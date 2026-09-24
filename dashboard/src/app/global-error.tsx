'use client';

/** ルートのレイアウト自体でエラーが起きたときの表示（error.tsx では拾えない分）。原因を画面に出す */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ja">
      <body style={{ background: '#09090b', color: 'white', fontFamily: 'sans-serif', padding: 16 }}>
        <h1 style={{ fontSize: 18 }}>エラーが発生しました</h1>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, color: '#fca5a5' }}>
          {error.message || String(error)}
          {error.digest ? `\n(digest: ${error.digest})` : ''}
          {error.stack ? `\n\n${error.stack.split('\n').slice(0, 6).join('\n')}` : ''}
        </pre>
        <button onClick={reset} style={{ padding: '8px 16px', marginTop: 8 }}>
          もう一度試す
        </button>
      </body>
    </html>
  );
}
