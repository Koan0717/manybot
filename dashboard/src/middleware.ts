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

  // Check for session cookie or query param or auth header
  let sessionToken = request.cookies.get(COOKIE_NAME)?.value;

  if (!sessionToken) {
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      sessionToken = authHeader.substring(7);
    }
  }
  
  if (!sessionToken) {
    const urlToken = request.nextUrl.searchParams.get('session_token');
    if (urlToken) {
      sessionToken = urlToken;
    }
  }

  if (!sessionToken) {
    // No session token — redirect or return 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: '認証が必要です。ログインしてください。' },
        { status: 401 }
      );
    }
    
    const isRSC = request.headers.has('RSC') || request.headers.get('x-middleware-prefetch');
    if (!isRSC && pathname !== '/login') {
      return new NextResponse(`
        <!DOCTYPE html>
        <html>
          <head><title>認証を確認中...</title></head>
          <body style="background-color: #09090b; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif;">
            <div>認証情報を確認しています...</div>
            <script>
              const token = localStorage.getItem('dashboard_session');
              if (token) {
                const url = new URL(window.location.href);
                url.searchParams.set('session_token', token);
                window.location.replace(url.toString());
              } else {
                const loginUrl = new URL('/login', window.location.origin);
                loginUrl.searchParams.set('redirect', window.location.pathname);
                window.location.replace(loginUrl.toString());
              }
            </script>
          </body>
        </html>
      `, { headers: { 'Content-Type': 'text/html' } });
    }

    // Redirect to login page for RSC requests
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
    const botId = payload.bot_id as string | undefined;

    // Dedicated Bot Sub-Account restriction
    if (botId && guildId) {
      const allowedBotPrefix = `/dashboard/bot/${botId}/${guildId}`;
      const isAllowedPage = pathname === allowedBotPrefix || pathname.startsWith(allowedBotPrefix + '/') || pathname.startsWith(allowedBotPrefix + '?');
      
      const isAllowedApi =
        pathname.startsWith('/api/auth') ||
        pathname.startsWith(`/api/guilds/${guildId}`) ||
        pathname.startsWith(`/api/bots/${botId}`);

      if (pathname.startsWith('/api/')) {
        if (!isAllowedApi) {
          return NextResponse.json({ error: 'このBot専用ダッシュボード以外のアクセス権限がありません' }, { status: 403 });
        }
      } else {
        if (!isAllowedPage) {
          return NextResponse.redirect(new URL(allowedBotPrefix, request.url));
        }
      }
    } else if (guildId) {
      // Standard Guild Sub-accounts can only access their specific guild
      const dashboardGuildMatch = pathname.match(/^\/dashboard\/([^\/]+)/);
      const apiGuildMatch = pathname.match(/^\/api\/guilds\/([^\/]+)/);

      if (dashboardGuildMatch && dashboardGuildMatch[1] !== guildId && !pathname.startsWith('/dashboard/bot/')) {
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

      if (role === 'subadmin' && pathname.includes('/accounts')) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json({ error: 'アカウント管理の権限はありません' }, { status: 403 });
        }
        return NextResponse.redirect(new URL(`/dashboard/${guildId}`, request.url));
      }
    } else {
      // Admin account: full access
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
