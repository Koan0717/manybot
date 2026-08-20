'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Menu,
  X,
  LogOut,
  SlidersHorizontal,
  DoorOpen,
  ShieldOff,
  Zap,
  Timer,
  ShoppingBag,
  Ticket,
  Trophy,
  ClipboardCheck,
  Coins,
  Dices,
  Gift,
  Terminal,
  ScrollText,
  UserCheck,
  UserPlus,
  ShieldAlert,
  LayoutPanelTop,
  Database,
  Users,
  ChevronLeft,
  CircuitBoard,
  PhoneCall,
  Activity,
  Gamepad2,
  type LucideIcon,
} from 'lucide-react';


interface NavItem {
  label: string;
  path: string;
  roles: string[];
  icon: LucideIcon;
  group: '評価鯖' | '雑談鯖' | 'その他';
}

interface NavSection {
  section: string;
  items: NavItem[];
}

export default function DashboardLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { guild_id: string };
}) {
  const pathname = usePathname();
  const guildId = params.guild_id;

  const [status, setStatus] = useState<{is_new_server: boolean, has_dedicated_db: boolean, guild_name?: string} | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isSubAccount, setIsSubAccount] = useState(false);
  const router = useRouter();

  const [isActivity, setIsActivity] = useState(false);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  useEffect(() => {
    if (typeof window !== 'undefined' && window.parent !== window) {
      setIsActivity(true);
    }
    Promise.all([
      fetch(`/api/guilds/${guildId}/status`).then(res => res.json()),
      fetch('/api/auth/check').then(res => res.json())
    ])
      .then(([statusData, authData]) => {
        if (!statusData.error) setStatus(statusData);
        if (authData.authenticated && authData.user) {
          setUserRole(authData.user.role);
          setIsSubAccount(!!authData.user.guild_id);
        }
      })
      .finally(() => setLoading(false));
  }, [guildId]);

  const navSections: NavSection[] = [
    {
      section: '全般',
      items: [
        { label: '基本・評価設定', path: `/dashboard/${guildId}`, roles: ['admin', 'subadmin'], icon: SlidersHorizontal, group: '評価鯖' },
      ],
    },
    {
      section: 'ボイスチャンネル',
      items: [
        { label: 'VCルーム設定', path: `/dashboard/${guildId}/rooms`, roles: ['admin', 'subadmin'], icon: DoorOpen, group: '評価鯖' },
        { label: '通話募集掲示板設定', path: `/dashboard/${guildId}/call-board`, roles: ['admin', 'subadmin'], icon: PhoneCall, group: '雑談鯖' },
        { label: '評価落ちVCアクセス制御', path: `/dashboard/${guildId}/room-access`, roles: ['admin', 'subadmin'], icon: ShieldOff, group: '評価鯖' },
        { label: 'VCトリガー設定', path: `/dashboard/${guildId}/vc-triggers`, roles: ['admin', 'subadmin'], icon: Zap, group: '雑談鯖' },
        { label: 'VCコイン獲得制限', path: `/dashboard/${guildId}/vc-coins`, roles: ['admin', 'subadmin'], icon: Timer, group: '評価鯖' },
      ],
    },
    {
      section: 'エンゲージメント',
      items: [
        { label: 'ショップ設定', path: `/dashboard/${guildId}/shop`, roles: ['admin', 'shop', 'subadmin'], icon: ShoppingBag, group: '評価鯖' },
        { label: 'チケット設定', path: `/dashboard/${guildId}/tickets`, roles: ['admin', 'subadmin'], icon: Ticket, group: '雑談鯖' },
        { label: 'ランク設定', path: `/dashboard/${guildId}/rank`, roles: ['admin', 'subadmin'], icon: Trophy, group: '評価鯖' },
        { label: '評価関連設定', path: `/dashboard/${guildId}/eval-sheet`, roles: ['admin', 'subadmin'], icon: ClipboardCheck, group: '評価鯖' },
        { label: '経済・レベリング設定', path: `/dashboard/${guildId}/economy`, roles: ['admin', 'subadmin'], icon: Coins, group: '評価鯖' },
        { label: 'ギャンブル設定', path: `/dashboard/${guildId}/gambling`, roles: ['admin', 'gambling', 'subadmin'], icon: Dices, group: '評価鯖' },
        { label: 'レベル到達報酬', path: `/dashboard/${guildId}/level-rewards`, roles: ['admin', 'subadmin'], icon: Gift, group: '評価鯖' },
        { label: '福引ガチャ設定', path: `/dashboard/${guildId}/gacha`, roles: ['admin', 'subadmin'], icon: Gift, group: '雑談鯖' },
      ],
    },
    {
      section: 'ゲーム',
      items: [
        { label: 'ゲーム設定', path: `/dashboard/${guildId}/games`, roles: ['admin', 'subadmin'], icon: Gamepad2, group: '雑談鯖' },
      ],
    },
    {
      section: '運用・モデレーション',
      items: [
        { label: 'コマンド設定', path: `/dashboard/${guildId}/commands`, roles: ['admin', 'subadmin'], icon: Terminal, group: 'その他' },
        { label: 'ログ出力設定', path: `/dashboard/${guildId}/logs`, roles: ['admin', 'subadmin'], icon: ScrollText, group: 'その他' },
        { label: '面接官設定', path: `/dashboard/${guildId}/interviewer`, roles: ['admin', 'subadmin'], icon: UserCheck, group: '評価鯖' },
        { label: '条件ロール付与設定', path: `/dashboard/${guildId}/self-intro-role`, roles: ['admin', 'subadmin'], icon: UserPlus, group: '雑談鯖' },
        { label: '荒らし対策設定', path: `/dashboard/${guildId}/antigrief`, roles: ['admin', 'subadmin'], icon: ShieldAlert, group: '雑談鯖' },
        { label: 'その他パネル設定', path: `/dashboard/${guildId}/other-panels`, roles: ['admin', 'subadmin'], icon: LayoutPanelTop, group: '雑談鯖' },
      ],
    },
    {
      section: 'システム',
      items: [
        { label: 'BOT機能接続状況', path: `/dashboard/${guildId}/bot-status`, roles: ['admin', 'subadmin'], icon: Activity, group: 'その他' },
        { label: 'データベース設定', path: `/dashboard/${guildId}/database`, roles: ['admin', 'subadmin'], icon: Database, group: 'その他' },
        { label: 'アカウント設定', path: `/dashboard/${guildId}/accounts`, roles: ['admin'], icon: Users, group: 'その他' },
      ],
    },
  ];

  const GROUP_ORDER: Array<'評価鯖' | '雑談鯖' | 'その他'> = ['評価鯖', '雑談鯖', 'その他'];
  const GROUP_LABELS: Record<string, string> = {
    '評価鯖': '評価鯖の設定',
    '雑談鯖': '雑談鯖用の設定',
    'その他': 'その他の設定',
  };

  // 各セクションを、既存のセクション名・項目名を一切変えずに
  // 上位グループ(評価鯖/雑談鯖/その他)ごとに分割する
  const groupedNavGroups = GROUP_ORDER.map(group => ({
    group,
    groupLabel: GROUP_LABELS[group],
    sections: navSections
      .map(section => ({
        ...section,
        items: section.items.filter(item => item.group === group),
      }))
      .filter(section => section.items.length > 0),
  })).filter(g => g.sections.length > 0);

  const filteredGroups = groupedNavGroups
    .map(g => ({
      ...g,
      sections: g.sections
        .map(section => ({
          ...section,
          items: userRole ? section.items.filter(item => item.roles.includes(userRole)) : section.items,
        }))
        .filter(section => section.items.length > 0),
    }))
    .filter(g => g.sections.length > 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white gap-3">
        <CircuitBoard className="w-5 h-5 text-red-500 animate-pulse" />
        <span className="text-zinc-400 text-sm tracking-wide">読み込み中...</span>
      </div>
    );
  }

  // 強制セットアップ画面
  if (status?.is_new_server && !status?.has_dedicated_db && !pathname.endsWith('/database')) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-white p-6 relative overflow-hidden mecha-grid-bg">
        <div className="absolute top-0 right-0 w-96 h-96 bg-red-600/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="max-w-xl w-full mecha-corners mecha-scan-wrap bg-neutral-900/90 border border-red-800/60 mecha-clip shadow-[0_0_50px_-10px_rgba(255,43,61,0.4)] relative z-10">
          <div className="mecha-hazard h-1.5 w-full opacity-80"></div>
          <div className="p-8 text-center">
            <div className="flex items-center justify-center gap-2 mb-4">
              <span className="mecha-led w-2 h-2 rounded-full bg-red-500 text-red-500"></span>
              <span className="font-tech text-[11px] tracking-[0.25em] text-red-500/80 uppercase">System Alert :: Setup Required</span>
            </div>
            <div className="w-16 h-16 mecha-clip-sm bg-red-500/15 border border-red-700/50 text-red-500 flex items-center justify-center mx-auto mb-6">
              <Database className="w-8 h-8" />
            </div>
            <h1 className="font-mecha text-2xl md:text-3xl font-black mb-4 text-white tracking-wide">初期設定が必要です</h1>
            <p className="font-tech text-sm text-zinc-400 mb-8 leading-relaxed">
              このサーバーで初めてBotを利用するためには、データを保存する<strong className="text-red-300">専用のSupabaseデータベース</strong>を設定する必要があります。<br />
              設定が完了するまで、他の機能は利用できません。
            </p>
            <Link
              href={`/dashboard/${guildId}/database`}
              className="mecha-btn-sheen mecha-clip-sm inline-flex items-center justify-center gap-2 bg-gradient-to-r from-red-700 via-red-600 to-red-800 hover:from-red-600 hover:via-red-500 hover:to-red-700 text-white font-mecha font-bold py-3 px-8 transition-all w-full border border-red-400/30 shadow-lg shadow-red-900/30"
            >
              <Database className="w-4 h-4" />
              データベース設定へ進む
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-screen min-h-screen bg-zinc-950 text-white overflow-hidden">
      {/* Mobile Header */}
      <header className={`md:hidden flex-none flex items-center justify-between bg-zinc-900/95 backdrop-blur border-b border-red-900/30 p-4 z-30 ${isActivity ? 'pt-16' : ''}`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 mecha-clip-sm bg-gradient-to-br from-red-600 to-red-900 flex items-center justify-center shadow shadow-red-900/40 flex-shrink-0 border border-red-500/30">
            <CircuitBoard className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="font-mecha font-bold text-white text-sm leading-tight tracking-wide">
              Many bot <span className="font-tech text-xs font-normal text-zinc-500 ml-1">{status?.guild_name || ''}</span>
            </h2>
            <p className="font-tech text-[10px] text-zinc-500">ID: {guildId}</p>
          </div>
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
        >
          <Menu size={24} />
        </button>
      </header>

      {/* Sidebar and Main Content Container */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile Sidebar Overlay */}
        {isMobileMenuOpen && (
          <div
            className="absolute inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside className={`
          absolute md:static inset-y-0 left-0 z-50
          w-72 bg-zinc-900/95 backdrop-blur border-r border-zinc-800/80 p-4 flex flex-col
          transform transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 h-full
        `}>
          <div className="mb-4 flex justify-between items-start flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 mecha-clip-sm bg-gradient-to-br from-red-600 to-red-900 flex items-center justify-center shadow-lg shadow-red-900/40 flex-shrink-0 border border-red-500/30">
                <CircuitBoard className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="font-mecha text-lg font-black text-white leading-tight truncate tracking-wide">Many bot</h2>
                <p className="font-tech text-[11px] text-zinc-500 truncate">{status?.guild_name || ''}</p>
              </div>
            </div>
            <button
              className="md:hidden p-2 -mr-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors flex-shrink-0"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <X size={20} />
            </button>
          </div>

          <div className="mb-4 flex-shrink-0 space-y-2">
            <p className="font-tech text-[10px] text-zinc-500 bg-black/40 border border-zinc-800 mecha-clip-sm px-2.5 py-1.5 tracking-wider">
              GUILD_ID :: {guildId}
            </p>
            {!status?.has_dedicated_db && (
              <div className="mecha-clip-sm bg-amber-950/40 border border-amber-900/60 text-amber-400 text-xs px-2.5 py-1.5 flex items-center gap-2">
                <span className="mecha-led w-1.5 h-1.5 rounded-full bg-amber-400 text-amber-400 flex-shrink-0"></span>
                <span className="font-tech leading-snug">DEFAULT CORE<br />専用DB未設定</span>
              </div>
            )}
          </div>

          <nav className="flex-1 min-h-0 space-y-6 overflow-y-auto pr-1 pb-4">
            {filteredGroups.map((groupEntry) => (
              <div key={groupEntry.group} className="space-y-5">
                <p className="px-3 font-mecha text-xs font-black tracking-wider text-red-400/90 border-b border-red-900/40 pb-1.5">
                  {groupEntry.groupLabel}
                </p>
                {groupEntry.sections.map((section) => (
                  <div key={`${groupEntry.group}-${section.section}`}>
                    <p className="px-3 mb-1.5 font-tech text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">
                      // {section.section}
                    </p>
                    <div className="space-y-1">
                      {section.items.map((item) => {
                        const isActive = pathname === item.path;
                        const Icon = item.icon;
                        return (
                          <Link
                            key={item.path}
                            href={item.path}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={`flex items-center gap-2.5 px-3 py-2.5 text-sm transition-all group relative overflow-hidden border-l-2 ${
                              isActive
                                ? 'mecha-clip-sm bg-gradient-to-r from-red-600/20 to-transparent text-white font-bold border-red-500'
                                : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-white border-transparent'
                            }`}
                          >
                            {isActive && <span className="mecha-led absolute right-2 w-1.5 h-1.5 rounded-full bg-red-500 text-red-500"></span>}
                            <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-red-400' : 'text-zinc-500 group-hover:text-zinc-300'}`} />
                            <span className="truncate font-tech tracking-wide">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </nav>

          <div className="pt-4 border-t border-zinc-800/80 mt-auto flex-shrink-0 space-y-2">
            {!isSubAccount && (
              <Link href="/" className="font-tech text-xs text-zinc-500 hover:text-cyan-400 flex items-center gap-2 transition-colors">
                <ChevronLeft className="w-4 h-4" />
                サーバー選択に戻る
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="font-tech text-xs text-zinc-500 hover:text-red-400 flex items-center gap-2 transition-colors w-full"
            >
              <LogOut size={14} />
              ログアウト
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-8 overflow-y-auto w-full h-full">
          {children}
        </main>
      </div>
    </div>
  );
}
