import { NextResponse } from 'next/server';
import { COOKIE_NAME, validateSession } from '@/lib/auth';
import { LATEST_ADDON_VERSION, isServerOnline, listMinecraftServers } from '@/lib/minecraft';

export const dynamic = 'force-dynamic';

/**
 * GET /api/minecraft-overview
 * トップ画面の「マイクラシステム」用。全サーバーのマイクラ連携の接続状況をまとめて返す。
 * サーバー単位のサブアカウントには他サーバーの情報を見せない（全体管理者だけ）。
 */
export async function GET(request: Request) {
  const cookie = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`))?.[1];
  const header = request.headers.get('authorization');
  const token = cookie ?? (header?.startsWith('Bearer ') ? header.substring(7) : null);
  const session = token ? await validateSession(decodeURIComponent(token)) : null;
  if (!session || session.guild_id || (session as any).role === 'member') {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  try {
    const servers = await listMinecraftServers();
    return NextResponse.json({
      latest_addon_version: LATEST_ADDON_VERSION,
      servers: servers.map((s) => ({
        guild_id: s.guild_id,
        is_enabled: s.is_enabled,
        has_api_key: !!s.api_key_hint,
        online: isServerOnline(s),
        server_name: s.server_name,
        addon_version: s.addon_version,
        online_players: s.online_players,
        max_players: s.max_players,
        last_heartbeat_at: s.last_heartbeat_at,
        join_leave_log: !!s.join_leave_channel_id,
      })),
    });
  } catch (e: any) {
    console.error('GET /api/minecraft-overview failed:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
