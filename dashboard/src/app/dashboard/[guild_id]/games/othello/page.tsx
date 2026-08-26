'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Save, AlertCircle, Disc3, Send } from 'lucide-react';
import ChannelSelect from '@/components/ChannelSelect';
import PageHeader from '@/components/PageHeader';
import { toast } from 'react-hot-toast';

export default function OthelloSettingsPage() {
  const params = useParams();
  const guildId = params.guild_id as string;

  const [settings, setSettings] = useState<Record<string, any>>({
    OTHELLO_BET_ENABLED: false,
    OTHELLO_DEFAULT_BET: 100,
    OTHELLO_SHOW_STATS: true,
    OTHELLO_PANEL_CHANNEL: '',
    OTHELLO_AUTO_VC_ENABLED: false,
    OTHELLO_VC_CATEGORY_ID: '',
    OTHELLO_VC_NAME: 'オセロ対戦',
    OTHELLO_GAME_CHANNEL: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingPanel, setSendingPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/games/othello`).then(res => res.ok ? res.json() : {}),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : []),
    ]).then(([data, channelsData]: [any, any]) => {
      setSettings({
        OTHELLO_BET_ENABLED: data.OTHELLO_BET_ENABLED ?? false,
        OTHELLO_DEFAULT_BET: data.OTHELLO_DEFAULT_BET ?? 100,
        OTHELLO_SHOW_STATS: data.OTHELLO_SHOW_STATS ?? true,
        OTHELLO_PANEL_CHANNEL: data.OTHELLO_PANEL_CHANNEL ?? '',
        OTHELLO_AUTO_VC_ENABLED: data.OTHELLO_AUTO_VC_ENABLED ?? false,
        OTHELLO_VC_CATEGORY_ID: data.OTHELLO_VC_CATEGORY_ID ?? '',
        OTHELLO_VC_NAME: data.OTHELLO_VC_NAME ?? 'オセロ対戦',
        OTHELLO_GAME_CHANNEL: data.OTHELLO_GAME_CHANNEL ?? '',
      });
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
      const res = await fetch(`/api/guilds/${guildId}/games/othello`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
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
    if (!settings.OTHELLO_PANEL_CHANNEL) {
      toast.error('パネル設置チャンネルを設定してください');
      return;
    }
    setSendingPanel(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/games/othello/panel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        toast.success('オセロパネルを送信しました！');
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
        icon={Disc3}
        title="オセロ設定"
        subtitle="オセロゲームの動作・チャンネル・VC設定を管理します"
        eyebrow="System // Othello Module"
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
            <p className="text-xs font-tech text-zinc-500 mt-0.5">オセロゲームでの賭けを有効にします</p>
          </div>
          <button
            onClick={() => updateSetting('OTHELLO_BET_ENABLED', !settings.OTHELLO_BET_ENABLED)}
            className={`px-5 py-2 rounded-lg font-bold font-mecha text-sm transition-colors ${
              settings.OTHELLO_BET_ENABLED
                ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                : 'bg-zinc-700 text-zinc-400'
            }`}
          >
            {settings.OTHELLO_BET_ENABLED ? '有効 (ON)' : '無効 (OFF)'}
          </button>
        </div>

        {settings.OTHELLO_BET_ENABLED && (
          <div className="flex flex-col space-y-2 bg-zinc-800/40 p-4 rounded-lg border border-zinc-700/50">
            <label className="text-sm font-tech text-zinc-300 font-medium">デフォルト賭け金額</label>
            <input
              type="number"
              min={1}
              value={settings.OTHELLO_DEFAULT_BET}
              onChange={(e) => updateSetting('OTHELLO_DEFAULT_BET', parseInt(e.target.value) || 100)}
              className="w-full bg-zinc-900 border border-zinc-600 rounded px-3 py-2 text-white font-tech focus:outline-none focus:border-cyan-500 transition-colors"
            />
          </div>
        )}

        <div className="flex items-center justify-between bg-zinc-800/40 p-4 rounded-lg border border-zinc-700/50">
          <div>
            <p className="text-sm font-tech text-zinc-300 font-medium">戦績ボタン表示 ON/OFF</p>
            <p className="text-xs font-tech text-zinc-500 mt-0.5">オセロパネルに「自分の戦績」ボタンを表示します</p>
          </div>
          <button
            onClick={() => updateSetting('OTHELLO_SHOW_STATS', !settings.OTHELLO_SHOW_STATS)}
            className={`px-5 py-2 rounded-lg font-bold font-mecha text-sm transition-colors ${
              settings.OTHELLO_SHOW_STATS
                ? 'bg-green-600 text-white shadow-[0_0_10px_rgba(34,197,94,0.4)]'
                : 'bg-zinc-700 text-zinc-400'
            }`}
          >
            {settings.OTHELLO_SHOW_STATS ? '表示 (ON)' : '非表示 (OFF)'}
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
            value={settings.OTHELLO_PANEL_CHANNEL}
            onChange={(id) => updateSetting('OTHELLO_PANEL_CHANNEL', id || '')}
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
            value={settings.OTHELLO_GAME_CHANNEL}
            onChange={(id) => updateSetting('OTHELLO_GAME_CHANNEL', id || '')}
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
            onClick={() => updateSetting('OTHELLO_AUTO_VC_ENABLED', !settings.OTHELLO_AUTO_VC_ENABLED)}
            className={`px-5 py-2 rounded-lg font-bold font-mecha text-sm transition-colors ${
              settings.OTHELLO_AUTO_VC_ENABLED
                ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                : 'bg-zinc-700 text-zinc-400'
            }`}
          >
            {settings.OTHELLO_AUTO_VC_ENABLED ? '有効 (ON)' : '無効 (OFF)'}
          </button>
        </div>

        {settings.OTHELLO_AUTO_VC_ENABLED && (
          <>
            <div className="space-y-2">
              <label className="text-sm font-tech text-zinc-300 font-medium">VC作成先カテゴリ</label>
              <ChannelSelect
                label="VC作成先カテゴリ"
                placeholder="カテゴリを選択..."
                value={settings.OTHELLO_VC_CATEGORY_ID}
                onChange={(id) => updateSetting('OTHELLO_VC_CATEGORY_ID', id || '')}
                channels={categoryChannels}
                multiple={false}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-tech text-zinc-300 font-medium">作成するVC名</label>
              <input
                type="text"
                value={settings.OTHELLO_VC_NAME}
                onChange={(e) => updateSetting('OTHELLO_VC_NAME', e.target.value)}
                placeholder="オセロ対戦"
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
