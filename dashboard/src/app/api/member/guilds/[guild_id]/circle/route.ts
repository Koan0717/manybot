import { NextResponse } from 'next/server';
import { createSession, getSessionCookieOptions } from '@/lib/auth';
import { memberDisplayName } from '@/lib/discordApi';
import { requireGuildMember } from '@/lib/memberAuth';
import { isGuildAdmin } from '@/lib/memberAdmin';
import { isCircleGuild } from '@/lib/circle';

export const dynamic = 'force-dynamic';

const SESSION_TTL = '12h';

/**
 * POST /api/member/guilds/[guild_id]/circle
 * サークル用サーバーのメンバーを「サークル報告書」（/circle/[guild_id]）へ入れるセッションを発行する。
 * 管理者ロールの人は管理ダッシュボードと同じサブアドミン、それ以外の人はサークル報告書だけ使える circle。
 */
export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  if (!isCircleGuild(params.guild_id)) {
    return NextResponse.json({ error: 'このサーバーではサークル報告書を使えません' }, { status: 403 });
  }
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, member, session } = access;
  try {
    const admin = await isGuildAdmin(guildId, member);
    const token = await createSession(
      {
        username: memberDisplayName(member) || session.username || session.discord_id,
        role: admin ? 'subadmin' : 'circle',
        guild_id: guildId,
        discord_id: session.discord_id,
      },
      SESSION_TTL
    );
    const cookieOptions = getSessionCookieOptions();
    const response = NextResponse.json({ success: true, token, is_admin: admin, redirect: `/circle/${guildId}` });
    response.headers.append(
      'Set-Cookie',
      `${cookieOptions.name}=${token}; Path=${cookieOptions.path}; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${12 * 60 * 60}`
    );
    return response;
  } catch (e) {
    console.error('member circle login failed:', e);
    return NextResponse.json({ error: 'サークル報告書に入れませんでした' }, { status: 500 });
  }
}
