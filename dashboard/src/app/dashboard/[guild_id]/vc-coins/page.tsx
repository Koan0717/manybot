'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Save, AlertCircle, Coins, ListFilter, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import Select from 'react-select';
import { toast } from 'react-hot-toast';
import { useSyncStatus, SyncBadge } from '@/lib/useSyncStatus';

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
}

interface VCCoinsSettings {
  is_whitelist_mode: boolean;
  channels: string[];
  categories: string[];
  vc_coin_reward_interval?: number;
  vc_coin_reward_amount?: number;
}

export default function VCCoinsSettingsPage() {
  const params = useParams();
  const guildId = params.guild_id as string;
  
  const [settings, setSettings] = useState<VCCoinsSettings>({
    is_whitelist_mode: true,
    channels: [],
    categories: [],
    vc_coin_reward_interval: 10,
    vc_coin_reward_amount: 100
  });
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sync = useSyncStatus(guildId);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/settings`).then(res => res.ok ? res.json() : {}),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : [])
    ]).then(([settingsData, channelsData]: [any, any]) => {
      setSettings({
        is_whitelist_mode: settingsData.is_whitelist_mode ?? true,
        channels: settingsData.channels || [],
        categories: settingsData.categories || [],
        vc_coin_reward_interval: settingsData.vc_coin_reward_interval ?? 10,
        vc_coin_reward_amount: settingsData.vc_coin_reward_amount ?? 100
      });
      setDiscordChannels(channelsData);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setError('データの取得に失敗しました');
      setLoading(false);
    });
  }, [guildId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    sync.reset();
    try {
      const res = await fetch(`/api/guilds/${guildId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('保存に失敗しました');
      const data = await res.json();
      toast.success('設定を保存しました！');
      sync.startPolling(data.sync_request_id ?? null);
    } catch (err) {
      console.error(err);
      setError('設定の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const vcChannels = discordChannels.filter(c => c.type === 2);
  const categories = discordChannels.filter(c => c.type === 4);

  const customStyles = {
    control: (base: any) => ({
      ...base,
      backgroundColor: '#111827',
      borderColor: '#374151',
      color: '#fff',
    }),
    menu: (base: any) => ({
      ...base,
      backgroundColor: '#1f2937',
    }),
    option: (base: any, state: any) => ({
      ...base,
      backgroundColor: state.isFocused ? '#374151' : 'transparent',
      color: '#fff',
    }),
    multiValue: (base: any) => ({
      ...base,
      backgroundColor: '#4b5563',
    }),
    multiValueLabel: (base: any) => ({
      ...base,
      color: '#fff',
    }),
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64 text-indigo-400">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-600">
          VCコイン獲得制限
        </h1>
        <div className="flex items-center gap-3">
          <SyncBadge state={sync.state} botOnline={sync.botOnline} />
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center space-x-2 px-6 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white rounded-lg shadow-lg shadow-indigo-500/25 transition-all disabled:opacity-50"
          >
            <Save size={20} />
            <span>{saving ? '保存中...' : '設定を保存'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-lg flex items-center space-x-3">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-gray-800/50 border border-indigo-500/20 p-6 rounded-xl space-y-6">
          <div className="flex items-center space-x-3 text-xl font-semibold text-indigo-300 border-b border-indigo-500/20 pb-4">
            <ListFilter className="text-indigo-400" />
            <h2>制限モード</h2>
          </div>

          <div className="space-y-4">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="radio"
                checked={settings.is_whitelist_mode === true}
                onChange={() => setSettings(prev => ({ ...prev, is_whitelist_mode: true }))}
                className="form-radio h-5 w-5 text-indigo-500 bg-gray-900 border-gray-700"
              />
              <span className="text-gray-200 font-medium text-lg">ホワイトリスト形式</span>
            </label>
            <p className="text-sm text-gray-400 pl-8">
              指定されたチャンネル/カテゴリにいる場合のみVCコインを獲得できます。
            </p>

            <label className="flex items-center space-x-3 cursor-pointer pt-4">
              <input
                type="radio"
                checked={settings.is_whitelist_mode === false}
                onChange={() => setSettings(prev => ({ ...prev, is_whitelist_mode: false }))}
                className="form-radio h-5 w-5 text-indigo-500 bg-gray-900 border-gray-700"
              />
              <span className="text-gray-200 font-medium text-lg">ブラックリスト形式</span>
            </label>
            <p className="text-sm text-gray-400 pl-8">
              指定されたチャンネル/カテゴリにいる場合はVCコインを獲得できません。
            </p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-gray-800/50 border border-purple-500/20 p-6 rounded-xl space-y-6">
          <div className="flex items-center space-x-3 text-xl font-semibold text-purple-300 border-b border-purple-500/20 pb-4">
            <Coins className="text-purple-400" />
            <h2>対象の指定</h2>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">対象カテゴリ (複数選択可)</label>
              <Select
                isMulti
                options={categories.map(c => ({ value: c.id, label: c.name }))}
                value={settings.categories.map(id => {
                  const cat = categories.find(c => c.id === id);
                  return { value: id, label: cat ? cat.name : id };
                })}
                onChange={(selected) => setSettings(prev => ({ ...prev, categories: selected.map(s => s.value) }))}
                styles={customStyles}
                placeholder="カテゴリを選択..."
                noOptionsMessage={() => "カテゴリが見つかりません"}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">対象VCチャンネル (複数選択可)</label>
              <Select
                isMulti
                options={vcChannels.map(c => ({ value: c.id, label: c.name }))}
                value={settings.channels.map(id => {
                  const ch = vcChannels.find(c => c.id === id);
                  return { value: id, label: ch ? ch.name : id };
                })}
                onChange={(selected) => setSettings(prev => ({ ...prev, channels: selected.map(s => s.value) }))}
                styles={customStyles}
                placeholder="VCを選択..."
                noOptionsMessage={() => "VCが見つかりません"}
              />
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-gray-800/50 border border-green-500/20 p-6 rounded-xl space-y-6 md:col-span-2">
          <div className="flex items-center space-x-3 text-xl font-semibold text-green-300 border-b border-green-500/20 pb-4">
            <Clock className="text-green-400" />
            <h2>獲得量設定</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col space-y-2">
              <label className="text-sm font-medium text-gray-400">獲得間隔 (分)</label>
              <input
                type="number"
                min="1"
                value={settings.vc_coin_reward_interval}
                onChange={(e) => setSettings(prev => ({ ...prev, vc_coin_reward_interval: parseInt(e.target.value) || 1 }))}
                className="bg-[#111827] border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-green-500 transition-colors"
              />
            </div>

            <div className="flex flex-col space-y-2">
              <label className="text-sm font-medium text-gray-400">獲得量 (コイン)</label>
              <input
                type="number"
                min="0"
                value={settings.vc_coin_reward_amount}
                onChange={(e) => setSettings(prev => ({ ...prev, vc_coin_reward_amount: parseInt(e.target.value) || 0 }))}
                className="bg-[#111827] border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-green-500 transition-colors"
              />
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
