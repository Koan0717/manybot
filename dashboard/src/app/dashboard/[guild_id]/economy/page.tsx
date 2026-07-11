'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Save, AlertCircle, Coins, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

interface EconomySettings {
  CURRENCY_NAME: string;
  INITIAL_COINS: number;
  MSG_COOLDOWN: number;
  TC_XP_REWARD: number;
  TC_XP_COOLDOWN: number;
  VC_XP_PER_MIN: number;
}

export default function EconomySettingsPage() {
  const params = useParams();
  const guildId = params.guild_id as string;
  
  const [settings, setSettings] = useState<EconomySettings>({
    CURRENCY_NAME: 'Rune',
    INITIAL_COINS: 30000,
    MSG_COOLDOWN: 60,
    TC_XP_REWARD: 10,
    TC_XP_COOLDOWN: 10,
    VC_XP_PER_MIN: 15,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, [guildId]);

  const fetchSettings = async () => {
    try {
      const res = await fetch(`/api/guilds/${guildId}/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings(prev => ({ ...prev, ...data }));
      }
    } catch (err) {
      console.error(err);
      setError('設定の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            CURRENCY_NAME: settings.CURRENCY_NAME,
            INITIAL_COINS: Number(settings.INITIAL_COINS),
            MSG_COOLDOWN: Number(settings.MSG_COOLDOWN),
            TC_XP_REWARD: Number(settings.TC_XP_REWARD),
            TC_XP_COOLDOWN: Number(settings.TC_XP_COOLDOWN),
            VC_XP_PER_MIN: Number(settings.VC_XP_PER_MIN),
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: type === 'number' ? (value === '' ? 0 : Number(value)) : value
    }));
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64 text-purple-400">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-amber-600">
          経済・レベリング設定
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-gray-800/50 border border-purple-500/20 p-6 rounded-xl space-y-6">
          <div className="flex items-center space-x-3 text-xl font-semibold text-purple-300 border-b border-purple-500/20 pb-4">
            <Coins className="text-yellow-400" />
            <h2>経済・通貨システム</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">通貨名</label>
              <input
                type="text"
                name="CURRENCY_NAME"
                value={settings.CURRENCY_NAME}
                onChange={handleChange}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all"
                placeholder="例: Rune, コイン, ゴールド"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">新規メンバーの初期コイン配布数</label>
              <input
                type="number"
                name="INITIAL_COINS"
                value={settings.INITIAL_COINS}
                onChange={handleChange}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all"
              />
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-gray-800/50 border border-pink-500/20 p-6 rounded-xl space-y-6">
          <div className="flex items-center space-x-3 text-xl font-semibold text-pink-300 border-b border-pink-500/20 pb-4">
            <Zap className="text-pink-400" />
            <h2>レベリング・経験値 (XP)</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">メッセージ送信時の獲得XP (TC XP)</label>
              <input
                type="number"
                name="TC_XP_REWARD"
                value={settings.TC_XP_REWARD}
                onChange={handleChange}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">メッセージXPの獲得クールダウン (秒)</label>
              <input
                type="number"
                name="TC_XP_COOLDOWN"
                value={settings.TC_XP_COOLDOWN}
                onChange={handleChange}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
              />
            </div>

            <div className="pt-2 border-t border-gray-700">
              <label className="block text-sm font-medium text-gray-400 mb-2">VC滞在1分あたりの獲得XP (VC XP)</label>
              <input
                type="number"
                name="VC_XP_PER_MIN"
                value={settings.VC_XP_PER_MIN}
                onChange={handleChange}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
              />
            </div>

            <div className="pt-2 border-t border-gray-700">
              <label className="block text-sm font-medium text-gray-400 mb-2">メッセージ連投防止クールダウン (秒)</label>
              <input
                type="number"
                name="MSG_COOLDOWN"
                value={settings.MSG_COOLDOWN}
                onChange={handleChange}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
              />
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
