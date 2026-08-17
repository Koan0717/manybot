'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Menu,
  X,
  LogOut,
  SlidersHorizontal,
  Ticket,
  ShoppingBag,
  Fish,
  BookOpen,
  Trophy,
  Coins,
  Camera,
  CreditCard,
  Wrench,
  Gamepad2,
  Database,
  ChevronLeft,
  Bot,
  Activity,
  Users,
  type LucideIcon,
} from 'lucide-react';

interface BotInfo {
  bot_id: string;
  bot_name: string;
  github_repo: string | null;
  render_deploy_hook_url: string | null;
  has_dedicated_db: boolean;
  last_commit_sha: string | null;
  last_commit_message: string | null;
}

interface NavItem {
  label: string;
  tabKey: string;
  icon: LucideIcon;
  badge?: string;
}

interface NavSection {
  section: string;
  items: NavItem[];
}

export default function BotDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { bot_id: string; guild_id: string };
}) {
  const { bot_id, guild_id } = params;
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab') || 'overview';
  const router = useRouter();

  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const [guildName, setGuildName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  useEffect(() => {
    Promise.all([
      fetch(`/api/bots/${bot_id}`).then((res) => (res.ok ? res.json() : null)),
      fetch(`/api/guilds/${guild_id}/status`).then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([botData, statusData]) => {
        if (botData) setBotInfo(botData);
        if (statusData && !statusData.error && statusData.guild_name) {
          setGuildName(statusData.guild_name);
        }
      })
      .catch((err) => console.error('Dashboard init error:', err))
      .finally(() => setLoading(false));
  }, [bot_id, guild_id]);

  const navSections: NavSection[] = [
    {
      section: 'ダッシュボード',
      items: [
        { label: '総合ステータス・概要', tabKey: 'overview', icon: Activity },
      ],
    },
    {
      section: '📜 ミッション＆ランク管理',
      items: [
        { label: 'ミッション一覧・作成・統計', tabKey: 'missions', icon: Camera, badge: '1日3枠' },
        { label: '階級・ランクアップ設定', tabKey: 'resident-ranks', icon: CreditCard, badge: '4段階' },
        { label: 'マイル手動操作＆ログ (管理者)', tabKey: 'mile-management', icon: Wrench, badge: '管理者' },
      ],
    },
    {
      section: '🎫 浮上・ショップ・経済',
      items: [
        { label: '浮上・チケット獲得設定', tabKey: 'tickets', icon: Ticket, badge: '自動付与' },
        { label: 'ショップ・道具交換 (/ショップ)', tabKey: 'shop', icon: ShoppingBag },
        { label: '通貨・両替・売却 (/両替, /売却)', tabKey: 'economy-exchange', icon: Coins, badge: 'ゼニー連携' },
      ],
    },
    {
      section: '🎣 採集・図鑑・コンプリート',
      items: [
        { label: '採集＆出現率 (/釣り, /虫捕り)', tabKey: 'gathering', icon: Fish, badge: '✨色違い' },
        { label: '図鑑表示 (/魚図鑑, /虫図鑑)', tabKey: 'encyclopedia', icon: BookOpen },
        { label: '限定コンプリートロール付与', tabKey: 'completion-roles', icon: Trophy, badge: 'ゴールド' },
      ],
    },
    {
      section: '🗄️ データベース＆システム',
      items: [
        { label: 'データベース接続＆ヘルス', tabKey: 'database-health', icon: Database, badge: 'Supabase' },
        { label: '総合操作パネル (/パネル設置)', tabKey: 'panel-control', icon: Gamepad2, badge: '即時送信' },
        { label: '専用アカウント設定', tabKey: 'accounts', icon: Users, badge: '限定アクセス' },
      ],
    },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white gap-3 mecha-grid-bg-purple">
        <Bot className="w-6 h-6 text-purple-400 animate-bounce" />
        <span className="font-tech text-purple-300 text-sm tracking-wide">Purple HUD 初期化中...</span>
      </div>
    );
  }

  const botDisplayName = botInfo?.bot_name || 'どうぶつの森林 Bot';

  return (
    <div className="flex flex-col md:flex-row h-screen min-h-screen bg-zinc-950 text-white overflow-hidden mecha-grid-bg-purple">
      {/* Background Ambience */}
      <div className="fixed top-[-10%] right-[-5%] w-[600px] h-[600px] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none z-0" />
      <div className="fixed bottom-[-10%] left-[-5%] w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[140px] pointer-events-none z-0" />

      {/* Mobile Header */}
      <header className="md:hidden flex-none flex items-center justify-between bg-zinc-900/95 backdrop-blur border-b border-purple-900/40 p-4 z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 mecha-clip-sm bg-gradient-to-br from-purple-600 to-indigo-900 flex items-center justify-center shadow-lg shadow-purple-900/40 flex-shrink-0 border border-purple-500/40">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="font-mecha font-bold text-white text-sm leading-tight tracking-wide flex items-center gap-1.5">
              <span>{botDisplayName}</span>
              <span className="font-tech text-xs font-normal text-purple-400">[{guildName || guild_id}]</span>
            </h2>
            <p className="font-tech text-[10px] text-zinc-500">ID: {guild_id}</p>
          </div>
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 text-zinc-400 hover:text-purple-300 hover:bg-zinc-800 rounded-lg transition-colors"
        >
          <Menu size={24} />
        </button>
      </header>

      {/* Sidebar and Main Container */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* Mobile Backdrop */}
        {isMobileMenuOpen && (
          <div
            className="absolute inset-0 bg-black/70 z-40 md:hidden backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Purple Mecha Sidebar */}
        <aside
          className={`
            absolute md:static inset-y-0 left-0 z-50
            w-80 bg-zinc-900/95 backdrop-blur border-r border-purple-900/40 p-4 flex flex-col
            transform transition-transform duration-300 ease-in-out
            ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
            md:translate-x-0 h-full shadow-[5px_0_25px_-5px_rgba(168,85,247,0.15)]
          `}
        >
          {/* Header & Bot Profile */}
          <div className="mb-4 flex justify-between items-start flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 mecha-clip-sm bg-gradient-to-br from-purple-600 via-indigo-700 to-purple-900 flex items-center justify-center shadow-lg shadow-purple-900/50 flex-shrink-0 border border-purple-400/40">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="mecha-led w-2 h-2 rounded-full bg-purple-400 text-purple-400" />
                  <h2 className="font-mecha text-base font-black text-white leading-tight truncate tracking-wide">
                    {botDisplayName}
                  </h2>
                </div>
                <p className="font-tech text-[11px] text-purple-400/90 truncate font-semibold">
                  {guildName || `Guild: ${guild_id}`}
                </p>
              </div>
            </div>
            <button
              className="md:hidden p-2 -mr-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors flex-shrink-0"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <X size={20} />
            </button>
          </div>

          {/* HUD Metadata Badges */}
          <div className="mb-3 flex-shrink-0 space-y-2">
            <p className="font-tech text-[10px] text-zinc-400 bg-black/50 border border-purple-900/40 mecha-clip-sm px-2.5 py-1.5 tracking-wider flex items-center justify-between">
              <span>GUILD_ID</span>
              <span className="font-mono text-purple-300">{guild_id}</span>
            </p>
            {botInfo?.has_dedicated_db ? (
              <div className="mecha-clip-sm bg-purple-950/40 border border-purple-800/60 text-purple-300 text-xs px-2.5 py-1.5 flex items-center gap-2">
                <span className="mecha-led w-1.5 h-1.5 rounded-full bg-purple-400 text-purple-400 flex-shrink-0" />
                <span className="font-tech leading-snug">DEDICATED SUPABASE<br />専用DB接続完了</span>
              </div>
            ) : (
              <div className="mecha-clip-sm bg-zinc-900/60 border border-zinc-700/60 text-zinc-400 text-xs px-2.5 py-1.5 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 flex-shrink-0" />
                <span className="font-tech leading-snug">SHARED CORE DB<br />共有マスター接続</span>
              </div>
            )}
          </div>

          {/* Navigation Groups */}
          <nav className="flex-1 min-h-0 space-y-4 overflow-y-auto pr-1 pb-4">
            {navSections.map((sec) => (
              <div key={sec.section} className="space-y-1">
                <p className="px-2 font-tech text-[10px] font-bold uppercase tracking-wider text-purple-400/90 border-b border-purple-900/40 pb-1">
                  {sec.section}
                </p>
                <div className="space-y-1 pt-1">
                  {sec.items.map((item) => {
                    const isActive = currentTab === item.tabKey;
                    const Icon = item.icon;
                    const targetUrl = `/dashboard/bot/${bot_id}/${guild_id}?tab=${item.tabKey}`;

                    return (
                      <Link
                        key={item.tabKey}
                        href={targetUrl}
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={`flex items-center justify-between px-2.5 py-2 text-xs transition-all group relative overflow-hidden border-l-2 ${
                          isActive
                            ? 'mecha-clip-sm bg-gradient-to-r from-purple-600/30 via-purple-900/20 to-transparent text-white font-bold border-purple-400 shadow-sm'
                            : 'text-zinc-400 hover:bg-purple-950/20 hover:text-purple-200 border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon
                            className={`w-4 h-4 flex-shrink-0 transition-colors ${
                              isActive ? 'text-purple-300' : 'text-zinc-500 group-hover:text-purple-400'
                            }`}
                          />
                          <span className="truncate font-tech tracking-wide">{item.label}</span>
                        </div>
                        {item.badge && (
                          <span className="font-tech text-[9px] px-1.5 py-0.5 rounded bg-purple-950/80 border border-purple-800 text-purple-300 flex-shrink-0">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Footer Controls */}
          <div className="pt-3 border-t border-purple-900/40 mt-auto flex-shrink-0 space-y-2">
            <Link
              href={`/dashboard/bot/${bot_id}`}
              className="font-tech text-xs text-zinc-400 hover:text-purple-300 flex items-center gap-2 transition-colors py-1.5 px-2 rounded hover:bg-purple-950/30"
            >
              <ChevronLeft className="w-4 h-4 text-purple-400" />
              サーバー選択に戻る
            </Link>
            <button
              onClick={handleLogout}
              className="font-tech text-xs text-zinc-500 hover:text-red-400 flex items-center gap-2 transition-colors w-full py-1.5 px-2 rounded hover:bg-red-950/20"
            >
              <LogOut size={14} />
              ログアウト
            </button>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 p-4 md:p-8 overflow-y-auto w-full h-full">
          {children}
        </main>
      </div>
    </div>
  );
}
