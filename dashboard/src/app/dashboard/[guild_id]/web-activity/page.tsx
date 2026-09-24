'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, MonitorSmartphone, Save } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';

// lib/casino/settings.ts の WEB_GAMES と同じ並び・同じキー
const GAMES = [
  { key: 'coinflip', label: '🪙 コイントス', desc: '表か裏かを当てる' },
  { key: 'slot', label: '🎰 スロット', desc: '絵柄をそろえる' },
  { key: 'roulette', label: '🎡 ルーレット', desc: '赤黒・偶奇・ダズン・数字に賭ける' },
  { key: 'blackjack', label: '🃏 ブラックジャック', desc: 'カードを引いてディーラーと勝負' },
  { key: 'chinchiro', label: '🎲 チンチロリン', desc: 'サイコロの役でBotと勝負' },
  { key: 'horse', label: '🏇 競馬', desc: '単勝・複勝で馬券を買う' },
] as const;
type GameKey = (typeof GAMES)[number]['key'];
type Enabled = Record<GameKey, boolean>;

const allOff = (): Enabled => Object.fromEntries(GAMES.map((g) => [g.key, false])) as Enabled;

export default function WebActivitySettingsPage() {
  const params = useParams();
  const guildId = params.guild_id as string;

  const [enabled, setEnabled] = useState<Enabled>(allOff);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/settings`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: any) => {
        const saved = data?.WEB_GAMES_ENABLED && typeof data.WEB_GAMES_ENABLED === 'object' ? data.WEB_GAMES_ENABLED : {};
        setEnabled(Object.fromEntries(GAMES.map((g) => [g.key, saved[g.key] === true])) as Enabled);
      })
      .catch(() => setError('設定の取得に失敗しました'))
      .finally(() => setLoading(false));
  }, [guildId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ WEB_GAMES_ENABLED: enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        const msg = data.error || '保存に失敗しました';
        setError(`設定の保存に失敗しました: ${msg}`);
        toast.error(`保存に失敗しました: ${msg}`);
        return;
      }
      toast.success('設定を保存しました！');
    } catch (err: any) {
      const msg = err?.message || String(err);
      setError(`設定の保存に失敗しました: ${msg}`);
      toast.error(`保存に失敗しました: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64 text-purple-400">Loading...</div>;
  }

  const onCount = GAMES.filter((g) => enabled[g.key]).length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-500 flex items-center gap-3">
            <MonitorSmartphone className="text-cyan-400" size={30} />
            Webアクティビティ設定
          </h1>
          <p className="text-gray-400 mt-2 text-sm">
            Discordアクティビティ・Webのメンバー画面で遊べるギャンブルを選びます。ONにしたものだけが「カジノ」タブに表示されます。
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center space-x-2 px-6 py-2 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-600 hover:to-indigo-700 text-white rounded-lg shadow-lg shadow-indigo-500/25 transition-all disabled:opacity-50 flex-shrink-0"
        >
          <Save size={20} />
          <span>{saving ? '保存中...' : '設定を保存'}</span>
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-lg flex items-center space-x-3">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gray-800/50 border border-cyan-500/20 p-6 rounded-xl space-y-2"
      >
        <div className="flex items-center justify-between border-b border-cyan-500/20 pb-4 mb-2">
          <h2 className="text-xl font-semibold text-cyan-300">遊べるギャンブル</h2>
          <span className="text-sm text-gray-400">{onCount} / {GAMES.length} 個がON</span>
        </div>

        {GAMES.map((g) => (
          <div key={g.key} className="flex items-center justify-between gap-4 py-3 border-b border-gray-700/60 last:border-0">
            <div>
              <div className="font-medium text-white">{g.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{g.desc}</div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={enabled[g.key]}
                onChange={(e) => setEnabled((prev) => ({ ...prev, [g.key]: e.target.checked }))}
              />
              <div className="w-14 h-7 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-cyan-600"></div>
            </label>
          </div>
        ))}
      </motion.div>

      <div className="text-sm text-gray-400 bg-gray-800/30 border border-gray-700/60 rounded-xl p-4 leading-relaxed">
        確率・配当倍率・賭け金の上限・1日のプレイ回数・手数料は、Discordのパネルと同じく
        <Link href={`/dashboard/${guildId}/gambling`} className="text-cyan-400 hover:underline mx-1">ギャンブル設定</Link>
        の値を使います。1日の回数と賭け金の上限は、パネルで遊んだ分と合算されます。
        結果は「ログ出力設定」の「賭博・カジノ機能の利用」のチャンネルに送られます。
      </div>
    </div>
  );
}
