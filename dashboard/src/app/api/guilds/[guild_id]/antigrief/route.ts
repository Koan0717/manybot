import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureAntigriefSettingsSchema } from '@/lib/migrations';
import { DiscordGuildMember, fetchAllGuildMembers } from '@/lib/discordApi';

// 荒らし対策全体のオン/オフ（未設定ならオン）
async function fetchEnableAntigrief(pool: any, guildId: string): Promise<boolean> {
  const res = await pool.query(
    "SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = 'ENABLE_ANTIGRIEF'",
    [guildId]
  );
  if (res.rows.length === 0) return true;
  try {
    return JSON.parse(res.rows[0].setting_value);
  } catch (e) {
    return res.rows[0].setting_value === 'true';
  }
}

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
      'SELECT target_category_ids, target_channel_ids, exempt_role_ids, admin_channel_id, bot_guard_enabled, bot_guard_action, bot_guard_allowed_user_ids FROM antigrief_settings WHERE guild_id = $1',
      [guildId]
    );

    const enableAntigrief = await fetchEnableAntigrief(pool, guildId);

    const antigriefSettings = antigriefResult.rows.length > 0 ? antigriefResult.rows[0] : {
      target_category_ids: [],
      target_channel_ids: [],
      exempt_role_ids: [],
      admin_channel_id: null,
      bot_guard_enabled: false,
      bot_guard_action: 'kick',
      bot_guard_allowed_user_ids: []
    };

    return NextResponse.json({
      ENABLE_ANTIGRIEF: enableAntigrief,
      target_category_ids: antigriefSettings.target_category_ids?.map(String) || [],
      target_channel_ids: antigriefSettings.target_channel_ids?.map(String) || [],
      exempt_role_ids: antigriefSettings.exempt_role_ids?.map(String) || [],
      admin_channel_id: antigriefSettings.admin_channel_id ? String(antigriefSettings.admin_channel_id) : '',
      bot_guard_enabled: !!antigriefSettings.bot_guard_enabled,
      bot_guard_action: antigriefSettings.bot_guard_action === 'ban' ? 'ban' : 'kick',
      bot_guard_allowed_user_ids: antigriefSettings.bot_guard_allowed_user_ids?.map(String) || []
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
    await ensureAntigriefSettingsSchema(pool);
    const body = await request.json();
    const { 
      ENABLE_ANTIGRIEF, 
      target_category_ids, 
      target_channel_ids, 
      exempt_role_ids,
      admin_channel_id,
      bot_guard_enabled,
      bot_guard_action,
      bot_guard_allowed_user_ids
    } = body;

    const adminChannelId = admin_channel_id && String(admin_channel_id) !== '' ? String(admin_channel_id) : null;
    const botGuardEnabled = !!bot_guard_enabled;
    const botGuardAction = bot_guard_action === 'ban' ? 'ban' : 'kick';
    const allowedUserIds = Array.isArray(bot_guard_allowed_user_ids)
      ? bot_guard_allowed_user_ids.map(String).filter((id: string) => /^\d+$/.test(id))
      : [];

    // BOT導入制限が動き出す保存では、今サーバーにいるBotを先に承認済みにする。
    // 取得に失敗したまま保存すると既存のBotが処分されるので、保存自体を止める
    const prevGuard = await pool.query('SELECT bot_guard_enabled FROM antigrief_settings WHERE guild_id = $1', [guildId]);
    const prevEnable = await fetchEnableAntigrief(pool, guildId);
    const wasGuardActive = prevEnable && !!prevGuard.rows[0]?.bot_guard_enabled;
    const isGuardActive = (ENABLE_ANTIGRIEF ?? prevEnable) && botGuardEnabled;
    let existingBots: DiscordGuildMember[] = [];
    if (isGuardActive && !wasGuardActive) {
      try {
        existingBots = (await fetchAllGuildMembers(guildId)).filter(m => m.user.bot);
      } catch (e: any) {
        console.error('Failed to list existing bots:', e);
        return NextResponse.json({ error: 'サーバー内のBOT一覧を取得できなかったため、BOT導入制限をONにできませんでした' }, { status: 502 });
      }
    }

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

      await client.query(
        `INSERT INTO antigrief_settings (guild_id, target_category_ids, target_channel_ids, exempt_role_ids, admin_channel_id,
           bot_guard_enabled, bot_guard_action, bot_guard_allowed_user_ids)
         VALUES ($1, $2::bigint[], $3::bigint[], $4::bigint[], $5::bigint, $6, $7, $8::bigint[])
         ON CONFLICT (guild_id) DO UPDATE SET
         target_category_ids = $2::bigint[], target_channel_ids = $3::bigint[], exempt_role_ids = $4::bigint[],
         admin_channel_id = $5::bigint,
         bot_guard_enabled = $6, bot_guard_action = $7, bot_guard_allowed_user_ids = $8::bigint[]`,
        [
          guildId,
          target_category_ids?.map(String) || [],
          target_channel_ids?.map(String) || [],
          exempt_role_ids?.map(String) || [],
          adminChannelId,
          botGuardEnabled,
          botGuardAction,
          allowedUserIds
        ]
      );

      if (existingBots.length > 0) {
        await client.query(
          `INSERT INTO antigrief_approved_bots (guild_id, bot_id, bot_name, source)
           SELECT $1::bigint, t.id, t.name, 'existing'
           FROM unnest($2::bigint[], $3::text[]) AS t(id, name)
           ON CONFLICT (guild_id, bot_id) DO NOTHING`,
          [guildId, existingBots.map(m => m.user.id), existingBots.map(m => m.user.username)]
        );
      }

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
