import { NextResponse } from 'next/server';
import { validateCredentials, createSession, getSessionCookieOptions } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: 'ユーザー名とパスワードを入力してください' },
        { status: 400 }
      );
    }

    const payload = await validateCredentials(username, password);

    if (!payload) {
      return NextResponse.json(
        { error: 'ユーザー名またはパスワードが正しくありません' },
        { status: 401 }
      );
    }

    // Create session and set cookie
    const token = await createSession(payload);
    const cookieOptions = getSessionCookieOptions();

    const response = NextResponse.json({ success: true, payload, token });
    
    // Next.js 14 doesn't support 'partitioned' in the types yet, so we append it manually
    response.headers.append(
      'Set-Cookie',
      `${cookieOptions.name}=${token}; Path=${cookieOptions.path}; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${cookieOptions.maxAge}`
    );

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'ログイン処理中にエラーが発生しました' },
      { status: 500 }
    );
  }
}

