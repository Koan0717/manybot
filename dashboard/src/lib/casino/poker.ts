import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { CasinoError, addBalance, getBalance, recordGameResult, sendGamblingLog, withTransaction } from './db';
import { POKER_AI_BET_MIN_LEVEL } from './settings';
import type { PlayContext } from './games';
import { AI_LEVEL_NAMES, PCard, PokerTable, TableState, aiDecide, bestHandName, newPlayer, newTable } from '@/lib/poker/engine';

/**
 * Web・アクティビティのポーカー（AIと1対1。メンバー画面の「ゲーム」タブで遊ぶ）。流れは cogs/poker.py の AI 対戦と同じ:
 * お互い同じチップから始め、決めたハンド数が終わったとき（どちらかのチップがなくなったらその時点）にチップが多い方の勝ち。
 * 賭けがONでレベル4以上なら、持ち込んだ通貨がそのままチップになる（AI も同じ額から始める）。
 * 終了したとき・席を立ったときに残ったチップを通貨で受け取る。賭けなしのときは設定のチップで遊び、通貨は動かない。
 * 卓の状態（山札・AIの手札を含む）は web_casino_sessions にだけ置き、ブラウザには見せてよいものだけ返す。
 */

const AI_UID = 'ai';
const MAX_LEVEL = 6;
const GOLD = 0xf1c40f;
const RED = 0xe74c3c;
const GREY = 0x95a5a6;
const BETTING = ['preflop', 'flop', 'turn', 'river'];

interface PokerState {
  table: TableState;
  level: number;
  /** 旧ルール（勝つと 賭け金×倍率）で始まった対戦の倍率。チップ＝通貨の対戦では使わない */
  mult: number;
  /** チップ＝通貨（持ち込んだ額がそのままチップ）の対戦か */
  chipMoney?: boolean;
  maxHands: number;
  blindUp: number;
  startChips: number;
  /** ブラインドが上がったハンド番号（画面にお知らせを出す用） */
  blindUpAt?: number;
}

interface SessionRow {
  id: string;
  bet: string;
  state: PokerState;
}

type FinalResult = 'win' | 'lose' | 'draw';
interface Final {
  result: FinalResult;
  resigned: boolean;
  payout: number;
  my_stack: number;
  ai_stack: number;
  hands: number;
}

const fmt = (n: number) => n.toLocaleString('ja-JP');

async function loadSession(client: PoolClient | Pool, ctx: PlayContext, lock: boolean): Promise<SessionRow | null> {
  const res = await client.query(
    `SELECT id, bet::text AS bet, state FROM web_casino_sessions
      WHERE guild_id = $1 AND user_id = $2 AND game = 'poker'
      ORDER BY created_at ASC LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [ctx.guildId, ctx.userId]
  );
  return res.rows[0] ?? null;
}

/** AI の番が続くあいだ AI に行動させる。AI の行動（表示用の文）を返す */
function runAi(t: PokerTable): string[] {
  const events: string[] = [];
  for (let guard = 0; guard < 50; guard++) {
    const cur = t.currentPlayer();
    if (!cur || cur.uid !== AI_UID || !BETTING.includes(t.s.street)) break;
    try {
      let [action, amount] = aiDecide(t, AI_UID);
      if (action === 'check' && !t.options()!.can_check) action = 'call';
      events.push(t.act(AI_UID, action, amount));
    } catch (e) {
      console.error('[poker] AI error:', e);
      const o = t.options();
      events.push(t.act(AI_UID, o?.can_check ? 'check' : 'fold'));
    }
  }
  return events;
}

/** ハンドが終わったあと、ゲームを終えるかどうか（cogs/poker.py の hand_finished と同じ） */
function isOver(st: PokerState): boolean {
  const t = st.table;
  const alive = t.players.filter((p) => p.stack > 0 && !p.leaving);
  return alive.length < 2 || (st.maxHands > 0 && t.handNo >= st.maxHands);
}

/** ゲームを終えて精算する（cogs/poker.py の finish_game の AI 対戦部分） */
async function settle(client: PoolClient, ctx: PlayContext, row: SessionRow, resigned: boolean): Promise<Final> {
  const st = row.state;
  const t = st.table;
  const bet = Number(row.bet) || 0;
  const chipMoney = bet > 0 && !!st.chipMoney;
  const me = t.players.find((p) => p.uid !== AI_UID)!;
  const ai = t.players.find((p) => p.uid === AI_UID)!;
  if (t.street !== 'done' && t.street !== 'waiting') {
    if (resigned && chipMoney) {
      // チップ＝通貨で席を立った: 今のハンドに出したチップはフォールドしたものとして AI のもの
      ai.stack += t.players.reduce((a, p) => a + p.totalIn, 0);
    } else {
      // 途中のハンドで出していたチップは、出した人に戻して比べる
      for (const p of t.players) p.stack += p.totalIn;
    }
    for (const p of t.players) {
      p.totalIn = 0;
      p.bet = 0;
    }
  }
  let result: FinalResult;
  let payout = 0;
  if (chipMoney) {
    // 残ったチップをそのまま受け取る。持ち込んだ額より増えたら勝ち
    result = me.stack > bet ? 'win' : me.stack < bet ? 'lose' : 'draw';
    payout = me.stack;
    await addBalance(client, ctx.guildId, ctx.userId, payout);
  } else {
    result = resigned ? 'lose' : me.stack > ai.stack ? 'win' : me.stack < ai.stack ? 'lose' : 'draw';
    if (bet > 0) {
      if (result === 'win') payout = Math.trunc(bet * st.mult);
      else if (result === 'draw') payout = bet;
      await addBalance(client, ctx.guildId, ctx.userId, payout);
    }
  }
  await recordGameResult(client, {
    guildId: ctx.guildId,
    userId: ctx.userId,
    game: 'poker',
    isWin: result === 'win',
    isDraw: result === 'draw',
    bet,
    payout,
    kind: result === 'win' ? 'ai_wins' : result === 'draw' ? 'ai_draws' : 'ai_losses',
  });
  await client.query('DELETE FROM web_casino_sessions WHERE id = $1', [row.id]);
  return { result, resigned, payout, my_stack: me.stack, ai_stack: ai.stack, hands: t.handNo };
}

async function logPoker(ctx: PlayContext, bet: number, st: PokerState, f: Final) {
  if (bet <= 0) return; // 賭けていない対戦はログに出さない
  const money = (n: number) => `${fmt(n)} ${ctx.s.currencyName}`;
  await sendGamblingLog(ctx.pool, ctx.guildId, {
    title: '🃏 ギャンブルログ: ポーカー（AI対戦）',
    color: f.result === 'win' ? GOLD : f.result === 'draw' ? GREY : RED,
    fields: [
      { name: 'プレイヤー', value: `<@${ctx.userId}> (ID: ${ctx.userId})`, inline: true },
      { name: st.chipMoney ? '持ち込み（チップ）' : '賭け金', value: money(bet), inline: true },
      {
        name: '結果',
        value:
          (f.result === 'win' ? '勝ち 🏆' : f.result === 'draw' ? '引き分け 🤝' : '負け 💀') +
          (f.resigned ? (st.chipMoney ? '（途中で席を立った）' : '（降参）') : ''),
        inline: true,
      },
      f.payout - bet > 0
        ? { name: '獲得額', value: `+${money(f.payout - bet)}`, inline: true }
        : f.payout - bet === 0
          ? { name: '獲得額', value: '±0', inline: true }
          : { name: '損失額', value: `-${money(bet - f.payout)}`, inline: true },
      { name: 'AIレベル', value: `Lv${st.level}（${AI_LEVEL_NAMES[st.level]}）`, inline: true },
      { name: '最終チップ', value: `あなた ${fmt(f.my_stack)} ／ AI ${fmt(f.ai_stack)}（${f.hands}ハンド）`, inline: false },
    ],
  });
}

/** ブラウザに見せる形。AI の手札はショーダウンのときだけ見せる */
function view(id: string | null, bet: number, st: PokerState) {
  const t = new PokerTable(st.table);
  const s = st.table;
  const me = s.players.find((p) => p.uid !== AI_UID)!;
  const ai = s.players.find((p) => p.uid === AI_UID)!;
  const meSeat = s.players.indexOf(me);
  const myTurn = BETTING.includes(s.street) && s.current === meSeat;
  const shown = s.result?.showdown ? s.result.hands[AI_UID]?.hole ?? null : null;
  const seat = (p: typeof me) => ({
    stack: p.stack,
    bet: p.bet,
    folded: p.folded,
    all_in: p.allIn,
    dealer: s.players.indexOf(p) === s.dealer,
  });
  return {
    id,
    bet,
    mult: st.mult,
    chip_money: bet > 0 && !!st.chipMoney,
    level: st.level,
    level_name: AI_LEVEL_NAMES[st.level],
    start_chips: st.startChips,
    max_hands: st.maxHands,
    hand_no: s.handNo,
    street: s.street,
    sb: s.sb,
    bb: s.bb,
    blind_up_now: st.blindUpAt === s.handNo + 1 && s.street === 'done',
    board: s.board,
    pot: t.pot(),
    me: { ...seat(me), hole: me.hole, hand_name: me.hole.length ? bestHandName([...me.hole, ...s.board]) : '' },
    ai: { ...seat(ai), hole: shown as PCard[] | null },
    my_turn: myTurn,
    options: myTurn ? t.options(me.uid) : null,
    log: s.log.slice(-8),
    hand_result: s.street === 'done' && s.result
      ? {
          showdown: s.result.showdown,
          pots: s.result.pots.map((p) => ({ amount: p.amount, winners: p.winners.map((u) => (u === AI_UID ? 'ai' : 'me')), hand: p.hand })),
          my_hand: s.result.hands[me.uid]?.name ?? null,
          ai_hand: s.result.hands[AI_UID]?.name ?? null,
        }
      : null,
  };
}

export type PokerView = ReturnType<typeof view>;

/** 進行中のポーカー（あれば）。画面を開き直したときに続きから遊べるようにする */
export async function activePoker(ctx: PlayContext) {
  const row = await loadSession(ctx.pool, ctx, false);
  if (!row) return null;
  return { ...view(row.id, Number(row.bet), row.state), finished: false, final: null, events: [] as string[] };
}

/** 画面に出す設定（レベルごとの倍率・賭け金の上限など） */
export function pokerInfo(ctx: PlayContext) {
  const p = ctx.s.poker;
  return {
    start_chips: p.startChips,
    sb: p.sb,
    bb: p.bb,
    blind_up: p.blindUp,
    max_hands: p.maxHands,
    bet_enabled: p.betEnabled,
    bet_min_level: POKER_AI_BET_MIN_LEVEL,
    ai_max_bet: p.aiMaxBet,
    level_names: AI_LEVEL_NAMES,
  };
}

/** ハンドが終わっていればゲーム終了かどうかを調べ、続くならブラインドを上げる */
function afterHand(st: PokerState): boolean {
  if (st.table.street !== 'done') return false;
  if (isOver(st)) return true;
  const up = st.blindUp;
  if (up && st.table.handNo % up === 0 && st.blindUpAt !== st.table.handNo + 1) {
    st.table.sb *= 2;
    st.table.bb *= 2;
    st.table.lastRaise = st.table.bb;
    st.blindUpAt = st.table.handNo + 1;
  }
  return false;
}

export async function poker(ctx: PlayContext, body: any) {
  const action = body?.action;

  if (action === 'start') {
    const level = Number(body?.level);
    if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw new CasinoError('AIのレベルを選んでください');
    const p = ctx.s.poker;
    const betting = p.betEnabled && level >= POKER_AI_BET_MIN_LEVEL;
    let bet = 0;
    if (betting) {
      bet = body?.bet;
      if (!Number.isSafeInteger(bet) || bet < p.bb) {
        throw new CasinoError(`持ち込む金額はビッグブラインド（${fmt(p.bb)}）以上の整数で入力してください`);
      }
      const limit = p.aiMaxBet[level] ?? 0;
      if (limit && bet > limit) throw new CasinoError(`レベル${level}の持ち込みの上限は ${fmt(limit)} ${ctx.s.currencyName} です`);
    }
    const out = await withTransaction(ctx.pool, async (client) => {
      const existing = await loadSession(client, ctx, true);
      if (existing) return { resumed: true, id: existing.id, bet: Number(existing.bet), state: existing.state, events: [] as string[] };
      if (bet > 0) {
        await client.query('INSERT INTO users (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ctx.guildId, ctx.userId]);
        const res = await client.query('SELECT balance FROM users WHERE guild_id = $1 AND user_id = $2 FOR UPDATE', [ctx.guildId, ctx.userId]);
        if ((Number(res.rows[0]?.balance) || 0) < bet) throw new CasinoError('残高が不足しています');
        await client.query('UPDATE users SET balance = balance - $1 WHERE guild_id = $2 AND user_id = $3', [bet, ctx.guildId, ctx.userId]);
      }
      // 賭けるときは持ち込んだ額がそのままチップ（AI も同じ額）
      const start = bet > 0 ? bet : p.startChips;
      const table = newTable([newPlayer(ctx.userId, 'あなた', start), newPlayer(AI_UID, 'AI', start, true, level)], p.sb, p.bb);
      const st: PokerState = {
        table,
        level,
        mult: 1,
        chipMoney: bet > 0,
        maxHands: p.maxHands,
        blindUp: p.blindUp,
        startChips: start,
      };
      const t = new PokerTable(table);
      t.startHand();
      const events = runAi(t);
      const id = randomUUID();
      await client.query(
        `INSERT INTO web_casino_sessions (id, guild_id, user_id, game, bet, play_number, state)
         VALUES ($1, $2, $3, 'poker', $4, 0, $5::jsonb)`,
        [id, ctx.guildId, ctx.userId, bet, JSON.stringify(st)]
      );
      return { resumed: false, id, bet, state: st, events };
    });
    return {
      ...view(out.id, out.bet, out.state),
      resumed: out.resumed,
      events: out.events,
      finished: false,
      final: null,
      balance: await getBalance(ctx.pool, ctx.guildId, ctx.userId),
    };
  }

  if (!['act', 'next', 'resign'].includes(action)) throw new CasinoError('操作が不正です');
  const out = await withTransaction(ctx.pool, async (client) => {
    const row = await loadSession(client, ctx, true);
    if (!row || (body?.id && row.id !== body.id)) throw new CasinoError('進行中のゲームが見つかりません。もう一度始めてください', 409);
    const st = row.state;
    const t = new PokerTable(st.table);
    const events: string[] = [];
    let final: Final | null = null;

    if (action === 'resign') {
      final = await settle(client, ctx, row, true);
    } else if (action === 'act') {
      const move = String(body?.move ?? '');
      if (!['fold', 'check', 'call', 'raise', 'allin'].includes(move)) throw new CasinoError('行動を選んでください');
      try {
        events.push(t.act(ctx.userId, move, Number(body?.amount) || 0));
      } catch (e: any) {
        throw new CasinoError(e?.message || 'その行動はできません');
      }
      events.push(...runAi(t));
      if (afterHand(st)) final = await settle(client, ctx, row, false);
    } else {
      // 次のハンドへ
      if (st.table.street !== 'done') throw new CasinoError('まだハンドの途中です');
      if (!t.startHand()) final = await settle(client, ctx, row, false);
      else {
        events.push(...runAi(t));
        if (afterHand(st)) final = await settle(client, ctx, row, false);
      }
    }

    if (!final) {
      await client.query('UPDATE web_casino_sessions SET state = $1::jsonb, updated_at = NOW() WHERE id = $2', [JSON.stringify(st), row.id]);
    }
    return { id: row.id, bet: Number(row.bet), state: st, events, final };
  });
  if (out.final) await logPoker(ctx, out.bet, out.state, out.final);
  return {
    ...view(out.id, out.bet, out.state),
    resumed: false,
    events: out.events,
    finished: !!out.final,
    final: out.final,
    balance: await getBalance(ctx.pool, ctx.guildId, ctx.userId),
  };
}

/**
 * 30分放置されたポーカーを片付ける。ハンドの途中なら自分はフォールドしたものとして、その時点のチップで勝ち負けを決める
 * （Bot でも持ち時間を過ぎるとフォールド扱いになる）。
 */
export async function settleStalePoker(ctx: PlayContext): Promise<void> {
  const stale = await ctx.pool.query(
    `SELECT id FROM web_casino_sessions
      WHERE guild_id = $1 AND user_id = $2 AND game = 'poker' AND updated_at < NOW() - INTERVAL '30 minutes'`,
    [ctx.guildId, ctx.userId]
  );
  for (const { id } of stale.rows) {
    try {
      const out = await withTransaction(ctx.pool, async (client) => {
        const row = await loadSession(client, ctx, true);
        if (!row || row.id !== id) return null;
        const t = new PokerTable(row.state.table);
        if (BETTING.includes(t.s.street) && t.currentPlayer()?.uid === ctx.userId) {
          t.act(ctx.userId, 'fold');
          runAi(t);
        }
        const final = await settle(client, ctx, row, false);
        return { bet: Number(row.bet), state: row.state, final };
      });
      if (out) await logPoker(ctx, out.bet, out.state, out.final);
    } catch (e) {
      console.error('settleStalePoker failed:', e);
    }
  }
}

