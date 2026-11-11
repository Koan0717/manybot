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
  const [config, setConfig] = useState<{ db_configured: boolean; bot_configured: boolean } | null>(null);

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
      .catch(() => {});
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
          {config && (!config.db_configured || !config.bot_configured) && (
            <div className="max-w-5xl mx-auto mb-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 text-sm flex gap-3">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-500" />
              <div className="space-y-1">
                {!config.db_configured && (
                  <p>
                    どう森BOTのデータベースが未設定です。ダッシュボードの環境変数 <code className="font-mono">DOUMORI_DATABASE_URL</code> を設定してください。
                  </p>
                )}
                {!config.bot_configured && (
                  <p>
                    どう森BOTのトークンが未設定のため、総合操作パネルを送信できません。環境変数 <code className="font-mono">DOUMORI_BOT_TOKEN</code> を設定してください。
                  </p>
                )}
              </div>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
