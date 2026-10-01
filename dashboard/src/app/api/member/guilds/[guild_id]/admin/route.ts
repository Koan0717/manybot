import { NextResponse } from 'next/server';
import { createSession, getSessionCookieOptions } from '@/lib/auth';
import { memberDisplayName } from '@/lib/discordApi';
import { requireGuildMember } from '@/lib/memberAuth';
import { isGuildAdmin } from '@/lib/memberAdmin';

export const dynamic = 'force-dynamic';

// 運営ロールを外されたら入れなくなるよう、Discordログインから発行する管理セッションは短めにする
const ADMIN_SESSION_TTL = '12h';

/**
 * GET /api/member/guilds/[guild_id]/admin
 * ログイン中のメンバーが、そのサーバーの運営管理者ロールを持っているか（管理ダッシュボードへ入れるか）。
 */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  try {
    return NextResponse.json({ is_admin: await isGuildAdmin(access.guildId, access.member) });
  } catch (e) {
    console.error('member admin check failed:', e);
    return NextResponse.json({ error: '運営ロールを確認できませんでした' }, { status: 500 });
  }
}

/**
 * POST /api/member/guilds/[guild_id]/admin
 * 運営管理者ロールを持つメンバーに、そのサーバーだけのサブアドミン（アカウント設定で発行するのと同じ権限）の
 * 管理ダッシュボード用セッションを発行する。全サーバー・全機能のアドミンにはしない。
 */
export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, member, session } = access;
  try {
    if (!(await isGuildAdmin(guildId, member))) {
      return NextResponse.json({ error: 'このサーバーの運営管理者ロールを持っていません' }, { status: 403 });
    }
    const token = await createSession(
      {
        username: memberDisplayName(member) || session.username || session.discord_id,
        role: 'subadmin',
        guild_id: guildId,
        discord_id: session.discord_id,
      },
      ADMIN_SESSION_TTL
    );
    const cookieOptions = getSessionCookieOptions();
    const response = NextResponse.json({ success: true, token, redirect: `/dashboard/${guildId}` });
    response.headers.append(
      'Set-Cookie',
      `${cookieOptions.name}=${token}; Path=${cookieOptions.path}; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${12 * 60 * 60}`
    );
    return response;
  } catch (e) {
    console.error('member admin login failed:', e);
    return NextResponse.json({ error: '管理ダッシュボードに入れませんでした' }, { status: 500 });
  }
}
