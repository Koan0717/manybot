'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Save, AlertCircle, Coins, ListFilter, Clock, Users, Plus, Trash2, Layers } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { useSyncStatus, SyncBadge, SyncStatusCards } from '@/lib/useSyncStatus';
import ChannelSelect from '@/components/ChannelSelect';
import RoleSelect from '@/components/RoleSelect';

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
}

interface DiscordRole {
  id: string;
  name: string;
  color: number;
}

interface RoleRewardRule {
  role_id: string;
  reward_amount: number;
  reward_interval: number;
  is_whitelist_mode: boolean;
  channels: string[];
  categories: string[];
}

interface VCCoinsSettings {
  is_enabled: boolean;
  is_whitelist_mode: boolean;
  channels: string[];
  categories: string[];
  vc_coin_reward_interval: number;
  vc_coin_reward_amount: number;
  use_common_reward: boolean;
  role_scope_per_rule: boolean;
  stack_multiple_roles: boolean;
  role_rewards: RoleRewardRule[];
}

const emptyRoleRule = (): RoleRewardRule => ({
  role_id: '',
  reward_amount: 100,
  reward_interval: 10,
  is_whitelist_mode: true,
  channels: [],
  categories: [],
});

export default function VCCoinsSettingsPage() {
  const params = useParams();
  const guildId = params.guild_id as string;

  const [settings, setSettings] = useState<VCCoinsSettings>({
    is_enabled: false,
    is_whitelist_mode: true,
    channels: [],
    categories: [],
    vc_coin_reward_interval: 10,
    vc_coin_reward_amount: 100,
    use_common_reward: true,
    role_scope_per_rule: false,
    stack_multiple_roles: false,
    role_rewards: [],
  });
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[]>([]);
  const [discordRoles, setDiscordRoles] = useState<DiscordRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sync = useSyncStatus(guildId);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/vc-coins`).then(res => res.ok ? res.json() : {}),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/roles`).then(res => res.ok ? res.json() : []),
    ]).then(([settingsData, channelsData, rolesData]: [any, any, any]) => {
      setSettings({
        is_enabled: settingsData.is_enabled ?? false,
        is_whitelist_mode: settingsData.is_whitelist_mode ?? true,
        channels: settingsData.channels || [],
        categories: settingsData.categories || [],
        vc_coin_reward_interval: settingsData.vc_coin_reward_interval ?? 10,
        vc_coin_reward_amount: settingsData.vc_coin_reward_amount ?? 100,
        use_common_reward: settingsData.use_common_reward ?? true,
        role_scope_per_rule: settingsData.role_scope_per_rule ?? false,
        stack_multiple_roles: settingsData.stack_multiple_roles ?? false,
        role_rewards: Array.isArray(settingsData.role_rewards) ? settingsData.role_rewards : [],
      });
      setDiscordChannels(channelsData);
      setDiscordRoles(Array.isArray(rolesData) ? rolesData : []);
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
      const res = await fetch(`/api/guilds/${guildId}/vc-coins`, {
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
      console.error(err);
      const msg = err?.message || String(err);
      setError(`設定の保存に失敗しました: ${msg}`);
      toast.error(`保存に失敗しました: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const vcChannels = discordChannels.filter(c => c.type === 2);
  const categories = discordChannels.filter(c => c.type === 4);

  const updateRoleRule = (index: number, patch: Partial<RoleRewardRule>) => {
    setSettings(prev => {
      const rules = [...prev.role_rewards];
      rules[index] = { ...rules[index], ...patch };
      return { ...prev, role_rewards: rules };
    });
  };

  const addRoleRule = () => {
    setSettings(prev => ({ ...prev, role_rewards: [...prev.role_rewards, emptyRoleRule()] }));
  };

  const removeRoleRule = (index: number) => {
    setSettings(prev => ({ ...prev, role_rewards: prev.role_rewards.filter((_, i) => i !== index) }));
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64 text-purple-400">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="flex justify-between items-center bg-gray-900/80 p-6 rounded-2xl border border-purple-500/20 backdrop-blur-sm sticky top-0 z-10 shadow-2xl">
        <div>
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 flex items-center gap-3">
            <Coins className="text-purple-500" size={32} />
            VCコイン獲得設定
          </h1>
          <p className="text-gray-400 mt-2 text-sm">ボイスチャンネル滞在によるコイン報酬のルールを設定します。</p>
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
          <h2 className="text-xl font-semibold text-white">VCコイン獲得機能</h2>
          <p className="text-gray-400 text-sm mt-1">有効にすると、ユーザーがVCに参加している時間に応じて定期的にコインを付与します。</p>
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

      {/* Configuration Grid */}
      <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 transition-opacity duration-200 ${settings.is_enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>

        {/* Whitelist / Blacklist Mode */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-gray-800/50 border border-purple-500/20 p-6 rounded-xl space-y-6">
          <div className="flex items-center space-x-3 text-xl font-semibold text-purple-300 border-b border-purple-500/20 pb-4">
            <ListFilter className="text-purple-400" />
            <h2>制限モード</h2>
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
              指定されたチャンネル/カテゴリにいる場合のみVCコインを獲得できます。（指定なしの場合は全VCが対象）
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
              指定されたチャンネル/カテゴリにいる場合はVCコインを獲得できません。
            </p>
          </div>
        </motion.div>

        {/* Target selection */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-gray-800/50 border border-purple-500/20 p-6 rounded-xl space-y-6">
          <div className="flex items-center space-x-3 text-xl font-semibold text-purple-300 border-b border-purple-500/20 pb-4">
            <Coins className="text-purple-400" />
            <h2>対象の指定</h2>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">対象カテゴリ (複数選択可)</label>
              <ChannelSelect
                label="対象カテゴリ"
                placeholder="カテゴリを選択..."
                channels={categories}
                value={settings.categories}
                onChange={(ids: any) => setSettings(prev => ({ ...prev, categories: ids }))}
                multiple={true}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">対象VCチャンネル (複数選択可)</label>
              <ChannelSelect
                label="対象VCチャンネル"
                placeholder="VCを選択..."
                channels={vcChannels}
                value={settings.channels}
                onChange={(ids: any) => setSettings(prev => ({ ...prev, channels: ids }))}
                multiple={true}
              />
            </div>
          </div>
        </motion.div>

        {/* Common reward toggle + amount settings */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-gray-800/50 border border-green-500/20 p-6 rounded-xl space-y-6 md:col-span-2">
          <div className="flex items-center justify-between border-b border-green-500/20 pb-4">
            <div className="flex items-center space-x-3 text-xl font-semibold text-green-300">
              <Clock className="text-green-400" />
              <h2>獲得量設定</h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-300 font-medium">全員共通の設定を使う</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.use_common_reward}
                  onChange={(e) => setSettings(prev => ({ ...prev, use_common_reward: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-12 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
              </label>
            </div>
          </div>

          <p className="text-sm text-gray-400 -mt-2">
            {settings.use_common_reward
              ? 'ONの間は、下記の共通設定が全ユーザーに適用されます。役職ごとに獲得量を分けたい場合はOFFにしてください。'
              : 'OFFの間は、下記の「役職ごとの獲得設定」が優先されます。どの役職にも該当しないユーザーには、下記の共通設定がそのまま適用されます。'}
          </p>

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

        {/* Role-based reward settings */}
        {!settings.use_common_reward && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-gray-800/50 border border-blue-500/20 p-6 rounded-xl space-y-6 md:col-span-2">
            <div className="flex items-center space-x-3 text-xl font-semibold text-blue-300 border-b border-blue-500/20 pb-4">
              <Users className="text-blue-400" />
              <h2>役職ごとの獲得設定</h2>
            </div>

            {/* Toggle: per-rule channel/category scope */}
            <div className="flex items-center justify-between bg-gray-900/40 border border-gray-700/60 rounded-lg p-4">
              <div className="pr-4">
                <h3 className="text-sm font-semibold text-gray-200">役職ごとに対象カテゴリー/VCも個別指定する</h3>
                <p className="text-xs text-gray-400 mt-1">
                  OFF: すべての役職ルールが、上の「対象の指定」で選んだカテゴリー/VCで共通に適用されます。<br />
                  ON: 役職ルールごとに、その役職が対象になるカテゴリー/VCを個別に選べます（「この役職の人が、このVCに入ったらこの金額」という設定が可能）。
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  checked={settings.role_scope_per_rule}
                  onChange={(e) => setSettings(prev => ({ ...prev, role_scope_per_rule: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-12 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Toggle: stacking */}
            <div className="flex items-center justify-between bg-gray-900/40 border border-gray-700/60 rounded-lg p-4">
              <div className="pr-4 flex items-start gap-2">
                <Layers className="text-gray-400 mt-0.5 flex-shrink-0" size={16} />
                <div>
                  <h3 className="text-sm font-semibold text-gray-200">複数の役職に該当する場合は金額を合算する</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    OFF: 複数の対象役職を持つユーザーには、最も獲得量（コイン/分換算）が高いルール1つだけが適用されます。<br />
                    ON: 該当する全ルールの獲得量を合算して付与します（役職を多く持つほど多くのコインを獲得できます）。
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  checked={settings.stack_multiple_roles}
                  onChange={(e) => setSettings(prev => ({ ...prev, stack_multiple_roles: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-12 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Rule list */}
            <div className="space-y-4">
              {settings.role_rewards.length === 0 && (
                <div className="text-center text-gray-500 py-8 border border-dashed border-gray-700 rounded-xl text-sm">
                  役職ごとの獲得ルールがありません。「役職ルールを追加」から追加してください。
                </div>
              )}

              {settings.role_rewards.map((rule, index) => (
                <div key={index} className="bg-gray-900/50 border border-gray-700/60 rounded-xl p-4 space-y-4">
                  <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
                    <div className="flex-1 min-w-0 space-y-1">
                      <label className="block text-xs font-semibold text-gray-400">対象役職</label>
                      <RoleSelect
                        label="対象役職"
                        placeholder="ロールを選択..."
                        value={rule.role_id}
                        onChange={(val: any) => updateRoleRule(index, { role_id: val || '' })}
                        roles={discordRoles}
                        multiple={false}
                      />
                    </div>

                    <div className="w-full sm:w-32 space-y-1">
                      <label className="block text-xs font-semibold text-gray-400">獲得間隔 (分)</label>
                      <input
                        type="number"
                        min={1}
                        value={rule.reward_interval}
                        onChange={(e) => updateRoleRule(index, { reward_interval: parseInt(e.target.value) || 1 })}
                        className="w-full bg-[#111827] border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>

                    <div className="w-full sm:w-32 space-y-1">
                      <label className="block text-xs font-semibold text-gray-400">獲得量 (コイン)</label>
                      <input
                        type="number"
                        min={0}
                        value={rule.reward_amount}
                        onChange={(e) => updateRoleRule(index, { reward_amount: parseInt(e.target.value) || 0 })}
                        className="w-full bg-[#111827] border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => removeRoleRule(index)}
                      className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors flex-shrink-0"
                      title="このルールを削除"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>

                  {settings.role_scope_per_rule && (
                    <div className="border-t border-gray-700/60 pt-4 space-y-4">
                      <div className="flex items-center gap-6">
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="radio"
                            name={`rule-mode-${index}`}
                            checked={rule.is_whitelist_mode === true}
                            onChange={() => updateRoleRule(index, { is_whitelist_mode: true })}
                            className="form-radio h-4 w-4 text-blue-500 bg-gray-900 border-gray-700"
                          />
                          <span className="text-sm text-gray-300">ホワイトリスト（指定した場所のみ対象）</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="radio"
                            name={`rule-mode-${index}`}
                            checked={rule.is_whitelist_mode === false}
                            onChange={() => updateRoleRule(index, { is_whitelist_mode: false })}
                            className="form-radio h-4 w-4 text-blue-500 bg-gray-900 border-gray-700"
                          />
                          <span className="text-sm text-gray-300">ブラックリスト（指定した場所以外が対象）</span>
                        </label>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-1.5">対象カテゴリ</label>
                          <ChannelSelect
                            label="対象カテゴリ"
                            placeholder="カテゴリを選択..."
                            channels={categories}
                            value={rule.categories}
                            onChange={(ids: any) => updateRoleRule(index, { categories: ids })}
                            multiple={true}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-1.5">対象VCチャンネル</label>
                          <ChannelSelect
                            label="対象VCチャンネル"
                            placeholder="VCを選択..."
                            channels={vcChannels}
                            value={rule.channels}
                            onChange={(ids: any) => updateRoleRule(index, { channels: ids })}
                            multiple={true}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={addRoleRule}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                役職ルールを追加
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
