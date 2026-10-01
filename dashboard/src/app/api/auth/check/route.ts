import { NextResponse } from 'next/server';
import { isAuthenticated, validateSession } from '@/lib/auth';

export async function GET(request: Request) {
  // Cookie が使えない環境（Discordアクティビティの iframe など）では Authorization ヘッダーのトークンで確認する
  let payload = await isAuthenticated();
  const header = request.headers.get('authorization');
  if (!payload && header?.startsWith('Bearer ')) {
    payload = await validateSession(header.substring(7));
  }
  return NextResponse.json({ 
    authenticated: !!payload,
    user: payload
  });
}
