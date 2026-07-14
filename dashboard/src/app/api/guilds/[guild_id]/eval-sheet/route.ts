import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';



export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);
  try {
    const result = await pool.query(
      'SELECT is_enabled, auto_generate_period, auto_fail_on_deadline, forum_channel_ids, self_intro_channel_ids FROM evaluation_settings WHERE guild_id = $1',
      [guildId]
    );

    const botSettingsResult = await pool.query(
      "SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key IN ('ENABLE_MINUS_PENALTY', 'MINUS_PUNISHMENT_TYPE')",
      [guildId]
    );
    let enableMinusPenalty = false;
    let minusPunishmentType = 'evaluation_failure';
    
    botSettingsResult.rows.forEach((r: any) => {
      if (r.setting_key === 'ENABLE_MINUS_PENALTY') {
        enableMinusPenalty = r.setting_value === 'true';
      } else if (r.setting_key === 'MINUS_PUNISHMENT_TYPE') {
        minusPunishmentType = r.setting_value;
      }
    });

    if (result.rows.length === 0) {
      return NextResponse.json({
        is_enabled: true,
        auto_generate_period: true,
        auto_fail_on_deadline: false,
        forum_channel_ids: [],
        self_intro_channel_ids: [],
        ENABLE_MINUS_PENALTY: enableMinusPenalty,
        MINUS_PUNISHMENT_TYPE: minusPunishmentType,
      });
    }

    const row = result.rows[0];
    return NextResponse.json({
      is_enabled: row.is_enabled !== null ? row.is_enabled : true,
      auto_generate_period: row.auto_generate_period !== null ? row.auto_generate_period : true,
      auto_fail_on_deadline: row.auto_fail_on_deadline !== null ? row.auto_fail_on_deadline : false,
      forum_channel_ids: row.forum_channel_ids?.map(String) || [],
      self_intro_channel_ids: row.self_intro_channel_ids?.map(String) || [],
      ENABLE_MINUS_PENALTY: enableMinusPenalty,
      MINUS_PUNISHMENT_TYPE: minusPunishmentType,
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
    const isEnabled = body.is_enabled !== undefined ? body.is_enabled : true;
    const autoGeneratePeriod = body.auto_generate_period !== undefined ? body.auto_generate_period : true;
    const autoFailOnDeadline = body.auto_fail_on_deadline !== undefined ? body.auto_fail_on_deadline : false;
    const forumChannelIds = Array.isArray(body.forum_channel_ids) ? body.forum_channel_ids : [];
    const selfIntroChannelIds = Array.isArray(body.self_intro_channel_ids) ? body.self_intro_channel_ids : [];
    const enableMinusPenalty = body.ENABLE_MINUS_PENALTY ? 'true' : 'false';
    const minusPunishmentType = body.MINUS_PUNISHMENT_TYPE || 'evaluation_failure';

    await pool.query(
      `INSERT INTO evaluation_settings (guild_id, forum_channel_ids, self_intro_channel_ids, is_enabled, auto_generate_period, auto_fail_on_deadline)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (guild_id)
       DO UPDATE SET forum_channel_ids = $2, self_intro_channel_ids = $3, is_enabled = $4, auto_generate_period = $5, auto_fail_on_deadline = $6`,
      [guildId, forumChannelIds, selfIntroChannelIds, isEnabled, autoGeneratePeriod, autoFailOnDeadline]
    );

    await pool.query(
      `INSERT INTO bot_settings (guild_id, setting_key, setting_value) VALUES ($1, 'ENABLE_MINUS_PENALTY', $2)
       ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = $2`,
      [guildId, enableMinusPenalty]
    );

    await pool.query(
      `INSERT INTO bot_settings (guild_id, setting_key, setting_value) VALUES ($1, 'MINUS_PUNISHMENT_TYPE', $2)
       ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = $2`,
      [guildId, minusPunishmentType]
    );

    // Request bot to reload the evaluation settings cache
    await pool.query(
      `INSERT INTO panel_requests (guild_id, channel_id, panel_type)
       VALUES ($1, $2, $3)`,
      [guildId, 0, 'reload_eval'] // channel_id=0 for system events
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
