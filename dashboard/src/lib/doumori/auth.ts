import { COOKIE_NAME, validateSession } from '@/lib/auth';

/** リクエストのセッション（Cookie か Authorization ヘッダー）。無効なら null */
export async function getRequestSession(request: Request) {
  const cookie = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`))?.[1];
  const header = request.headers.get('authorization');
  const token = cookie ?? (header?.startsWith('Bearer ') ? header.substring(7) : null);
  return token ? await validateSession(decodeURIComponent(token)) : null;
}

/** 全体管理者（サーバー単位のサブアカウントではない）かどうか */
export async function isSuperAdmin(request: Request) {
  const session = await getRequestSession(request);
  return !!session && !session.guild_id && (session as any).role !== 'member';
}
