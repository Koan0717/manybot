'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Save, AlertCircle, FileText } from 'lucide-react';
import { motion } from 'framer-motion';

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
}

const LOG_TYPES = [
  { id: 'member_join_leave', label: 'メンバーの参加・退出・キック・BAN' },
  { id: 'message_edit', label: 'メッセージの編集' },
  { id: 'message_delete', label: 'メッセージの削除' },
  { id: 'vc_join_leave', label: 'VCの入退室' },
  { id: 'currency', label: '経済システム・通貨変動' },
  { id: 'shop', label: 'ショップアイテムの購入・使用' },
  { id: 'gambling', label: '賭博・カジノ機能の利用' },
  { id: 'evaluation_failure', label: '評価シートの浮上・不合格処理' },
  { id: 'interviewer', label: '面接官・入界処理' },
];

export default function LogSettingsPage() {
  const params = useParams();
  const guildId = params.guild_id as string;
  
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/logs`).then(res => res.ok ? res.json() : {}),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : [])
    ]).then(([settingsData, channelsData]: [any, any]) => {
      setSettings(settingsData || {});
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
    try {
      const res = await fetch(`/api/guilds/${guildId}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
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

  const handleChannelChange = (logType: string, channelId: string) => {
    setSettings(prev => ({
      ...prev,
      [logType]: channelId
    }));
  };

  const textChannels = discordChannels.filter(c => c.type === 0);

  if (loading) {
    return <div className="flex justify-center items-center h-64 text-green-400">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-600">
          ログ出力設定
        </h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center space-x-2 px-6 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-lg shadow-lg shadow-emerald-500/25 transition-all disabled:opacity-50"
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

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-gray-800/50 border border-emerald-500/20 p-6 rounded-xl space-y-6">
        <div className="flex items-center space-x-3 text-xl font-semibold text-emerald-300 border-b border-emerald-500/20 pb-4">
          <FileText className="text-emerald-400" />
          <h2>ログ種類と出力先の指定</h2>
        </div>
        
        <p className="text-gray-400 text-sm">
          各種ログの出力先チャンネルを指定してください。何も指定しない場合、そのログは出力されません。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
          {LOG_TYPES.map(log => (
            <div key={log.id} className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
              <label className="block text-sm font-medium text-gray-300 mb-2">{log.label}</label>
              <select
                value={settings[log.id] || ""}
                onChange={(e) => handleChannelChange(log.id, e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
              >
                <option value="">-- 出力しない --</option>
                {textChannels.map(ch => (
                  <option key={ch.id} value={ch.id}>
                    # {ch.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
