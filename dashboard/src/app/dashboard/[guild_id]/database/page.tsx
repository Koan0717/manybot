'use client';

import { useState, useEffect } from 'react';

export default function DatabaseSettings({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/database`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) {
          setDatabaseUrl(data.database_url || '');
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [guildId]);

  const handleSave = async () => {
    setSaving(true);
    
    try {
      const res = await fetch(`/api/guilds/${guildId}/database`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database_url: databaseUrl.trim() })
      });
      const data = await res.json();
      if (data.success) {
        alert('データベース設定を保存しました！新しいデータベースを使用するため、次回のBot操作時から適用されます。');
      } else {
        alert('エラーが発生しました: ' + data.error);
      }
    } catch (e) {
      alert('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <h1 className="text-3xl font-bold mb-8 text-white">データベース設定</h1>
      
      <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-red-900/30 mb-8 relative overflow-hidden">
        {/* Decorative background element */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-red-600/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>

        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-red-400">専用データベース（Supabase）の設定</h2>
        <div className="text-sm text-zinc-300 mb-6 space-y-2">
          <p>
            このサーバーのデータを完全に分離し、専用のデータベース（Supabase）に保存することができます。<br/>
            容量制限を回避したい場合や、大規模なサーバーを運営する場合に設定してください。
          </p>
          <div className="bg-red-950/40 border border-red-900/50 p-4 rounded-lg mt-4">
            <h3 className="font-bold text-red-400 mb-2 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              注意事項
            </h3>
            <ul className="list-disc pl-5 space-y-1 text-red-200/80">
              <li>未設定（空欄）の場合は、Botのデフォルトのデータベースが使用されます。</li>
              <li>設定を変更すると、新しいデータベースを参照するため、<strong>これまでの設定やVCルームのデータはリセット</strong>された状態からのスタートになります。</li>
              <li>入力するURLは <code className="bg-red-950 px-1 py-0.5 rounded text-red-300">postgresql://...</code> で始まるSupabaseの接続URL（Transaction pooler等）を指定してください。</li>
            </ul>
          </div>
        </div>
        
        <div className="flex flex-col gap-2 mt-6 relative z-10">
          <label className="text-sm text-zinc-300 font-bold">DATABASE URL</label>
          <input 
            type="text"
            className="bg-zinc-900 border border-zinc-700 rounded p-3 focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none text-white w-full transition-all"
            value={databaseUrl}
            onChange={(e) => setDatabaseUrl(e.target.value)}
            placeholder="postgresql://postgres.[project-ref]:[password]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres"
          />
        </div>
        
        <div className="mt-8 border-t border-zinc-700 pt-6 relative z-10">
          <button 
            onClick={handleSave}
            className="bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white transition-all shadow-lg shadow-red-900/20 px-8 py-3 rounded-lg font-bold disabled:opacity-50 w-full md:w-auto flex items-center justify-center gap-2" 
            disabled={loading || saving}
          >
            {saving ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                保存中...
              </>
            ) : '設定を保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
