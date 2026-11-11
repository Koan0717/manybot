'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Save, RefreshCw } from 'lucide-react';
import Card from '@/components/doumori/Card';
import { DEFAULT_SETTINGS } from '@/lib/doumori/settings';

interface Channel {
  id: string;
  name: string;
  type: number;
}

export default function SettingsPage() {
  const { guild_id: guildId } = useParams<{ guild_id: string }>();
  const [settings, setSettings] = useState<Record<string, any>>(DEFAULT_SETTINGS);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/doumori/settings`, { cache: 'no-store' });
      const data = await res.json();
      if (!data.error) {
        setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
        setChannels((data.channels || []).filter((c: Channel) => c.type === 0 || c.type === 5));
      } else {
        toast.error('設定の取得に失敗しました');
      }
    } catch {
      toast.error('通信エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const update = (key: string, value: any) => setSettings((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/doumori/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('設定を保存しました！Botに即時反映されます。');
      } else {
        toast.error('保存エラー: ' + (data.error || '保存に失敗しました'));
      }
    } catch {
      toast.error('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  const num = (key: string) => (
    <input
      type="number"
      value={settings[key] ?? ''}
      onChange={(e) => update(key, parseFloat(e.target.value) || 0)}
      className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-leaf-400"
    />
  );

  const text = (key: string, placeholder = '') => (
    <input
      type="text"
      value={settings[key] ?? ''}
      onChange={(e) => update(key, e.target.value)}
      placeholder={placeholder}
      className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-leaf-400"
    />
  );

  const color = (key: string) => (
    <input
      type="color"
      value={settings[key] ?? '#3498DB'}
      onChange={(e) => update(key, e.target.value)}
      className="w-12 h-9 bg-transparent cursor-pointer border border-leaf-200 rounded"
    />
  );

  const channelSelect = (key: string) => (
    <select
      value={settings[key] ?? ''}
      onChange={(e) => update(key, e.target.value)}
      className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-leaf-400"
    >
      <option value="">-- チャンネルを選択 --</option>
      {channels.map((c) => (
        <option key={c.id} value={c.id}>
          # {c.name}
        </option>
      ))}
    </select>
  );

  if (loading) {
    return <div className="text-leaf-500 text-sm">読み込み中...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto pb-20 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-leaf-900">基本設定</h1>
          <p className="text-sm text-leaf-500 mt-1">浮上特典・ショップ・採集・図鑑・売却などの各種パラメータを設定します。</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            disabled={loading || saving}
            className="bg-white border border-leaf-200 hover:bg-leaf-50 text-leaf-700 px-4 py-2.5 rounded-xl text-sm flex items-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            再読み込み
          </button>
          <button
            onClick={handleSave}
            disabled={loading || saving}
            className="bg-leaf-600 hover:bg-leaf-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-leaf-600/20"
          >
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>

      <Card title="🍃 どう森機能" description="このサーバーで ManyBot のどう森機能（/釣り・/ショップ・浮上チケットなど）を動かすかどうかです。">
        {(() => {
          const on = settings.doumori_enabled === true || settings.doumori_enabled === 'true';
          return (
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm">
                {on ? (
                  <span className="font-bold text-leaf-700">✅ 有効：このサーバーでどう森のコマンドと浮上計測が動きます</span>
                ) : (
                  <span className="font-bold text-amber-600">⏸ 無効：コマンドを使うと「有効になっていません」と表示されます</span>
                )}
                <p className="text-xs text-leaf-500 mt-1">切り替えたら「保存する」を押してください。</p>
              </div>
              <button
                type="button"
                onClick={() => update('doumori_enabled', !on)}
                className={`relative w-14 h-8 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-leaf-500' : 'bg-gray-300'}`}
                aria-pressed={on}
                aria-label="どう森機能を有効にする"
              >
                <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all ${on ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          );
        })()}
      </Card>

      <Card title="🎫 浮上・チケット獲得" description="VC・チャットの浮上時間を計測して図鑑チケットを付与する条件です。">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-leaf-600 block mb-1">チケット1枚獲得の必要時間 (分)</label>
            {num('ticket_required_minutes')}
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">チャット1発言の加算秒数</label>
            {num('ticket_chat_activity_seconds')}
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">チャット加算クールダウン (秒)</label>
            {num('ticket_chat_cooldown_seconds')}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="text-xs text-leaf-600 block mb-1">通知先チャンネル (destination=channel の場合)</label>
            {channelSelect('ticket_notify_channel_id')}
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">通知送信先の種類</label>
            <select
              value={settings.ticket_notify_destination ?? 'last_channel'}
              onChange={(e) => update('ticket_notify_destination', e.target.value)}
              className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="dm">DM</option>
              <option value="channel">特定のチャンネル</option>
              <option value="last_channel">最後に発言したチャンネル</option>
            </select>
          </div>
        </div>
        <div className="mt-4">
          <label className="text-xs text-leaf-600 block mb-1">通知メッセージテンプレート</label>
          <textarea
            rows={2}
            value={settings.ticket_notify_message ?? ''}
            onChange={(e) => update('ticket_notify_message', e.target.value)}
            className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm"
          />
          <span className="text-[11px] text-leaf-500 mt-1 block">挿入可能タグ: {'{user}'} {'{tickets}'} {'{total}'}</span>
        </div>
      </Card>

      <Card title="🏪 ショップ・両替" description="/ショップ, /両替 コマンドの価格・レートです。">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-leaf-600 block mb-1">チケット1枚あたりの必要マイル (pt)</label>
            {num('miles_per_ticket')}
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">つりざお価格 (チケット数)</label>
            {num('fishing_rod_price')}
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">虫取り網価格 (チケット数)</label>
            {num('bug_net_price')}
          </div>
        </div>
      </Card>

      <Card title="🎣 採集" description="/釣り, /虫捕り のレアリティ判定です。">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-leaf-600 block mb-1">色違い出現率 (%)</label>
            {num('shiny_chance_percent')}
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">図鑑1ページの表示件数</label>
            {num('book_page_size')}
          </div>
        </div>
      </Card>

      <Card title="🏆 限定コンプリートロール付与" description="図鑑100%コンプリート時に自動付与されるロールです。">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <label className="text-xs text-leaf-600 block">魚図鑑コンプリートロール</label>
            <div className="flex items-center gap-2">
              {text('fish_completion_role_name')}
              {color('fish_completion_role_color')}
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-xs text-leaf-600 block">虫図鑑コンプリートロール</label>
            <div className="flex items-center gap-2">
              {text('bug_completion_role_name')}
              {color('bug_completion_role_color')}
            </div>
          </div>
        </div>
      </Card>

      <Card title="🪙 生き物売却 (鯖内通貨)" description="/売却 コマンドでの重複生き物の売却額です（ManyBot の鯖内通貨で受け取ります）。">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="text-xs text-leaf-600 block mb-1">COMMON</label>
            {num('sell_price_common')}
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">UNCOMMON</label>
            {num('sell_price_uncommon')}
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">RARE</label>
            {num('sell_price_rare')}
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">SUPER RARE</label>
            {num('sell_price_super_rare')}
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">LEGENDARY</label>
            {num('sell_price_legendary')}
          </div>
        </div>
        <div className="mt-4 max-w-xs">
          <label className="text-xs text-leaf-600 block mb-1">色違い売却倍率</label>
          {num('sell_price_shiny_multiplier')}
        </div>
      </Card>

      <Card title="📸 ミッション報告" description="デイリーミッションの受注枠数と報告先です。">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-leaf-600 block mb-1">1日あたりのミッション受注枠数</label>
            {num('daily_mission_slot_count')}
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">ミッション報告先チャンネル</label>
            {channelSelect('mission_report_channel_id')}
          </div>
        </div>
      </Card>

      <div className="p-4 bg-white border border-leaf-200 rounded-xl flex items-center justify-between sticky bottom-4 shadow-lg">
        <p className="text-xs text-leaf-500">保存すると、Bot側に即座に設定が適用されます。</p>
        <button
          onClick={handleSave}
          disabled={loading || saving}
          className="bg-leaf-600 hover:bg-leaf-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          {saving ? '保存中...' : '保存する'}
        </button>
      </div>
    </div>
  );
}
