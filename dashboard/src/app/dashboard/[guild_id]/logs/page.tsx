'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Save, AlertCircle, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import ChannelSelect from '@/components/ChannelSelect';

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
  { id: 'shop_extend', label: '評価期間延長の購入' },
  { id: 'gambling', label: '賭博・カジノ機能の利用' },
  { id: 'gacha', label: '福引ガチャの利用' },
  { id: 'evaluation_failure', label: '評価シートの浮上・不合格処理' },
  { id: 'interviewer', label: '面接官・入界処理' },
];

export default function LogSettingsPage() {
  const params = useParams();
  const guildId = params.guild_id as string;
  
  const [settings, setSettings] = useState<Record<string, { channel_id: string; is_enabled: boolean }>>({});
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
      const data = await res.json();
      if (!res.ok || data.error) {
        const msg = data.error || '保存に失敗しました';
        setError(`設定の保存に失敗しました: ${msg}`);
        toast.error(`保存に失敗しました: ${msg}`);
        return;
      }
      toast.success('設定を保存しました！');
    } catch (err: any) {
      console.error(err);
      const msg = err?.message || String(err);
      setError(`設定の保存に失敗しました: ${msg}`);
      toast.error(`保存に失敗しました: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (logTypeId: string, checked: boolean) => {
    setSettings(prev => ({
      ...prev,
      [logTypeId]: {
        channel_id: prev[logTypeId]?.channel_id || '',
        is_enabled: checked,
      }
    }));
  };

  const handleChannelChange = (logTypeId: string, channelId: string) => {
    setSettings(prev => ({
      ...prev,
      [logTypeId]: {
        channel_id: channelId,
        is_enabled: prev[logTypeId]?.is_enabled ?? false,
      }
    }));
  };

  const textChannels = discordChannels.filter(c => c.type === 0);

  if (loading) {
    return <div className="flex justify-center items-center h-64 text-indigo-400">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="flex justify-between items-center bg-gray-900/80 p-6 rounded-2xl border border-indigo-500/20 backdrop-blur-sm sticky top-0 z-10 shadow-2xl">
        <div>
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-600 flex items-center gap-3">
            <FileText className="text-indigo-500" size={32} />
            ログ通知設定
          </h1>
          <p className="text-gray-400 mt-2 text-sm">サーバー内の各種イベントのログ送信先チャンネルと有効/無効を設定します。</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center space-x-2 px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-all disabled:opacity-50 font-bold"
        >
          <Save size={20} />
          <span>{saving ? '保存中...' : '設定を保存'}</span>
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl flex items-center space-x-3">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Log Type List */}
      <div className="grid grid-cols-1 gap-4">
        {LOG_TYPES.map((logType, index) => {
          const isEnabled = settings[logType.id]?.is_enabled ?? false;
          const channelId = settings[logType.id]?.channel_id || '';

          return (
            <motion.div
              key={logType.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
              className={`p-5 rounded-xl border transition-all duration-200 ${
                isEnabled
                  ? 'bg-gray-800/80 border-indigo-500/40 shadow-[0_4px_20px_rgba(0,0,0,0.2)]'
                  : 'bg-gray-900/40 border-gray-800'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                {/* Left: Info & Toggle */}
                <div className="flex items-center space-x-4 flex-1">
                  <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(e) => handleToggle(logType.id, e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-12 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                  <div>
                    <h3 className={`text-base font-semibold transition-colors ${isEnabled ? 'text-white' : 'text-gray-400'}`}>
                      {logType.label}
                    </h3>
                  </div>
                </div>

                {/* Right: Channel Select */}
                <div className="w-full md:w-80 flex-shrink-0">
                  <ChannelSelect
                    label={logType.label}
                    placeholder="チャンネルを選択..."
                    channels={textChannels}
                    value={channelId}
                    onChange={(id: any) => handleChannelChange(logType.id, id || '')}
                    disabled={!isEnabled}
                    multiple={false}
                  />
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}