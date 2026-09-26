'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Save, AlertCircle, Send, type LucideIcon } from 'lucide-react';
import ChannelSelect from '@/components/ChannelSelect';
import PageHeader from '@/components/PageHeader';
import { toast } from 'react-hot-toast';

const AI_MULT_DEFAULT = { 4: 2, 5: 3 } as const;

/** 倍率の入力を保存用の数値にする（1〜100、小数第2位まで。空欄や不正な値は既定値） */
function toMult(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (raw === '' || !Number.isFinite(n)) return fallback;
  return Math.round(Math.min(100, Math.max(1, n)) * 100) / 100;
}

/**
 * オセロ・チェス・将棋の設定画面（中身は同じで、設定キーの頭 (OTHELLO / CHESS / SHOGI) だけが違う）
 */
export default function BoardGameSettings({ game, name, icon: Icon }: { game: 'othello' | 'chess' | 'shogi'; name: string; icon: LucideIcon }) {
  const params = useParams();
  const guildId = params.guild_id as string;
  const P = game.toUpperCase();

  const defaults = (data: any = {}) => ({
    [`${P}_BET_ENABLED`]: data[`${P}_BET_ENABLED`] ?? false,
    [`${P}_SHOW_STATS`]: data[`${P}_SHOW_STATS`] ?? true,
    [`${P}_PANEL_CHANNEL`]: data[`${P}_PANEL_CHANNEL`] ?? '',
    [`${P}_AUTO_VC_ENABLED`]: data[`${P}_AUTO_VC_ENABLED`] ?? false,
    [`${P}_VC_CATEGORY_ID`]: data[`${P}_VC_CATEGORY_ID`] ?? '',
    [`${P}_VC_NAME`]: data[`${P}_VC_NAME`] ?? `${name}対戦`,
    [`${P}_GAME_CHANNEL`]: data[`${P}_GAME_CHANNEL`] ?? '',
    // AI に勝ったときの倍率（賭けられるのはレベル4・5だけ）。入力中は文字列のまま持ち、保存時に数値へ直す
    [`${P}_AI_MULT_4`]: String(data[`${P}_AI_MULT_4`] ?? AI_MULT_DEFAULT[4]),
    [`${P}_AI_MULT_5`]: String(data[`${P}_AI_MULT_5`] ?? AI_MULT_DEFAULT[5]),
  });
  const [settings, setSettings] = useState<Record<string, any>>(defaults());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingPanel, setSendingPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/games/${game}`).then(res => res.ok ? res.json() : {}),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : []),
    ]).then(([data, channelsData]: [any, any]) => {
      setSettings(defaults(data));
      if (Array.isArray(channelsData)) {
        setChannels(channelsData);
      }
    }).catch(err => {
      console.error(err);
      setError('データの取得に失敗しました');
    }).finally(() => setLoading(false));
  }, [guildId]);

  const updateSetting = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/games/${game}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings,
          [`${P}_AI_MULT_4`]: toMult(settings[`${P}_AI_MULT_4`], AI_MULT_DEFAULT[4]),
          [`${P}_AI_MULT_5`]: toMult(settings[`${P}_AI_MULT_5`], AI_MULT_DEFAULT[5]),
        }),
      });
      const data = await res.json();
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

  const handleSendPanel = async () => {
    if (!settings[`${P}_PANEL_CHANNEL`]) {
      toast.error('パネル設置チャンネルを設定してください');
      return;
    }
    setSendingPanel(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/games/${game}/panel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        toast.success(`${name}パネルを送信しました！`);
      } else {
        const data = await res.json();
        toast.error(`送信に失敗しました: ${data.error || '不明なエラー'}`);
      }
    } catch (e) {
      toast.error('エラーが発生しました');
    } finally {
      setSendingPanel(false);
    }
  };

  const textChannels = channels.filter((c: any) => c.type === 0);
  const categoryChannels = channels.filter((c: any) => c.type === 4);

  if (loading) {
    return <div className="flex justify-center items-center h-64 text-cyan-400 font-tech">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto pb-12">
      <PageHeader
        icon={Icon}
        title={`${name}設定`}
        subtitle={`${name}の動作・チャンネル・VC設定を管理します`}
        eyebrow={`System // ${game[0].toUpperCase()}${game.slice(1)} Module`}
        tone="cyan"
      />

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl flex items-center space-x-3">
          <AlertCircle size={20} />
          <span className="font-tech text-sm">{error}</span>
        </div>
      )}

      {/* 賭け設定 */}
      <section className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl space-y-4">
        <h2 className="font-mecha text-base font-bold text-white border-b border-zinc-800 pb-2">賭け設定</h2>

        <div className="flex items-center justify-between bg-zinc-800/40 p-4 rounded-lg border border-zinc-700/50">
          <div>
            <p className="text-sm font-tech text-zinc-300 font-medium">賭け ON/OFF</p>
            <p className="text-xs font-tech text-zinc-500 mt-0.5">{name}での賭けを有効にします（金額は対局を申し込む人が毎回決めます）</p>
          </div>
          <button
            onClick={() => updateSetting(`${P}_BET_ENABLED`, !settings[`${P}_BET_ENABLED`])}
            className={`px-5 py-2 rounded-lg font-bold font-mecha text-sm transition-colors ${
              settings[`${P}_BET_ENABLED`]
                ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                : 'bg-zinc-700 text-zinc-400'
            }`}
          >
            {settings[`${P}_BET_ENABLED`] ? '有効 (ON)' : '無効 (OFF)'}
          </button>
        </div>

        <div className="bg-zinc-800/40 p-4 rounded-lg border border-zinc-700/50 space-y-3">
          <div>
            <p className="text-sm font-tech text-zinc-300 font-medium">AI対戦の倍率</p>
            <p className="text-xs font-tech text-zinc-500 mt-0.5">
              AI対戦で賭けられるのはレベル4・5だけです。AIに勝つと「賭け金 × 倍率」が戻ります（引き分けは返金、負けは没収）
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([4, 5] as const).map((lv) => (
              <label key={lv} className="flex items-center gap-2">
                <span className="text-sm font-tech text-zinc-300 whitespace-nowrap">レベル{lv}（{lv === 4 ? '難しい' : '最難関'}）</span>
                <span className="text-zinc-500">×</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="1"
                  max="100"
                  value={settings[`${P}_AI_MULT_${lv}`]}
                  onChange={(e) => updateSetting(`${P}_AI_MULT_${lv}`, e.target.value)}
                  onBlur={() => updateSetting(`${P}_AI_MULT_${lv}`, String(toMult(settings[`${P}_AI_MULT_${lv}`], AI_MULT_DEFAULT[lv])))}
                  className="w-24 bg-zinc-900 border border-zinc-600 rounded px-3 py-1.5 text-white font-tech focus:outline-none focus:border-cyan-500"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between bg-zinc-800/40 p-4 rounded-lg border border-zinc-700/50">
          <div>
            <p className="text-sm font-tech text-zinc-300 font-medium">戦績ボタン表示 ON/OFF</p>
            <p className="text-xs font-tech text-zinc-500 mt-0.5">{name}パネルに「自分の戦績」ボタンを表示します</p>
          </div>
          <button
            onClick={() => updateSetting(`${P}_SHOW_STATS`, !settings[`${P}_SHOW_STATS`])}
            className={`px-5 py-2 rounded-lg font-bold font-mecha text-sm transition-colors ${
              settings[`${P}_SHOW_STATS`]
                ? 'bg-green-600 text-white shadow-[0_0_10px_rgba(34,197,94,0.4)]'
                : 'bg-zinc-700 text-zinc-400'
            }`}
          >
            {settings[`${P}_SHOW_STATS`] ? '表示 (ON)' : '非表示 (OFF)'}
          </button>
        </div>
      </section>

      {/* チャンネル設定 */}
      <section className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl space-y-4">
        <h2 className="font-mecha text-base font-bold text-white border-b border-zinc-800 pb-2">チャンネル設定</h2>

        <div className="space-y-2">
          <label className="text-sm font-tech text-zinc-300 font-medium">パネル設置チャンネル</label>
          <ChannelSelect
            label="パネル設置チャンネル"
            placeholder="テキストチャンネルを選択..."
            value={settings[`${P}_PANEL_CHANNEL`]}
            onChange={(id) => updateSetting(`${P}_PANEL_CHANNEL`, id || '')}
            channels={textChannels}
            multiple={false}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-tech text-zinc-300 font-medium">プレイ進行チャンネル</label>
          <p className="text-xs font-tech text-zinc-500">
            専用VC自動作成がOFFで、かつVCに入っていない場合にゲームを行うチャンネル（未設定の場合はパネルが設置されているチャンネルを使用）
          </p>
          <ChannelSelect
            label="プレイ進行チャンネル"
            placeholder="テキストチャンネルを選択..."
            value={settings[`${P}_GAME_CHANNEL`]}
            onChange={(id) => updateSetting(`${P}_GAME_CHANNEL`, id || '')}
            channels={textChannels}
            multiple={false}
          />
        </div>
      </section>

      {/* VC設定 */}
      <section className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl space-y-4">
        <h2 className="font-mecha text-base font-bold text-white border-b border-zinc-800 pb-2">専用VC設定</h2>

        <div className="flex items-center justify-between bg-zinc-800/40 p-4 rounded-lg border border-zinc-700/50">
          <div>
            <p className="text-sm font-tech text-zinc-300 font-medium">専用VC自動作成</p>
            <p className="text-xs font-tech text-zinc-500 mt-0.5">ゲーム開始時に専用VCを自動で作成します</p>
          </div>
          <button
            onClick={() => updateSetting(`${P}_AUTO_VC_ENABLED`, !settings[`${P}_AUTO_VC_ENABLED`])}
            className={`px-5 py-2 rounded-lg font-bold font-mecha text-sm transition-colors ${
              settings[`${P}_AUTO_VC_ENABLED`]
                ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                : 'bg-zinc-700 text-zinc-400'
            }`}
          >
            {settings[`${P}_AUTO_VC_ENABLED`] ? '有効 (ON)' : '無効 (OFF)'}
          </button>
        </div>

        {settings[`${P}_AUTO_VC_ENABLED`] && (
          <>
            <div className="space-y-2">
              <label className="text-sm font-tech text-zinc-300 font-medium">VC作成先カテゴリ</label>
              <ChannelSelect
                label="VC作成先カテゴリ"
                placeholder="カテゴリを選択..."
                value={settings[`${P}_VC_CATEGORY_ID`]}
                onChange={(id) => updateSetting(`${P}_VC_CATEGORY_ID`, id || '')}
                channels={categoryChannels}
                multiple={false}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-tech text-zinc-300 font-medium">作成するVC名</label>
              <input
                type="text"
                value={settings[`${P}_VC_NAME`]}
                onChange={(e) => updateSetting(`${P}_VC_NAME`, e.target.value)}
                placeholder={`${name}対戦`}
                className="w-full bg-zinc-900 border border-zinc-600 rounded px-3 py-2 text-white font-tech focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>
          </>
        )}
      </section>

      {/* ボタン */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center justify-center gap-2 px-8 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl shadow-[0_0_15px_rgba(6,182,212,0.4)] transition-all disabled:opacity-50 font-bold font-mecha"
        >
          <Save size={18} />
          <span>{saving ? '保存中...' : '設定を保存'}</span>
        </button>

        <button
          onClick={handleSendPanel}
          disabled={sendingPanel}
          className="flex items-center justify-center gap-2 px-8 py-3 bg-gradient-to-r from-zinc-700 to-zinc-600 hover:from-zinc-600 hover:to-zinc-500 text-white rounded-xl transition-all disabled:opacity-50 font-bold font-mecha border border-zinc-600"
        >
          <Send size={18} />
          <span>{sendingPanel ? '送信中...' : 'パネルを送信'}</span>
        </button>
      </div>
    </div>
  );
}
