import { NextResponse } from 'next/server';
import { createMemberSession, getMemberSession, jsonError } from '@/lib/memberAuth';

/**
 * POST /api/member/session
 * 有効なメンバーセッションの期限を延ばした新しいトークンを返す。
 * ログアウトするまでログインしたままにするため、メンバー画面を開くたびにクライアントから呼ぶ。
 */
export async function POST(request: Request) {
  const session = await getMemberSession(request);
  if (!session) return jsonError('ログインが必要です', 401);
  const token = await createMemberSession({ discord_id: session.discord_id, username: session.username });
  return NextResponse.json({ success: true, token });
}
