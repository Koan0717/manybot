'use client';

export default function ShopSettings({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-white">ショップ設定</h1>
      
      <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700 mb-8">
        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">ショップパネルの設置</h2>
        <p className="text-sm text-zinc-400 mb-4">
          メンバーがポイントを使ってアイテムやロールを購入できるパネルを設置します。
        </p>
        
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-zinc-400">設置するテキストチャンネル</label>
            <select className="bg-zinc-900 border border-zinc-700 rounded p-2 focus:border-red-500 outline-none text-white">
              <option># チャンネルを選択</option>
              <option># ショップ</option>
            </select>
          </div>
          
          <button className="mt-4 bg-red-600 hover:bg-red-700 text-white transition-colors px-6 py-2 rounded font-bold">
            パネルを設置する
          </button>
        </div>
      </div>
      
      <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700">
        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">販売アイテム管理</h2>
        <p className="text-sm text-zinc-400 mb-4">現在ショップで販売されているアイテムの一覧です。</p>

        <div className="bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden">
          <table className="w-full text-left text-sm text-zinc-300">
            <thead className="bg-zinc-800 text-xs uppercase text-zinc-400 border-b border-zinc-700">
              <tr>
                <th className="px-4 py-3">アイテム名</th>
                <th className="px-4 py-3">価格 (pt)</th>
                <th className="px-4 py-3">付与ロール</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {/* サンプルデータ */}
              <tr className="border-b border-zinc-800">
                <td className="px-4 py-3">VIPロール</td>
                <td className="px-4 py-3">1000</td>
                <td className="px-4 py-3">@VIP</td>
                <td className="px-4 py-3">
                  <button className="text-red-500 hover:text-red-400">削除</button>
                </td>
              </tr>
              <tr className="border-b border-zinc-800">
                <td className="px-4 py-3">カラー変更権</td>
                <td className="px-4 py-3">500</td>
                <td className="px-4 py-3">@色変更</td>
                <td className="px-4 py-3">
                  <button className="text-red-500 hover:text-red-400">削除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <button className="mt-4 border border-red-500 text-red-500 hover:bg-red-500 hover:text-white transition-colors px-4 py-2 rounded font-bold text-sm">
          + 新しいアイテムを追加
        </button>
      </div>
    </div>
  );
}