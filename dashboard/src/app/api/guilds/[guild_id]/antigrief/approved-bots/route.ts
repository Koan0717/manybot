import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureAntigriefSettingsSchema } from '@/lib/migrations';
import { DiscordApiError, DiscordUser, botRequest } from '@/lib/discordApi';

export const dynamic = 'force-dynamic';

// IPCでBotに設定再読み込みを通知
async function requestReload(pool: any, guildId: string): Promise<number | null> {
  const res = await pool.query(
    `INSERT INTO panel_requests (guild_id, channel_id, panel_type)
     VALUES ($1, 0, 'reload_antigrief')
     RETURNING id`,
    [guildId]
  );
  return res.rows[0]?.id ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  try {
    const pool = await getPool(guildId);
    await ensureAntigriefSettingsSchema(pool);
    const res = await pool.query(
      `SELECT bot_id::text AS bot_id, bot_name, source, approved_by::text AS approved_by, approved_at
         FROM antigrief_approved_bots WHERE guild_id = $1 ORDER BY approved_at DESC, bot_id`,
      [guildId]
    );
    return NextResponse.json(res.rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  try {
    const pool = await getPool(guildId);
    await ensureAntigriefSettingsSchema(pool);
    const body = await request.json();
    const botId = String(body.bot_id ?? '').trim();
    if (!/^\d{17,20}$/.test(botId)) {
      return NextResponse.json({ error: 'BOTのIDを正しく入力してください' }, { status: 400 });
    }

    if (body.action === 'delete') {
      await pool.query('DELETE FROM antigrief_approved_bots WHERE guild_id = $1 AND bot_id = $2', [guildId, botId]);
      const sync_request_id = await requestReload(pool, guildId);
      return NextResponse.json({ success: true, sync_request_id });
    }

    if (body.action === 'add') {
      let user: DiscordUser;
      try {
        user = await botRequest<DiscordUser>(`/users/${botId}`);
      } catch (e) {
        if (e instanceof DiscordApiError && e.status === 404) {
          return NextResponse.json({ error: 'このIDのBOTが見つかりません' }, { status: 404 });
        }
        throw e;
      }
      if (!user.bot) {
        return NextResponse.json({ error: 'このIDはBOTではありません' }, { status: 400 });
      }
      await pool.query(
        `INSERT INTO antigrief_approved_bots (guild_id, bot_id, bot_name, source)
         VALUES ($1, $2, $3, 'manual')
         ON CONFLICT (guild_id, bot_id) DO UPDATE SET bot_name = $3`,
        [guildId, botId, user.username]
      );
      const sync_request_id = await requestReload(pool, guildId);
      return NextResponse.json({ success: true, sync_request_id });
    }

    return NextResponse.json({ error: '不明な操作です' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
