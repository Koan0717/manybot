'use client';

import { useEffect, useRef, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { KeyRound, Loader2, MessageCircle } from 'lucide-react';
import {
  LOGIN_STEP_LABEL,
  LoginStep,
  consumeLoggedOut,
  discordActivityLogin,
  isDiscordActivity,
  startDiscordWebLogin,
} from '@/lib/memberClient';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  // 'choose': 2つのボタンを表示 / 'password': 従来のID・パスワードのフォームを表示
  const [mode, setMode] = useState<'choose' | 'password'>('choose');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [discordLoading, setDiscordLoading] = useState(false);
  const [loginStep, setLoginStep] = useState<LoginStep | null>(null);

  const autoStarted = useRef(false);

  const handleDiscordLogin = async () => {
    setError('');
    setDiscordLoading(true);
    setLoginStep(null);
    try {
      if (isDiscordActivity()) {
        // Discordアクティビティ内: SDK で開いた本人に許可してもらい、そのままログイン
        await discordActivityLogin(setLoginStep);
        router.push('/member');
      } else {
        // ブラウザ: Discordの認可画面へ移動し、/login/discord-callback に戻ってくる
        setLoginStep('authorize');
        await startDiscordWebLogin();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discordログインに失敗しました');
      setDiscordLoading(false);
      setLoginStep(null);
    }
  };

  // Activity の起動パラメータ(frame_id 等)がURLに残っているうちに退避し（Discord SDK がURLから読むため）、
  // Activity から開かれた場合は、開いた人にすぐDiscordの許可を求めてログインする。
  // ログアウト直後だけは自動で始めない（専用ログインも選べるように）。
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    const loggedOut = consumeLoggedOut();
    if (isDiscordActivity() && !loggedOut) {
      handleDiscordLogin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        if (data.token) {
          localStorage.setItem('dashboard_session', data.token);
        }
        
        // Always pass token in URL to handle ITP blocked cookies
        const url = new URL(redirect, window.location.href);
        if (data.token) {
          url.searchParams.set('session_token', data.token);
        }
        router.push(url.pathname + url.search);
        router.refresh();
      } else {
        setError(data.error || 'ログインに失敗しました');
      }
    } catch (err) {
      setError('サーバーに接続できませんでした');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-950 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] bg-red-600/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] bg-red-400/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] w-[300px] h-[300px] bg-rose-600/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="w-full max-w-md mx-4 relative z-10">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-red-500 to-rose-700 rounded-2xl shadow-lg shadow-red-500/20 mb-5">
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Many bot</h1>
          <p className="text-zinc-500 mt-2 text-sm">
            {mode === 'choose' ? 'ログイン方法を選んでください' : '専用ログイン'}
          </p>
        </div>

        {/* Login method chooser */}
        {mode === 'choose' && (
          <div className="bg-zinc-900/80 backdrop-blur-xl border border-zinc-800/80 rounded-2xl p-8 shadow-2xl shadow-black/40 space-y-4">
            {error && (
              <div className="bg-red-950/60 border border-red-800/60 text-red-300 px-4 py-3 rounded-xl text-sm">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleDiscordLogin}
              disabled={discordLoading}
              className="w-full py-3 px-4 bg-[#5865F2] hover:bg-[#4752C4] disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-[#5865F2]/20 active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {discordLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <MessageCircle className="w-5 h-5" />}
              {discordLoading ? (loginStep ? LOGIN_STEP_LABEL[loginStep] : 'Discordで認証中...') : 'Discordでログイン'}
            </button>

            <button
              type="button"
              onClick={() => { setError(''); setMode('password'); }}
              disabled={discordLoading}
              className="w-full py-3 px-4 bg-zinc-800 hover:bg-zinc-700 disabled:cursor-not-allowed border border-zinc-700 text-zinc-200 font-semibold rounded-xl transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <KeyRound className="w-5 h-5" />
              専用ログイン
            </button>

            <p className="text-center text-zinc-600 text-xs pt-2 leading-relaxed">
              Discordでログイン: サーバーのメンバー向け（プロフィール・送金）。ブラウザ・アクティビティのどちらからでも使えます<br />
              専用ログイン: 管理者・運営向け（ID／パスワード）
            </p>
          </div>
        )}

        {/* Login Card (専用ログイン) */}
        {mode === 'password' && (
        <form
          onSubmit={handleSubmit}
          className="bg-zinc-900/80 backdrop-blur-xl border border-zinc-800/80 rounded-2xl p-8 shadow-2xl shadow-black/40"
        >
          {error && (
            <div className="bg-red-950/60 border border-red-800/60 text-red-300 px-4 py-3 rounded-xl mb-6 text-sm flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 flex-shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span>{error}</span>
              </div>
              {error.includes('ログインから進まない') || error.includes('サーバーに接続できません') || true ? (
                <div className="mt-2 text-xs text-red-200">
                  <p>※スマホ・iPad（iOS）のDiscordアプリ内で開いている場合、Appleのセキュリティ仕様によりログインできないことがあります。</p>
                  <button 
                    type="button"
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="mt-3 px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-white font-bold inline-flex items-center gap-1 border border-red-500/30 w-full justify-center"
                  >
                    外部ブラウザ（Safari等）で開く
                  </button>
                </div>
              ) : null}
            </div>
          )}

          <div className="space-y-5">
            {/* Username */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-zinc-400 mb-2">
                ユーザー名
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                </div>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="ユーザー名を入力"
                  className="w-full pl-11 pr-4 py-3 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/50 transition-all duration-200"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-zinc-400 mb-2">
                パスワード
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="パスワードを入力"
                  className="w-full pl-11 pr-4 py-3 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/50 transition-all duration-200"
                />
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-7 py-3 px-4 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:from-zinc-700 disabled:to-zinc-700 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-red-600/20 hover:shadow-red-500/30 active:scale-[0.98]"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                ログイン中...
              </span>
            ) : (
              'ログイン'
            )}
          </button>

          <button
            type="button"
            onClick={() => { setError(''); setMode('choose'); }}
            className="w-full mt-3 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ← ログイン方法の選択に戻る
          </button>
        </form>
        )}

        {/* Footer note */}
        {mode === 'password' && (
          <p className="text-center text-zinc-700 text-xs mt-6">
            管理者のみアクセスできます
          </p>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-white">
        <div>読み込み中...</div>
      </main>
    }>
      <LoginForm />
    </Suspense>
  );
}
