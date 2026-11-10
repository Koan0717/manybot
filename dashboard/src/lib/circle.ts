/**
 * 大学サークル用ダッシュボード（/circle/[guild_id]）の共通処理。
 *
 * - circle_settings: サークル名・レポートの送信先（Discord ユーザー）
 * - circle_reports : サークル進捗状況のレポート（題名・内容・PDF）と送信結果
 *
 * 送信は panel_requests に 'circle_report_send'（channel_id = 0, panel_id = レポートID）を入れ、
 * Bot 側（bot/cogs/circle_report.py）が送信先の人に DM で送る。テーブル定義は Bot 側と同じ。
 */

/** PDF の最大サイズ（Vercel のリクエスト上限 4.5MB に収まるように） */
export const MAX_PDF_BYTES = 4 * 1024 * 1024;
export const MAX_TITLE = 200;
export const MAX_CONTENT = 4000;
export const MAX_RECIPIENTS = 25;

const ensuredPools = new WeakSet<object>();

export async function ensureCircleSchema(pool: any) {
  if (ensuredPools.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS circle_settings (
      guild_id BIGINT PRIMARY KEY,
      circle_name TEXT NOT NULL DEFAULT '',
      recipient_user_ids BIGINT[] NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS circle_reports (
      id SERIAL PRIMARY KEY,
      guild_id BIGINT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      pdf_name TEXT,
      pdf_size INT,
      pdf_data BYTEA,
      send_status TEXT NOT NULL DEFAULT 'none',
      send_results JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_circle_reports_guild ON circle_reports (guild_id, id DESC)`);
  // 送信リクエストでレポートIDを渡すために使う（アンケートと同じ列）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS panel_requests (
      id SERIAL PRIMARY KEY,
      guild_id BIGINT,
      channel_id BIGINT,
      panel_type VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`ALTER TABLE panel_requests ADD COLUMN IF NOT EXISTS panel_id BIGINT`);
  ensuredPools.add(pool);
}

/** circle_reports の行（pdf_data は含めない）をダッシュボード向け JSON に変換する */
export const toCircleReportJson = (row: any) => ({
  id: row.id,
  title: row.title || '',
  content: row.content || '',
  pdf_name: row.pdf_name || null,
  pdf_size: row.pdf_size != null ? Number(row.pdf_size) : null,
  send_status: (row.send_status || 'none') as 'none' | 'pending' | 'sent' | 'partial' | 'failed',
  send_results: Array.isArray(row.send_results) ? row.send_results : [],
  last_sent_at: row.last_sent_at ? new Date(row.last_sent_at).toISOString() : null,
  created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});

/** SELECT で pdf_data（重い）を除いた列 */
export const REPORT_COLUMNS =
  'id, guild_id, title, content, pdf_name, pdf_size, send_status, send_results, last_sent_at, created_at, updated_at';

/** PDF かどうかをファイル先頭のマジックナンバーで確認する */
export const isPdf = (buf: Buffer) => buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-';

/** ファイル名を DB・Discord 向けに整える */
export const cleanPdfName = (name: string) => {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const cleaned = base.replace(/[\x00-\x1f"<>|:*?]/g, '').trim().slice(0, 120);
  if (!cleaned) return 'report.pdf';
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
};
