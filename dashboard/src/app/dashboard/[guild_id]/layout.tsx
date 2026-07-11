'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function DashboardLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { guild_id: string };
}) {
  const pathname = usePathname();
  const guildId = params.guild_id;

  const [status, setStatus] = useState<{ is_new_server: boolean, has_dedicated_db: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/status`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) setStatus(data);
      })
      .finally(() => setLoading(false));
  }, [guildId]);

  const navItems = [
    { label: '基本・評価設定', path: `/dashboard/${guildId}` },
    { label: 'VCルーム設定', path: `/dashboard/${guildId}/rooms` },
    { label: 'ショップ設定', path: `/dashboard/${guildId}/shop` },
    { label: 'チケット設定', path: `/dashboard/${guildId}/tickets` },
    { label: 'ランク設定', path: `/dashboard/${guildId}/rank` },
    { label: '評価シート自動生成', path: `/dashboard/${guildId}/eval-sheet` },
    { label: '経済・レベリング設定', path: `/dashboard/${guildId}/economy` },
    { label: 'ギャンブル設定', path: `/dashboard/${guildId}/gambling` },
    { label: 'レベル到達報酬', path: `/dashboard/${guildId}/level-rewards` },
    { label: 'VCコイン獲得制限', path: `/dashboard/${guildId}/vc-coins` },
    { label: 'ログ出力設定', path: `/dashboard/${guildId}/logs` },
    { label: 'データベース設定', path: `/dashboard/${guildId}/database` },
  ];

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white">読み込み中...</div>;
  }

  // 強制セットアップ画面
  if (status?.is_new_server && !status?.has_dedicated_db && !pathname.endsWith('/database')) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-white p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-red-600/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>
        
        <div className="max-w-xl w-full bg-neutral-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl relative z-10 text-center">
          <div className="w-16 h-16 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold mb-4 text-white">初期設定が必要です</h1>
          <p className="text-zinc-400 mb-8 leading-relaxed">
            このサーバーで初めてBotを利用するためには、データを保存する<strong>専用のSupabaseデータベース</strong>を設定する必要があります。<br/>
            設定が完了するまで、他の機能は利用できません。
          </p>
          <Link 
            href={`/dashboard/${guildId}/database`}
            className="inline-block bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-lg transition-colors w-full"
          >
            データベース設定へ進む
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-zinc-950 text-white">
      {/* Sidebar */}
      <aside className="w-64 bg-zinc-900 border-r border-zinc-800 p-4 hidden md:flex md:flex-col">
        <div className="mb-8">
          <h2 className="text-xl font-bold text-red-500">Many bot</h2>
          <p className="text-xs text-zinc-400 mt-1">サーバーID: {guildId}</p>
          {!status?.has_dedicated_db && (
            <div className="mt-3 bg-red-950/50 border border-red-900 text-red-400 text-xs px-2 py-1.5 rounded flex items-center gap-1.5">
              <span>⚠️</span>
              <span>専用DB未設定<br/>(メインDB使用中)</span>
            </div>
          )}
        </div>
        
        <nav className="flex-1 space-y-2">
          {navItems.map((item) => {
            const isActive = pathname === item.path;
            return (
              <Link 
                key={item.path} 
                href={item.path}
                className={`block px-4 py-3 rounded-lg transition-colors ${isActive ? 'bg-red-600/10 text-red-500 font-bold border-l-4 border-red-500' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        
        <div className="pt-4 border-t border-zinc-800">
          <Link href="/" className="text-sm text-zinc-500 hover:text-white flex items-center gap-2">
            ← サーバー選択に戻る
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto h-screen">
        {children}
      </main>
    </div>
  );
}
