'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { ArrowLeft, FileText, GraduationCap, LayoutPanelTop, Users } from 'lucide-react';
import { getActivityContext } from '@/lib/memberClient';

/**
 * 大学サークル用ダッシュボード（第2のダッシュボード）。
 * 既存の /dashboard とは別のレイアウト・配色で、サークルの報告書づくりに必要な画面だけを置く。
 */
export default function CircleLayout({ children }: { children: React.ReactNode }) {
  const { guild_id: guildId } = useParams<{ guild_id: string }>();
  const pathname = usePathname();
  const [guild, setGuild] = useState<{ name: string; icon: string | null } | null>(null);
  const [circleName, setCircleName] = useState('');
  // Discord アクティビティから来たときは、サーバー選択ではなく「ダッシュボード設定 / サークル報告書」の画面へ戻る
  const [inActivity, setInActivity] = useState(false);

  useEffect(() => {
    setInActivity(!!getActivityContext());
  }, []);

  useEffect(() => {
    fetch('/api/guilds')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        const g = Array.isArray(list) ? list.find((x: any) => String(x.id) === guildId) : null;
        if (g) setGuild({ name: g.name, icon: g.icon });
      })
      .catch(() => {});
    fetch(`/api/guilds/${guildId}/circle/settings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setCircleName(s?.circle_name || ''))
      .catch(() => {});
  }, [guildId]);

  // 送信先設定でサークル名を変えたらヘッダーにも反映する
  useEffect(() => {
    const onChange = (e: Event) => setCircleName((e as CustomEvent<string>).detail || '');
    window.addEventListener('circle-name-changed', onChange);
    return () => window.removeEventListener('circle-name-changed', onChange);
  }, []);

  const nav = [
    { href: `/circle/${guildId}`, label: 'サークル進捗状況', icon: FileText },
    { href: `/circle/${guildId}/recipients`, label: '送信先設定', icon: Users },
    { href: `/circle/${guildId}/panel`, label: 'パネル設置', icon: LayoutPanelTop },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.10),transparent_60%)]" />

      <header className={`relative z-10 ${inActivity ? 'pt-12 md:pt-0' : ''} border-b border-slate-800/80 bg-slate-950/80 backdrop-blur`}>
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center gap-3">
          <Link
            href={inActivity ? '/member' : '/'}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white rounded-md px-2 py-1.5 hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">{inActivity ? 'メニュー' : 'サーバー選択'}</span>
          </Link>
          <div className="w-px h-6 bg-slate-800" />
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-900/40 flex-shrink-0">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] tracking-[0.2em] text-sky-400/80 uppercase">Circle Report</div>
            <div className="font-bold text-sm truncate">
              {circleName || 'サークル報告書ダッシュボード'}
            </div>
          </div>
          {guild && (
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 min-w-0">
              {guild.icon ? (
                <img src={`https://cdn.discordapp.com/icons/${guildId}/${guild.icon}.png`} alt="" className="w-6 h-6 rounded-full" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold">{guild.name.charAt(0)}</div>
              )}
              <span className="truncate max-w-[200px]">{guild.name}</span>
            </div>
          )}
        </div>
      </header>

      <div className="relative z-10 max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8 flex flex-col md:flex-row gap-6">
        <nav className="md:w-56 flex-shrink-0">
          <div className="flex md:flex-col gap-1.5 overflow-x-auto md:sticky md:top-6">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/40'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
