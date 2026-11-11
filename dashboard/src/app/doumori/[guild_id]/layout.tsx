'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Menu,
  X,
  LogOut,
  Leaf,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Wrench,
  Gamepad2,
  ChevronLeft,
  AlertTriangle,
  Database,
} from 'lucide-react';

/**
 * どう森BOT用ダッシュボード（第2のダッシュボード）。
 * サーバー選択画面の「どう森BOT」から入る。メインの /dashboard とは別のレイアウト・配色にしている。
 * データはどう森BOT本体と同じDB（DOUMORI_DATABASE_URL）を直接読み書きする。
 */
export default function DoumoriLayout({ children }: { children: React.ReactNode }) {
  const { guild_id: guildId } = useParams<{ guild_id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [guildName, setGuildName] = useState('');
  const [isSubAccount, setIsSubAccount] = useState(false);
  const [config, setConfig] = useState<{ db_source: 'guild' | 'legacy' | null; bot_active: boolean } | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setGuildName(s?.guild_name || ''))
      .catch(() => {});
    fetch('/api/auth/check')
      .then((r) => r.json())
      .then((a) => setIsSubAccount(!!a?.user?.guild_id))
      .catch(() => {});
    fetch(`/api/guilds/${guildId}/doumori/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setConfig)
      .catch(() => {})
      .finally(() => setConfigLoaded(true));
  }, [guildId]);

  const base = `/doumori/${guildId}`;
  const navItems = [
    { label: '基本設定', path: base, icon: SlidersHorizontal },
    { label: 'デイリーミッション管理', path: `${base}/missions`, icon: Sparkles },
    { label: '階級・ランク設定', path: `${base}/ranks`, icon: Trophy },
    { label: 'マイル手動操作', path: `${base}/miles`, icon: Wrench },
    { label: '総合操作パネル送信', path: `${base}/panel`, icon: Gamepad2 },
  ];

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    try {
      localStorage.removeItem('dashboard_session');
    } catch {}
    router.push('/login');
    router.refresh();
  };

  // メインダッシュボードと同じく、DBが無いサーバーでは初期設定（データベース設定）を先にしてもらう
  if (configLoaded && config && config.db_source === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-leaf-50 text-leaf-900 p-6">
        <div className="max-w-lg w-full bg-white border border-leaf-200 rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-leaf-100 text-leaf-600 flex items-center justify-center mx-auto mb-5">
            <Database className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-black mb-3">初期設定が必要です</h1>
          <p className="text-sm text-leaf-600 leading-relaxed mb-6">
            {guildName ? <strong>{guildName}</strong> : 'このサーバー'} にはまだデータベースが登録されていません。<br />
            メインダッシュボードの「データベース設定」で、このサーバー専用のデータベースを登録してください。登録すると、どう森BOTもそのデータベースを使います。
          </p>
          <div className="flex flex-col gap-2">
            <Link
              href={`/dashboard/${guildId}/database`}
              className="inline-flex items-center justify-center gap-2 bg-leaf-600 hover:bg-leaf-700 text-white font-bold py-3 px-6 rounded-xl transition-colors"
            >
              <Database className="w-4 h-4" />
              データベース設定へ進む
            </Link>
            {!isSubAccount && (
              <Link href="/" className="text-xs text-leaf-500 hover:text-leaf-800 py-2">
                サーバー選択に戻る
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-screen min-h-screen bg-leaf-50 text-leaf-900 overflow-hidden">
      <header className="md:hidden flex-none flex items-center justify-between bg-white border-b border-leaf-200 p-4 z-30">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-leaf-500 flex items-center justify-center flex-shrink-0">
            <Leaf className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-leaf-900 text-sm leading-tight">どう森BOT ダッシュボード</h2>
            {guildName && <p className="text-[11px] text-leaf-500 truncate">{guildName}</p>}
          </div>
        </div>
        <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 text-leaf-600 hover:bg-leaf-100 rounded-lg">
          <Menu size={22} />
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {isMobileMenuOpen && (
          <div className="absolute inset-0 bg-black/30 z-40 md:hidden" onClick={() => setIsMobileMenuOpen(false)} />
        )}

        <aside
          className={`
            absolute md:static inset-y-0 left-0 z-50
            w-72 bg-white border-r border-leaf-200 p-4 flex flex-col
            transform transition-transform duration-300 ease-in-out
            ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
            md:translate-x-0 h-full
          `}
        >
          <div className="mb-6 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-leaf-500 flex items-center justify-center shadow-lg shadow-leaf-500/20 flex-shrink-0">
                <Leaf className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-leaf-900 text-sm leading-tight">どう森BOT</h2>
                <p className="text-xs text-leaf-500 truncate">{guildName || '管理ダッシュボード'}</p>
              </div>
            </div>
            <button className="md:hidden p-1.5 text-leaf-500 hover:bg-leaf-100 rounded-lg" onClick={() => setIsMobileMenuOpen(false)}>
              <X size={18} />
            </button>
          </div>

          {config?.db_source && (
            <div className="mb-4 flex-shrink-0 space-y-1.5">
              <div className="flex items-center gap-2 text-[11px] text-leaf-600 bg-leaf-50 border border-leaf-200 rounded-lg px-2.5 py-1.5">
                <Database className="w-3.5 h-3.5 flex-shrink-0" />
                {config.db_source === 'guild' ? 'サーバー専用DBを使用中' : '旧どう森DB（共有）を使用中'}
              </div>
              {!config.bot_active && (
                <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                  このサーバーではどう森BOTが動いていません（DOUMORI_GUILD_ID に未登録）
                </div>
              )}
            </div>
          )}

          <nav className="flex-1 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const isActive = pathname === item.path;
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${
                    isActive ? 'bg-leaf-100 text-leaf-800 font-bold' : 'text-leaf-600 hover:bg-leaf-50'
                  }`}
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-leaf-600' : 'text-leaf-400'}`} />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="pt-4 border-t border-leaf-200 mt-auto flex-shrink-0 space-y-2">
            {!isSubAccount && (
              <Link href="/" className="text-xs text-leaf-500 hover:text-leaf-800 flex items-center gap-2 transition-colors">
                <ChevronLeft size={14} />
                サーバー選択に戻る
              </Link>
            )}
            <button onClick={handleLogout} className="text-xs text-leaf-500 hover:text-red-500 flex items-center gap-2 transition-colors w-full">
              <LogOut size={14} />
              ログアウト
            </button>
          </div>
        </aside>

        <main className="flex-1 p-4 md:p-8 overflow-y-auto w-full h-full">
          {configLoaded ? children : null}
        </main>
      </div>
    </div>
  );
}
