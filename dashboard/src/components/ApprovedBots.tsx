'use client';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';

interface ApprovedBot {
  bot_id: string;
  bot_name: string;
  source: string;
}

const SOURCE_LABELS: Record<string, string> = {
  existing: 'ON前から導入済み',
  inviter: '許可された人が追加',
  manual: '手動で承認',
};

/** 承認済みBOTの一覧。Botも自動で追加するので、設定の保存とは別に個別で保存する */
export default function ApprovedBots({ guildId, refreshKey }: { guildId: string; refreshKey: number }) {
  const [bots, setBots] = useState<ApprovedBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [botId, setBotId] = useState('');
  const [adding, setAdding] = useState(false);

  const load = () =>
    fetch(`/api/guilds/${guildId}/antigrief/approved-bots`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setBots(data);
          setError(null);
        } else {
          setError(data?.error || '承認済みBOTの取得に失敗しました');
        }
      })
      .catch(() => setError('承認済みBOTの取得に失敗しました'))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId, refreshKey]);

  const post = async (body: any) => {
    const res = await fetch(`/api/guilds/${guildId}/antigrief/approved-bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || '不明なエラー');
  };

  const handleAdd = async () => {
    setAdding(true);
    try {
      await post({ action: 'add', bot_id: botId.trim() });
      setBotId('');
      toast.success('承認しました');
      await load();
    } catch (err: any) {
      toast.error(`承認に失敗しました: ${err.message}`);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (bot: ApprovedBot) => {
    if (!confirm(`「${bot.bot_name || bot.bot_id}」の承認を外しますか？\nサーバーにいる場合、次に発言したときにキック/BANの対象になります。`)) return;
    try {
      await post({ action: 'delete', bot_id: bot.bot_id });
      setBots(prev => prev.filter(b => b.bot_id !== bot.bot_id));
      toast.success('承認を外しました');
    } catch (err: any) {
      toast.error(`承認の解除に失敗しました: ${err.message}`);
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-zinc-300 mb-2">承認済みBOT</label>
      <p className="text-xs text-zinc-500 mb-2">
        ここにあるBOTはそのまま動けます。BANされたBOTを承認するときは、Discord側でBANも解除してください。BOTがサーバーから抜けると承認は外れます。
      </p>

      {error && <p className="text-sm text-red-400 mb-2">{error}</p>}

      <div className="bg-zinc-900 border border-zinc-700 rounded-lg divide-y divide-zinc-800 mb-3">
        {loading ? (
          <p className="px-3 py-3 text-sm text-zinc-500">読み込み中...</p>
        ) : bots.length === 0 ? (
          <p className="px-3 py-3 text-sm text-zinc-500">まだありません。BOT導入制限をONにして保存すると、サーバーにいるBOTが登録されます。</p>
        ) : (
          bots.map(bot => (
            <div key={bot.bot_id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{bot.bot_name || '名前不明'}</p>
                <p className="text-xs text-zinc-500 truncate">ID: {bot.bot_id} ・ {SOURCE_LABELS[bot.source] || bot.source}</p>
              </div>
              <button type="button" onClick={() => handleRemove(bot)} className="text-red-500 hover:text-red-400 text-sm flex-shrink-0">
                解除
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={botId}
          onChange={e => setBotId(e.target.value)}
          placeholder="BOTのIDを入力して承認"
          className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-[16px] text-white focus:outline-none focus:border-red-500 transition-colors placeholder:text-zinc-500"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || !botId.trim()}
          className="px-4 py-2.5 rounded-lg text-sm font-bold text-white bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        >
          {adding ? '確認中...' : '承認'}
        </button>
      </div>
    </div>
  );
}
