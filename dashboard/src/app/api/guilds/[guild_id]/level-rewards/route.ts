import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

async function ensureConditionRoleColumn(pool: any) {
  // 既存環境向けの安全策: condition_role_id 列が無ければ追加し、
  // 複合主キーを condition_role_id を含む形に更新する。
  try {
    await pool.query('ALTER TABLE level_role_rewards ADD COLUMN IF NOT EXISTS condition_role_id BIGINT DEFAULT NULL');
    await pool.query('ALTER TABLE level_role_rewards DROP CONSTRAINT IF EXISTS level_role_rewards_pkey');
    await pool.query('ALTER TABLE level_role_rewards ADD PRIMARY KEY (guild_id, level_type, level, role_id, condition_role_id)');
  } catch (e) {
    // ignore (table may not exist yet, or already migrated)
  }
  try {
    await pool.query('ALTER TABLE level_coin_rewards ADD COLUMN IF NOT EXISTS condition_role_id BIGINT DEFAULT NULL');
    await pool.query('ALTER TABLE level_coin_rewards DROP CONSTRAINT IF EXISTS level_coin_rewards_pkey');
    await pool.query('ALTER TABLE level_coin_rewards ADD PRIMARY KEY (guild_id, level_type, level, condition_role_id)');
  } catch (e) {
    // ignore
  }
}

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);

  try {
    await ensureConditionRoleColumn(pool);

    // 1. Get role rewards
    const roleRes = await pool.query(
      'SELECT level_type, level, role_id, condition_role_id FROM level_role_rewards WHERE guild_id = $1 ORDER BY level ASC',
      [guildId]
    );

    // 2. Get coin rewards
    const coinRes = await pool.query(
      'SELECT level_type, level, coins, condition_role_id FROM level_coin_rewards WHERE guild_id = $1 ORDER BY level ASC',
      [guildId]
    );

    // 3. Get ENABLE_LEVEL_REWARDS / ENABLE_ROLE_BASED_LEVEL_REWARDS settings
    const settingRes = await pool.query(
      "SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key IN ('ENABLE_LEVEL_REWARDS', 'ENABLE_ROLE_BASED_LEVEL_REWARDS')",
      [guildId]
    );
    const settingsMap: Record<string, string> = {};
    for (const row of settingRes.rows) {
      settingsMap[row.setting_key] = row.setting_value;
    }
    const isEnabled = settingsMap['ENABLE_LEVEL_REWARDS'] === 'true';
    const isRoleBasedEnabled = settingsMap['ENABLE_ROLE_BASED_LEVEL_REWARDS'] === 'true';

    return NextResponse.json({
      role_rewards: roleRes.rows,
      coin_rewards: coinRes.rows,
      is_enabled: isEnabled,
      is_role_based_enabled: isRoleBasedEnabled,
    });
  } catch (error: any) {
    console.error('Failed to fetch level rewards:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);

  try {
    const body = await request.json();
    const { role_rewards, coin_rewards, is_enabled, is_role_based_enabled } = body;

    await ensureConditionRoleColumn(pool);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Update Settings
      await client.query(`
        INSERT INTO bot_settings (guild_id, setting_key, setting_value)
        VALUES ($1, 'ENABLE_LEVEL_REWARDS', $2)
        ON CONFLICT (guild_id, setting_key) 
        DO UPDATE SET setting_value = EXCLUDED.setting_value
      `, [guildId, String(is_enabled)]);

      await client.query(`
        INSERT INTO bot_settings (guild_id, setting_key, setting_value)
        VALUES ($1, 'ENABLE_ROLE_BASED_LEVEL_REWARDS', $2)
        ON CONFLICT (guild_id, setting_key) 
        DO UPDATE SET setting_value = EXCLUDED.setting_value
      `, [guildId, String(is_role_based_enabled)]);

      // 2. Replace role rewards
      await client.query('DELETE FROM level_role_rewards WHERE guild_id = $1', [guildId]);
      if (role_rewards && role_rewards.length > 0) {
        for (const rr of role_rewards) {
          await client.query(`
            INSERT INTO level_role_rewards (guild_id, level_type, level, role_id, condition_role_id)
            VALUES ($1, $2, $3, $4, $5)
          `, [guildId, rr.level_type, rr.level, rr.role_id, rr.condition_role_id || null]);
        }
      }

      // 3. Replace coin rewards
      await client.query('DELETE FROM level_coin_rewards WHERE guild_id = $1', [guildId]);
      if (coin_rewards && coin_rewards.length > 0) {
        for (const cr of coin_rewards) {
          await client.query(`
            INSERT INTO level_coin_rewards (guild_id, level_type, level, coins, condition_role_id)
            VALUES ($1, $2, $3, $4, $5)
          `, [guildId, cr.level_type, cr.level, cr.coins, cr.condition_role_id || null]);
        }
      }

      await client.query('COMMIT');
      return NextResponse.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Failed to save level rewards:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
