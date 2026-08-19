import { Pool } from 'pg';

const globalForDb = globalThis as unknown as {
  masterPool: Pool | undefined;
  pools: { [url: string]: Pool };
};

export const masterPool = globalForDb.masterPool ?? new Pool({ connectionString: process.env.DATABASE_URL?.replace('?sslmode=require', ''), ssl: { rejectUnauthorized: false } });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.masterPool = masterPool;
}

if (!globalForDb.pools) {
  globalForDb.pools = {};
}
const pools = globalForDb.pools;

export async function initDb() {
  try {
    await masterPool.query(`
      CREATE TABLE IF NOT EXISTS dashboard_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        guild_id VARCHAR(50) NOT NULL,
        bot_id VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS bot_id VARCHAR(50);
    `);
  } catch (error) {
    console.error('Failed to initialize dashboard_users table:', error);
  }

  try {
    await masterPool.query(`
      CREATE TABLE IF NOT EXISTS registered_bots (
        id SERIAL PRIMARY KEY,
        bot_id VARCHAR(50) UNIQUE NOT NULL,
        bot_name VARCHAR(255) NOT NULL,
        token TEXT NOT NULL,
        github_repo VARCHAR(500),
        render_deploy_hook_url TEXT,
        database_url TEXT,
        webhook_secret TEXT,
        last_deploy_at TIMESTAMP WITH TIME ZONE,
        last_commit_sha VARCHAR(100),
        last_commit_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS github_deploy_logs (
        id SERIAL PRIMARY KEY,
        bot_id VARCHAR(50) NOT NULL,
        event_type VARCHAR(50) DEFAULT 'push',
        commit_sha VARCHAR(100),
        commit_message TEXT,
        branch VARCHAR(255),
        pusher VARCHAR(255),
        deploy_triggered BOOLEAN DEFAULT FALSE,
        received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (error) {
    console.error('Failed to initialize registered_bots table:', error);
  }
}

// Automatically try to initialize on startup
initDb();


export async function getGuildDbUrl(guildId: string | number): Promise<string | null> {
  const parsedId = typeof guildId === 'string' ? guildId : String(guildId);
  if (isNaN(Number(parsedId))) return null;

  try {
    const res = await masterPool.query(
      'SELECT database_url FROM guild_databases WHERE guild_id = $1',
      [parsedId]
    );
    if (res.rows.length > 0) {
      return res.rows[0].database_url;
    }
  } catch (error: any) {
    if (error.code !== '42P01') {
      console.error('Error fetching guild database URL:', error);
    }
  }
  return null;
}

export async function getDoumoriDbUrl(guildId: string | number): Promise<string | null> {
  const parsedId = typeof guildId === 'string' ? guildId : String(guildId);
  if (isNaN(Number(parsedId))) return process.env.DOUMORI_DATABASE_URL || null;

  try {
    const res = await masterPool.query(
      'SELECT database_url, doumori_database_url FROM guild_databases WHERE guild_id = $1',
      [parsedId]
    );
    if (res.rows.length > 0) {
      if (res.rows[0].doumori_database_url) return res.rows[0].doumori_database_url;
      if (res.rows[0].database_url) return res.rows[0].database_url;
    }
  } catch (error: any) {
    if (error.code !== '42P01') {
      console.error('Error fetching doumori database URL:', error);
    }
  }
  return process.env.DOUMORI_DATABASE_URL || null;
}

export async function getPool(guildId: string | number): Promise<Pool> {
  const url = await getGuildDbUrl(guildId);
  if (url) {
    if (!pools[url]) {
      pools[url] = new Pool({ connectionString: url?.replace('?sslmode=require', ''), ssl: { rejectUnauthorized: false } });
    }
    return pools[url];
  }
  return masterPool;
}

export async function getDoumoriPool(guildId: string | number): Promise<Pool> {
  const url = await getDoumoriDbUrl(guildId);
  if (url) {
    if (!pools[url]) {
      pools[url] = new Pool({ connectionString: url?.replace('?sslmode=require', ''), ssl: { rejectUnauthorized: false } });
    }
    return pools[url];
  }
  return masterPool;
}

export async function setupDbSchema(client: any) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS users (
            user_id BIGINT PRIMARY KEY,
            balance BIGINT DEFAULT 0,
            vc_total_time BIGINT DEFAULT 0,
            msg_total_count BIGINT DEFAULT 0,
            join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS rooms (
            channel_id BIGINT PRIMARY KEY,
            guild_id BIGINT,
            owner_id BIGINT,
            room_type TEXT,
            expire_at TIMESTAMP,
            trigger_channel_id BIGINT
        );
        CREATE TABLE IF NOT EXISTS evaluation_periods (
            guild_id BIGINT PRIMARY KEY,
            start_date TIMESTAMP,
            end_date TIMESTAMP,
            is_active BOOLEAN DEFAULT false
        );
        CREATE TABLE IF NOT EXISTS auto_vc_triggers (
            channel_id BIGINT PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS auto_vc_config (
            channel_id BIGINT PRIMARY KEY,
            base_name TEXT DEFAULT '',
            allow_rename BOOLEAN DEFAULT TRUE,
            include_owner_name BOOLEAN DEFAULT TRUE,
            use_numbering BOOLEAN DEFAULT FALSE,
            allow_limit_change BOOLEAN DEFAULT TRUE,
            show_panel BOOLEAN DEFAULT TRUE,
            is_invite_only BOOLEAN DEFAULT FALSE,
            invite_visible_role_ids BIGINT[] DEFAULT '{}',
            allowed_role_ids BIGINT[] DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS inquiry_panels (
            message_id BIGINT PRIMARY KEY,
            guild_id BIGINT,
            channel_id BIGINT,
            role_ids TEXT
        );
        CREATE TABLE IF NOT EXISTS bot_settings (
            guild_id BIGINT,
            setting_key TEXT,
            setting_value TEXT,
            PRIMARY KEY (guild_id, setting_key)
        );
        CREATE TABLE IF NOT EXISTS antigrief_settings (
            guild_id BIGINT PRIMARY KEY,
            everyone_threshold INT,
            everyone_action TEXT,
            everyone_duration INT,
            everyone_punish_role_id BIGINT,
            spam_threshold INT,
            spam_action TEXT,
            spam_duration INT,
            spam_punish_role_id BIGINT,
            url_action TEXT,
            url_duration INT,
            url_punish_role_id BIGINT
        );
        CREATE TABLE IF NOT EXISTS level_role_rewards (
            guild_id BIGINT,
            level_type VARCHAR(10) DEFAULT 'tc',
            level INT,
            role_id BIGINT,
            condition_role_id BIGINT DEFAULT NULL,
            PRIMARY KEY (guild_id, level_type, level, role_id, condition_role_id)
        );
        CREATE TABLE IF NOT EXISTS level_coin_rewards (
            guild_id BIGINT,
            level_type VARCHAR(10) DEFAULT 'tc',
            level INT,
            coins INT,
            condition_role_id BIGINT DEFAULT NULL,
            PRIMARY KEY (guild_id, level_type, level, condition_role_id)
        );
        CREATE TABLE IF NOT EXISTS room_prices (
            room_type TEXT,
            duration INT,
            price BIGINT,
            PRIMARY KEY (room_type, duration)
        );
        CREATE TABLE IF NOT EXISTS role_room_prices (
            role_key TEXT NOT NULL,
            room_type TEXT NOT NULL,
            duration INT NOT NULL,
            price BIGINT NOT NULL,
            PRIMARY KEY (role_key, room_type, duration)
        );
        CREATE TABLE IF NOT EXISTS anonymous_chats (
            channel_id BIGINT PRIMARY KEY,
            guild_id BIGINT
        );
        CREATE TABLE IF NOT EXISTS custom_ticket_panels (
            channel_id BIGINT PRIMARY KEY,
            guild_id BIGINT,
            panel_title TEXT,
            panel_description TEXT,
            button_label TEXT DEFAULT 'チケットを作成する',
            button_emoji TEXT,
            mention_role_ids BIGINT[] DEFAULT '{}'::BIGINT[],
            target_role_ids BIGINT[] DEFAULT '{}'::BIGINT[],
            ticket_prefix TEXT DEFAULT 'ticket',
            panel_type TEXT DEFAULT 'custom_ticket'
        );
        CREATE TABLE IF NOT EXISTS panel_requests (
            id SERIAL PRIMARY KEY,
            guild_id BIGINT,
            channel_id BIGINT,
            panel_type TEXT,
            processed BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS log_settings (
            guild_id BIGINT,
            log_type TEXT,
            channel_id BIGINT,
            PRIMARY KEY (guild_id, log_type)
        );
        CREATE TABLE IF NOT EXISTS evaluation_settings (
            guild_id BIGINT PRIMARY KEY,
            is_enabled BOOLEAN DEFAULT FALSE,
            channel_id BIGINT,
            auto_generate BOOLEAN DEFAULT FALSE
        );
        CREATE TABLE IF NOT EXISTS rank_settings (
            guild_id BIGINT PRIMARY KEY,
            is_enabled BOOLEAN DEFAULT FALSE,
            whitelist_channels TEXT,
            whitelist_categories TEXT,
            blacklist_channels TEXT,
            blacklist_categories TEXT,
            vc_multiplier REAL DEFAULT 1.0,
            msg_multiplier REAL DEFAULT 1.0,
            vc_interval_min INT DEFAULT 1,
            vc_points_per_interval INT DEFAULT 1,
            msg_points_per_msg INT DEFAULT 1,
            msg_cooldown_sec INT DEFAULT 60
        );
        CREATE TABLE IF NOT EXISTS vc_coins_settings (
            guild_id BIGINT PRIMARY KEY,
            is_enabled BOOLEAN DEFAULT TRUE,
            whitelist_channels TEXT,
            whitelist_categories TEXT,
            blacklist_channels TEXT,
            blacklist_categories TEXT,
            vc_interval_min INT DEFAULT 10,
            vc_coins_per_interval INT DEFAULT 10
        );
        CREATE TABLE IF NOT EXISTS interviewer_logs (
            id SERIAL PRIMARY KEY,
            guild_id BIGINT,
            interviewer_id BIGINT,
            target_user_id BIGINT,
            action TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS user_evaluations (
            guild_id BIGINT,
            user_id BIGINT,
            evaluator_id BIGINT,
            eval_type TEXT,
            eval_value INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS reaction_roles (
            message_id BIGINT,
            emoji TEXT,
            role_id BIGINT,
            PRIMARY KEY (message_id, emoji)
        );
        CREATE TABLE IF NOT EXISTS user_vc_durations (
            guild_id BIGINT,
            user_id BIGINT,
            channel_id BIGINT,
            duration BIGINT DEFAULT 0,
            last_joined TIMESTAMP,
            PRIMARY KEY (guild_id, user_id, channel_id)
        );
        CREATE TABLE IF NOT EXISTS sticky_templates (
            id SERIAL PRIMARY KEY,
            guild_id BIGINT,
            name TEXT,
            content TEXT,
            channel_ids TEXT
        );
        CREATE TABLE IF NOT EXISTS shop_settings (
            guild_id BIGINT PRIMARY KEY,
            log_channel_id BIGINT,
            employee_role_id BIGINT,
            manager_role_id BIGINT,
            currency_name TEXT
        );
        CREATE TABLE IF NOT EXISTS shop_items (
            item_id SERIAL PRIMARY KEY,
            guild_id BIGINT,
            name TEXT,
            description TEXT,
            price BIGINT,
            target_role_ids TEXT,
            reward_role_ids TEXT,
            duration_days INT,
            is_eval_extend BOOLEAN DEFAULT FALSE,
            extend_days INT,
            stock INT DEFAULT -1,
            is_active BOOLEAN DEFAULT TRUE
        );
        CREATE TABLE IF NOT EXISTS user_items (
            id SERIAL PRIMARY KEY,
            guild_id BIGINT,
            user_id BIGINT,
            item_id INT,
            purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS guild_databases (
            guild_id BIGINT PRIMARY KEY,
            database_url TEXT NOT NULL
        );
    `);
}
