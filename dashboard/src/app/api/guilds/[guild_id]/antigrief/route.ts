import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureAntigriefSettingsSchema } from '@/lib/migrations';

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);
  try {
    await ensureAntigriefSettingsSchema(pool);
    // Fetch antigrief settings
    const antigriefResult = await pool.query(
      'SELECT target_category_ids, target_channel_ids, exempt_role_ids FROM antigrief_settings WHERE guild_id = $1',
      [guildId]
    );

    // Fetch bot setting for ENABLE_ANTIGRIEF
    const botSettingsResult = await pool.query(
      "SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = 'ENABLE_ANTIGRIEF'",
      [guildId]
    );

    let enableAntigrief = true; // default
    if (botSettingsResult.rows.length > 0) {
      try {
        enableAntigrief = JSON.parse(botSettingsResult.rows[0].setting_value);
      } catch (e) {
        enableAntigrief = botSettingsResult.rows[0].setting_value === 'true';
      }
    }

    const antigriefSettings = antigriefResult.rows.length > 0 ? antigriefResult.rows[0] : {
      target_category_ids: [],
      target_channel_ids: [],
      exempt_role_ids: []
    };

    return NextResponse.json({
      ENABLE_ANTIGRIEF: enableAntigrief,
      target_category_ids: antigriefSettings.target_category_ids?.map(String) || [],
      target_channel_ids: antigriefSettings.target_channel_ids?.map(String) || [],
      exempt_role_ids: antigriefSettings.exempt_role_ids?.map(String) || []
    });
  } catch (error: any) {
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
    const { 
      ENABLE_ANTIGRIEF, 
      target_category_ids, 
      target_channel_ids, 
      exempt_role_ids 
    } = body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update bot_settings for ENABLE_ANTIGRIEF
      if (ENABLE_ANTIGRIEF !== undefined) {
        await client.query(
          `INSERT INTO bot_settings (guild_id, setting_key, setting_value)
           VALUES ($1, $2, $3)
           ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = $3`,
          [guildId, 'ENABLE_ANTIGRIEF', JSON.stringify(ENABLE_ANTIGRIEF)]
        );
      }

      // Update antigrief_settings
      await client.query(
        `INSERT INTO antigrief_settings (guild_id, target_category_ids, target_channel_ids, exempt_role_ids)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (guild_id) DO UPDATE SET 
         target_category_ids = $2, target_channel_ids = $3, exempt_role_ids = $4`,
        [
          guildId, 
          target_category_ids?.map(Number) || [], 
          target_channel_ids?.map(Number) || [], 
          exempt_role_ids?.map(Number) || []
        ]
      );

      await client.query('COMMIT');

      // IPCでBotに設定再読み込みを通知
      const reqResult = await client.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type)
         VALUES ($1, 0, 'reload_antigrief')
         RETURNING id`,
        [guildId]
      );

      const sync_request_id: number | null = reqResult.rows[0]?.id ?? null;
      return NextResponse.json({ success: true, sync_request_id });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
