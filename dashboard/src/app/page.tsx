'use client';

import { useEffect, useState } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';

// Client ID for Discord Activity (To be set)
const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || '1234567890';
let discordSdk: DiscordSDK | null = null;

export default function Home() {
  const [auth, setAuth] = useState<any>(null);

  useEffect(() => {
    // Only init inside discord iframe
    if (typeof window !== 'undefined' && window.parent !== window) {
      discordSdk = new DiscordSDK(clientId);
      discordSdk.ready().then(() => {
        setAuth({ status: 'Ready to Auth' });
      });
    }
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center p-8 bg-zinc-900 text-white">
      <div className="z-10 w-full max-w-5xl items-center justify-between font-mono text-sm">
        <h1 className="text-4xl font-bold mb-8 text-center text-red-500">Evalia BOT Dashboard</h1>
        
        <div className="bg-zinc-800 p-6 rounded-xl shadow-lg border border-zinc-700">
          <h2 className="text-2xl mb-4 border-b border-zinc-600 pb-2">サーバー設定</h2>
          
          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm text-zinc-400">準メンバー（任意）</label>
              <select className="bg-zinc-900 border border-zinc-700 rounded p-2 focus:border-red-500 outline-none">
                <option>未設定</option>
              </select>
            </div>
            
            <div className="flex flex-col gap-2">
              <label className="text-sm text-zinc-400">仮メンバー</label>
              <select className="bg-zinc-900 border border-zinc-700 rounded p-2 focus:border-red-500 outline-none">
                <option>未設定</option>
              </select>
            </div>
            
            <button className="mt-4 w-full bg-red-600 hover:bg-red-700 transition-colors py-2 rounded-lg font-bold">
              保存
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
