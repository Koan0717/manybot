'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Save, AlertCircle, Gift, ListFilter, Clock, Plus, Trash2, Hash } from 'lucide-react';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'react-hot-toast';
import { useSyncStatus, SyncBadge, SyncStatusCards } from '@/lib/useSyncStatus';
import ChannelSelect from '@/components/ChannelSelect';

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
}

type RewardType = 'coin' | 'none';

interface Reward {
  reward_type: RewardType;
  label: string;
  amount: number;
  weight: number;
}

interface VCFloatSettings {
  is_enabled: boolean;
  is_whitelist_mode: boolean;
  channels: string[];
  categories: string[];
  required_minutes: number;
  daily_limit: number;
  reset_on_leave: boolean;
  exclude_muted: boolean;
  exclude_deafened: boolean;
  rewards: Reward[];
}

const REWARD_TYPE_LABELS: Record<RewardType, string> = {
  coin: '通貨',
  none: 'ハズレ（何もなし）',
};

// ガチャ設定の円グラフと同じ色。ハズレは灰色
const COLORS = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#14b8a6', '#a3e635'];
const NONE_COLOR = '#71717a';

const newReward = (reward_type: RewardType): Reward => ({
  reward_type,
  label: reward_type === 'none' ? 'ハズレ' : '',
  amount: reward_type === 'coin' ? 100 : 0,
  weight: 10,
});

export default function VCFloatSettingsPage() {
  const params = useParams();
  const guildId = params.guild_id as string;

  const [settings, setSettings] = useState<VCFloatSettings>({
    is_enabled: false,
    is_whitelist_mode: true,
    channels: [],
    categories: [],
    required_minutes: 30,
    daily_limit: 1,
    reset_on_leave: false,
    exclude_muted: false,
    exclude_deafened: false,
    rewards: [],
  });
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[]>([]);
  const [currencyName, setCurrencyName] = useState('通貨');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sync = useSyncStatus(guildId);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/vc-float`).then(res => res.ok ? res.json() : {}),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/settings`).then(res => res.ok ? res.json() : {}).catch(() => ({})),
    ]).then(([data, channelsData, settingsData]: [any, any, any]) => {
      if (settingsData?.CURRENCY_NAME) setCurrencyName(String(settingsData.CURRENCY_NAME));
      setSettings({
        is_enabled: data.is_enabled ?? false,
        is_whitelist_mode: data.is_whitelist_mode ?? true,
        channels: data.channels || [],
        categories: data.categories || [],
        required_minutes: data.required_minutes ?? 30,
        daily_limit: data.daily_limit ?? 1,
        reset_on_leave: data.reset_on_leave ?? false,
        exclude_muted: data.exclude_muted ?? false,
        exclude_deafened: data.exclude_deafened ?? false,
        rewards: Array.isArray(data.rewards) ? data.rewards : [],
      });
      setDiscordChannels(Array.isArray(channelsData) ? channelsData : []);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setError('データの取得に失敗しました');
      setLoading(false);
    });
  }, [guildId]);

  const totalWeight = settings.rewards.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const percentOf = (w: number) => (totalWeight > 0 ? ((Number(w) || 0) / totalWeight) * 100 : 0);
  // 報酬ごとの色（一覧の印と円グラフで同じ色にする）
  const colorOf = (index: number) => {
    if (settings.rewards[index]?.reward_type === 'none') return NONE_COLOR;
    const n = settings.rewards.slice(0, index).filter(r => r.reward_type !== 'none').length;
    return COLORS[n % COLORS.length];
  };
  const rewardName = (r: Reward) =>
    r.label.trim() || (r.reward_type === 'coin' ? `${(Number(r.amount) || 0).toLocaleString()} ${currencyName}` : 'ハズレ');
  const pieData = settings.rewards
    .map((r, i) => ({ name: rewardName(r), value: percentOf(r.weight), color: colorOf(i) }))
    .filter(d => d.value > 0);

  const handleSave = async () => {
    if (settings.is_enabled && totalWeight <= 0) {
      toast.error('報酬を1つ以上、割合を0より大きく設定してください');
      return;
    }
    setSaving(true);
    setError(null);
    sync.reset();
    try {
      const res = await fetch(`/api/guilds/${guildId}/vc-float`, {
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
      sync.startPolling(data.sync_request_id ?? null);
    } catch (err: any) {
      const msg = err?.message || String(err);
      setError(`設定の保存に失敗しました: ${msg}`);
      toast.error(`保存に失敗しました: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const updateReward = (index: number, patch: Partial<Reward>) => {
    setSettings(prev => {
      const rewards = [...prev.rewards];
      rewards[index] = { ...rewards[index], ...patch };
      return { ...prev, rewards };
    });
  };
  const addReward = (type: RewardType) => setSettings(prev => ({ ...prev, rewards: [...prev.rewards, newReward(type)] }));
  const removeReward = (index: number) => setSettings(prev => ({ ...prev, rewards: prev.rewards.filter((_, i) => i !== index) }));

  const vcChannels = discordChannels.filter(c => c.type === 2 || c.type === 13);
  const categories = discordChannels.filter(c => c.type === 4);

  if (loading) {
    return <div className="flex justify-center items-center h-64 text-purple-400">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="flex justify-between items-center bg-gray-900/80 p-6 rounded-2xl border border-purple-500/20 backdrop-blur-sm sticky top-0 z-10 shadow-2xl">
        <div>
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 flex items-center gap-3">
            <Gift className="text-purple-500" size={32} />
            VC浮上報酬設定
          </h1>
          <p className="text-gray-400 mt-2 text-sm">VCに一定時間浮上したメンバーに、ガチャ形式で報酬を抽選してDMで通知します。</p>
        </div>
        <div className="flex items-center gap-3">
          <SyncBadge state={sync.state} botOnline={sync.botOnline} />
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center space-x-2 px-8 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl shadow-[0_0_15px_rgba(139,92,246,0.5)] transition-all disabled:opacity-50 font-bold"
          >
            <Save size={20} />
            <span>{saving ? '保存中...' : '設定を保存'}</span>
          </button>
        </div>
      </div>

      <SyncStatusCards sync={sync} />

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl flex items-center space-x-3">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Main Switch */}
      <div className="bg-gray-800/50 border border-purple-500/20 p-6 rounded-xl flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">VC浮上報酬機能</h2>
          <p className="text-gray-400 text-sm mt-1">有効にすると、対象VCでの浮上時間が設定時間に達するたびに報酬ガチャが引かれ、結果がDMと通貨ログに送られます。</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={settings.is_enabled}
            onChange={(e) => setSettings(prev => ({ ...prev, is_enabled: e.target.checked }))}
            className="sr-only peer"
          />
          <div className="w-14 h-7 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-purple-600"></div>
        </label>
      </div>

      <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 transition-opacity duration-200 ${settings.is_enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>

        {/* Whitelist / Blacklist Mode */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-gray-800/50 border border-purple-500/20 p-6 rounded-xl space-y-6">
          <div className="flex items-center space-x-3 text-xl font-semibold text-purple-300 border-b border-purple-500/20 pb-4">
            <ListFilter className="text-purple-400" />
            <h2>対象モード</h2>
          </div>
          <div className="space-y-4">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="radio"
                name="mode"
                checked={settings.is_whitelist_mode === true}
                onChange={() => setSettings(prev => ({ ...prev, is_whitelist_mode: true }))}
                className="form-radio h-5 w-5 text-purple-600 bg-gray-900 border-gray-700"
              />
              <span className="text-gray-200 font-medium text-lg">ホワイトリスト形式</span>
            </label>
            <p className="text-sm text-gray-400 pl-8">
              指定したチャンネル/カテゴリにいる時間だけカウントします。（指定なしの場合は全VCが対象）
            </p>
            <div className="border-t border-gray-700/50 my-4" />
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="radio"
                name="mode"
                checked={settings.is_whitelist_mode === false}
                onChange={() => setSettings(prev => ({ ...prev, is_whitelist_mode: false }))}
                className="form-radio h-5 w-5 text-indigo-500 bg-gray-900 border-gray-700"
              />
              <span className="text-gray-200 font-medium text-lg">ブラックリスト形式</span>
            </label>
            <p className="text-sm text-gray-400 pl-8">
              指定したチャンネル/カテゴリにいる時間はカウントしません。
            </p>
            <p className="text-xs text-gray-500">※ サーバーのAFKチャンネルは常に対象外です。</p>
          </div>
        </motion.div>

        {/* Target selection */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-gray-800/50 border border-purple-500/20 p-6 rounded-xl space-y-6">
          <div className="flex items-center space-x-3 text-xl font-semibold text-purple-300 border-b border-purple-500/20 pb-4">
            <Hash className="text-purple-400" />
            <h2>{settings.is_whitelist_mode ? '対象の指定' : '除外の指定'}</h2>
          </div>
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">カテゴリ (複数選択可)</label>
              <ChannelSelect
                label="カテゴリ"
                placeholder="カテゴリを選択..."
                channels={categories}
                value={settings.categories}
                onChange={(ids: any) => setSettings(prev => ({ ...prev, categories: ids }))}
                multiple={true}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">VCチャンネル (複数選択可)</label>
              <ChannelSelect
                label="VCチャンネル"
                placeholder="VCを選択..."
                channels={vcChannels}
                value={settings.channels}
                onChange={(ids: any) => setSettings(prev => ({ ...prev, channels: ids }))}
                multiple={true}
              />
            </div>
          </div>
        </motion.div>

        {/* Time & limit */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-gray-800/50 border border-green-500/20 p-6 rounded-xl space-y-6 md:col-span-2">
          <div className="flex items-center space-x-3 text-xl font-semibold text-green-300 border-b border-green-500/20 pb-4">
            <Clock className="text-green-400" />
            <h2>浮上時間・回数</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col space-y-2">
              <label className="text-sm font-medium text-gray-400">浮上時間 (分)</label>
              <input
                type="number"
                min={1}
                value={settings.required_minutes}
                onChange={(e) => setSettings(prev => ({ ...prev, required_minutes: parseInt(e.target.value) || 1 }))}
                className="bg-[#111827] border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-green-500 transition-colors"
              />
              <p className="text-xs text-gray-500">この時間VCに浮上するごとに報酬ガチャを1回引きます。</p>
            </div>
            <div className="flex flex-col space-y-2">
              <label className="text-sm font-medium text-gray-400">1日の上限回数</label>
              <input
                type="number"
                min={0}
                value={settings.daily_limit}
                onChange={(e) => setSettings(prev => ({ ...prev, daily_limit: Math.max(0, parseInt(e.target.value) || 0) }))}
                className="bg-[#111827] border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-green-500 transition-colors"
              />
              <p className="text-xs text-gray-500">0で無制限。日本時間の0時にリセットされます。</p>
            </div>
          </div>
          <div className="flex items-center justify-between bg-gray-900/40 border border-gray-700/60 rounded-lg p-4">
            <div className="pr-4">
              <h3 className="text-sm font-semibold text-gray-200">VCから退出したら進捗をリセットする</h3>
              <p className="text-xs text-gray-400 mt-1">
                OFF: 浮上時間は退出しても持ち越され、累計で達成になります。<br />
                ON: 連続して浮上した時間のみカウントします（途中で退出すると0からやり直し）。
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={settings.reset_on_leave}
                onChange={(e) => setSettings(prev => ({ ...prev, reset_on_leave: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-12 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
            </label>
          </div>
          <div className="flex items-center justify-between bg-gray-900/40 border border-gray-700/60 rounded-lg p-4">
            <div className="pr-4">
              <h3 className="text-sm font-semibold text-gray-200">マイクミュート中はカウントしない</h3>
              <p className="text-xs text-gray-400 mt-1">ONにすると、マイクをミュート（自分・サーバーどちらでも）している間は浮上時間に含めません。</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={settings.exclude_muted}
                onChange={(e) => setSettings(prev => ({ ...prev, exclude_muted: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-12 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
            </label>
          </div>
          <div className="flex items-center justify-between bg-gray-900/40 border border-gray-700/60 rounded-lg p-4">
            <div className="pr-4">
              <h3 className="text-sm font-semibold text-gray-200">スピーカーミュート中はカウントしない</h3>
              <p className="text-xs text-gray-400 mt-1">ONにすると、スピーカーミュート（自分・サーバーどちらでも）している間は浮上時間に含めません。</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={settings.exclude_deafened}
                onChange={(e) => setSettings(prev => ({ ...prev, exclude_deafened: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-12 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
            </label>
          </div>
          <p className="text-xs text-gray-500">※ スピーカーミュートするとマイクも自動でミュートになりますが、この場合は「スピーカーミュート」として扱います（マイクミュートの設定だけONなら、スピーカーミュート中はカウントされます）。</p>
        </motion.div>

        {/* Rewards */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-gray-800/50 border border-yellow-500/20 p-6 rounded-xl space-y-6 md:col-span-2">
          <div className="flex items-center justify-between border-b border-yellow-500/20 pb-4">
            <div className="flex items-center space-x-3 text-xl font-semibold text-yellow-300">
              <Gift className="text-yellow-400" />
              <h2>報酬設定（ガチャ）</h2>
            </div>
            <span className="text-xs text-gray-400">割合の合計: {totalWeight}</span>
          </div>
          <p className="text-sm text-gray-400 -mt-2">
            「割合」は重みです。各報酬の当選確率は「その報酬の割合 ÷ 割合の合計」で計算されます（合計を100にすると、そのまま%になります）。
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3">
            {settings.rewards.length === 0 && (
              <div className="text-center text-gray-500 py-8 border border-dashed border-gray-700 rounded-xl text-sm">
                報酬がありません。下のボタンから追加してください。
              </div>
            )}

            {settings.rewards.map((reward, index) => (
              <div key={index} className="bg-gray-900/50 border border-gray-700/60 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colorOf(index) }} />
                    報酬 #{index + 1}
                    <span className="text-yellow-300 font-bold ml-2">{percentOf(reward.weight).toFixed(1)}%</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeReward(index)}
                    className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                    title="この報酬を削除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-gray-400">種類</label>
                    <select
                      value={reward.reward_type}
                      onChange={(e) => {
                        const t = e.target.value as RewardType;
                        updateReward(index, { reward_type: t, amount: t === 'coin' ? (reward.amount || 100) : 0 });
                      }}
                      className="w-full bg-[#111827] border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-yellow-500"
                    >
                      {(Object.keys(REWARD_TYPE_LABELS) as RewardType[]).map(t => (
                        <option key={t} value={t}>{REWARD_TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-gray-400">表示名（任意）</label>
                    <input
                      type="text"
                      maxLength={100}
                      value={reward.label}
                      placeholder={reward.reward_type === 'coin' ? '例: 大当たり' : '例: ハズレ'}
                      onChange={(e) => updateReward(index, { label: e.target.value })}
                      className="w-full bg-[#111827] border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-yellow-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-gray-400">金額</label>
                    <input
                      type="number"
                      min={0}
                      disabled={reward.reward_type !== 'coin'}
                      value={reward.reward_type === 'coin' ? reward.amount : ''}
                      placeholder="—"
                      onChange={(e) => updateReward(index, { amount: Math.max(0, parseInt(e.target.value) || 0) })}
                      className="w-full bg-[#111827] border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-yellow-500 disabled:opacity-40"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-gray-400">割合</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={reward.weight}
                      onChange={(e) => updateReward(index, { weight: Math.max(0, parseFloat(e.target.value) || 0) })}
                      className="w-full bg-[#111827] border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-yellow-500"
                    />
                  </div>
                </div>
              </div>
            ))}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => addReward('coin')}
                className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white text-sm font-bold rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                通貨報酬を追加
              </button>
              <button
                type="button"
                onClick={() => addReward('none')}
                className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white text-sm font-bold rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                ハズレを追加
              </button>
            </div>
          </div>

          {/* 円グラフ */}
          <div className="lg:col-span-1">
            <div className="bg-gray-900/60 border border-gray-700/60 rounded-xl p-4 lg:sticky lg:top-28">
              <h3 className="text-center text-sm font-bold text-yellow-300 mb-1">現在の当選確率</h3>
              <p className="text-center text-[11px] text-gray-500 mb-2">割合が0の報酬はグラフに出ません</p>
              {pieData.length > 0 ? (
                <>
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={95}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="none"
                        animationDuration={800}
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={`cell-${i}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        formatter={(value: any) => [`${Number(value).toFixed(1)}%`, '確率']}
                        contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', color: '#fff' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1 mt-2">
                  {pieData.map((d, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 min-w-0 text-gray-300">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="truncate">{d.name}</span>
                      </span>
                      <span className="text-yellow-300 font-bold flex-shrink-0">{d.value.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
                </>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-gray-600 text-sm">報酬を追加すると表示されます</div>
              )}
            </div>
          </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
