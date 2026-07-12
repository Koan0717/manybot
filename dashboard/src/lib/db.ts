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
    // If table doesn't exist yet, ignore
    if (error.code !== '42P01') {
      console.error('Error fetching guild database URL:', error);
    }
  }
  return null;
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
            expire_at TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS evaluation_periods (
            guild_id BIGINT PRIMARY KEY,
            start_date TIMESTAMP,
            end_date TIMESTAMP,
            is_active BOOLEAN DEFAULT false
        );
        CREATE TABLE IF NOT EXISTS auto_vc_triggers (
            trigger_channel_id BIGINT PRIMARY KEY,
            guild_id BIGINT,
            base_name TEXT
        );
        CREATE TABLE IF NOT EXISTS auto_vc_config (
            guild_id BIGINT PRIMARY KEY,
            category_id BIGINT
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
            level INT,
            role_id BIGINT,
            PRIMARY KEY (guild_id, level, role_id)
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
            panel_id SERIAL PRIMARY KEY,
            guild_id BIGINT,
            channel_id BIGINT,
            message_id BIGINT,
            title TEXT,
            description TEXT,
            color INT,
            emoji TEXT,
            mention_role_ids TEXT,
            target_role_ids TEXT,
            ticket_prefix TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS panel_requests (
            request_id SERIAL PRIMARY KEY,
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
