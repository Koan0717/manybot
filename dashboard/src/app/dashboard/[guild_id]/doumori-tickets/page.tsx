'use client';

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useSyncStatus, SyncStatusCards } from '@/lib/useSyncStatus';
import ChannelSelect from '@/components/ChannelSelect';
import {
  Ticket,
  Bell,
  BellOff,
  MessageSquare,
  Mail,
  Hash,
  Clock,
  MessageCircle,
  Save,
  RefreshCw,
  Info,
  CheckCircle2,
} from 'lucide-react';

interface DoumoriSettings {
  ticket_notify_enabled?: boolean;
  ticket_notify_destination?: 'dm' | 'channel' | 'last_channel';
  ticket_notify_channel_id?: string;
  ticket_notify_message?: string;
  ticket_required_minutes?: number;
  ticket_chat_activity_seconds?: number;
  ticket_chat_cooldown_seconds?: number;
  [key: string]: any;
}

export default function DoumoriTicketsSettingsPage({
  params,
}: {
  params: { guild_id: string };
}) {
  const guildId = params.guild_id;
  const sync = useSyncStatus(guildId);

  const [settings, setSettings] = useState<DoumoriSettings>({
    ticket_notify_enabled: true,
    ticket_notify_destination: 'last_channel',
    ticket_notify_channel_id: '',
    ticket_notify_message:
      '🎉 **【浮上特典】** {user} さんがアクティビティを達成し、**図鑑チケット ×{tickets}** を獲得しました！（所持数: {total}枚）',
    ticket_required_minutes: 60,
    ticket_chat_activity_seconds: 60,
    ticket_chat_cooldown_seconds: 60,
  });

  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/doumori`, { cache: 'no-store' });
      const data = await res.json();
      if (!data.error && data.settings) {
        setSettings({
          ...data.settings,
          ticket_notify_enabled:
            data.settings.ticket_notify_enabled !== undefined
              ? Boolean(data.settings.ticket_notify_enabled)
              : true,
          ticket_notify_destination:
            data.settings.ticket_notify_destination || 'last_channel',
        });
      }
      if (Array.isArray(data.channels)) {
        setChannels(data.channels.filter((c: any) => c.type === 0 || c.type === 5));
      }
    } catch {
      toast.error('設定の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [guildId]);

  const updateField = (key: keyof DoumoriSettings, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/doumori`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('浮上特典・通知設定を保存しました！Botに即時反映されます。');
      } else {
        toast.error('保存エラー: ' + (data.error || '保存に失敗しました'));
      }
    } catch {
      toast.error('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  // プレビュー用メッセージ生成
  const previewMessage = (
    settings.ticket_notify_message ||
    '🎉 **【浮上特典】** {user} さんがアクティビティを達成し、**図鑑チケット ×{tickets}** を獲得しました！（所持数: {total}枚）'
  )
    .replace('{user}', '@ユーザー名')
    .replace('{tickets}', '1')
    .replace('{total}', '3');

  return (
    <div className="max-w-5xl mx-auto pb-20 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="mecha-led w-2 h-2 rounded-full bg-purple-400 text-purple-400"></span>
            <span className="font-tech text-[11px] tracking-[0.25em] text-purple-400/90 uppercase">
              Activity Core // Voice & Chat Reward Notification
            </span>
          </div>
          <h1 className="font-mecha text-2xl md:text-3xl font-black text-white flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-10 h-10 mecha-clip-sm bg-purple-600/20 border border-purple-500/50 text-purple-400">
              <Ticket className="w-5 h-5" />
            </span>
            どうぶつの森 浮上特典＆チケット通知設定
          </h1>
          <p className="font-tech text-xs text-zinc-400 mt-1">
            VC・チャットの浮上時間を計測して1時間ごとに図鑑チケットを付与し、お祝い通知を送信します。
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="mecha-btn-sheen mecha-clip-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2.5 font-tech text-xs flex items-center gap-2 border border-zinc-700"
            disabled={loading || saving}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            再読み込み
          </button>
          <button
            onClick={handleSave}
            className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-700 via-purple-600 to-indigo-800 hover:from-purple-600 hover:to-indigo-700 text-white px-6 py-2.5 font-mecha text-sm font-black flex items-center gap-2 shadow-lg shadow-purple-950/50 border border-purple-400/40"
            disabled={loading || saving}
          >
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : '設定を保存 / EXECUTE'}
          </button>
        </div>
      </div>

      <SyncStatusCards sync={sync} showSyncCard={false} />

      {/* 1. 通知のON/OFF切り替えカード */}
      <div className="mecha-corners mecha-scan-wrap mecha-grid-bg bg-neutral-900/90 border border-purple-900/40 mecha-clip p-6 shadow-xl">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center font-mecha font-black text-sm bg-purple-600/30 text-purple-300 border border-purple-500/40">
              1
            </span>
            <div>
              <h2 className="font-mecha font-bold text-white text-base flex items-center gap-2">
                浮上特典通知の送信 (ON / OFF)
              </h2>
              <span className="font-tech text-xs text-zinc-400">
                1時間達成時に「🎉 【浮上特典】...」のメッセージを自動送信するかを設定します。
              </span>
            </div>
          </div>
          <span
            className={`font-tech text-xs px-3 py-1 mecha-clip-sm font-bold border ${
              settings.ticket_notify_enabled
                ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                : 'bg-zinc-800 border-zinc-600 text-zinc-400'
            }`}
          >
            {settings.ticket_notify_enabled ? '● 通知中 (ON)' : '○ 停止中 (OFF)'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* ON Button Card */}
          <button
            type="button"
            onClick={() => updateField('ticket_notify_enabled', true)}
            className={`p-5 mecha-clip text-left transition-all relative overflow-hidden border-2 ${
              settings.ticket_notify_enabled
                ? 'bg-gradient-to-br from-emerald-950/60 to-purple-950/40 border-emerald-500 shadow-lg shadow-emerald-950/40'
                : 'bg-black/40 border-zinc-800 hover:border-zinc-600 opacity-60 hover:opacity-100'
            }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 mecha-clip-sm bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <Bell className="w-5 h-5" />
              </div>
              {settings.ticket_notify_enabled && (
                <span className="flex items-center gap-1 font-tech text-xs text-emerald-400 font-bold bg-emerald-950/90 px-2 py-0.5 border border-emerald-600 mecha-clip-sm">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 選択中
                </span>
              )}
            </div>
            <h3 className="font-mecha font-bold text-white text-base mb-1">
              🔔 通知を行う (ON)
            </h3>
            <p className="font-tech text-xs text-zinc-400 leading-relaxed">
              ユーザーが累計1時間のアクティビティを達成した際、指定の送信先にお祝いメッセージを自動送信します。
            </p>
          </button>

          {/* OFF Button Card */}
          <button
            type="button"
            onClick={() => updateField('ticket_notify_enabled', false)}
            className={`p-5 mecha-clip text-left transition-all relative overflow-hidden border-2 ${
              !settings.ticket_notify_enabled
                ? 'bg-gradient-to-br from-zinc-900 to-black border-red-500 shadow-lg shadow-red-950/30'
                : 'bg-black/40 border-zinc-800 hover:border-zinc-600 opacity-60 hover:opacity-100'
            }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 mecha-clip-sm bg-red-600/20 border border-red-500/40 flex items-center justify-center text-red-400">
                <BellOff className="w-5 h-5" />
              </div>
              {!settings.ticket_notify_enabled && (
                <span className="flex items-center gap-1 font-tech text-xs text-red-400 font-bold bg-red-950/90 px-2 py-0.5 border border-red-600 mecha-clip-sm">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 選択中
                </span>
              )}
            </div>
            <h3 className="font-mecha font-bold text-white text-base mb-1">
              🔕 通知を行わない (OFF / サイレント)
            </h3>
            <p className="font-tech text-xs text-zinc-400 leading-relaxed">
              メッセージ通知は送信せず、図鑑チケットの付与のみを静かに行います（チャットの通知欄を静かに保ちたい場合におすすめ）。
            </p>
          </button>
        </div>
      </div>

      {/* 2. 送信先の選択設定 (ONの場合) */}
      <div
        className={`mecha-corners mecha-scan-wrap mecha-grid-bg bg-neutral-900/90 border border-purple-900/40 mecha-clip p-6 shadow-xl transition-all ${
          !settings.ticket_notify_enabled ? 'opacity-40 pointer-events-none' : ''
        }`}
      >
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center font-mecha font-black text-sm bg-purple-600/30 text-purple-300 border border-purple-500/40">
              2
            </span>
            <div>
              <h2 className="font-mecha font-bold text-white text-base flex items-center gap-2">
                通知メッセージの送信先設定
              </h2>
              <span className="font-tech text-xs text-zinc-400">
                チケット獲得時のお祝いメッセージをどこに届けるかを選択してください。
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Option A: DM */}
          <button
            type="button"
            onClick={() => updateField('ticket_notify_destination', 'dm')}
            className={`p-4 mecha-clip text-left transition-all relative border-2 ${
              settings.ticket_notify_destination === 'dm'
                ? 'bg-purple-950/60 border-purple-400 shadow-md'
                : 'bg-black/40 border-zinc-800 hover:border-zinc-600'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <Mail className={`w-5 h-5 ${settings.ticket_notify_destination === 'dm' ? 'text-purple-300' : 'text-zinc-500'}`} />
              <input
                type="radio"
                name="destination"
                checked={settings.ticket_notify_destination === 'dm'}
                onChange={() => updateField('ticket_notify_destination', 'dm')}
                className="cursor-pointer"
              />
            </div>
            <h4 className="font-mecha font-bold text-white text-sm mb-1">
              📩 メンバーのDM
            </h4>
            <p className="font-tech text-[11px] text-zinc-400 leading-relaxed">
              達成したユーザーのDiscord個人DM宛に直接メッセージを送信します。
            </p>
          </button>

          {/* Option B: Specific Channel */}
          <button
            type="button"
            onClick={() => updateField('ticket_notify_destination', 'channel')}
            className={`p-4 mecha-clip text-left transition-all relative border-2 ${
              settings.ticket_notify_destination === 'channel'
                ? 'bg-purple-950/60 border-purple-400 shadow-md'
                : 'bg-black/40 border-zinc-800 hover:border-zinc-600'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <Hash className={`w-5 h-5 ${settings.ticket_notify_destination === 'channel' ? 'text-purple-300' : 'text-zinc-500'}`} />
              <input
                type="radio"
                name="destination"
                checked={settings.ticket_notify_destination === 'channel'}
                onChange={() => updateField('ticket_notify_destination', 'channel')}
                className="cursor-pointer"
              />
            </div>
            <h4 className="font-mecha font-bold text-white text-sm mb-1">
              📢 特定のチャンネル
            </h4>
            <p className="font-tech text-[11px] text-zinc-400 leading-relaxed">
              指定した固定チャンネル（獲得通知ログや雑談チャンネルなど）に送信します。
            </p>
          </button>

          {/* Option C: Last active message channel */}
          <button
            type="button"
            onClick={() => updateField('ticket_notify_destination', 'last_channel')}
            className={`p-4 mecha-clip text-left transition-all relative border-2 ${
              settings.ticket_notify_destination === 'last_channel'
                ? 'bg-purple-950/60 border-purple-400 shadow-md'
                : 'bg-black/40 border-zinc-800 hover:border-zinc-600'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <MessageSquare className={`w-5 h-5 ${settings.ticket_notify_destination === 'last_channel' ? 'text-purple-300' : 'text-zinc-500'}`} />
              <input
                type="radio"
                name="destination"
                checked={settings.ticket_notify_destination === 'last_channel'}
                onChange={() => updateField('ticket_notify_destination', 'last_channel')}
                className="cursor-pointer"
              />
            </div>
            <h4 className="font-mecha font-bold text-white text-sm mb-1">
              💬 最後に発言したチャンネル
            </h4>
            <p className="font-tech text-[11px] text-zinc-400 leading-relaxed">
              ユーザーが直近で発言したアクティブなチャンネル上に自然にお祝いを返信します。
            </p>
          </button>
        </div>

        {/* チャンネル選択ドロップダウン (特定のチャンネル選択時) */}
        {settings.ticket_notify_destination === 'channel' && (
          <div className="p-4 bg-black/60 border border-purple-900/50 mecha-clip-sm space-y-2 animate-fade-in">
            <label className="font-tech text-xs text-purple-300 font-bold flex items-center gap-1.5">
              <Hash className="w-4 h-4 text-purple-400" />
              通知先Discordチャンネルを選択 <span className="text-red-400">*</span>
            </label>
            <ChannelSelect
              label="通知先チャンネル"
              placeholder="チャンネルを選択してください..."
              channels={channels}
              value={settings.ticket_notify_channel_id || ''}
              onChange={(id: any) => updateField('ticket_notify_channel_id', id || '')}
              multiple={false}
            />
            <p className="font-tech text-[10px] text-zinc-500">
              ※ 未選択の場合は、直近発言チャンネルまたはDMへ自動フォールバックされます。
            </p>
          </div>
        )}
      </div>

      {/* 3. メッセージプレビュー＆テンプレート編集 */}
      <div className="mecha-corners mecha-scan-wrap mecha-grid-bg bg-neutral-900/90 border border-purple-900/40 mecha-clip p-6 shadow-xl space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center font-mecha font-black text-sm bg-purple-600/30 text-purple-300 border border-purple-500/40">
              3
            </span>
            <div>
              <h2 className="font-mecha font-bold text-white text-base flex items-center gap-2">
                メッセージ内容・テンプレート
              </h2>
              <span className="font-tech text-xs text-zinc-400">
                Discord上で送信される通知メッセージの文面をカスタマイズできます。
              </span>
            </div>
          </div>
        </div>

        {/* Discord Mockup Preview */}
        <div>
          <label className="font-tech text-xs text-zinc-400 block mb-2">
            👁️ Discord送信プレビュー
          </label>
          <div className="bg-[#313338] border border-zinc-700/60 rounded-lg p-4 font-sans text-sm text-zinc-200 flex items-start gap-3 shadow-inner">
            <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-base flex-shrink-0 shadow">
              🍃
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-bold text-white text-sm">どうぶつの森</span>
                <span className="bg-[#5865F2] text-white text-[10px] px-1.5 py-0.2 rounded font-semibold">
                  ✓ アプリ
                </span>
                <span className="text-[11px] text-zinc-400">今日 13:46</span>
              </div>
              <p className="text-[#DBDEE1] text-sm leading-relaxed whitespace-pre-wrap">
                {previewMessage}
              </p>
            </div>
          </div>
        </div>

        {/* Template Input */}
        <div className="space-y-2">
          <label className="font-tech text-xs text-purple-300 font-bold block">
            メッセージテンプレート
          </label>
          <textarea
            rows={2}
            value={settings.ticket_notify_message || ''}
            onChange={(e) => updateField('ticket_notify_message', e.target.value)}
            className="w-full bg-black/70 border border-zinc-700 focus:border-purple-400 mecha-clip-sm p-3 text-sm text-white font-tech outline-none"
            placeholder="🎉 **【浮上特典】** {user} さんがアクティビティ1時間を達成し、**図鑑チケット ×{tickets}** を獲得しました！（所持数: {total}枚）"
          />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="font-tech text-[10px] text-zinc-500">挿入可能タグ:</span>
            <code className="text-[10px] bg-black/80 px-2 py-0.5 rounded text-purple-300 border border-purple-900 font-mono">
              &#123;user&#125; (ユーザー名)
            </code>
            <code className="text-[10px] bg-black/80 px-2 py-0.5 rounded text-purple-300 border border-purple-900 font-mono">
              &#123;tickets&#125; (獲得枚数)
            </code>
            <code className="text-[10px] bg-black/80 px-2 py-0.5 rounded text-purple-300 border border-purple-900 font-mono">
              &#123;total&#125; (所持合計枚数)
            </code>
          </div>
        </div>
      </div>

      {/* 4. 浮上時間＆チャット加算パラメータ */}
      <div className="mecha-corners mecha-scan-wrap mecha-grid-bg bg-neutral-900/90 border border-purple-900/40 mecha-clip p-6 shadow-xl space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center font-mecha font-black text-sm bg-purple-600/30 text-purple-300 border border-purple-500/40">
              4
            </span>
            <div>
              <h2 className="font-mecha font-bold text-white text-base flex items-center gap-2">
                浮上時間＆アクティビティ加算パラメータ
              </h2>
              <span className="font-tech text-xs text-zinc-400">
                チケット1枚獲得に必要な累計時間やチャット発言ごとの加算秒数を設定します。
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 font-tech text-sm">
          <div>
            <label className="text-xs text-zinc-400 block mb-1.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-purple-400" />
              チケット1枚獲得の必要時間 (分)
            </label>
            <input
              type="number"
              min={1}
              value={settings.ticket_required_minutes ?? 60}
              onChange={(e) => updateField('ticket_required_minutes', parseInt(e.target.value, 10) || 60)}
              className="w-full bg-black/70 border border-zinc-700 mecha-clip-sm px-3 py-2 text-white font-mono focus:border-purple-400 outline-none"
            />
            <span className="text-[10px] text-zinc-500 block mt-1">
              デフォルト: **60 分** (累計1時間ごとに+1枚)
            </span>
          </div>

          <div>
            <label className="text-xs text-zinc-400 block mb-1.5 flex items-center gap-1.5">
              <MessageCircle className="w-3.5 h-3.5 text-purple-400" />
              チャット1発言の加算秒数 (秒)
            </label>
            <input
              type="number"
              min={0}
              value={settings.ticket_chat_activity_seconds ?? 60}
              onChange={(e) => updateField('ticket_chat_activity_seconds', parseInt(e.target.value, 10) || 60)}
              className="w-full bg-black/70 border border-zinc-700 mecha-clip-sm px-3 py-2 text-white font-mono focus:border-purple-400 outline-none"
            />
            <span className="text-[10px] text-zinc-500 block mt-1">
              デフォルト: **60 秒** (1発言あたり60秒分加算)
            </span>
          </div>

          <div>
            <label className="text-xs text-zinc-400 block mb-1.5 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-purple-400" />
              チャット加算クールダウン (秒)
            </label>
            <input
              type="number"
              min={0}
              value={settings.ticket_chat_cooldown_seconds ?? 60}
              onChange={(e) => updateField('ticket_chat_cooldown_seconds', parseInt(e.target.value, 10) || 60)}
              className="w-full bg-black/70 border border-zinc-700 mecha-clip-sm px-3 py-2 text-white font-mono focus:border-purple-400 outline-none"
            />
            <span className="text-[10px] text-zinc-500 block mt-1">
              デフォルト: **60 秒** (スパム防止間隔)
            </span>
          </div>
        </div>
      </div>

      {/* Floating Save Footer */}
      <div className="p-4 bg-neutral-900/90 border border-purple-900/40 mecha-clip-sm flex items-center justify-between shadow-2xl">
        <p className="text-xs font-tech text-zinc-400">
          💡 保存すると、Bot側のVC監視＆チャット監視処理に即座に設定が適用されます。
        </p>
        <button
          onClick={handleSave}
          className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-700 via-purple-600 to-indigo-800 hover:from-purple-600 hover:to-indigo-700 text-white px-6 py-2.5 font-mecha text-sm font-black flex items-center gap-2 shadow-lg border border-purple-400/40"
          disabled={loading || saving}
        >
          <Save className="w-4 h-4" />
          {saving ? '保存中...' : '設定を保存 / EXECUTE'}
        </button>
      </div>
    </div>
  );
}
