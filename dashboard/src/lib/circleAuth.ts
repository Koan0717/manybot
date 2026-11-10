import { SessionPayload, getSessionTokenFromCookies, validateSession } from '@/lib/auth';

/**
 * サークル報告書APIを呼んだ人のセッション（Cookie または Authorization ヘッダー）。
 * ミドルウェアで検証済みだが、一般メンバー（role: circle）かどうかと Discord ID を知るために読み直す。
 */
export async function getRequestSession(request: Request): Promise<SessionPayload | null> {
  const header = request.headers.get('authorization');
  if (header?.startsWith('Bearer ')) {
    const s = await validateSession(header.substring(7));
    if (s) return s;
  }
  const token = getSessionTokenFromCookies();
  return token ? validateSession(token) : null;
}

/** 一般メンバーは自分が書いた報告書だけ編集・送信・削除できる。管理者は全部 */
export const canManageReport = (session: SessionPayload | null, authorId: string | null | undefined) => {
  if (!session || session.role !== 'circle') return true;
  return !!session.discord_id && !!authorId && String(authorId) === String(session.discord_id);
};
