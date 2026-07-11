'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Save, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import Select from 'react-select';

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
}

interface VCTrigger {
  channel_id: string;
  base_name: string;
  allow_rename: boolean;
  include_owner_name: boolean;
  use_numbering: boolean;
  allow_limit_change: boolean;
  show_panel: boolean;
}

export default function VCTriggersPage() {
  const params = useParams();
  const guildId = params.guild_id as string;
  
  const [triggers, setTriggers] = useState<VCTrigger[]>([]);
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/vc-triggers`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : [])
    ]).then(([triggersData, channelsData]: [VCTrigger[], DiscordChannel[]]) => {
      setTriggers(triggersData || []);
      setDiscordChannels(channelsData || []);
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
    setSuccessMessage(null);
    
    // channel_idが未設定のものを除外
    const validTriggers = triggers.filter(t => t.channel_id && t.channel_id.trim() !== '');

    try {
      const res = await fetch(`/api/guilds/${guildId}/vc-triggers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(validTriggers)
      });
      
      if (!res.ok) {
        throw new Error('設定の保存に失敗しました');
      }
      
      setSuccessMessage('設定を保存しました。Botに変更が反映されます。');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const vcChannels = discordChannels.filter(c => c.type === 2); // 2 is Guild Voice

  const addTrigger = () => {
    setTriggers([
      ...triggers,
      {
        channel_id: '',
        base_name: '🔊━{user}の部屋',
        allow_rename: true,
        include_owner_name: true,
        use_numbering: false,
        allow_limit_change: true,
        show_panel: true
      }
    ]);
  };

  const removeTrigger = (index: number) => {
    setTriggers(triggers.filter((_, i) => i !== index));
  };

  const updateTrigger = (index: number, key: keyof VCTrigger, value: any) => {
    const newTriggers = [...triggers];
    newTriggers[index] = { ...newTriggers[index], [key]: value };
    setTriggers(newTriggers);
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-white">読み込み中...</div>;
  }

  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            VCトリガー設定
          </h1>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            <Save className="w-5 h-5" />
            {saving ? '保存中...' : '保存'}
          </button>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-500 p-4 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}
        
        {successMessage && (
          <div className="bg-green-500/20 border border-green-500 text-green-500 p-4 rounded-lg flex items-center gap-2">
            {successMessage}
          </div>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
          <p className="text-gray-400">
            ここで設定したボイスチャンネルに参加したユーザーに対し、自動的に専用のVC（一時部屋）を作成し、移動させます。
            トリガーとして複数のVCを設定し、それぞれ個別の名前やルールを適用できます。
          </p>

          <div className="space-y-6">
            {triggers.map((trigger, index) => (
              <motion.div 
                key={index} 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-5 space-y-4 relative"
              >
                <button 
                  onClick={() => removeTrigger(index)}
                  className="absolute top-4 right-4 text-gray-500 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
                
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    トリガー対象のボイスチャンネル
                  </label>
                  <Select
                    options={vcChannels.map(c => ({ value: c.id, label: c.name }))}
                    value={
                      trigger.channel_id 
                        ? { value: trigger.channel_id, label: vcChannels.find(c => c.id === trigger.channel_id)?.name || trigger.channel_id } 
                        : null
                    }
                    onChange={(selected: any) => updateTrigger(index, 'channel_id', selected ? selected.value : '')}
                    className="text-black"
                    placeholder="チャンネルを選択..."
                    noOptionsMessage={() => "チャンネルが見つかりません"}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    作成される部屋のベース名 (&#123;user&#125; でユーザー名に置換)
                  </label>
                  <input
                    type="text"
                    value={trigger.base_name}
                    onChange={(e) => updateTrigger(index, 'base_name', e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
                    placeholder="🔊━{user}の部屋"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-700/50 cursor-pointer hover:bg-zinc-800 transition-colors">
                    <input
                      type="checkbox"
                      checked={trigger.allow_rename}
                      onChange={(e) => updateTrigger(index, 'allow_rename', e.target.checked)}
                      className="w-5 h-5 rounded border-gray-600 text-indigo-600 focus:ring-indigo-600 bg-zinc-800"
                    />
                    <span className="text-gray-300">ユーザーによる部屋名変更を許可</span>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-700/50 cursor-pointer hover:bg-zinc-800 transition-colors">
                    <input
                      type="checkbox"
                      checked={trigger.allow_limit_change}
                      onChange={(e) => updateTrigger(index, 'allow_limit_change', e.target.checked)}
                      className="w-5 h-5 rounded border-gray-600 text-indigo-600 focus:ring-indigo-600 bg-zinc-800"
                    />
                    <span className="text-gray-300">ユーザーによる人数制限変更を許可</span>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-700/50 cursor-pointer hover:bg-zinc-800 transition-colors">
                    <input
                      type="checkbox"
                      checked={trigger.include_owner_name}
                      onChange={(e) => updateTrigger(index, 'include_owner_name', e.target.checked)}
                      className="w-5 h-5 rounded border-gray-600 text-indigo-600 focus:ring-indigo-600 bg-zinc-800"
                    />
                    <span className="text-gray-300">自動でオーナー名を含める</span>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-700/50 cursor-pointer hover:bg-zinc-800 transition-colors">
                    <input
                      type="checkbox"
                      checked={trigger.use_numbering}
                      onChange={(e) => updateTrigger(index, 'use_numbering', e.target.checked)}
                      className="w-5 h-5 rounded border-gray-600 text-indigo-600 focus:ring-indigo-600 bg-zinc-800"
                    />
                    <span className="text-gray-300">ナンバリングを使用する (#1, #2)</span>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-700/50 cursor-pointer hover:bg-zinc-800 transition-colors">
                    <input
                      type="checkbox"
                      checked={trigger.show_panel}
                      onChange={(e) => updateTrigger(index, 'show_panel', e.target.checked)}
                      className="w-5 h-5 rounded border-gray-600 text-indigo-600 focus:ring-indigo-600 bg-zinc-800"
                    />
                    <span className="text-gray-300">作成された部屋に設定用パネルを表示</span>
                  </label>
                </div>
              </motion.div>
            ))}

            <button
              onClick={addTrigger}
              className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white p-4 rounded-lg border border-zinc-600 border-dashed transition-colors"
            >
              <Plus className="w-5 h-5" />
              新しいトリガーを追加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
