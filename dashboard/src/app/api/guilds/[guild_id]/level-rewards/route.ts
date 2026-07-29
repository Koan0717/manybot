import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);

  try {
    // 1. Get role rewards
    const roleRes = await pool.query(
      'SELECT level_type, level, role_id FROM level_role_rewards WHERE guild_id = $1 ORDER BY level ASC',
      [guildId]
    );

    // 2. Get coin rewards
    const coinRes = await pool.query(
      'SELECT level_type, level, coins FROM level_coin_rewards WHERE guild_id = $1 ORDER BY level ASC',
      [guildId]
    );

    // 3. Get ENABLE_LEVEL_REWARDS setting
    const settingRes = await pool.query(
      "SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = 'ENABLE_LEVEL_REWARDS'",
      [guildId]
    );
    const isEnabled = settingRes.rows.length > 0 ? settingRes.rows[0].setting_value === 'true' : false;

    return NextResponse.json({
      role_rewards: roleRes.rows,
      coin_rewards: coinRes.rows,
      is_enabled: isEnabled,
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
    const { role_rewards, coin_rewards, is_enabled } = body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Update Setting
      await client.query(`
        INSERT INTO bot_settings (guild_id, setting_key, setting_value)
        VALUES ($1, 'ENABLE_LEVEL_REWARDS', $2)
        ON CONFLICT (guild_id, setting_key) 
        DO UPDATE SET setting_value = EXCLUDED.setting_value
      `, [guildId, String(is_enabled)]);

      // 2. Replace role rewards
      await client.query('DELETE FROM level_role_rewards WHERE guild_id = $1', [guildId]);
      if (role_rewards && role_rewards.length > 0) {
        for (const rr of role_rewards) {
          await client.query(`
            INSERT INTO level_role_rewards (guild_id, level_type, level, role_id)
            VALUES ($1, $2, $3, $4)
          `, [guildId, rr.level_type, rr.level, rr.role_id]);
        }
      }

      // 3. Replace coin rewards
      await client.query('DELETE FROM level_coin_rewards WHERE guild_id = $1', [guildId]);
      if (coin_rewards && coin_rewards.length > 0) {
        for (const cr of coin_rewards) {
          await client.query(`
            INSERT INTO level_coin_rewards (guild_id, level_type, level, coins)
            VALUES ($1, $2, $3, $4)
          `, [guildId, cr.level_type, cr.level, cr.coins]);
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
