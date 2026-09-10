'use client';

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { 
  Link as LinkIcon, 
  Send, 
  Save, 
  Info, 
  Hash, 
  Clock, 
  Users, 
  Power, 
  ShieldAlert 
} from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import ChannelSelect from '@/components/ChannelSelect';

const DURATION_OPTIONS = [
  { value: 0, label: '無期限 (無限)' },
  { value: 1800, label: '30分' },
  { value: 3600, label: '1時間' },
  { value: 21600, label: '6時間' },
  { value: 43200, label: '12時間' },
  { value: 86400, label: '1日 (24時間)' },
  { value: 604800, label: '7日 (1週間)' },
];

const USES_OPTIONS = [
  { value: 0, label: '無制限 (無限)' },
  { value: 1, label: '1回のみ' },
  { value: 5, label: '5回' },
  { value: 10, label: '10回' },
  { value: 25, label: '25回' },
  { value: 50, label: '50回' },
  { value: 100, label: '100回' },
];

export default function InviteLinkSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;

  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingPanel, setSendingPanel] = useState(false);

  const [formData, setFormData] = useState({
    INVITE_LINK_ENABLED: false,
    INVITE_LINK_MAX_USES: 0,
    INVITE_LINK_MAX_AGE: 0,
    INVITE_LINK_CHANNEL_ID: '',
    INVITE_LINK_TEMPORARY: false,
    INVITE_LINK_PANEL_CHANNEL: ''
  });

  const [customUsesMode, setCustomUsesMode] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/invite-link`).then(res => res.ok ? res.json() : {})
    ])
      .then(([channelsData, settingsData]: [any, any]) => {
        if (!channelsData.error && Array.isArray(channelsData)) {
          setChannels(channelsData.filter((c: any) => [0, 5].includes(c.type)));
        }
        if (!settingsData.error) {
          const uses = settingsData.INVITE_LINK_MAX_USES ?? 0;
          setFormData({
            INVITE_LINK_ENABLED: !!settingsData.INVITE_LINK_ENABLED,
            INVITE_LINK_MAX_USES: uses,
            INVITE_LINK_MAX_AGE: settingsData.INVITE_LINK_MAX_AGE ?? 0,
            INVITE_LINK_CHANNEL_ID: settingsData.INVITE_LINK_CHANNEL_ID ? String(settingsData.INVITE_LINK_CHANNEL_ID) : '',
            INVITE_LINK_TEMPORARY: !!settingsData.INVITE_LINK_TEMPORARY,
            INVITE_LINK_PANEL_CHANNEL: settingsData.INVITE_LINK_PANEL_CHANNEL ? String(settingsData.INVITE_LINK_PANEL_CHANNEL) : ''
          });
          if (!USES_OPTIONS.some(o => o.value === uses)) {
            setCustomUsesMode(true);
          }
        }
      })
      .catch(err => {
        console.error(err);
        toast.error('設定データの取得に失敗しました');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [guildId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/invite-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('招待リンク発行設定を保存しました！');
      } else {
        toast.error(`保存に失敗しました: ${data.error || '不明なエラー'}`);
      }
    } catch (e: any) {
      console.error(e);
      toast.error('保存処理中にエラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  const handleSendPanel = async () => {
    if (!formData.INVITE_LINK_PANEL_CHANNEL) {
      toast.error('送信先チャンネルを選択してください');
      return;
    }

    setSendingPanel(true);
    try {
      const selectedCh = channels.find(c => c.id === formData.INVITE_LINK_PANEL_CHANNEL);
      const res = await fetch(`/api/guilds/${guildId}/invite-link/panel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: formData.INVITE_LINK_PANEL_CHANNEL,
          channel_type: selectedCh?.type ?? 0
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('招待リンク発行パネルを送信しました！');
      } else {
        toast.error(`送信に失敗しました: ${data.error || '不明なエラー'}`);
      }
    } catch (e: any) {
      console.error(e);
      toast.error('送信処理中にエラーが発生しました');
    } finally {
      setSendingPanel(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-red-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-16">
      <PageHeader
        title="招待リンク発行設定"
        eyebrow="INVITE SYSTEM // URL GENERATION"
        subtitle="Discordサーバーの招待リンクを発行・管理します。チャンネルにパネルを設置し、ユーザーがボタンを押すと設定通りの招待リンクがDMに届きます。"
        icon={LinkIcon}
        tone="cyan"
      />

      {/* 機能ステータス & 有効化トグル */}
      <div className="mecha-corners bg-neutral-900/80 border border-zinc-800 p-6 rounded-xl shadow-lg relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${formData.INVITE_LINK_ENABLED ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-zinc-600'}`} />
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                招待リンク発行機能
              </h3>
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                formData.INVITE_LINK_ENABLED 
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
              }`}>
                {formData.INVITE_LINK_ENABLED ? '有効化中' : '無効'}
              </span>
            </div>
            <p className="text-sm text-zinc-400">
              機能をONにすると、メンバーがボタンから招待リンクを発行できるようになります。
            </p>
          </div>

          <button
            type="button"
            onClick={() => setFormData(prev => ({ ...prev, INVITE_LINK_ENABLED: !prev.INVITE_LINK_ENABLED }))}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-sm transition-all shadow-md ${
              formData.INVITE_LINK_ENABLED
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
            }`}
          >
            <Power className="w-4 h-4" />
            {formData.INVITE_LINK_ENABLED ? '有効 (ON)' : '無効 (OFF)'}
          </button>
        </div>
      </div>

      {/* 招待条件設定 (Discordの招待設定に準拠) */}
      <div className="mecha-corners bg-neutral-900/80 border border-zinc-800 p-6 rounded-xl shadow-lg space-y-6">
        <div className="border-b border-zinc-800 pb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <LinkIcon className="w-5 h-5 text-blue-400" />
            発行条件の設定
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            Discord公式の招待作成と同じ条件（有効期限・最大使用回数）を指定できます。未指定の場合は無期限・無制限となります。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 有効期限 */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Clock className="w-4 h-4 text-zinc-400" />
              有効期限 (日付・期間)
            </label>
            <select
              value={formData.INVITE_LINK_MAX_AGE}
              onChange={(e) => setFormData(prev => ({ ...prev, INVITE_LINK_MAX_AGE: Number(e.target.value) }))}
              className="w-full bg-zinc-800/80 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
            >
              {DURATION_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value} className="bg-zinc-900 text-white">
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-zinc-500">
              ※ 設定されていない場合、リンクは期限切れにならず「無期限」となります。
            </p>
          </div>

          {/* 最大使用回数 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <Users className="w-4 h-4 text-zinc-400" />
                最大使用回数 (上限)
              </label>
              <button
                type="button"
                onClick={() => setCustomUsesMode(!customUsesMode)}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors underline"
              >
                {customUsesMode ? '選択式に戻す' : 'カスタム数値を入力'}
              </button>
            </div>

            {customUsesMode ? (
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  placeholder="0 = 無制限"
                  value={formData.INVITE_LINK_MAX_USES}
                  onChange={(e) => setFormData(prev => ({ ...prev, INVITE_LINK_MAX_USES: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="w-full bg-zinc-800/80 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                />
                <span className="absolute right-3 top-2.5 text-xs text-zinc-400">回</span>
              </div>
            ) : (
              <select
                value={formData.INVITE_LINK_MAX_USES}
                onChange={(e) => setFormData(prev => ({ ...prev, INVITE_LINK_MAX_USES: Number(e.target.value) }))}
                className="w-full bg-zinc-800/80 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
              >
                {USES_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value} className="bg-zinc-900 text-white">
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
            <p className="text-xs text-zinc-500">
              ※ 0に設定すると「無制限」となります。設定回数に達するとリンクは無効化されます。
            </p>
          </div>

          {/* 対象チャンネル */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Hash className="w-4 h-4 text-zinc-400" />
              招待先チャンネル
            </label>
            <ChannelSelect
              channels={channels}
              value={formData.INVITE_LINK_CHANNEL_ID}
              onChange={(val) => setFormData(prev => ({ ...prev, INVITE_LINK_CHANNEL_ID: val }))}
              placeholder="サーバーのデフォルト (未選択時)"
            />
            <p className="text-xs text-zinc-500">
              ※ 未指定の場合は、サーバーのシステムチャンネルまたは標準テキストチャンネルになります。
            </p>
          </div>

          {/* 一時的メンバーシップ */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-zinc-400" />
              一時的メンバーシップ
            </label>
            <div className="flex items-center gap-3 pt-2">
              <input
                type="checkbox"
                id="temp_member"
                checked={formData.INVITE_LINK_TEMPORARY}
                onChange={(e) => setFormData(prev => ({ ...prev, INVITE_LINK_TEMPORARY: e.target.checked }))}
                className="w-4 h-4 text-blue-600 bg-zinc-800 border-zinc-700 rounded focus:ring-blue-500 focus:ring-offset-zinc-900"
              />
              <label htmlFor="temp_member" className="text-xs text-zinc-300 cursor-pointer">
                ロールが付与されていない場合、切断時に自動キックする
              </label>
            </div>
            <p className="text-xs text-zinc-500">
              ※ 通常はOFFで問題ありません。一時参加用の招待を作成したい場合のみONにしてください。
            </p>
          </div>
        </div>

        {/* 設定保存ボタン */}
        <div className="pt-4 flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-bold text-sm transition-all shadow-lg shadow-blue-900/30"
          >
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : '設定を保存する'}
          </button>
        </div>
      </div>

      {/* パネル送信セクション */}
      <div className="mecha-corners bg-neutral-900/80 border border-zinc-800 p-6 rounded-xl shadow-lg space-y-6">
        <div className="border-b border-zinc-800 pb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Send className="w-5 h-5 text-emerald-400" />
            招待リンク発行パネルの送信
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            カジノbotやチンチロと同様に、指定チャンネルに「招待リンク発行ボタン」付きのパネルを送信します。
            メンバーがボタンを押すと、上記で設定した条件の招待URLがDMに届きます。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <Hash className="w-4 h-4 text-zinc-400" />
                送信先チャンネル
              </label>
              <ChannelSelect
                channels={channels}
                value={formData.INVITE_LINK_PANEL_CHANNEL}
                onChange={(val) => setFormData(prev => ({ ...prev, INVITE_LINK_PANEL_CHANNEL: val }))}
                placeholder="送信先チャンネルを選択..."
              />
            </div>

            <button
              type="button"
              onClick={handleSendPanel}
              disabled={sendingPanel || !formData.INVITE_LINK_PANEL_CHANNEL}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white rounded-lg font-bold text-sm transition-all shadow-lg shadow-emerald-900/30"
            >
              <Send className="w-4 h-4" />
              {sendingPanel ? '送信中...' : 'チャンネルにパネルを送信'}
            </button>
          </div>

          {/* プレビュー表示 */}
          <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-4 space-y-3">
            <span className="text-xs font-mono text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" />
              Discord埋め込みプレビュー
            </span>

            <div className="border-l-4 border-blue-500 bg-[#2b2d31] p-3.5 rounded-r-md text-white space-y-2 shadow-sm">
              <div className="font-bold text-sm text-white flex items-center gap-1.5">
                🔗 サーバー招待リンク発行
              </div>
              <div className="text-xs text-zinc-300 leading-relaxed">
                下のボタンを押すと、あなた専用のサーバー招待リンクがDMに送られます。<br />
                お友達をサーバーに招待する際にご利用ください！
              </div>
            </div>

            <div className="pt-1">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#5865F2] text-white rounded-md text-xs font-semibold shadow opacity-90 cursor-default">
                <span>🔗</span>
                <span>招待リンクを発行する</span>
              </div>
            </div>
            
            <p className="text-[11px] text-zinc-500 italic">
              ※ ボタンをタップしたユーザーのDMに、設定された条件（回数・期限）のURLが即座に送られます。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
