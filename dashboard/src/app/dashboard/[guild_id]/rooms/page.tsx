'use client';

import { useState, useEffect } from 'react';

export default function RoomsSettings({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/channels`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) {
          setChannels(data);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [guildId]);

  // Discord Channel Types: 0 = GUILD_TEXT, 4 = GUILD_CATEGORY
  const textChannels = channels.filter(c => c.type === 0);
  const categories = channels.filter(c => c.type === 4);

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-white">VCルーム設定</h1>
      
      <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700 mb-8">
        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">VC作成パネルの設置</h2>
        <p className="text-sm text-zinc-400 mb-4">
          メンバーが個別の通話部屋（VC）を作成できるパネルを指定のチャンネルに設置します。
        </p>
        
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-zinc-400">設置するテキストチャンネル</label>
            <select className="bg-zinc-900 border border-zinc-700 rounded p-2 focus:border-red-500 outline-none text-white">
              <option value="">チャンネルを選択してください</option>
              {loading ? (
                <option disabled>読み込み中...</option>
              ) : (
                textChannels.map(c => (
                  <option key={c.id} value={c.id}># {c.name}</option>
                ))
              )}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm text-zinc-400">作成されるVCの親カテゴリ</label>
            <select className="bg-zinc-900 border border-zinc-700 rounded p-2 focus:border-red-500 outline-none text-white">
              <option value="">カテゴリを選択してください</option>
              {loading ? (
                <option disabled>読み込み中...</option>
              ) : (
                categories.map(c => (
                  <option key={c.id} value={c.id}>📁 {c.name}</option>
                ))
              )}
            </select>
          </div>
          
          <button className="mt-4 bg-red-600 hover:bg-red-700 text-white transition-colors px-6 py-2 rounded font-bold disabled:opacity-50" disabled={loading}>
            パネルを設置する
          </button>
        </div>
      </div>
      
      <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700">
        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">料金設定 (ポイント)</h2>
        <p className="text-sm text-zinc-400 mb-4">
          VC作成時や延長時に消費されるポイントを設定できます。
        </p>

        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-zinc-400">VC作成時の基本料金</label>
            <input type="number" defaultValue={10} className="bg-zinc-900 border border-zinc-700 rounded p-2 focus:border-red-500 outline-none text-white" />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm text-zinc-400">延長料金（10分ごと）</label>
            <input type="number" defaultValue={5} className="bg-zinc-900 border border-zinc-700 rounded p-2 focus:border-red-500 outline-none text-white" />
          </div>
          
          <button className="mt-4 bg-red-600 hover:bg-red-700 text-white transition-colors px-6 py-2 rounded font-bold disabled:opacity-50" disabled={loading}>
            料金を保存する
          </button>
        </div>
      </div>
    </div>
  );
}