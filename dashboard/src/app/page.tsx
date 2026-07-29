'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DiscordSDK } from '@discord/embedded-app-sdk';

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
    <main className="flex min-h-screen flex-col items-center p-8 bg-zinc-900 text-white">
      <div className="max-w-4xl w-full mx-auto">
        <h1 className="text-4xl font-bold mb-8 text-center text-red-500">Many bot Dashboard</h1>
        
        <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700">
          <h2 className="text-2xl mb-4 border-b border-zinc-600 pb-2">サーバーを選択してください</h2>
          
          {error && (
            <div className="bg-red-900/50 text-red-200 p-4 rounded mb-4 border border-red-700">
              {error}
              <div className="text-sm mt-2 opacity-80">
                Vercelの環境変数に「DISCORD_BOT_TOKEN」が正しく設定されているか確認してください。
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-zinc-400">読み込み中...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
              {guilds.map((guild) => (
                <button
                  key={guild.id}
                  onClick={() => handleSelectGuild(guild.id)}
                  className="flex items-center gap-4 bg-zinc-900 hover:bg-zinc-700 transition-colors p-4 rounded-lg border border-zinc-700 text-left"
                >
                  {guild.icon ? (
                    <img
                      src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`}
                      alt={guild.name}
                      className="w-12 h-12 rounded-full"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-zinc-700 flex items-center justify-center text-lg font-bold">
                      {guild.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <div className="font-bold text-lg">{guild.name}</div>
                    <div className="text-xs text-zinc-400">ID: {guild.id}</div>
                  </div>
                </button>
              ))}
              
              {guilds.length === 0 && !error && (
                <div className="col-span-full text-center py-8 text-zinc-400">
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
