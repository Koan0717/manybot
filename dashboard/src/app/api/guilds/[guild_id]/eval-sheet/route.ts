import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureEvaluationSettingsSchema } from '@/lib/migrations';


export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);
  try {
    await ensureEvaluationSettingsSchema(pool);
    const result = await pool.query(
      'SELECT is_enabled, auto_generate_period, auto_fail_on_deadline, evaluation_duration_days, forum_channel_ids, self_intro_channel_ids FROM evaluation_settings WHERE guild_id = $1',
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
        evaluation_duration_days: 14,
        forum_channel_ids: [],
        self_intro_channel_ids: [],
        ENABLE_MINUS_PENALTY: enableMinusPenalty,
        MINUS_PUNISHMENT_TYPE: minusPunishmentType,
      });
    }

    const row = result.rows[0];
    // 末尾00の丸められた不正IDを除去し、重複を排除するヘルパー
    const cleanIds = (arr: any[]) => {
      if (!Array.isArray(arr)) return [];
      const strings = arr.map(String).filter(id => id && id.length > 5);
      // 18桁以上のSnowflakeIDで末尾が00のものは過去のJS精度落ちで生じた破損IDなので除去
      const valid = strings.filter(id => !(id.length >= 18 && id.endsWith('00')));
      return Array.from(new Set(valid));
    };

    const forumChannelIds = cleanIds(row.forum_channel_ids || []);
    const selfIntroChannelIds = cleanIds(row.self_intro_channel_ids || []);

    // もしDB内のIDに破損IDや重複があった場合、自動的にDBをクリーンな配列に修復する
    if (
      JSON.stringify(forumChannelIds) !== JSON.stringify((row.forum_channel_ids || []).map(String)) ||
      JSON.stringify(selfIntroChannelIds) !== JSON.stringify((row.self_intro_channel_ids || []).map(String))
    ) {
      try {
        await pool.query(
          `UPDATE evaluation_settings SET forum_channel_ids = $2::bigint[], self_intro_channel_ids = $3::bigint[] WHERE guild_id = $1`,
          [guildId, forumChannelIds, selfIntroChannelIds]
        );
      } catch (e) {
        console.error('Failed to auto-clean evaluation_settings IDs:', e);
      }
    }

    return NextResponse.json({
      is_enabled: row.is_enabled !== null ? row.is_enabled : true,
      auto_generate_period: row.auto_generate_period !== null ? row.auto_generate_period : true,
      auto_fail_on_deadline: row.auto_fail_on_deadline !== null ? row.auto_fail_on_deadline : false,
      evaluation_duration_days: row.evaluation_duration_days !== null && row.evaluation_duration_days !== undefined ? Number(row.evaluation_duration_days) : 14,
      forum_channel_ids: forumChannelIds,
      self_intro_channel_ids: selfIntroChannelIds,
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
    await ensureEvaluationSettingsSchema(pool);
    const body = await request.json();
    const isEnabled = body.is_enabled !== undefined ? body.is_enabled : true;
    const autoGeneratePeriod = body.auto_generate_period !== undefined ? body.auto_generate_period : true;
    const autoFailOnDeadline = body.auto_fail_on_deadline !== undefined ? body.auto_fail_on_deadline : false;
    const evaluationDurationDays = body.evaluation_duration_days !== undefined && !isNaN(Number(body.evaluation_duration_days)) ? Math.max(1, Number(body.evaluation_duration_days)) : 14;

    const cleanIds = (arr: any[]) => {
      if (!Array.isArray(arr)) return [];
      const strings = arr.map(String).filter(id => id && id.length > 5);
      const valid = strings.filter(id => !(id.length >= 18 && id.endsWith('00')));
      return Array.from(new Set(valid));
    };

    const forumChannelIds = cleanIds(body.forum_channel_ids || []);
    const selfIntroChannelIds = cleanIds(body.self_intro_channel_ids || []);
    const enableMinusPenalty = body.ENABLE_MINUS_PENALTY ? 'true' : 'false';
    const minusPunishmentType = body.MINUS_PUNISHMENT_TYPE || 'evaluation_failure';

    await pool.query(
      `INSERT INTO evaluation_settings (guild_id, forum_channel_ids, self_intro_channel_ids, is_enabled, auto_generate_period, auto_fail_on_deadline, evaluation_duration_days)
       VALUES ($1, $2::bigint[], $3::bigint[], $4, $5, $6, $7)
       ON CONFLICT (guild_id)
       DO UPDATE SET forum_channel_ids = $2::bigint[], self_intro_channel_ids = $3::bigint[], is_enabled = $4, auto_generate_period = $5, auto_fail_on_deadline = $6, evaluation_duration_days = $7`,
      [guildId, forumChannelIds, selfIntroChannelIds, isEnabled, autoGeneratePeriod, autoFailOnDeadline, evaluationDurationDays]
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
