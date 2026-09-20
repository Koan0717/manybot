import * as jose from 'jose';
import { NextResponse } from 'next/server';
import { DiscordApiError, DiscordGuildMember, botRequest } from '@/lib/discordApi';

/**
 * Discordログインしたメンバー用のセッション。
 * 管理者セッション（role: admin など）とは別物で、/api/member/* 以外には通さない（middleware.ts 参照）。
 */
export interface MemberSession {
  role: 'member';
  discord_id: string;
  username: string;
}

const SNOWFLAKE = /^\d{15,25}$/;
const MEMBER_SESSION_TTL = '12h';

function jwtSecret() {
  return new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_key_change_me_later');
}

export async function createMemberSession(session: Omit<MemberSession, 'role'>): Promise<string> {
  return new jose.SignJWT({ role: 'member', ...session })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(MEMBER_SESSION_TTL)
    .sign(jwtSecret());
}

export async function getMemberSession(request: Request): Promise<MemberSession | null> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const { payload } = await jose.jwtVerify(header.substring(7), jwtSecret());
    if (payload.role !== 'member' || typeof payload.discord_id !== 'string' || !SNOWFLAKE.test(payload.discord_id)) {
      return null;
    }
    return {
      role: 'member',
      discord_id: payload.discord_id,
      username: typeof payload.username === 'string' ? payload.username : '',
    };
  } catch {
    return null;
  }
}

export function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE.test(value);
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

type GuildAccess =
  | { ok: true; session: MemberSession; guildId: string; member: DiscordGuildMember }
  | { ok: false; response: NextResponse };

/**
 * セッションのユーザーが、指定サーバーのメンバーであることをBotトークンで毎回確認する。
 * guild_id はURL（＝クライアント申告）なので、ここを通さずにDBを引かないこと。
 */
export async function requireGuildMember(request: Request, guildId: string): Promise<GuildAccess> {
  const session = await getMemberSession(request);
  if (!session) {
    return { ok: false, response: jsonError('ログインが必要です', 401) };
  }
  if (!isSnowflake(guildId)) {
    return { ok: false, response: jsonError('サーバーIDが不正です', 400) };
  }
  try {
    const member = await botRequest<DiscordGuildMember>(`/guilds/${guildId}/members/${session.discord_id}`);
    return { ok: true, session, guildId, member };
  } catch (e) {
    if (e instanceof DiscordApiError && (e.status === 404 || e.status === 403)) {
      return { ok: false, response: jsonError('このサーバーのメンバーではないか、Botが参加していません', 403) };
    }
    console.error('requireGuildMember failed:', e);
    return { ok: false, response: jsonError('Discordとの通信に失敗しました', 502) };
  }
}
