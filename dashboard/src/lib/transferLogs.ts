import type { Pool, PoolClient } from 'pg';

/**
 * 送金履歴（database.py の transfer_logs と同じ定義）。
 * /pay・アクティビティ・Webの送金を記録し、メンバー画面で直近の送金を表示する。
 * Botが新しいスキーマで起動する前でも使えるよう、ダッシュボード側でも作成する。
 */
export type TransferSource = 'pay' | 'activity' | 'web' | 'othello' | 'chess' | 'shogi';

export const TRANSFER_SOURCE_LABEL: Record<string, string> = {
  pay: '/pay',
  activity: 'アクティビティ',
  web: 'Web',
  othello: 'オセロの対局',
  chess: 'チェスの対局',
  shogi: '将棋の対局',
};

const ensured = new WeakSet<Pool>();

export async function ensureTransferLogsTable(pool: Pool): Promise<void> {
  if (ensured.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transfer_logs (
      id BIGSERIAL PRIMARY KEY,
      guild_id BIGINT NOT NULL,
      sender_id BIGINT NOT NULL,
      receiver_id BIGINT NOT NULL,
      amount BIGINT NOT NULL,
      source TEXT NOT NULL DEFAULT 'pay',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_transfer_logs_sender ON transfer_logs (guild_id, sender_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_transfer_logs_receiver ON transfer_logs (guild_id, receiver_id, created_at DESC)');
  ensured.add(pool);
}

/** 送金のトランザクション内で履歴を記録する。失敗しても送金は巻き戻さない（セーブポイントで記録だけ取り消す） */
export async function recordTransfer(
  client: PoolClient,
  row: { guildId: string; senderId: string; receiverId: string; amount: number; source: TransferSource }
): Promise<void> {
  await client.query('SAVEPOINT transfer_log');
  try {
    await client.query(
      'INSERT INTO transfer_logs (guild_id, sender_id, receiver_id, amount, source) VALUES ($1, $2, $3, $4, $5)',
      [row.guildId, row.senderId, row.receiverId, row.amount, row.source]
    );
    await client.query('RELEASE SAVEPOINT transfer_log');
  } catch (e) {
    console.error('recordTransfer failed:', e);
    await client.query('ROLLBACK TO SAVEPOINT transfer_log');
  }
}
