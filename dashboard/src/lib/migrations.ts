/**
 * Dashboard DB Migration Helpers
 * 
 * ダッシュボードAPIルートからアクセスする際に、
 * Botのinit_db()が未実行の専用Supabase DBでも動作するよう
 * 各テーブルとカラムを自動作成・追加する関数群。
 */

/**
 * rank_settings テーブルの全カラムを保証する
 */
export async function ensureRankSettingsSchema(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rank_settings (
      guild_id BIGINT PRIMARY KEY,
      whitelist_channel_ids BIGINT[] NOT NULL DEFAULT '{}',
      blacklist_channel_ids BIGINT[] NOT NULL DEFAULT '{}',
      whitelist_category_ids BIGINT[] NOT NULL DEFAULT '{}',
      blacklist_category_ids BIGINT[] NOT NULL DEFAULT '{}',
      enable_exclude_rank_role BOOLEAN NOT NULL DEFAULT FALSE,
      exclude_rank_role_ids BIGINT[] NOT NULL DEFAULT '{}',
      ephemeral_rank_commands BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  const cols = [
    `ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS whitelist_channel_ids BIGINT[] NOT NULL DEFAULT '{}'`,
    `ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS blacklist_channel_ids BIGINT[] NOT NULL DEFAULT '{}'`,
    `ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS whitelist_category_ids BIGINT[] NOT NULL DEFAULT '{}'`,
    `ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS blacklist_category_ids BIGINT[] NOT NULL DEFAULT '{}'`,
    `ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS enable_exclude_rank_role BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS exclude_rank_role_ids BIGINT[] NOT NULL DEFAULT '{}'`,
    `ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS ephemeral_rank_commands BOOLEAN NOT NULL DEFAULT FALSE`,
  ];
  for (const sql of cols) { try { await pool.query(sql); } catch {} }
}

/**
 * evaluation_settings テーブルの全カラムを保証する
 */
export async function ensureEvaluationSettingsSchema(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evaluation_settings (
      guild_id BIGINT PRIMARY KEY,
      forum_channel_ids BIGINT[] DEFAULT '{}',
      self_intro_channel_ids BIGINT[] DEFAULT '{}',
      is_enabled BOOLEAN DEFAULT TRUE,
      auto_generate_period BOOLEAN DEFAULT TRUE,
      auto_fail_on_deadline BOOLEAN DEFAULT FALSE
    )
  `);
  const cols = [
    `ALTER TABLE evaluation_settings ADD COLUMN IF NOT EXISTS forum_channel_ids BIGINT[] DEFAULT '{}'`,
    `ALTER TABLE evaluation_settings ADD COLUMN IF NOT EXISTS self_intro_channel_ids BIGINT[] DEFAULT '{}'`,
    `ALTER TABLE evaluation_settings ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT TRUE`,
    `ALTER TABLE evaluation_settings ADD COLUMN IF NOT EXISTS auto_generate_period BOOLEAN DEFAULT TRUE`,
    `ALTER TABLE evaluation_settings ADD COLUMN IF NOT EXISTS auto_fail_on_deadline BOOLEAN DEFAULT FALSE`,
  ];
  for (const sql of cols) { try { await pool.query(sql); } catch {} }
}

/**
 * antigrief_settings テーブルの全カラムを保証する
 */
export async function ensureAntigriefSettingsSchema(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS antigrief_settings (
      guild_id BIGINT PRIMARY KEY,
      target_category_ids BIGINT[] NOT NULL DEFAULT '{}',
      target_channel_ids BIGINT[] NOT NULL DEFAULT '{}',
      exempt_role_ids BIGINT[] NOT NULL DEFAULT '{}'
    )
  `);
  const cols = [
    `ALTER TABLE antigrief_settings ADD COLUMN IF NOT EXISTS target_category_ids BIGINT[] NOT NULL DEFAULT '{}'`,
    `ALTER TABLE antigrief_settings ADD COLUMN IF NOT EXISTS target_channel_ids BIGINT[] NOT NULL DEFAULT '{}'`,
    `ALTER TABLE antigrief_settings ADD COLUMN IF NOT EXISTS exempt_role_ids BIGINT[] NOT NULL DEFAULT '{}'`,
  ];
  for (const sql of cols) { try { await pool.query(sql); } catch {} }
}

/**
 * vc_coins_settings テーブルの全カラムを保証する
 */
export async function ensureVcCoinsSettingsSchema(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vc_coins_settings (
      guild_id BIGINT PRIMARY KEY,
      whitelist_channels JSONB DEFAULT '[]',
      blacklist_channels JSONB DEFAULT '[]',
      whitelist_categories JSONB DEFAULT '[]',
      blacklist_categories JSONB DEFAULT '[]'
    )
  `);
  const cols = [
    `ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS whitelist_channels JSONB DEFAULT '[]'`,
    `ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS blacklist_channels JSONB DEFAULT '[]'`,
    `ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS whitelist_categories JSONB DEFAULT '[]'`,
    `ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS blacklist_categories JSONB DEFAULT '[]'`,
  ];
  for (const sql of cols) { try { await pool.query(sql); } catch {} }
}
