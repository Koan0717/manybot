import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as jose from 'jose';
import { ACTIVITY_STASH_SCRIPT } from '@/lib/activityStash';

const COOKIE_NAME = 'dashboard_session';

// Routes that don't require authentication
// /member 配下のページは中身のないクライアント側の殻で、データは /api/member/* から
// Authorization ヘッダー付きで取得する（そちらはトークン必須）。
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/member',
  '/api/member/discord-login',
  '/api/member/discord-config',
];

/**
 * 未ログイン（または無効なトークン）のページ表示には、サーバーでリダイレクトせずこのHTMLを返し、
 * ブラウザ側のスクリプトに /login への移動を任せる。
 *
 * サーバーは Discord のプロキシ越しにリクエストを受けるため、Activity の起動パラメータ(frame_id 等)を
 * 見られないことがある。サーバーで先にリダイレクトするとブラウザがそれを見る前にURLが切り替わり、
 * Discord SDK が初期化できなくなる。ブラウザ側なら window.location.search に本物のパラメータがある。
 */
function clientLoginRedirectPage(opts: { dropStoredToken: boolean; clearCookie: boolean }) {
  const html = `
        <!DOCTYPE html>
        <html>
          <head><title>認証を確認中...</title></head>
          <body style="background-color: #09090b; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif;">
            <div>認証情報を確認しています...</div>
            <script>
              // Discordアクティビティの起動パラメータ(frame_id 等)を退避し、リダイレクト先にも引き継ぐ
              // （Discord SDK は現在のURLからこれを読むので、無いとDiscordログインが初期化できない）。
              ${ACTIVITY_STASH_SCRIPT}
              const launchSearch = window.location.search;

              // 直前にこの端末のトークンで試して無効だった場合は捨てる（同じトークンで繰り返さない）
              const dropStoredToken = ${opts.dropStoredToken ? 'true' : 'false'};
              let token = null;
              try {
                if (dropStoredToken) localStorage.removeItem('dashboard_session');
                else token = localStorage.getItem('dashboard_session');
              } catch (e) {}

              if (token) {
                const url = new URL(window.location.href);
                url.searchParams.set('session_token', token);
                window.location.replace(url.toString());
              } else {
                const loginUrl = new URL('/login', window.location.origin);
                new URLSearchParams(launchSearch).forEach(function (value, key) {
                  if (key !== 'redirect' && key !== 'session_token') loginUrl.searchParams.set(key, value);
                });
                loginUrl.searchParams.set('redirect', window.location.pathname);
                window.location.replace(loginUrl.toString());
              }
            </script>
          </body>
        </html>
      `;
  const response = new NextResponse(html, { headers: { 'Content-Type': 'text/html' } });
  if (opts.clearCookie) {
    // 無効なCookieが残っていると、毎回ここに来て（Cookieが優先されるため）他のトークンも使えない
    response.headers.append(
      'Set-Cookie',
      `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned`
    );
  }
  return response;
}

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
      return clientLoginRedirectPage({ dropStoredToken: false, clearCookie: false });
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

    // Discordログインのメンバーは /api/member/* だけ。ここで弾かないと、
    // guild_id を持たないトークンは下の「Admin account: full access」に落ちてしまう。
    if (role === 'member') {
      if (pathname.startsWith('/api/member/')) {
        return NextResponse.next();
      }
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'メンバーにはこの操作の権限がありません' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/member', request.url));
    }

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
    const isRSC = request.headers.has('RSC') || request.headers.get('x-middleware-prefetch');
    if (!isRSC) {
      // session_token が付いていれば、ブラウザ側が保存済みトークンで試した結果が無効だった、ということ
      const triedStoredToken = request.nextUrl.searchParams.has('session_token');
      return clientLoginRedirectPage({ dropStoredToken: triedStoredToken, clearCookie: true });
    }
    const loginUrl = new URL('/login', request.url);
    request.nextUrl.searchParams.forEach((value, key) => {
      if (key !== 'session_token' && key !== 'redirect') loginUrl.searchParams.set(key, value);
    });
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
