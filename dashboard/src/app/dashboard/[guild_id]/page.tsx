'use client';

export default function GeneralSettings({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">基本・評価設定</h1>
      
      <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700 mb-8">
        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2">ロール設定</h2>
        
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-zinc-400">準メンバー（任意）</label>
            <select className="bg-zinc-900 border border-zinc-700 rounded p-2 focus:border-red-500 outline-none">
              <option>未設定</option>
              {/* APIからロール一覧を取得してマッピングする予定 */}
            </select>
          </div>
          
          <div className="flex flex-col gap-2">
            <label className="text-sm text-zinc-400">仮メンバー</label>
            <select className="bg-zinc-900 border border-zinc-700 rounded p-2 focus:border-red-500 outline-none">
              <option>未設定</option>
            </select>
          </div>
          
          <button className="mt-4 bg-red-600 hover:bg-red-700 transition-colors px-6 py-2 rounded font-bold">
            保存する
          </button>
        </div>
      </div>
      
      <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700">
        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2">チャンネル設定</h2>
        <div className="text-zinc-400 text-sm">
          今後のアップデートでここに設定項目が追加されます...
        </div>
      </div>
    </div>
  );
}
