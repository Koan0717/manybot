import type { Pool, PoolClient } from 'pg';
import { botRequest } from '@/lib/discordApi';
import type { CasinoSettings } from './settings';

/**
 * カジノのお金・回数・戦績の処理。Bot（database.py）と同じテーブル・同じ列を使うので、
 * Discordのパネルで遊んだ分と「1日の回数・賭け金の上限」「戦績」が共通になる。
 */

export class CasinoError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Bot と同じ日付の区切り（日本時間の YYYY-MM-DD） */
export function jstToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

const ensured = new WeakSet<Pool>();

/** Botより先にダッシュボードで遊ばれても動くよう、使うテーブルを用意する */
export async function ensureCasinoTables(pool: Pool): Promise<void> {
  if (ensured.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_game_stats (
      guild_id BIGINT,
      user_id BIGINT,
      game_type TEXT,
      plays INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      draws INTEGER DEFAULT 0,
      total_bet BIGINT DEFAULT 0,
      total_payout BIGINT DEFAULT 0,
      net_profit BIGINT DEFAULT 0,
      max_win BIGINT DEFAULT 0,
      extra_data JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, user_id, game_type)
    )
  `);
  // 途中の状態を持つゲーム（ブラックジャック）の進行中データ。山札はここにだけ置き、ブラウザには渡さない
  await pool.query(`
    CREATE TABLE IF NOT EXISTS web_casino_sessions (
      id TEXT PRIMARY KEY,
      guild_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      game TEXT NOT NULL,
      bet BIGINT NOT NULL,
      play_number INTEGER NOT NULL DEFAULT 0,
      state JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_web_casino_sessions_user ON web_casino_sessions (guild_id, user_id, game)');
  ensured.add(pool);
}

export interface PlayerStatus {
  balance: number;
  playsToday: number;
  betToday: number;
}

/** 今日の回数・賭け金（日付が変わっていれば0） */
export async function getPlayerStatus(pool: Pool, guildId: string, userId: string): Promise<PlayerStatus> {
  const res = await pool.query(
    'SELECT balance, chinchiro_count, chinchiro_daily_bet, chinchiro_last_date FROM users WHERE guild_id = $1 AND user_id = $2',
    [guildId, userId]
  );
  const row = res.rows[0];
  if (!row) return { balance: 0, playsToday: 0, betToday: 0 };
  const today = row.chinchiro_last_date === jstToday();
  return {
    balance: Number(row.balance) || 0,
    playsToday: today ? Number(row.chinchiro_count) || 0 : 0,
    betToday: today ? Number(row.chinchiro_daily_bet) || 0 : 0,
  };
}

/**
 * 賭け金を受け付ける（トランザクション内で呼ぶ）。Bot の各 BetModal と同じ順で
 * 賭け金の範囲 → 日付リセット → 1日の回数 → 1日の賭け金 → 残高 を確認し、賭け金を引いて回数を数える。
 * ユーザーの行をロックするので、同時に何回押されても二重に遊ばれない。
 */
export async function beginPlay(
  client: PoolClient,
  s: CasinoSettings,
  guildId: string,
  userId: string,
  bet: unknown
): Promise<{ bet: number; playNumber: number }> {
  if (!Number.isSafeInteger(bet) || (bet as number) < 1 || (bet as number) > s.maxBet) {
    throw new CasinoError(`賭け金は1〜${s.maxBet.toLocaleString()}の整数で入力してください`);
  }
  const amount = bet as number;
  await client.query('INSERT INTO users (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guildId, userId]);
  const res = await client.query(
    'SELECT balance, chinchiro_count, chinchiro_daily_bet, chinchiro_last_date FROM users WHERE guild_id = $1 AND user_id = $2 FOR UPDATE',
    [guildId, userId]
  );
  const row = res.rows[0];
  const today = jstToday();
  let count = Number(row.chinchiro_count) || 0;
  let dailyBet = Number(row.chinchiro_daily_bet) || 0;
  if (row.chinchiro_last_date !== today) {
    count = 0;
    dailyBet = 0;
  }
  if (s.maxPlays > 0 && count >= s.maxPlays) {
    throw new CasinoError(`本日のプレイ上限（${s.maxPlays}回）に達しました`);
  }
  if (s.dailyLimit > 0 && dailyBet + amount > s.dailyLimit) {
    throw new CasinoError(
      `1日の賭け金上限（${s.dailyLimit.toLocaleString()} ${s.currencyName}）を超えるため賭けられません（本日既に ${dailyBet.toLocaleString()} ${s.currencyName}）`
    );
  }
  if ((Number(row.balance) || 0) < amount) throw new CasinoError('残高が不足しています');

  await client.query(
    `UPDATE users SET balance = balance - $1, chinchiro_count = $2, chinchiro_daily_bet = $3, chinchiro_last_date = $4
      WHERE guild_id = $5 AND user_id = $6`,
    [amount, count + 1, dailyBet + amount, today, guildId, userId]
  );
  return { bet: amount, playNumber: count + 1 };
}

export async function addBalance(client: PoolClient, guildId: string, userId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await client.query('UPDATE users SET balance = balance + $1 WHERE guild_id = $2 AND user_id = $3', [
    Math.floor(amount),
    guildId,
    userId,
  ]);
}

/** 残高を超えない範囲で引く（チンチロの追加の負け分）。実際に引いた額を返す */
export async function removeUpTo(client: PoolClient, guildId: string, userId: string, amount: number): Promise<number> {
  const res = await client.query('SELECT balance FROM users WHERE guild_id = $1 AND user_id = $2 FOR UPDATE', [guildId, userId]);
  const taken = Math.max(0, Math.min(Math.floor(amount), Number(res.rows[0]?.balance) || 0));
  if (taken > 0) {
    await client.query('UPDATE users SET balance = balance - $1 WHERE guild_id = $2 AND user_id = $3', [taken, guildId, userId]);
  }
  return taken;
}

export async function getBalance(client: PoolClient | Pool, guildId: string, userId: string): Promise<number> {
  const res = await client.query('SELECT balance FROM users WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
  return Number(res.rows[0]?.balance) || 0;
}

/** database.record_game_result と同じ戦績の更新 */
export async function recordGameResult(
  client: PoolClient,
  r: { guildId: string; userId: string; game: string; isWin: boolean; isDraw: boolean; bet: number; payout: number; kind?: string | null }
): Promise<void> {
  await client.query('SAVEPOINT game_stats');
  try {
    const cur = await client.query(
      'SELECT extra_data FROM user_game_stats WHERE guild_id = $1 AND user_id = $2 AND game_type = $3 FOR UPDATE',
      [r.guildId, r.userId, r.game]
    );
    let extra: Record<string, unknown> = {};
    const raw = cur.rows[0]?.extra_data;
    if (raw && typeof raw === 'object') extra = { ...raw };
    else if (typeof raw === 'string') {
      try {
        extra = JSON.parse(raw);
      } catch {}
    }
    if (r.kind) extra[r.kind] = (Number(extra[r.kind]) || 0) + 1;

    const win = r.isWin && !r.isDraw ? 1 : 0;
    const draw = r.isDraw ? 1 : 0;
    const loss = !r.isWin && !r.isDraw ? 1 : 0;
    await client.query(
      `INSERT INTO user_game_stats (guild_id, user_id, game_type, plays, wins, losses, draws,
                                    total_bet, total_payout, net_profit, max_win, extra_data, updated_at)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $8, $10::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (guild_id, user_id, game_type) DO UPDATE SET
         plays = user_game_stats.plays + 1,
         wins = user_game_stats.wins + $4,
         losses = user_game_stats.losses + $5,
         draws = user_game_stats.draws + $6,
         total_bet = user_game_stats.total_bet + $7,
         total_payout = user_game_stats.total_payout + $8,
         net_profit = user_game_stats.net_profit + $9,
         max_win = GREATEST(user_game_stats.max_win, $8),
         extra_data = $10::jsonb,
         updated_at = CURRENT_TIMESTAMP`,
      [r.guildId, r.userId, r.game, win, loss, draw, r.bet, r.payout, r.payout - r.bet, JSON.stringify(extra)]
    );
    await client.query('RELEASE SAVEPOINT game_stats');
  } catch (e) {
    // 戦績が残せなくても遊んだ結果（お金）は確定させる
    console.error('recordGameResult failed:', e);
    await client.query('ROLLBACK TO SAVEPOINT game_stats');
  }
}

export interface LogField { name: string; value: string; inline?: boolean }

/** Bot と同じ「賭博・カジノ機能の利用」(gambling) のログチャンネルに送る。失敗しても遊んだ結果には影響させない */
export async function sendGamblingLog(
  pool: Pool,
  guildId: string,
  embed: { title: string; color: number; fields: LogField[] }
): Promise<void> {
  try {
    const res = await pool.query(
      "SELECT channel_id::text AS channel_id, is_enabled FROM log_settings WHERE guild_id = $1 AND log_type = 'gambling'",
      [guildId]
    );
    const row = res.rows[0];
    if (!row?.channel_id || row.is_enabled === false) return;
    await botRequest(`/channels/${row.channel_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{ ...embed, timestamp: new Date().toISOString(), footer: { text: 'アクティビティ・Web から' } }],
        allowed_mentions: { parse: [] },
      }),
    });
  } catch (e) {
    console.error('sendGamblingLog failed:', e);
  }
}

/** トランザクションを張って fn を実行する */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
