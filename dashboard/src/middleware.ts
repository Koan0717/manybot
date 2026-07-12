import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as jose from 'jose';

const COOKIE_NAME = 'dashboard_session';

// Routes that don't require authentication
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some(path => pathname === path || pathname.startsWith(path + '/'))) {
    return NextResponse.next();
  }

  // Allow Next.js internal paths and static files
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.js')
  ) {
    return NextResponse.next();
  }

  // Check for session cookie
  const sessionToken = request.cookies.get(COOKIE_NAME)?.value;

  if (!sessionToken) {
    // No session token — redirect or return 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: '認証が必要です。ログインしてください。' },
        { status: 401 }
      );
    }
    // Redirect to login page
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Validate JWT
  try {
    const jwtSecretStr = process.env.JWT_SECRET || 'fallback_secret_key_change_me_later';
    const jwtSecret = new TextEncoder().encode(jwtSecretStr);
    const { payload } = await jose.jwtVerify(sessionToken, jwtSecret);

    const role = payload.role as string;
    const guildId = payload.guild_id as string | undefined;

    // Check guild specific restrictions
    if (guildId) {
      // Sub-accounts can only access their specific guild
      const dashboardGuildMatch = pathname.match(/^\/dashboard\/([^\/]+)/);
      const apiGuildMatch = pathname.match(/^\/api\/guilds\/([^\/]+)/);

      if (dashboardGuildMatch && dashboardGuildMatch[1] !== guildId) {
        return NextResponse.redirect(new URL(`/dashboard/${guildId}`, request.url));
      }

      if (apiGuildMatch && apiGuildMatch[1] !== guildId) {
        return NextResponse.json({ error: '他のサーバーへアクセスする権限がありません' }, { status: 403 });
      }

      // Role-based restrictions
      if (role === 'shop' && !pathname.includes('/shop') && pathname !== `/dashboard/${guildId}`) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json({ error: 'ショップ設定の権限しかありません' }, { status: 403 });
        }
        return NextResponse.redirect(new URL(`/dashboard/${guildId}/shop`, request.url));
      }
      
      if (role === 'gambling' && !pathname.includes('/gambling') && pathname !== `/dashboard/${guildId}`) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json({ error: 'ギャンブル設定の権限しかありません' }, { status: 403 });
        }
        return NextResponse.redirect(new URL(`/dashboard/${guildId}/gambling`, request.url));
      }
    } else {
      // Admin account: prevent access to unauthorized roles
      // No strict path locks, but we can do it if needed. Admin has access to all.
    }

  } catch (err) {
    // Invalid token
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'セッションが無効です。再度ログインしてください。' },
        { status: 401 }
      );
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
