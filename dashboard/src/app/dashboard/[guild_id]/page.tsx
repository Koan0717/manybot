'use client';

import { useState, useEffect } from 'react';

export default function GeneralSettings({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/roles`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) {
          // Filter out the @everyone role which has the same ID as the guild
          setRoles(data.filter((r: any) => r.id !== guildId));
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [guildId]);

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-white">基本・評価設定</h1>
      
      <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700 mb-8">
        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">ロール設定</h2>
        
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-zinc-400">準メンバー（任意）</label>
            <select className="bg-zinc-900 border border-zinc-700 rounded p-2 focus:border-red-500 outline-none text-white">
              <option value="">未設定</option>
              {loading ? (
                <option disabled>読み込み中...</option>
              ) : (
                roles.map(r => (
                  <option key={r.id} value={r.id}>@ {r.name}</option>
                ))
              )}
            </select>
          </div>
          
          <div className="flex flex-col gap-2">
            <label className="text-sm text-zinc-400">仮メンバー</label>
            <select className="bg-zinc-900 border border-zinc-700 rounded p-2 focus:border-red-500 outline-none text-white">
              <option value="">未設定</option>
              {loading ? (
                <option disabled>読み込み中...</option>
              ) : (
                roles.map(r => (
                  <option key={r.id} value={r.id}>@ {r.name}</option>
                ))
              )}
            </select>
          </div>
          
          <button className="mt-4 bg-red-600 hover:bg-red-700 text-white transition-colors px-6 py-2 rounded font-bold disabled:opacity-50" disabled={loading}>
            保存する
          </button>
        </div>
      </div>
      
      <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700">
        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">チャンネル設定</h2>
        <div className="text-zinc-400 text-sm">
          今後のアップデートでここに設定項目が追加されます...
        </div>
      </div>
    </div>
  );
}
