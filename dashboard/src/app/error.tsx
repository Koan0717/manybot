'use client';

import { useEffect } from 'react';

/**
 * 画面の表示中にエラーが起きたときの表示。
 * Discordアクティビティの中ではブラウザのコンソールを見られないので、原因を画面に出す。
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-4">
      <div className="w-full max-w-md bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 space-y-4">
        <h1 className="text-lg font-bold">エラーが発生しました</h1>
        <p className="text-sm text-zinc-400">もう一度お試しください。直らない場合は、下の内容を管理者に伝えてください。</p>
        <pre className="text-xs text-red-300 bg-red-950/40 border border-red-900/60 rounded-xl p-3 whitespace-pre-wrap break-all max-h-64 overflow-auto">
          {error.message || String(error)}
          {error.digest ? `\n(digest: ${error.digest})` : ''}
          {error.stack ? `\n\n${error.stack.split('\n').slice(0, 6).join('\n')}` : ''}
          {`\n\nURL: ${typeof window !== 'undefined' ? window.location.pathname : ''}`}
        </pre>
        <div className="flex gap-2">
          <button
            onClick={reset}
            className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm font-semibold"
          >
            もう一度試す
          </button>
          <button
            onClick={() => window.location.replace('/login')}
            className="flex-1 py-2.5 bg-gradient-to-r from-red-600 to-rose-600 rounded-lg text-sm font-semibold"
          >
            ログイン画面へ
          </button>
        </div>
      </div>
    </main>
  );
}
