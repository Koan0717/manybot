/**
 * Dashboard DB Migration Helpers
 * 
 * ダッシュボードAPIルートからアクセスする際に、
 * Botのinit_db()が未実行の専用Supabase DBでも動作するよう
 * 各テーブルとカラムを自動作成・追加・移行する関数群。
 */

/**
 * rank_settings テーブルの全カラムを保証する
 */
export async function ensureRankSettingsSchema(pool: any) {
  try {
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

    // 古いカラム名 (whitelist_channels等) からのリネームまたは新規追加
    const renameQueries = [
      `ALTER TABLE rank_settings RENAME COLUMN whitelist_channels TO whitelist_channel_ids`,
      `ALTER TABLE rank_settings RENAME COLUMN blacklist_channels TO blacklist_channel_ids`,
      `ALTER TABLE rank_settings RENAME COLUMN whitelist_categories TO whitelist_category_ids`,
      `ALTER TABLE rank_settings RENAME COLUMN blacklist_categories TO blacklist_category_ids`,
    ];
    for (const sql of renameQueries) {
      try { await pool.query(sql); } catch {}
    }

    const cols = [
      `ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS whitelist_channel_ids BIGINT[] NOT NULL DEFAULT '{}'`,
      `ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS blacklist_channel_ids BIGINT[] NOT NULL DEFAULT '{}'`,
      `ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS whitelist_category_ids BIGINT[] NOT NULL DEFAULT '{}'`,
      `ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS blacklist_category_ids BIGINT[] NOT NULL DEFAULT '{}'`,
      `ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS enable_exclude_rank_role BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS exclude_rank_role_ids BIGINT[] NOT NULL DEFAULT '{}'`,
      `ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS ephemeral_rank_commands BOOLEAN NOT NULL DEFAULT FALSE`,
    ];
    for (const sql of cols) { 
      try { await pool.query(sql); } catch {} 
    }
  } catch (e) {
    console.error('Failed to ensure rank_settings schema:', e);
  }
}

/**
 * evaluation_settings テーブルの全カラムを保証する
 */
export async function ensureEvaluationSettingsSchema(pool: any) {
  try {
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
      `ALTER TABLE evaluation_settings ADD COLUMN IF NOT EXISTS evaluation_duration_days INT DEFAULT 14`,
    ];
    for (const sql of cols) { 
      try { await pool.query(sql); } catch {} 
    }
  } catch (e) {
    console.error('Failed to ensure evaluation_settings schema:', e);
  }
}

/**
 * antigrief_settings テーブルの全カラムを保証する
 */
export async function ensureAntigriefSettingsSchema(pool: any) {
  try {
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
    for (const sql of cols) { 
      try { await pool.query(sql); } catch {} 
    }
  } catch (e) {
    console.error('Failed to ensure antigrief_settings schema:', e);
  }
}

/**
 * vc_coins_settings テーブルの全カラムを保証する
 */
export async function ensureVcCoinsSettingsSchema(pool: any) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vc_coins_settings (
        guild_id BIGINT PRIMARY KEY,
        is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        whitelist_channel_ids BIGINT[] NOT NULL DEFAULT '{}',
        blacklist_channel_ids BIGINT[] NOT NULL DEFAULT '{}',
        whitelist_category_ids BIGINT[] NOT NULL DEFAULT '{}',
        blacklist_category_ids BIGINT[] NOT NULL DEFAULT '{}',
        whitelist_channels JSONB DEFAULT '[]',
        blacklist_channels JSONB DEFAULT '[]',
        whitelist_categories JSONB DEFAULT '[]',
        blacklist_categories JSONB DEFAULT '[]'
      )
    `);
    const cols = [
      `ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS whitelist_channel_ids BIGINT[] NOT NULL DEFAULT '{}'`,
      `ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS blacklist_channel_ids BIGINT[] NOT NULL DEFAULT '{}'`,
      `ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS whitelist_category_ids BIGINT[] NOT NULL DEFAULT '{}'`,
      `ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS blacklist_category_ids BIGINT[] NOT NULL DEFAULT '{}'`,
      `ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS whitelist_channels JSONB DEFAULT '[]'`,
      `ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS blacklist_channels JSONB DEFAULT '[]'`,
      `ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS whitelist_categories JSONB DEFAULT '[]'`,
      `ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS blacklist_categories JSONB DEFAULT '[]'`,
    ];
    for (const sql of cols) { 
      try { await pool.query(sql); } catch {} 
    }
  } catch (e) {
    console.error('Failed to ensure vc_coins_settings schema:', e);
  }
}

/**
 * evaluation_periods テーブルの全カラムを保証する
 */
export async function ensureEvaluationPeriodsSchema(pool: any) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS evaluation_periods (
        guild_id BIGINT,
        user_id BIGINT,
        PRIMARY KEY (guild_id, user_id),
        start_time TIMESTAMP,
        end_time TIMESTAMP
      )
    `);
    const renames = [
      'ALTER TABLE evaluation_periods RENAME COLUMN start_date TO start_time',
      'ALTER TABLE evaluation_periods RENAME COLUMN end_date TO end_time',
      'ALTER TABLE evaluation_periods RENAME COLUMN member_id TO user_id',
      'ALTER TABLE evaluation_periods RENAME COLUMN target_user_id TO user_id',
      'ALTER TABLE evaluation_periods RENAME COLUMN target_id TO user_id',
      'ALTER TABLE evaluation_periods RENAME COLUMN server_id TO guild_id',
    ];
    for (const sql of renames) {
      try { await pool.query(sql); } catch {}
    }
    const cols = [
      'ALTER TABLE evaluation_periods ADD COLUMN IF NOT EXISTS guild_id BIGINT',
      'ALTER TABLE evaluation_periods ADD COLUMN IF NOT EXISTS user_id BIGINT',
      'ALTER TABLE evaluation_periods ADD COLUMN IF NOT EXISTS start_time TIMESTAMP',
      'ALTER TABLE evaluation_periods ADD COLUMN IF NOT EXISTS end_time TIMESTAMP',
    ];
    for (const sql of cols) {
      try { await pool.query(sql); } catch {}
    }
  } catch (e) {
    console.error('Failed to ensure evaluation_periods schema:', e);
  }
}

/**
 * room_panels テーブルを保証する
 */
export async function ensureRoomPanelsSchema(pool: any) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS room_panels (
        guild_id BIGINT,
        channel_id BIGINT,
        message_id BIGINT,
        panel_type VARCHAR(50) DEFAULT 'inn',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, panel_type)
      )
    `);
    const cols = [
      'ALTER TABLE room_panels ADD COLUMN IF NOT EXISTS channel_id BIGINT',
      'ALTER TABLE room_panels ADD COLUMN IF NOT EXISTS message_id BIGINT',
      'ALTER TABLE room_panels ADD COLUMN IF NOT EXISTS panel_type VARCHAR(50) DEFAULT \'inn\'',
      'ALTER TABLE room_panels ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    ];
    for (const sql of cols) {
      try { await pool.query(sql); } catch {}
    }
  } catch (e) {
    console.error('Failed to ensure room_panels schema:', e);
  }
}

/**
 * すべての基本スキーマを一括保証する
 */
export async function ensureAllSchemas(pool: any) {
  await Promise.allSettled([
    ensureRankSettingsSchema(pool),
    ensureEvaluationSettingsSchema(pool),
    ensureEvaluationPeriodsSchema(pool),
    ensureAntigriefSettingsSchema(pool),
    ensureVcCoinsSettingsSchema(pool),
    ensureRoomPanelsSchema(pool),
  ]);
}
