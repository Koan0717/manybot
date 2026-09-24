'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { finishDiscordWebLogin } from '@/lib/memberClient';

/**
 * ブラウザ（Activity外）からの「Discordでログイン」で、Discordの認可画面から戻ってくるページ。
 * Discord Developer Portal の OAuth2 → Redirects に このページのURL を登録しておく必要がある。
 */
function DiscordCallback() {
  const router = useRouter();
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    // 認可コードをURL（履歴）に残さない
    window.history.replaceState(window.history.state, '', window.location.pathname);
    finishDiscordWebLogin(params)
      .then(() => router.replace('/member'))
      .catch((err) => setError(err instanceof Error ? err.message : 'Discordログインに失敗しました'));
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-4">
      <div className="w-full max-w-md bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-8 text-center">
        {error ? (
          <>
            <div className="bg-red-950/60 border border-red-800/60 text-red-300 px-4 py-3 rounded-xl text-sm text-left">
              {error}
            </div>
            <button
              type="button"
              onClick={() => router.replace('/login')}
              className="w-full mt-5 py-3 px-4 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-semibold rounded-xl transition-colors"
            >
              ログイン画面に戻る
            </button>
          </>
        ) : (
          <div className="flex items-center justify-center gap-2 text-zinc-300">
            <Loader2 className="w-5 h-5 animate-spin" />
            Discordでログインしています...
          </div>
        )}
      </div>
    </main>
  );
}

export default function DiscordCallbackPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-zinc-950" />}>
      <DiscordCallback />
    </Suspense>
  );
}
