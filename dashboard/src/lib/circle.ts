/**
 * 大学サークル用ダッシュボード（/circle/[guild_id]）の共通処理。
 *
 * - circle_settings: サークル名・レポートの送信先（Discord ユーザー）
 * - circle_reports : サークル進捗状況のレポート（題名・内容・PDF）と送信結果
 *
 * 送信は panel_requests に 'circle_report_send'（channel_id = 0, panel_id = レポートID）を入れ、
 * Bot 側（bot/cogs/circle_report.py）が送信先の人に DM で送る。テーブル定義は Bot 側と同じ。
 */

/**
 * サークル用サーバー（今は OPENEssex だけ）。Discordログインでこのサーバーを選ぶと、
 * 管理者ロールの人には「プロフィール・ダッシュボード設定・サークル報告書」、
 * それ以外の人には「プロフィール・サークル報告書」のボタンを出す。サークル報告書は全員が使える。
 * 追加するときは Vercel の環境変数 NEXT_PUBLIC_CIRCLE_GUILD_IDS（カンマ区切り）でも足せる。
 */
const CIRCLE_GUILD_IDS = [
  '1498230531123318876',
  ...(process.env.NEXT_PUBLIC_CIRCLE_GUILD_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
];

export const isCircleGuild = (guildId: string | null | undefined) =>
  !!guildId && CIRCLE_GUILD_IDS.includes(String(guildId));

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
  // 報告書パネルの表示内容 / パネルから書かれた報告書の作成者（Bot 側と同じ）
  for (const sql of [
    `ALTER TABLE circle_settings ADD COLUMN IF NOT EXISTS panel_title TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE circle_settings ADD COLUMN IF NOT EXISTS panel_description TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE circle_settings ADD COLUMN IF NOT EXISTS panel_button_label TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE circle_reports ADD COLUMN IF NOT EXISTS author_id BIGINT`,
    `ALTER TABLE circle_reports ADD COLUMN IF NOT EXISTS author_name TEXT`,
  ]) {
    await pool.query(sql);
  }
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
  author_id: row.author_id ? String(row.author_id) : null,
  author_name: row.author_name || null,
  created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});

/** SELECT で pdf_data（重い）を除いた列 */
export const REPORT_COLUMNS =
  'id, guild_id, title, content, pdf_name, pdf_size, send_status, send_results, last_sent_at, created_at, updated_at, author_id, author_name';

/** 報告書パネルの既定の文言（Bot 側 cogs/circle_report.py と同じ） */
export const DEFAULT_PANEL_TITLE = '📝 サークル進捗報告';
export const DEFAULT_PANEL_DESCRIPTION = '下のボタンから、サークルの進捗状況の報告書（題名・内容・PDF）を書いて提出できます。';
export const DEFAULT_PANEL_BUTTON_LABEL = '報告書を書く';

/** PDF かどうかをファイル先頭のマジックナンバーで確認する */
export const isPdf = (buf: Buffer) => buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-';

/** ファイル名を DB・Discord 向けに整える */
export const cleanPdfName = (name: string) => {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const cleaned = base.replace(/[\x00-\x1f"<>|:*?]/g, '').trim().slice(0, 120);
  if (!cleaned) return 'report.pdf';
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
};
