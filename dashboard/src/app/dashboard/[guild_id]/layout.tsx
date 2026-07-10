'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function DashboardLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { guild_id: string };
}) {
  const pathname = usePathname();
  const guildId = params.guild_id;

  const navItems = [
    { label: '基本・評価設定', path: `/dashboard/${guildId}` },
    { label: 'VCルーム設定', path: `/dashboard/${guildId}/rooms` },
    { label: 'ショップ設定', path: `/dashboard/${guildId}/shop` },
    { label: 'チケット設定', path: `/dashboard/${guildId}/tickets` },
    { label: 'ランク設定', path: `/dashboard/${guildId}/rank` },
  ];

  return (
    <div className="flex min-h-screen bg-zinc-950 text-white">
      {/* Sidebar */}
      <aside className="w-64 bg-zinc-900 border-r border-zinc-800 p-4 hidden md:flex md:flex-col">
        <div className="mb-8">
          <h2 className="text-xl font-bold text-red-500">Many bot</h2>
          <p className="text-xs text-zinc-400 mt-1">サーバーID: {guildId}</p>
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
