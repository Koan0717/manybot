'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, LogOut, Server } from 'lucide-react';
import { MemberState, clearMemberState, guildIconUrl, loadMemberState, markLoggedOut } from '@/lib/memberClient';

export default function MemberHome() {
  const router = useRouter();
  const [state, setState] = useState<MemberState | null>(null);

  useEffect(() => {
    const s = loadMemberState();
    if (!s) {
      router.replace(`/login${window.location.search}`);
      return;
    }
    setState(s);
  }, [router]);

  const logout = () => {
    clearMemberState();
    markLoggedOut();
    router.replace(`/login${window.location.search}`);
  };

  if (!state) {
    return <main className="min-h-screen bg-zinc-950" />;
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <header className="flex items-center gap-3 mb-8">
          <img src={state.user.avatar_url} alt="" className="w-11 h-11 rounded-full ring-2 ring-zinc-800" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-zinc-500">Discordでログイン中</div>
            <div className="font-bold truncate">{state.user.name}</div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg px-3 py-2 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> ログアウト
          </button>
        </header>

        <h1 className="text-xl font-bold mb-1">サーバーを選択</h1>
        <p className="text-sm text-zinc-500 mb-5">
          選んだサーバーでのプロフィール・送金・役職を表示します。
        </p>

        {state.guilds.length === 0 ? (
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-8 text-center text-zinc-500 text-sm">
            <Server className="w-8 h-8 mx-auto mb-3 text-zinc-600" />
            Manybotが参加していて、あなたも参加しているサーバーが見つかりませんでした。
          </div>
        ) : (
          <div className="grid gap-3">
            {state.guilds.map((guild) => {
              const icon = guildIconUrl(guild);
              return (
                <button
                  key={guild.id}
                  onClick={() => router.push(`/member/${guild.id}`)}
                  className="group flex items-center gap-4 bg-zinc-900/80 hover:bg-zinc-900 border border-zinc-800 hover:border-red-800/60 rounded-2xl p-4 text-left transition-all"
                >
                  {icon ? (
                    <img src={icon} alt="" className="w-12 h-12 rounded-full ring-2 ring-zinc-800 flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center text-lg font-bold flex-shrink-0">
                      {guild.name.charAt(0)}
                    </div>
                  )}
                  <span className="flex-1 min-w-0 font-semibold truncate">{guild.name}</span>
                  <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-red-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
