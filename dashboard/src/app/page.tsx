'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { CircuitBoard, ChevronRight, ServerCrash, Loader2 } from 'lucide-react';

const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || '1234567890';
let discordSdk: DiscordSDK | null = null;

export default function Home() {
  const router = useRouter();
  const [guilds, setGuilds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Check authentication status to handle sub-account redirection
    fetch('/api/auth/check')
      .then(res => res.json())
      .then(authData => {
        if (authData.authenticated && authData.user && authData.user.guild_id) {
          // It's a sub-account bound to a specific guild, redirect them immediately
          router.push(`/dashboard/${authData.user.guild_id}`);
          return;
        }

        // Otherwise, it's a super admin, fetch guilds list
        fetch('/api/guilds')
          .then(res => res.json())
          .then(data => {
            if (data.error) {
              setError(data.error);
            } else {
              setGuilds(data);
            }
          })
          .catch(err => {
            setError('サーバー一覧の取得に失敗しました。');
          })
          .finally(() => setLoading(false));
      })
      .catch(() => setLoading(false));
  }, [router]);

  const handleSelectGuild = (guildId: string) => {
    router.push(`/dashboard/${guildId}`);
  };

  return (
    <main className="min-h-screen flex flex-col items-center p-6 md:p-10 bg-zinc-950 text-white relative overflow-hidden mecha-grid-bg">
      {/* Background decoration */}
      <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] bg-red-600/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] bg-cyan-600/8 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-4xl w-full mx-auto relative z-10">
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-10 mt-6">
          <div className="inline-flex items-center justify-center w-16 h-16 mecha-clip bg-gradient-to-br from-red-600 to-red-900 shadow-lg shadow-red-900/40 mb-5 border border-red-500/30">
            <CircuitBoard className="w-8 h-8 text-white" />
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className="mecha-led w-2 h-2 rounded-full bg-red-500 text-red-500"></span>
            <span className="font-tech text-[11px] tracking-[0.25em] text-red-500/80 uppercase">System // Guild Select</span>
          </div>
          <h1 className="font-mecha text-3xl md:text-4xl font-black tracking-tight text-white">Many bot Dashboard</h1>
          <p className="font-tech text-zinc-500 mt-2 text-sm">管理するサーバーを選択してください</p>
        </div>

        <div className="mecha-corners mecha-scan-wrap mecha-grid-bg bg-neutral-900/80 border border-red-900/40 mecha-clip shadow-[0_0_35px_-10px_rgba(255,43,61,0.35)] p-6 md:p-8">
          <h2 className="font-mecha text-lg font-bold mb-6 pb-3 border-b border-red-900/30 flex items-center gap-2 text-zinc-200">
            <span className="mecha-led w-1.5 h-1.5 rounded-full bg-red-500 text-red-500" />
            サーバー一覧
          </h2>

          {error && (
            <div className="mecha-clip-sm bg-red-950/50 text-red-200 p-4 mb-4 border border-red-900/60 flex items-start gap-3">
              <ServerCrash className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" />
              <div className="font-tech text-sm">
                {error}
                <div className="mt-2 opacity-80">
                  Vercelの環境変数に「DISCORD_BOT_TOKEN」が正しく設定されているか確認してください。
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-14 text-zinc-500 flex flex-col items-center gap-3 font-tech text-sm">
              <Loader2 className="w-6 h-6 animate-spin text-red-500" />
              読み込み中...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {guilds.map((guild) => (
                <button
                  key={guild.id}
                  onClick={() => handleSelectGuild(guild.id)}
                  className="mecha-clip-sm group flex items-center gap-4 bg-black/40 hover:bg-red-950/20 transition-all p-4 border border-zinc-800 hover:border-red-800/60 text-left"
                >
                  {guild.icon ? (
                    <img
                      src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`}
                      alt={guild.name}
                      className="w-12 h-12 rounded-full ring-2 ring-zinc-800 group-hover:ring-red-900/60 transition-all flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center text-lg font-bold flex-shrink-0 ring-2 ring-zinc-800 group-hover:ring-red-900/60 transition-all">
                      {guild.name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-mecha font-bold text-base truncate group-hover:text-white transition-colors">{guild.name}</div>
                    <div className="font-tech text-xs text-zinc-500 truncate">ID: {guild.id}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-red-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                </button>
              ))}

              {guilds.length === 0 && !error && (
                <div className="col-span-full text-center py-14 text-zinc-500 font-tech text-sm">
                  参加しているサーバーが見つかりません。
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
