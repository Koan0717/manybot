import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { DiscordGuildMember, botRequest, memberAvatarUrl, memberDisplayName } from '@/lib/discordApi';
import { CasinoError, recordGameResult, withTransaction } from '@/lib/casino/db';
import * as O from './othello';
import * as C from './chess';
import * as S from './shogi';

/**
 * アクティビティ・Web のボードゲーム（オセロ・チェス・将棋）。
 * AI対戦と、メンバー同士の対戦（招待 → 受ける → 交互に指す。画面は数秒ごとに最新を取りに来る）。
 * ルール・AI・賭け・戦績は Bot（cogs/othello.py, cogs/board_games.py）と同じ。
 */

export const BOARD_GAMES = ['othello', 'chess', 'shogi'] as const;
export type BoardGame = (typeof BOARD_GAMES)[number];
export const BOARD_GAME_LABEL: Record<BoardGame, string> = { othello: 'オセロ', chess: 'チェス', shogi: '将棋' };
export const WEB_BOARDGAMES_KEY = 'WEB_BOARDGAMES_ENABLED';
export const isBoardGame = (v: unknown): v is BoardGame => typeof v === 'string' && (BOARD_GAMES as readonly string[]).includes(v);

const IDLE_LIMIT_MIN = 10; // 対人戦でこれだけ指さなければ時間切れ負け
const INVITE_LIMIT_MIN = 10;

// ---------------- 設定 ----------------

export interface BoardGameSettings {
  currencyName: string;
  enabled: Record<BoardGame, boolean>;
  bet: Record<BoardGame, { enabled: boolean; defaultBet: number }>;
}

export async function loadBoardGameSettings(pool: Pool, guildId: string): Promise<BoardGameSettings> {
  const s: Record<string, string> = {};
  try {
    const res = await pool.query(
      `SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key IN
         ($2, 'CURRENCY_NAME', 'OTHELLO_BET_ENABLED', 'OTHELLO_DEFAULT_BET', 'CHESS_BET_ENABLED', 'CHESS_DEFAULT_BET', 'SHOGI_BET_ENABLED', 'SHOGI_DEFAULT_BET')`,
      [guildId, WEB_BOARDGAMES_KEY]
    );
    for (const r of res.rows) s[r.setting_key] = r.setting_value;
  } catch (e: any) {
    if (e?.code !== '42P01') throw e;
  }
  let enabledRaw: any = {};
  try {
    enabledRaw = s[WEB_BOARDGAMES_KEY] ? JSON.parse(s[WEB_BOARDGAMES_KEY]) : {};
  } catch {}
  const t = (v: unknown) => v === 'true' || v === true;
  const cur = s.CURRENCY_NAME ? String(s.CURRENCY_NAME).replace(/^"|"$/g, '') : 'コイン';
  return {
    currencyName: cur || 'コイン',
    enabled: Object.fromEntries(BOARD_GAMES.map((g) => [g, t(enabledRaw?.[g])])) as Record<BoardGame, boolean>,
    bet: Object.fromEntries(
      BOARD_GAMES.map((g) => {
        const P = g.toUpperCase();
        return [g, { enabled: t(s[`${P}_BET_ENABLED`]), defaultBet: Math.max(0, Math.floor(Number(s[`${P}_DEFAULT_BET`]) || 100)) }];
      })
    ) as BoardGameSettings['bet'],
  };
}

// ---------------- ゲームごとの違い（指し手は文字で受け渡す） ----------------

interface Engine {
  init(): any;
  /** 手番: 1 = 黒石/白/先手、2 = 白石/黒/後手 */
  turn(state: any): 1 | 2;
  legal(state: any): string[];
  /** 手を指す。text は棋譜用、last は画面の「直前の手」表示用 */
  apply(state: any, wire: string): { state: any; text: string; last: any; notes?: string[] } | null;
  result(state: any): { winner: 0 | 1 | 2; reason: string } | null;
  ai(state: any, level: number): string | null;
}

const othello: Engine = {
  init: () => ({ board: O.newBoard(), turn: 1 }),
  turn: (s) => s.turn,
  legal: (s) => O.validMoves(s.board, s.turn).map(([r, c]) => `${r},${c}`),
  apply(s, wire) {
    const [r, c] = wire.split(',').map(Number);
    const res = O.applyMove(s.board, r, c, s.turn);
    if (!res) return null;
    let turn = 3 - s.turn;
    const notes: string[] = [];
    // 置ける場所がなければパス
    if (!O.validMoves(res.board, turn).length && O.validMoves(res.board, 3 - turn).length) {
      notes.push(`${turn === 1 ? '⚫ 黒' : '⚪ 白'} は置ける場所がないためパス`);
      turn = 3 - turn;
    }
    const label = `${'ABCDEFGH'[r]}${c + 1}`;
    return { state: { board: res.board, turn }, text: `${s.turn === 1 ? '⚫' : '⚪'}${label}`, last: { at: [r, c], flipped: res.flipped }, notes };
  },
  result(s) {
    if (!O.isGameOver(s.board)) return null;
    const [b, w] = O.countStones(s.board);
    return { winner: O.winner(s.board), reason: `${b} 対 ${w}` };
  },
  ai(s, level) {
    const m = O.aiMove(s.board, s.turn, level);
    return m ? `${m[0]},${m[1]}` : null;
  },
};

const CHESS_REASON: Record<string, string> = { checkmate: 'チェックメイト', stalemate: 'ステイルメイト', fifty: '50手ルール', material: '駒不足' };
const chess: Engine = {
  init: () => ({ fen: C.START_FEN }),
  turn: (s) => (C.fromFen(s.fen).turn === 'w' ? 1 : 2),
  legal: (s) => C.legalMoves(C.fromFen(s.fen)).map(C.moveToUci),
  apply(s, wire) {
    const st = C.fromFen(s.fen);
    const legal = C.legalMoves(st);
    const m = legal.find((x) => C.moveToUci(x) === wire);
    if (!m) return null;
    return { state: { fen: C.toFen(C.applyMove(st, m)) }, text: C.moveToSan(st, m, legal), last: { from: m[0], to: m[1] } };
  },
  result(s) {
    const r = C.gameResult(C.fromFen(s.fen));
    return r ? { winner: r.winner === null ? 0 : r.winner === 'w' ? 1 : 2, reason: CHESS_REASON[r.reason] ?? r.reason } : null;
  },
  ai(s, level) {
    const m = C.aiMove(C.fromFen(s.fen), level);
    return m ? C.moveToUci(m) : null;
  },
};

const shogi: Engine = {
  init: () => ({ sfen: S.START_SFEN }),
  turn: (s) => (S.fromSfen(s.sfen).turn === 'b' ? 1 : 2),
  legal: (s) => S.legalMoves(S.fromSfen(s.sfen)).map(S.moveToUsi),
  apply(s, wire) {
    const st = S.fromSfen(s.sfen);
    const m = S.legalMoves(st).find((x) => S.moveToUsi(x) === wire);
    if (!m) return null;
    return { state: { sfen: S.toSfen(S.applyMove(st, m)) }, text: S.moveToText(st, m), last: { from: m[0], to: m[1] } };
  },
  result(s) {
    const r = S.gameResult(S.fromSfen(s.sfen));
    return r ? { winner: r.winner === null ? 0 : r.winner === 'b' ? 1 : 2, reason: r.reason === 'checkmate' ? '詰み' : `${S.MAX_PLIES}手で引き分け` } : null;
  },
  ai(s, level) {
    const m = S.aiMove(S.fromSfen(s.sfen), level);
    return m ? S.moveToUsi(m) : null;
  },
};

export const ENGINES: Record<BoardGame, Engine> = { othello, chess, shogi };

// ---------------- テーブル ----------------

const ensured = new WeakSet<Pool>();
export async function ensureBoardGameTable(pool: Pool) {
  if (ensured.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS web_board_games (
      id TEXT PRIMARY KEY,
      guild_id BIGINT NOT NULL,
      game TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      first_id BIGINT,
      second_id BIGINT,
      inviter_id BIGINT,
      ai_level INTEGER DEFAULT 1,
      bet BIGINT DEFAULT 0,
      state JSONB NOT NULL,
      history JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_move JSONB,
      notes JSONB,
      winner INTEGER,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_web_board_games_guild ON web_board_games (guild_id, status)');
  ensured.add(pool);
}

interface Row {
  id: string;
  guild_id: string;
  game: BoardGame;
  mode: 'ai' | 'pvp';
  status: 'invited' | 'active' | 'finished' | 'declined' | 'cancelled';
  first_id: string | null;
  second_id: string | null;
  inviter_id: string | null;
  ai_level: number;
  bet: string;
  state: any;
  history: string[];
  last_move: any;
  notes: string[] | null;
  winner: number | null;
  reason: string | null;
  updated_at: string;
  created_at: string;
}

const COLS = `id, guild_id::text AS guild_id, game, mode, status, first_id::text AS first_id, second_id::text AS second_id,
  inviter_id::text AS inviter_id, ai_level, bet::text AS bet, state, history, last_move, notes, winner, reason,
  updated_at, created_at`;

// ---------------- 名前（表示用。少しの間覚えておく） ----------------

const nameCache = new Map<string, { at: number; name: string; avatar: string }>();
async function memberInfo(guildId: string, userId: string | null) {
  if (!userId) return null;
  const key = `${guildId}:${userId}`;
  const hit = nameCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return { id: userId, name: hit.name, avatar_url: hit.avatar };
  try {
    const m = await botRequest<DiscordGuildMember>(`/guilds/${guildId}/members/${userId}`);
    const v = { at: Date.now(), name: memberDisplayName(m), avatar: memberAvatarUrl(guildId, m) };
    nameCache.set(key, v);
    return { id: userId, name: v.name, avatar_url: v.avatar };
  } catch {
    return { id: userId, name: `ID: ${userId}`, avatar_url: '' };
  }
}

// ---------------- 精算 ----------------

/** winner: 1 / 2 / 0 = 引き分け（Bot の end_game と同じ賭け・戦績） */
async function settle(client: PoolClient, row: Row, winner: 0 | 1 | 2, reason: string) {
  const bet = Number(row.bet) || 0;
  const players = [row.first_id, row.mode === 'ai' ? null : row.second_id];
  const pay = async (uid: string, amount: number) => {
    if (amount > 0) await client.query('UPDATE users SET balance = balance + $1 WHERE guild_id = $2 AND user_id = $3', [amount, row.guild_id, uid]);
  };
  for (let i = 0; i < 2; i++) {
    const uid = players[i];
    if (!uid) continue;
    const me = i + 1;
    const isDraw = winner === 0;
    const isWin = winner === me;
    const payout = bet > 0 ? (isWin ? bet * 2 : isDraw ? bet : 0) : 0;
    await pay(uid, payout);
    const mode = row.mode === 'ai' ? 'ai' : 'pvp';
    await recordGameResult(client, {
      guildId: row.guild_id, userId: uid, game: row.game, isWin, isDraw, bet, payout,
      kind: `${mode}_${isDraw ? 'draws' : isWin ? 'wins' : 'losses'}`,
    });
  }
  await client.query(`UPDATE web_board_games SET status = 'finished', winner = $2, reason = $3, updated_at = NOW() WHERE id = $1`, [row.id, winner, reason]);
  row.status = 'finished';
  row.winner = winner;
  row.reason = reason;
}

// ---------------- 表示 ----------------

export async function gameView(row: Row, viewerId: string) {
  const eng = ENGINES[row.game];
  const you = row.first_id === viewerId ? 1 : row.second_id === viewerId ? 2 : 0;
  const active = row.status === 'active';
  const turn = eng.turn(row.state);
  const myTurn = active && you === turn && !(row.mode === 'ai' && turn === 2);
  const [first, second] = await Promise.all([memberInfo(row.guild_id, row.first_id), memberInfo(row.guild_id, row.second_id)]);
  return {
    id: row.id,
    game: row.game,
    mode: row.mode,
    status: row.status,
    ai_level: row.ai_level,
    bet: Number(row.bet) || 0,
    you,
    first,
    second,
    inviter_id: row.inviter_id,
    state: row.state,
    turn,
    my_turn: myTurn,
    legal: myTurn ? eng.legal(row.state) : [],
    history: row.history ?? [],
    last_move: row.last_move,
    notes: row.notes ?? [],
    winner: row.winner,
    reason: row.reason,
    updated_at: row.updated_at,
  };
}

// ---------------- 時間切れ ----------------

/** 対人戦で長く指されていない対局・古い招待を片付ける */
export async function expireGames(pool: Pool, guildId: string) {
  const stale = await pool.query(
    `SELECT id FROM web_board_games WHERE guild_id = $1 AND (
       (status = 'active' AND mode = 'pvp' AND updated_at < NOW() - make_interval(mins => $2)) OR
       (status = 'invited' AND updated_at < NOW() - make_interval(mins => $3)))`,
    [guildId, IDLE_LIMIT_MIN, INVITE_LIMIT_MIN]
  );
  for (const { id } of stale.rows) {
    try {
      await withTransaction(pool, async (client) => {
        const r = await client.query(`SELECT ${COLS} FROM web_board_games WHERE id = $1 FOR UPDATE`, [id]);
        const row: Row | undefined = r.rows[0];
        if (!row) return;
        if (row.status === 'invited') {
          await client.query(`UPDATE web_board_games SET status = 'cancelled', reason = '期限切れ', updated_at = NOW() WHERE id = $1`, [id]);
        } else if (row.status === 'active') {
          const loser = ENGINES[row.game].turn(row.state);
          await settle(client, row, loser === 1 ? 2 : 1, '時間切れ');
        }
      });
    } catch (e) {
      console.error('expireGames failed:', e);
    }
  }
}

// ---------------- 一覧・作成 ----------------

export async function listGames(pool: Pool, guildId: string, userId: string) {
  const res = await pool.query(
    `SELECT ${COLS} FROM web_board_games
      WHERE guild_id = $1 AND (first_id = $2 OR second_id = $2 OR inviter_id = $2)
        AND (status IN ('active', 'invited') OR (status = 'finished' AND updated_at > NOW() - INTERVAL '1 day'))
      ORDER BY (status = 'finished'), updated_at DESC LIMIT 20`,
    [guildId, userId]
  );
  return Promise.all(res.rows.map((r: Row) => gameView(r, userId)));
}

async function takeBet(client: PoolClient, guildId: string, userId: string, bet: number, who: string) {
  if (bet <= 0) return;
  await client.query('INSERT INTO users (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guildId, userId]);
  const r = await client.query('SELECT balance FROM users WHERE guild_id = $1 AND user_id = $2 FOR UPDATE', [guildId, userId]);
  if ((Number(r.rows[0]?.balance) || 0) < bet) throw new CasinoError(`${who}の残高が足りません`);
  await client.query('UPDATE users SET balance = balance - $1 WHERE guild_id = $2 AND user_id = $3', [bet, guildId, userId]);
}

export async function createAiGame(pool: Pool, s: BoardGameSettings, guildId: string, userId: string, game: BoardGame, level: unknown, betRaw: unknown) {
  const lv = Number(level);
  if (!Number.isInteger(lv) || lv < 1 || lv > 5) throw new CasinoError('AIの強さを選んでください');
  let bet = 0;
  if (s.bet[game].enabled && betRaw !== undefined && betRaw !== null && betRaw !== '' && Number(betRaw) !== 0) {
    bet = Number(betRaw);
    if (!Number.isSafeInteger(bet) || bet < 1) throw new CasinoError('賭け金は1以上の整数で入力してください');
  }
  const id = randomUUID();
  const row = await withTransaction(pool, async (client) => {
    const active = await client.query(
      `SELECT 1 FROM web_board_games WHERE guild_id = $1 AND game = $2 AND mode = 'ai' AND status = 'active' AND first_id = $3`,
      [guildId, game, userId]
    );
    if (active.rows.length) throw new CasinoError(`${BOARD_GAME_LABEL[game]}のAI対戦が進行中です。先に終わらせてください`);
    await takeBet(client, guildId, userId, bet, 'あなた');
    const r = await client.query(
      `INSERT INTO web_board_games (id, guild_id, game, mode, status, first_id, inviter_id, ai_level, bet, state)
       VALUES ($1, $2, $3, 'ai', 'active', $4, $4, $5, $6, $7::jsonb) RETURNING ${COLS}`,
      [id, guildId, game, userId, lv, bet, JSON.stringify(ENGINES[game].init())]
    );
    return r.rows[0] as Row;
  });
  return gameView(row, userId);
}

export async function createInvite(pool: Pool, s: BoardGameSettings, guildId: string, userId: string, game: BoardGame, opponentId: unknown) {
  if (typeof opponentId !== 'string' || !/^\d{15,25}$/.test(opponentId)) throw new CasinoError('対戦相手を選んでください');
  if (opponentId === userId) throw new CasinoError('自分自身とは対戦できません');
  let opp: DiscordGuildMember;
  try {
    opp = await botRequest<DiscordGuildMember>(`/guilds/${guildId}/members/${opponentId}`);
  } catch {
    throw new CasinoError('相手がこのサーバーにいません', 404);
  }
  if (opp.user.bot) throw new CasinoError('Botとは対戦できません。AI対戦を選んでください');
  const bet = s.bet[game].enabled ? s.bet[game].defaultBet : 0;
  const id = randomUUID();
  const row = await withTransaction(pool, async (client) => {
    const dup = await client.query(
      `SELECT 1 FROM web_board_games WHERE guild_id = $1 AND game = $2 AND status IN ('invited', 'active') AND mode = 'pvp'
         AND ((first_id = $3 AND second_id = $4) OR (first_id = $4 AND second_id = $3))`,
      [guildId, game, userId, opponentId]
    );
    if (dup.rows.length) throw new CasinoError('この相手とはすでに招待中か対局中です');
    // 先手（黒石・白・先手）はランダム
    const [first, second] = Math.random() < 0.5 ? [userId, opponentId] : [opponentId, userId];
    const r = await client.query(
      `INSERT INTO web_board_games (id, guild_id, game, mode, status, first_id, second_id, inviter_id, bet, state)
       VALUES ($1, $2, $3, 'pvp', 'invited', $4, $5, $6, $7, $8::jsonb) RETURNING ${COLS}`,
      [id, guildId, game, first, second, userId, bet, JSON.stringify(ENGINES[game].init())]
    );
    return r.rows[0] as Row;
  });
  // 相手にDMで知らせる（失敗しても招待はできている）
  try {
    const me = await memberInfo(guildId, userId);
    const dm = await botRequest<{ id: string }>('/users/@me/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: opponentId }),
    });
    await botRequest(`/channels/${dm.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🎮 **${me?.name ?? 'メンバー'}** さんから **${BOARD_GAME_LABEL[game]}** の対局の申し込みが届きました！${bet ? `（賭け金 ${bet.toLocaleString()} ${s.currencyName}）` : ''}\nアクティビティ・Web のプロフィール画面の「ゲーム」タブから受けられます（${INVITE_LIMIT_MIN}分以内）。`,
        allowed_mentions: { parse: [] },
      }),
    });
  } catch (e) {
    console.error('board game invite DM failed:', e);
  }
  return gameView(row, userId);
}

// ---------------- 1局の操作 ----------------

export async function getGame(pool: Pool, guildId: string, userId: string, id: string) {
  const r = await pool.query(`SELECT ${COLS} FROM web_board_games WHERE id = $1 AND guild_id = $2`, [id, guildId]);
  const row: Row | undefined = r.rows[0];
  if (!row || (row.first_id !== userId && row.second_id !== userId)) throw new CasinoError('対局が見つかりません', 404);
  return gameView(row, userId);
}

export async function gameAction(pool: Pool, guildId: string, userId: string, id: string, body: any) {
  const action = body?.action;
  const out = await withTransaction(pool, async (client) => {
    const r = await client.query(`SELECT ${COLS} FROM web_board_games WHERE id = $1 AND guild_id = $2 FOR UPDATE`, [id, guildId]);
    const row: Row | undefined = r.rows[0];
    if (!row || (row.first_id !== userId && row.second_id !== userId)) throw new CasinoError('対局が見つかりません', 404);
    const eng = ENGINES[row.game];
    const me = row.first_id === userId ? 1 : 2;
    const bet = Number(row.bet) || 0;

    if (action === 'accept' || action === 'decline' || action === 'cancel') {
      if (row.status !== 'invited') throw new CasinoError('この招待はもう終わっています', 409);
      if (action === 'accept') {
        if (row.inviter_id === userId) throw new CasinoError('自分が送った招待は受けられません');
        await takeBet(client, guildId, row.inviter_id!, bet, '招待した人');
        await takeBet(client, guildId, userId, bet, 'あなた');
        await client.query(`UPDATE web_board_games SET status = 'active', updated_at = NOW() WHERE id = $1`, [id]);
        row.status = 'active';
      } else {
        await client.query(`UPDATE web_board_games SET status = $2, reason = $3, updated_at = NOW() WHERE id = $1`, [
          id,
          action === 'cancel' ? 'cancelled' : 'declined',
          action === 'cancel' ? '取り消し' : '断られました',
        ]);
        row.status = action === 'cancel' ? 'cancelled' : 'declined';
      }
      return row;
    }

    if (row.status !== 'active') throw new CasinoError('この対局は終わっています', 409);
    if (action === 'resign') {
      await settle(client, row, me === 1 ? 2 : 1, '投了');
      return row;
    }
    if (action !== 'move') throw new CasinoError('操作が不正です');
    if (eng.turn(row.state) !== me || (row.mode === 'ai' && me !== 1)) throw new CasinoError('今はあなたの番ではありません', 409);
    const wire = String(body?.move ?? '');
    if (!eng.legal(row.state).includes(wire)) throw new CasinoError('その手は指せません', 400);

    const history = [...(row.history ?? [])];
    let state = row.state;
    let last: any = null;
    let notes: string[] = [];
    const play = (w: string) => {
      const res = eng.apply(state, w)!;
      state = res.state;
      history.push(res.text);
      last = res.last;
      notes = [...notes, ...(res.notes ?? [])];
    };
    play(wire);
    let result = eng.result(state);
    // AI の番なら続けて指す（オセロでこちらがパスのときは AI が何手か続く）
    while (!result && row.mode === 'ai' && eng.turn(state) === 2) {
      const mv = eng.ai(state, row.ai_level);
      if (!mv) break;
      notes = [];
      play(mv);
      result = eng.result(state);
    }
    row.state = state;
    row.history = history;
    row.last_move = last;
    row.notes = notes;
    await client.query(
      `UPDATE web_board_games SET state = $2::jsonb, history = $3::jsonb, last_move = $4::jsonb, notes = $5::jsonb, updated_at = NOW() WHERE id = $1`,
      [id, JSON.stringify(state), JSON.stringify(history), JSON.stringify(last), JSON.stringify(notes)]
    );
    if (result) await settle(client, row, result.winner, result.reason);
    return row;
  });
  return gameView(out, userId);
}
