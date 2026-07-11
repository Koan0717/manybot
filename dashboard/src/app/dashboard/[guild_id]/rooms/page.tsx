'use client';

export default function RoomsSettings({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;

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
              <option># 部屋作成チャンネルを選択</option>
              <option># vc作成</option>
              <option># create-room</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm text-zinc-400">作成されるVCの親カテゴリ</label>
            <select className="bg-zinc-900 border border-zinc-700 rounded p-2 focus:border-red-500 outline-none text-white">
              <option>カテゴリを選択</option>
              <option>ボイスチャンネル</option>
              <option>プライベート部屋</option>
            </select>
          </div>
          
          <button className="mt-4 bg-red-600 hover:bg-red-700 text-white transition-colors px-6 py-2 rounded font-bold">
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
          
          <button className="mt-4 bg-red-600 hover:bg-red-700 text-white transition-colors px-6 py-2 rounded font-bold">
            料金を保存する
          </button>
        </div>
      </div>
    </div>
  );
}