import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import {
  CasinoError,
  LogField,
  addBalance,
  beginPlay,
  getBalance,
  recordGameResult,
  removeUpTo,
  sendGamblingLog,
  withTransaction,
} from './db';
import {
  BlackjackState,
  Card,
  CoinSide,
  HL_RANKS,
  HighLowGuess,
  HighLowOutcome,
  HlCard,
  HORSES,
  HorseBetType,
  ROULETTE_BET_LABEL,
  ROULETTE_BET_TYPES,
  RED_NUMBERS,
  RouletteBetType,
  bjScore,
  dealBlackjack,
  dealerPlay,
  hlFirstCard,
  hlNextCard,
  playChinchiro,
  playCoinflip,
  playHorse,
  playRoulette,
  playSlot,
} from './engine';
import { CasinoSettings, applyTax, highLowTotalMul } from './settings';

/**
 * Web・アクティビティのカジノ。各ゲームの流れ（賭け金の受付→抽選→払い戻し→ログ→戦績）は cogs/gambling.py と同じ。
 * お金の出入りと戦績は1つのトランザクションで確定させ、ログはその後に送る。
 */

export interface PlayContext {
  pool: Pool;
  s: CasinoSettings;
  guildId: string;
  userId: string;
}

const GOLD = 0xf1c40f;
const RED = 0xe74c3c;
const GREY = 0x95a5a6;

const fmt = (n: number) => n.toLocaleString('ja-JP');
const money = (ctx: PlayContext, n: number) => `${fmt(n)} ${ctx.s.currencyName}`;
const player = (ctx: PlayContext): LogField => ({ name: 'プレイヤー', value: `<@${ctx.userId}> (ID: ${ctx.userId})`, inline: true });
const betField = (ctx: PlayContext, bet: number): LogField => ({ name: '賭け金', value: money(ctx, bet), inline: true });

// ---------------- コイントス ----------------

export async function coinflip(ctx: PlayContext, body: any) {
  const side: CoinSide = body?.choice === 'tails' ? 'tails' : body?.choice === 'heads' ? 'heads' : (null as never);
  if (!side) throw new CasinoError('表か裏を選んでください');
  const result = await withTransaction(ctx.pool, async (client) => {
    const { bet, playNumber } = await beginPlay(client, ctx.s, ctx.guildId, ctx.userId, body?.bet);
    const r = playCoinflip(ctx.s, side);
    const { payout, tax } = r.win ? applyTax(ctx.s, bet, Math.trunc(bet * r.mul)) : { payout: 0, tax: 0 };
    await addBalance(client, ctx.guildId, ctx.userId, payout);
    await recordGameResult(client, { guildId: ctx.guildId, userId: ctx.userId, game: 'coinflip', isWin: r.win, isDraw: false, bet, payout });
    return { bet, playNumber, ...r, payout, tax, balance: await getBalance(client, ctx.guildId, ctx.userId) };
  });
  const label = (x: CoinSide) => (x === 'heads' ? '表' : '裏');
  await sendGamblingLog(ctx.pool, ctx.guildId, {
    title: '🪙 ギャンブルログ: コイントス',
    color: result.win ? GOLD : RED,
    fields: [
      player(ctx),
      betField(ctx, result.bet),
      { name: '結果', value: result.win ? '勝ち (当たり) 🏆' : '負け (外れ) 💀', inline: true },
      result.win
        ? { name: '獲得額 (配当)', value: `+${money(ctx, result.payout)}`, inline: true }
        : { name: '損失額', value: `-${money(ctx, result.bet)}`, inline: true },
      { name: '選択', value: label(side), inline: true },
      { name: '実際の結果', value: label(result.result), inline: true },
    ],
  });
  return result;
}

// ---------------- スロット ----------------

export async function slot(ctx: PlayContext, body: any) {
  const result = await withTransaction(ctx.pool, async (client) => {
    const { bet, playNumber } = await beginPlay(client, ctx.s, ctx.guildId, ctx.userId, body?.bet);
    const r = playSlot(ctx.s);
    const raw = Math.trunc(bet * r.mul);
    const { payout, tax } = raw > 0 ? applyTax(ctx.s, bet, raw) : { payout: 0, tax: 0 };
    await addBalance(client, ctx.guildId, ctx.userId, payout);
    await recordGameResult(client, {
      guildId: ctx.guildId, userId: ctx.userId, game: 'slot', isWin: payout > 0, isDraw: false, bet, payout, kind: r.kind,
    });
    return { bet, playNumber, reels: r.reels, mul: r.mul, win: payout > 0, payout, tax, balance: await getBalance(client, ctx.guildId, ctx.userId) };
  });
  await sendGamblingLog(ctx.pool, ctx.guildId, {
    title: '🎰 ギャンブルログ: スロット',
    color: result.win ? GOLD : RED,
    fields: [
      player(ctx),
      betField(ctx, result.bet),
      { name: '結果', value: result.win ? '当たり 🏆' : 'ハズレ 💀', inline: true },
      result.win
        ? { name: '獲得額 (配当)', value: `+${money(ctx, result.payout)} (倍率: ${result.mul}倍)`, inline: true }
        : { name: '損失額', value: `-${money(ctx, result.bet)}`, inline: true },
      { name: '出目', value: result.reels.join(' | '), inline: true },
    ],
  });
  return result;
}

// ---------------- ルーレット ----------------

export async function roulette(ctx: PlayContext, body: any) {
  const type = body?.bet_type as RouletteBetType;
  if (!(ROULETTE_BET_TYPES as readonly string[]).includes(type)) throw new CasinoError('賭け先を選んでください');
  let target: number | null = null;
  if (type === 'number') {
    target = body?.number;
    if (!Number.isInteger(target) || (target as number) < 0 || (target as number) > 36) {
      throw new CasinoError('0〜36の数字を選んでください');
    }
  }
  const result = await withTransaction(ctx.pool, async (client) => {
    const { bet, playNumber } = await beginPlay(client, ctx.s, ctx.guildId, ctx.userId, body?.bet);
    const r = playRoulette(ctx.s, type, target);
    const { payout, tax } = r.win ? applyTax(ctx.s, bet, Math.trunc(bet * r.mul)) : { payout: 0, tax: 0 };
    await addBalance(client, ctx.guildId, ctx.userId, payout);
    await recordGameResult(client, {
      guildId: ctx.guildId, userId: ctx.userId, game: 'roulette', isWin: r.win, isDraw: false, bet, payout, kind: r.kind,
    });
    return { bet, playNumber, number: r.number, win: r.win, mul: r.mul, payout, tax, balance: await getBalance(client, ctx.guildId, ctx.userId) };
  });
  const betLabel = type === 'number' ? `🎯 数字 1点賭け: ${target}` : ROULETTE_BET_LABEL[type];
  const n = result.number;
  await sendGamblingLog(ctx.pool, ctx.guildId, {
    title: '🎡 ギャンブルログ: ルーレット',
    color: result.win ? GOLD : RED,
    fields: [
      player(ctx),
      betField(ctx, result.bet),
      { name: '結果', value: result.win ? '当たり 🏆' : 'ハズレ 💀', inline: true },
      result.win
        ? { name: '獲得額 (配当)', value: `+${money(ctx, result.payout - result.bet)} (倍率: ${result.mul}倍)`, inline: true }
        : { name: '損失額', value: `-${money(ctx, result.bet)}`, inline: true },
      { name: '賭け先', value: betLabel, inline: true },
      { name: '出目', value: n === 0 ? '🟢0' : `${RED_NUMBERS.has(n) ? '🔴' : '⚫'}${n}`, inline: true },
    ],
  });
  return result;
}

// ---------------- 競馬 ----------------

export async function horse(ctx: PlayContext, body: any) {
  const horseNum = body?.horse;
  const type: HorseBetType = body?.bet_type === 'fuku' ? 'fuku' : body?.bet_type === 'tan' ? 'tan' : (null as never);
  if (!HORSES.some((h) => h.num === horseNum)) throw new CasinoError('馬を選んでください');
  if (!type) throw new CasinoError('単勝か複勝を選んでください');
  const result = await withTransaction(ctx.pool, async (client) => {
    const { bet, playNumber } = await beginPlay(client, ctx.s, ctx.guildId, ctx.userId, body?.bet);
    const r = playHorse(ctx.s, horseNum, type);
    const { payout, tax } = r.win ? applyTax(ctx.s, bet, Math.trunc(bet * r.mul)) : { payout: 0, tax: 0 };
    await addBalance(client, ctx.guildId, ctx.userId, payout);
    await recordGameResult(client, {
      guildId: ctx.guildId, userId: ctx.userId, game: 'horse', isWin: r.win, isDraw: false, bet, payout,
      kind: r.win ? (type === 'tan' ? 'tan_win' : 'fuku_win') : null,
    });
    return { bet, playNumber, ...r, payout, tax, balance: await getBalance(client, ctx.guildId, ctx.userId) };
  });
  const h = HORSES.find((x) => x.num === horseNum)!;
  const typeLabel = type === 'tan' ? `単勝 (${ctx.s.horse.mulTan}倍)` : `複勝 (${ctx.s.horse.mulFuku}倍)`;
  const medals = ['🥇 1着', '🥈 2着', '🥉 3着'];
  await sendGamblingLog(ctx.pool, ctx.guildId, {
    title: '🏇 ギャンブルログ: 競馬',
    color: result.win ? GOLD : RED,
    fields: [
      player(ctx),
      betField(ctx, result.bet),
      { name: '馬券種別・選択馬', value: `${h.emoji} ${h.name} (${typeLabel})`, inline: true },
      { name: '結果', value: `${result.win ? '的中 🏆' : 'ハズレ 💀'} (${result.rank}着)`, inline: true },
      result.win
        ? { name: '獲得額 (配当)', value: `+${money(ctx, result.payout)} (倍率: ${result.mul}倍)`, inline: true }
        : { name: '損失額', value: `-${money(ctx, result.bet)}`, inline: true },
      {
        name: '確定TOP3',
        value: result.ranking.slice(0, 3).map((n, i) => `${medals[i]} ${HORSES.find((x) => x.num === n)!.name}`).join('\n'),
        inline: false,
      },
    ],
  });
  return result;
}

// ---------------- チンチロリン ----------------

export async function chinchiro(ctx: PlayContext, body: any) {
  const result = await withTransaction(ctx.pool, async (client) => {
    const { bet, playNumber } = await beginPlay(client, ctx.s, ctx.guildId, ctx.userId, body?.bet);
    const r = playChinchiro(ctx.s);
    const pm = r.playerHand.mul;
    const bm = r.npcHand.mul;
    let payout = 0; // 戻ってきた額（賭け金を含む）
    let winAmount = 0; // 儲け
    let tax = 0;
    let loss = bet; // 失った額（追加の負けを含む）
    if (r.status === 'draw') {
      payout = bet;
      loss = 0;
      await addBalance(client, ctx.guildId, ctx.userId, bet);
    } else if (r.status === 'player_win') {
      const winMul = bm < 0 ? pm * Math.abs(bm) : pm;
      winAmount = Math.trunc(bet * winMul);
      if (ctx.s.taxEnabled) {
        tax = Math.trunc(winAmount * ctx.s.taxRate); // チンチロだけは儲けそのものに課税（Bot と同じ）
        winAmount -= tax;
      }
      payout = bet + winAmount;
      loss = 0;
      await addBalance(client, ctx.guildId, ctx.userId, payout);
    } else {
      let lossMul = bm > 0 ? bm : 1;
      if (pm < 0) lossMul *= Math.abs(pm);
      const extra = Math.trunc(bet * (lossMul - 1));
      if (extra > 0) loss = bet + (await removeUpTo(client, ctx.guildId, ctx.userId, extra));
    }
    await recordGameResult(client, {
      guildId: ctx.guildId, userId: ctx.userId, game: 'chinchiro',
      isWin: r.status === 'player_win', isDraw: r.status === 'draw',
      bet: r.status === 'npc_win' ? loss : bet,
      payout: r.status === 'player_win' ? winAmount : r.status === 'draw' ? bet : 0,
      kind: r.kind,
    });
    return { bet, playNumber, ...r, payout, winAmount, tax, loss, balance: await getBalance(client, ctx.guildId, ctx.userId) };
  });
  await sendGamblingLog(ctx.pool, ctx.guildId, {
    title: '🎲 ギャンブルログ: チンチロリン',
    color: result.status === 'player_win' ? GOLD : result.status === 'npc_win' ? RED : GREY,
    fields: [
      player(ctx),
      betField(ctx, result.bet),
      result.status === 'draw'
        ? { name: '結果', value: '引き分け 🤝', inline: true }
        : result.status === 'player_win'
          ? { name: '結果', value: 'プレイヤー勝利 🏆', inline: true }
          : { name: '結果', value: 'ディーラー勝利 (負け) 💀', inline: true },
      result.status === 'draw'
        ? { name: '獲得額', value: '±0', inline: true }
        : result.status === 'player_win'
          ? { name: '獲得額 (配当)', value: `+${money(ctx, result.winAmount)}`, inline: true }
          : { name: '損失額', value: `-${money(ctx, result.loss)}`, inline: true },
      { name: 'プレイヤーの役', value: result.playerHand.name, inline: true },
      { name: 'Botの役', value: result.npcHand.name, inline: true },
    ],
  });
  return result;
}

// ---------------- ブラックジャック ----------------

type BjOutcome = 'bj' | 'push' | 'bust' | 'win' | 'dealer_bust' | 'lose' | 'draw';

interface BjSessionRow {
  id: string;
  bet: string;
  play_number: number;
  state: BlackjackState;
}

/** ブラウザに見せる形。ゲーム中はディーラーの2枚目と山札を隠す */
function bjView(state: BlackjackState, final: boolean) {
  const dealer = final ? state.dealer : [state.dealer[0]];
  return {
    player: state.player,
    player_score: bjScore(state.player),
    dealer: final ? state.dealer : [state.dealer[0], null],
    dealer_score: bjScore(dealer as Card[]),
  };
}

async function loadBjSession(client: PoolClient | Pool, ctx: PlayContext, lock: boolean): Promise<BjSessionRow | null> {
  const res = await client.query(
    `SELECT id, bet::text AS bet, play_number, state FROM web_casino_sessions
      WHERE guild_id = $1 AND user_id = $2 AND game = 'blackjack'
      ORDER BY created_at ASC LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [ctx.guildId, ctx.userId]
  );
  return res.rows[0] ?? null;
}

/** 勝負を決めて払い戻す（Bot の resolve_stand / resolve_bust / check_initial_blackjack） */
async function settleBlackjack(client: PoolClient, ctx: PlayContext, bet: number, state: BlackjackState, reason: 'initial' | 'bust' | 'stand') {
  const playerScore = bjScore(state.player);
  let outcome: BjOutcome;
  let raw = 0;
  let isWin = false;
  let isDraw = false;
  let kind: string | null = null;

  if (reason === 'initial') {
    if (bjScore(state.dealer) === 21) {
      outcome = 'push';
      raw = bet;
      isDraw = true;
    } else {
      outcome = 'bj';
      raw = Math.trunc(bet * ctx.s.blackjack.mulBj);
      isWin = true;
    }
    kind = 'bj_win';
  } else if (reason === 'bust') {
    outcome = 'bust';
    kind = 'bust';
  } else {
    dealerPlay(state);
    const dealerScore = bjScore(state.dealer);
    if (dealerScore > 21 || playerScore > dealerScore) {
      outcome = dealerScore > 21 ? 'dealer_bust' : 'win';
      raw = Math.trunc(bet * ctx.s.blackjack.mulNormal);
      isWin = true;
      kind = 'normal_win';
    } else if (playerScore < dealerScore) {
      outcome = 'lose';
    } else {
      outcome = 'draw';
      raw = bet;
      isDraw = true;
    }
  }
  const { payout, tax } = isWin ? applyTax(ctx.s, bet, raw) : { payout: raw, tax: 0 };
  await addBalance(client, ctx.guildId, ctx.userId, payout);
  await recordGameResult(client, { guildId: ctx.guildId, userId: ctx.userId, game: 'blackjack', isWin, isDraw, bet, payout, kind });
  return { outcome, payout, tax, isWin, isDraw };
}

async function logBlackjack(ctx: PlayContext, bet: number, state: BlackjackState, r: Awaited<ReturnType<typeof settleBlackjack>>) {
  const label: Record<BjOutcome, string> = {
    bj: 'プレイヤー勝利 (BJ) 🏆',
    push: '引き分け (双方BJ) 🤝',
    bust: 'プレイヤー敗北 (バスト) 💀',
    win: 'プレイヤー勝利 🏆',
    dealer_bust: 'プレイヤー勝利 (ディーラーバスト) 🏆',
    lose: 'プレイヤー敗北 💀',
    draw: '引き分け 🤝',
  };
  await sendGamblingLog(ctx.pool, ctx.guildId, {
    title: '🃏 ギャンブルログ: ブラックジャック',
    color: r.isWin ? GOLD : r.isDraw ? GREY : RED,
    fields: [
      player(ctx),
      betField(ctx, bet),
      { name: '結果', value: label[r.outcome], inline: true },
      r.isWin
        ? { name: '獲得額 (配当)', value: `+${money(ctx, r.payout - bet)}`, inline: true }
        : r.isDraw
          ? { name: '獲得額', value: '±0', inline: true }
          : { name: '損失額', value: `-${money(ctx, bet)}`, inline: true },
      { name: 'プレイヤー手札', value: `Score: ${bjScore(state.player)}`, inline: true },
      { name: 'ディーラー手札', value: `Score: ${r.outcome === 'bust' ? bjScore([state.dealer[0]]) : bjScore(state.dealer)}`, inline: true },
    ],
  });
}

/** 進行中のブラックジャック（あれば）。画面を開き直したときに続きから遊べるようにする */
export async function activeBlackjack(ctx: PlayContext) {
  const row = await loadBjSession(ctx.pool, ctx, false);
  if (!row) return null;
  return { id: row.id, bet: Number(row.bet), play_number: row.play_number, finished: false, ...bjView(row.state, false) };
}

export async function blackjack(ctx: PlayContext, body: any) {
  const action = body?.action;
  if (action === 'start') {
    const out = await withTransaction(ctx.pool, async (client) => {
      // 進行中のゲームがあれば、新しく賭けずにそれを返す
      const existing = await loadBjSession(client, ctx, true);
      if (existing) {
        return { resumed: true, id: existing.id, bet: Number(existing.bet), playNumber: existing.play_number, state: existing.state, settled: null };
      }
      const { bet, playNumber } = await beginPlay(client, ctx.s, ctx.guildId, ctx.userId, body?.bet);
      const state = dealBlackjack(ctx.s);
      if (bjScore(state.player) === 21) {
        const settled = await settleBlackjack(client, ctx, bet, state, 'initial');
        return { resumed: false, id: null, bet, playNumber, state, settled };
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO web_casino_sessions (id, guild_id, user_id, game, bet, play_number, state)
         VALUES ($1, $2, $3, 'blackjack', $4, $5, $6::jsonb)`,
        [id, ctx.guildId, ctx.userId, bet, playNumber, JSON.stringify(state)]
      );
      return { resumed: false, id, bet, playNumber, state, settled: null };
    });
    if (out.settled) await logBlackjack(ctx, out.bet, out.state, out.settled);
    return {
      id: out.id,
      resumed: out.resumed,
      bet: out.bet,
      playNumber: out.playNumber,
      finished: !!out.settled,
      ...(out.settled ?? {}),
      ...bjView(out.state, !!out.settled),
      balance: await getBalance(ctx.pool, ctx.guildId, ctx.userId),
    };
  }

  if (action !== 'hit' && action !== 'stand') throw new CasinoError('操作が不正です');
  const out = await withTransaction(ctx.pool, async (client) => {
    const row = await loadBjSession(client, ctx, true);
    if (!row || (body?.id && row.id !== body.id)) throw new CasinoError('進行中のゲームが見つかりません。もう一度始めてください', 409);
    const bet = Number(row.bet);
    const state = row.state;
    let settled: Awaited<ReturnType<typeof settleBlackjack>> | null = null;
    if (action === 'hit') {
      state.player.push(state.deck.pop()!);
      const score = bjScore(state.player);
      if (score > 21) settled = await settleBlackjack(client, ctx, bet, state, 'bust');
      else if (score === 21) settled = await settleBlackjack(client, ctx, bet, state, 'stand');
    } else {
      settled = await settleBlackjack(client, ctx, bet, state, 'stand');
    }
    if (settled) await client.query('DELETE FROM web_casino_sessions WHERE id = $1', [row.id]);
    else {
      await client.query('UPDATE web_casino_sessions SET state = $1::jsonb, updated_at = NOW() WHERE id = $2', [
        JSON.stringify(state),
        row.id,
      ]);
    }
    return { id: row.id, bet, playNumber: row.play_number, state, settled };
  });
  if (out.settled) await logBlackjack(ctx, out.bet, out.state, out.settled);
  return {
    id: out.id,
    resumed: false,
    bet: out.bet,
    playNumber: out.playNumber,
    finished: !!out.settled,
    ...(out.settled ?? {}),
    ...bjView(out.state, !!out.settled),
    balance: await getBalance(ctx.pool, ctx.guildId, ctx.userId),
  };
}

/** 放置されたブラックジャック（Bot では60秒で自動的に勝負）を、10分たったら勝負して片付ける */
export async function settleStaleBlackjack(ctx: PlayContext): Promise<void> {
  const stale = await ctx.pool.query(
    `SELECT id FROM web_casino_sessions
      WHERE guild_id = $1 AND user_id = $2 AND game = 'blackjack' AND updated_at < NOW() - INTERVAL '10 minutes'`,
    [ctx.guildId, ctx.userId]
  );
  for (const { id } of stale.rows) {
    try {
      await blackjack(ctx, { action: 'stand', id });
    } catch (e) {
      console.error('settleStaleBlackjack failed:', e);
    }
  }
}

export const HORSE_LIST = HORSES;

// ---------------- High & Low ----------------

interface HighLowState {
  card: HlCard;
  history: HlCard[];
  streak: number;
  revealed: boolean;
}
type HlReason = 'lose' | 'cashout' | 'max' | 'timeout';

interface HlSessionRow {
  id: string;
  bet: string;
  play_number: number;
  state: HighLowState;
}

const hlText = (c: HlCard) => `${c.suit}${HL_RANKS[c.value - 1]}`;
const hlAmount = (ctx: PlayContext, bet: number, streak: number) => Math.trunc(bet * highLowTotalMul(ctx.s.highlow, streak));

async function loadHlSession(client: PoolClient | Pool, ctx: PlayContext, lock: boolean): Promise<HlSessionRow | null> {
  const res = await client.query(
    `SELECT id, bet::text AS bet, play_number, state FROM web_casino_sessions
      WHERE guild_id = $1 AND user_id = $2 AND game = 'highlow'
      ORDER BY created_at ASC LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [ctx.guildId, ctx.userId]
  );
  return res.rows[0] ?? null;
}

/** 勝負を終えて払い戻す（cogs/gambling.py の HighLowGameView.finish と同じ） */
async function settleHighLow(client: PoolClient, ctx: PlayContext, bet: number, state: HighLowState, reason: HlReason) {
  let payout = 0;
  let tax = 0;
  if (reason !== 'lose') {
    const raw = hlAmount(ctx, bet, state.streak);
    ({ payout, tax } = raw > bet ? applyTax(ctx.s, bet, raw) : { payout: raw, tax: 0 });
    await addBalance(client, ctx.guildId, ctx.userId, payout);
  }
  const isWin = reason !== 'lose' && state.streak > 0;
  const isDraw = reason !== 'lose' && state.streak === 0;
  const kind = reason === 'lose' ? 'miss' : reason === 'max' ? 'max_streak' : isWin ? 'cashout' : null;
  await recordGameResult(client, { guildId: ctx.guildId, userId: ctx.userId, game: 'highlow', isWin, isDraw, bet, payout, kind });
  return { reason, payout, tax, isWin, isDraw };
}

async function logHighLow(ctx: PlayContext, bet: number, state: HighLowState, r: Awaited<ReturnType<typeof settleHighLow>>) {
  await sendGamblingLog(ctx.pool, ctx.guildId, {
    title: '🃏 ギャンブルログ: High & Low',
    color: r.isWin ? GOLD : r.isDraw ? GREY : RED,
    fields: [
      player(ctx),
      betField(ctx, bet),
      { name: '結果', value: r.isWin ? '勝ち 🏆' : r.isDraw ? '引き分け 🤝' : '負け 💀', inline: true },
      r.isWin
        ? { name: '獲得額 (配当)', value: `+${money(ctx, r.payout - bet)}`, inline: true }
        : r.isDraw
          ? { name: '獲得額', value: '±0', inline: true }
          : { name: '損失額', value: `-${money(ctx, bet)}`, inline: true },
      { name: '連勝', value: `${state.streak}連勝`, inline: true },
      { name: 'カード', value: state.history.slice(-12).map(hlText).join(' → '), inline: false },
    ],
  });
}

function hlView(ctx: PlayContext, id: string | null, bet: number, playNumber: number, state: HighLowState) {
  const max = ctx.s.highlow.maxStreak;
  return {
    id,
    bet,
    playNumber,
    card: state.card,
    history: state.history.slice(-12),
    streak: state.streak,
    max_streak: max,
    mul: ctx.s.highlow.mul,
    muls: highLowMuls(ctx.s),
    revealed: state.revealed,
    amount: hlAmount(ctx, bet, state.streak),
    next_amount: state.streak < max ? hlAmount(ctx, bet, state.streak + 1) : null,
  };
}

/** 1連勝〜最大連勝の受け取り倍率（画面の連勝メーター用） */
export function highLowMuls(s: CasinoSettings): number[] {
  return Array.from({ length: s.highlow.maxStreak }, (_, i) => Math.round(highLowTotalMul(s.highlow, i + 1) * 100) / 100);
}

/** 進行中の High & Low（あれば）。画面を開き直したときに続きから遊べるようにする */
export async function activeHighLow(ctx: PlayContext) {
  const row = await loadHlSession(ctx.pool, ctx, false);
  if (!row) return null;
  return { ...hlView(ctx, row.id, Number(row.bet), row.play_number, row.state), finished: false };
}

export async function highlow(ctx: PlayContext, body: any) {
  const action = body?.action;
  if (action === 'start') {
    const out = await withTransaction(ctx.pool, async (client) => {
      const existing = await loadHlSession(client, ctx, true);
      if (existing) return { resumed: true, id: existing.id, bet: Number(existing.bet), playNumber: existing.play_number, state: existing.state };
      const { bet, playNumber } = await beginPlay(client, ctx.s, ctx.guildId, ctx.userId, body?.bet);
      const first = hlFirstCard();
      const state: HighLowState = { card: first, history: [first], streak: 0, revealed: false };
      const id = randomUUID();
      await client.query(
        `INSERT INTO web_casino_sessions (id, guild_id, user_id, game, bet, play_number, state)
         VALUES ($1, $2, $3, 'highlow', $4, $5, $6::jsonb)`,
        [id, ctx.guildId, ctx.userId, bet, playNumber, JSON.stringify(state)]
      );
      return { resumed: false, id, bet, playNumber, state };
    });
    return {
      ...hlView(ctx, out.id, out.bet, out.playNumber, out.state),
      resumed: out.resumed,
      finished: false,
      last: null,
      balance: await getBalance(ctx.pool, ctx.guildId, ctx.userId),
    };
  }

  if (action !== 'guess' && action !== 'cashout') throw new CasinoError('操作が不正です');
  const guess: HighLowGuess | null = body?.guess === 'high' ? 'high' : body?.guess === 'low' ? 'low' : null;
  if (action === 'guess' && !guess) throw new CasinoError('High か Low を選んでください');
  const out = await withTransaction(ctx.pool, async (client) => {
    const row = await loadHlSession(client, ctx, true);
    if (!row || (body?.id && row.id !== body.id)) throw new CasinoError('進行中のゲームが見つかりません。もう一度始めてください', 409);
    const bet = Number(row.bet);
    const state = row.state;
    let last: { guess: HighLowGuess; outcome: HighLowOutcome; from: HlCard } | null = null;
    let settled: Awaited<ReturnType<typeof settleHighLow>> | null = null;
    if (action === 'guess') {
      const from = state.card;
      const r = hlNextCard(ctx.s, from.value, guess!, state.streak);
      state.card = r.card;
      state.history.push(r.card);
      state.revealed = true;
      last = { guess: guess!, outcome: r.outcome, from };
      if (r.outcome === 'lose') settled = await settleHighLow(client, ctx, bet, state, 'lose');
      else if (r.outcome === 'win') {
        state.streak += 1;
        if (state.streak >= ctx.s.highlow.maxStreak) settled = await settleHighLow(client, ctx, bet, state, 'max');
      }
    } else {
      if (!state.revealed) throw new CasinoError('1回以上めくってから受け取れます');
      settled = await settleHighLow(client, ctx, bet, state, (body?.reason === 'timeout' ? 'timeout' : 'cashout') as HlReason);
    }
    if (settled) await client.query('DELETE FROM web_casino_sessions WHERE id = $1', [row.id]);
    else {
      await client.query('UPDATE web_casino_sessions SET state = $1::jsonb, updated_at = NOW() WHERE id = $2', [JSON.stringify(state), row.id]);
    }
    return { id: row.id, bet, playNumber: row.play_number, state, last, settled };
  });
  if (out.settled) await logHighLow(ctx, out.bet, out.state, out.settled);
  return {
    ...hlView(ctx, out.id, out.bet, out.playNumber, out.state),
    resumed: false,
    finished: !!out.settled,
    last: out.last,
    result: out.settled,
    balance: await getBalance(ctx.pool, ctx.guildId, ctx.userId),
  };
}

/** 放置された High & Low を、10分たったらその時点の額で受け取って片付ける（まだめくっていなければ賭け金を返す） */
export async function settleStaleHighLow(ctx: PlayContext): Promise<void> {
  const stale = await ctx.pool.query(
    `SELECT id FROM web_casino_sessions
      WHERE guild_id = $1 AND user_id = $2 AND game = 'highlow' AND updated_at < NOW() - INTERVAL '10 minutes'`,
    [ctx.guildId, ctx.userId]
  );
  for (const { id } of stale.rows) {
    try {
      const out = await withTransaction(ctx.pool, async (client) => {
        const row = await loadHlSession(client, ctx, true);
        if (!row || row.id !== id) return null;
        const settled = await settleHighLow(client, ctx, Number(row.bet), row.state, 'timeout');
        await client.query('DELETE FROM web_casino_sessions WHERE id = $1', [row.id]);
        return { bet: Number(row.bet), state: row.state, settled };
      });
      if (out) await logHighLow(ctx, out.bet, out.state, out.settled);
    } catch (e) {
      console.error('settleStaleHighLow failed:', e);
    }
  }
}
