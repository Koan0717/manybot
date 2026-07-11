'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Save, AlertCircle, Plus, Trash2, Award, Coins, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface DiscordRole {
  id: string;
  name: string;
  color: number;
}

interface RewardRule {
  level: number;
  role_id: string;
  coins: number;
}

export default function LevelRewardsPage() {
  const params = useParams();
  const guildId = params.guild_id as string;
  
  const [isEnabled, setIsEnabled] = useState(false);
  const [tcRewards, setTcRewards] = useState<RewardRule[]>([]);
  const [vcRewards, setVcRewards] = useState<RewardRule[]>([]);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/roles`).then(r => r.json()),
      fetch(`/api/guilds/${guildId}/level-rewards`).then(r => r.json())
    ]).then(([rolesData, rewardsData]) => {
      setRoles(rolesData || []);
      
      if (!rewardsData.error) {
        setIsEnabled(rewardsData.is_enabled || false);
        
        // Merge role and coin rewards
        const mergedTC = new Map<number, RewardRule>();
        const mergedVC = new Map<number, RewardRule>();
        
        const addMerged = (map: Map<number, RewardRule>, level: number, data: Partial<RewardRule>) => {
          if (!map.has(level)) map.set(level, { level, role_id: '', coins: 0 });
          const current = map.get(level)!;
          if (data.role_id) current.role_id = data.role_id;
          if (data.coins !== undefined) current.coins = data.coins;
        };

        (rewardsData.role_rewards || []).forEach((r: any) => {
          if (r.level_type === 'tc') addMerged(mergedTC, r.level, { role_id: r.role_id });
          if (r.level_type === 'vc') addMerged(mergedVC, r.level, { role_id: r.role_id });
        });
        
        (rewardsData.coin_rewards || []).forEach((c: any) => {
          if (c.level_type === 'tc') addMerged(mergedTC, c.level, { coins: c.coins });
          if (c.level_type === 'vc') addMerged(mergedVC, c.level, { coins: c.coins });
        });

        setTcRewards(Array.from(mergedTC.values()).sort((a, b) => a.level - b.level));
        setVcRewards(Array.from(mergedVC.values()).sort((a, b) => a.level - b.level));
      }
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
    
    // Flatten merged arrays back into separate role and coin arrays
    const finalRoleRewards: any[] = [];
    const finalCoinRewards: any[] = [];

    const processRewards = (rewards: RewardRule[], type: string) => {
      rewards.forEach(r => {
        if (r.role_id) finalRoleRewards.push({ level_type: type, level: r.level, role_id: r.role_id });
        if (r.coins > 0) finalCoinRewards.push({ level_type: type, level: r.level, coins: r.coins });
      });
    };

    processRewards(tcRewards, 'tc');
    processRewards(vcRewards, 'vc');

    try {
      const res = await fetch(`/api/guilds/${guildId}/level-rewards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_enabled: isEnabled,
          role_rewards: finalRoleRewards,
          coin_rewards: finalCoinRewards
        }),
      });
      if (!res.ok) throw new Error('保存に失敗しました');
      alert('設定を保存しました！');
    } catch (err) {
      console.error(err);
      setError('設定の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const addReward = (type: 'tc' | 'vc') => {
    const updater = type === 'tc' ? setTcRewards : setVcRewards;
    updater(prev => {
      const highest = prev.length > 0 ? Math.max(...prev.map(r => r.level)) : 0;
      return [...prev, { level: highest + 5, role_id: '', coins: 0 }];
    });
  };

  const updateReward = (type: 'tc' | 'vc', index: number, field: keyof RewardRule, value: any) => {
    const updater = type === 'tc' ? setTcRewards : setVcRewards;
    updater(prev => {
      const copy = [...prev];
      const isNumberField = field === 'level' || field === 'coins';
      copy[index] = { ...copy[index], [field]: isNumberField ? Number(value) || 0 : value };
      return copy;
    });
  };

  const removeReward = (type: 'tc' | 'vc', index: number) => {
    const updater = type === 'tc' ? setTcRewards : setVcRewards;
    updater(prev => prev.filter((_, i) => i !== index));
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64 text-purple-400">Loading...</div>;
  }

  const renderRewardSection = (title: string, type: 'tc' | 'vc', rewards: RewardRule[]) => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-gray-800/50 border border-purple-500/20 p-6 rounded-xl space-y-6">
      <div className="flex justify-between items-center border-b border-purple-500/20 pb-4">
        <div className="flex items-center space-x-3 text-xl font-semibold text-purple-300">
          <Award className="text-yellow-400" />
          <h2>{title}</h2>
        </div>
        <button
          onClick={() => addReward(type)}
          className="flex items-center space-x-2 px-4 py-2 bg-purple-500/20 hover:bg-purple-500/40 text-purple-300 rounded-lg transition-all text-sm"
        >
          <Plus size={16} />
          <span>ルール追加</span>
        </button>
      </div>

      <div className="space-y-4">
        <AnimatePresence>
          {rewards.map((reward, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-col md:flex-row gap-4 p-4 bg-gray-900/50 rounded-lg border border-gray-700/50"
            >
              <div className="flex-1 space-y-2">
                <label className="text-xs text-gray-400">到達レベル</label>
                <div className="flex items-center space-x-2">
                  <span className="text-purple-400 font-bold">Lv.</span>
                  <input
                    type="number"
                    min="1"
                    value={reward.level}
                    onChange={(e) => updateReward(type, i, 'level', Number(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div className="flex-[2] space-y-2">
                <label className="text-xs text-gray-400">付与ロール (任意)</label>
                <div className="flex items-center space-x-2">
                  <Shield size={16} className="text-blue-400" />
                  <select
                    value={reward.role_id}
                    onChange={(e) => updateReward(type, i, 'role_id', e.target.value)}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="">-- ロールなし --</option>
                    {roles.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex-1 space-y-2">
                <label className="text-xs text-gray-400">報酬コイン (任意)</label>
                <div className="flex items-center space-x-2">
                  <Coins size={16} className="text-yellow-400" />
                  <input
                    type="number"
                    min="0"
                    value={reward.coins}
                    onChange={(e) => updateReward(type, i, 'coins', Number(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div className="flex items-end pb-1">
                <button
                  onClick={() => removeReward(type, i)}
                  className="p-2 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-lg transition-all"
                >
                  <Trash2 size={20} />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        
        {rewards.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            報酬ルールが設定されていません。<br/>「ルール追加」ボタンから追加してください。
          </div>
        )}
      </div>
    </motion.div>
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-amber-600">
          レベル到達報酬設定
        </h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center space-x-2 px-6 py-2 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white rounded-lg shadow-lg shadow-purple-500/25 transition-all disabled:opacity-50"
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

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-gradient-to-r from-gray-800 to-gray-900 border border-gray-700 p-6 rounded-xl flex items-center justify-between shadow-xl">
        <div>
          <h2 className="text-xl font-bold text-white mb-2">レベル報酬システムの有効化</h2>
          <p className="text-gray-400 text-sm">
            この機能をONにすると、指定したレベルに到達したユーザーに対して自動的にロールの付与やコインの配布が行われます。<br/>
            また、新しくレベル報酬ロールを獲得した際、古い報酬ロールは自動で剥奪されます。
          </p>
        </div>
        <button
          onClick={() => setIsEnabled(!isEnabled)}
          className={`${
            isEnabled ? 'bg-purple-500' : 'bg-gray-600'
          } relative inline-flex h-8 w-16 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900`}
        >
          <span className="sr-only">Enable rewards</span>
          <span
            className={`${
              isEnabled ? 'translate-x-9' : 'translate-x-1'
            } inline-block h-6 w-6 transform rounded-full bg-white transition-transform`}
          />
        </button>
      </motion.div>

      {isEnabled && (
        <div className="grid grid-cols-1 gap-6">
          {renderRewardSection('テキストチャット (TC) 報酬', 'tc', tcRewards)}
          {renderRewardSection('ボイスチャット (VC) 報酬', 'vc', vcRewards)}
        </div>
      )}
    </div>
  );
}
