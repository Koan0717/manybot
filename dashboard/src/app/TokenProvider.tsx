'use client';

/**
 * 保存済みの管理者トークン（localStorage の dashboard_session）を、すべての fetch に Authorization として付ける。
 * Cookie が使えない環境（ホーム画面に追加したアプリ、iframe など）でも API が使えるようにするため。
 *
 * 以前は useEffect の中で差し替えていたが、React は子のエフェクトを先に実行するので、
 * ページ側の最初の fetch（接続状況・ログイン確認など）がトークンなしで飛んで 401 になっていた。
 * そのため、このファイルが読み込まれた時点（どのエフェクトよりも前）で差し替える。
 */
function installAuthFetch() {
  if (typeof window === 'undefined') return;
  const w = window as typeof window & { __authFetchInstalled?: boolean };
  if (w.__authFetchInstalled) return;
  w.__authFetchInstalled = true;

  const originalFetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    let [, config] = args;
    let token: string | null = null;
    try {
      token = localStorage.getItem('dashboard_session');
    } catch {}

    if (token) {
      config = config || {};
      config.headers = config.headers || {};

      if (config.headers instanceof Headers) {
        if (!config.headers.has('Authorization')) {
          config.headers.set('Authorization', `Bearer ${token}`);
        }
      } else if (Array.isArray(config.headers)) {
        const hasAuth = config.headers.some(([key]) => key.toLowerCase() === 'authorization');
        if (!hasAuth) {
          config.headers.push(['Authorization', `Bearer ${token}`]);
        }
      } else {
        const headersRecord = config.headers as Record<string, string>;
        const hasAuth = Object.keys(headersRecord).some((key) => key.toLowerCase() === 'authorization');
        if (!hasAuth) {
          headersRecord['Authorization'] = `Bearer ${token}`;
        }
      }
      args[1] = config;
    }
    return originalFetch.apply(this, args);
  };
}

installAuthFetch();

export default function TokenProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
