'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Save, AlertCircle, Plus, Trash2, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import PageHeader from '@/components/PageHeader';
import { useSyncStatus, SyncBadge, SyncStatusCards } from '@/lib/useSyncStatus';
import ChannelSelect from '@/components/ChannelSelect';
import RoleSelect from '@/components/RoleSelect';

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
  is_invite_only: boolean;
  invite_visible_role_ids: string[];
  allowed_role_ids?: string[];
}

interface DiscordRole {
  id: string;
  name: string;
  color: number;
}

export default function VCTriggersPage() {
  const params = useParams();
  const guildId = params.guild_id as string;
  
  const [triggers, setTriggers] = useState<VCTrigger[]>([]);
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[]>([]);
  const [discordRoles, setDiscordRoles] = useState<DiscordRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const sync = useSyncStatus(guildId);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/vc-triggers`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/roles`).then(res => res.ok ? res.json() : [])
    ]).then(([triggersData, channelsData, rolesData]: [VCTrigger[], DiscordChannel[], DiscordRole[]]) => {
      setTriggers(triggersData || []);
      setDiscordChannels(channelsData || []);
      setDiscordRoles(rolesData || []);
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
    sync.reset();
    
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
        let errMsg = '設定の保存に失敗しました';
        try {
          const errorData = await res.json();
          if (errorData.error) errMsg = errorData.error;
        } catch (e) {}
        throw new Error(errMsg);
      }
      
      const data = await res.json();
      setSuccessMessage('設定を保存しました。Botに変更が反映されます。');
      setTimeout(() => setSuccessMessage(null), 3000);
      sync.startPolling(data.sync_request_id ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addTrigger = () => {
    setTriggers([
      ...triggers,
      {
        channel_id: '',
        base_name: '🔊━{user}の部屋',
        allow_rename: true,
        include_owner_name: true,
        use_numbering: true,
        allow_limit_change: true,
        show_panel: true,
        is_invite_only: false,
        invite_visible_role_ids: [],
        allowed_role_ids: []
      }
    ]);
  };

  const removeTrigger = (index: number) => {
    const newTriggers = [...triggers];
    newTriggers.splice(index, 1);
    setTriggers(newTriggers);
  };

  const updateTrigger = (index: number, field: keyof VCTrigger, value: any) => {
    const newTriggers = [...triggers];
    newTriggers[index] = {
      ...newTriggers[index],
      [field]: value
    };
    setTriggers(newTriggers);
  };

  // ボイスチャンネルのみをフィルタリング (type === 2)
  const vcChannels = discordChannels.filter(c => c.type === 2);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <PageHeader icon={Zap} title="自動VC作成 (トリガー)" subtitle="指定のVCに入室した際、自動で専用部屋を作成して移動させます" guildId={guildId} healthKey="vc-triggers" />
        <div className="flex items-center gap-3 -mt-8">
          <SyncBadge state={sync.state} botOnline={sync.botOnline} />
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-800/50 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      <SyncStatusCards sync={sync} />

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
        <p className="text-gray-400 font-tech">
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
                <label className="block text-sm font-medium text-gray-300 mb-2 font-tech">
                  トリガー対象のボイスチャンネル
                </label>
                <ChannelSelect
                  label="トリガー対象VC"
                  placeholder="ボイスチャンネルを選択..."
                  channels={vcChannels}
                  value={trigger.channel_id}
                  onChange={(id: any) => updateTrigger(index, 'channel_id', id || '')}
                  multiple={false}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2 font-tech">
                  作成される部屋のベース名 (&#123;user&#125; でユーザー名に置換)
                </label>
                <input
                  type="text"
                  value={trigger.base_name}
                  onChange={(e) => updateTrigger(index, 'base_name', e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500 font-tech"
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
                  <span className="text-gray-300 font-tech">ユーザーによる部屋名変更を許可</span>
                </label>

                <label className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-700/50 cursor-pointer hover:bg-zinc-800 transition-colors">
                  <input
                    type="checkbox"
                    checked={trigger.allow_limit_change}
                    onChange={(e) => updateTrigger(index, 'allow_limit_change', e.target.checked)}
                    className="w-5 h-5 rounded border-gray-600 text-indigo-600 focus:ring-indigo-600 bg-zinc-800"
                  />
                  <span className="text-gray-300 font-tech">ユーザーによる人数制限変更を許可</span>
                </label>

                <label className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-700/50 cursor-pointer hover:bg-zinc-800 transition-colors">
                  <input
                    type="checkbox"
                    checked={trigger.include_owner_name}
                    onChange={(e) => updateTrigger(index, 'include_owner_name', e.target.checked)}
                    className="w-5 h-5 rounded border-gray-600 text-indigo-600 focus:ring-indigo-600 bg-zinc-800"
                  />
                  <span className="text-gray-300 font-tech">自動でオーナー名を含める</span>
                </label>

                <label className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-700/50 cursor-pointer hover:bg-zinc-800 transition-colors">
                  <input
                    type="checkbox"
                    checked={trigger.use_numbering}
                    onChange={(e) => updateTrigger(index, 'use_numbering', e.target.checked)}
                    className="w-5 h-5 rounded border-gray-600 text-indigo-600 focus:ring-indigo-600 bg-zinc-800"
                  />
                  <span className="text-gray-300 font-tech">ナンバリングを使用する (#1, #2)</span>
                </label>

                <label className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-700/50 cursor-pointer hover:bg-zinc-800 transition-colors">
                  <input
                    type="checkbox"
                    checked={trigger.is_invite_only}
                    onChange={(e) => updateTrigger(index, 'is_invite_only', e.target.checked)}
                    className="w-5 h-5 rounded border-gray-600 text-indigo-600 focus:ring-indigo-600 bg-zinc-800"
                  />
                  <span className="text-gray-300 font-tech">招待専用にする（招待パネル設置）</span>
                </label>
              </div>

              {trigger.is_invite_only && (
                <div className="mt-4 p-4 border border-indigo-500/30 bg-indigo-500/5 rounded-lg">
                  <label className="block text-sm font-medium text-gray-300 mb-2 font-tech">
                    閲覧可能ロール (未設定時は招待者以外非表示になります)
                  </label>
                  <RoleSelect
                    label="閲覧可能ロール"
                    placeholder="ロールを選択..."
                    roles={discordRoles}
                    value={trigger.invite_visible_role_ids || []}
                    onChange={(ids: any) => updateTrigger(index, 'invite_visible_role_ids', ids)}
                    multiple={true}
                  />
                </div>
              )}

              <div className="mt-4 p-4 border border-zinc-700/50 bg-zinc-900/50 rounded-lg">
                <label className="block text-sm font-medium text-gray-300 mb-2 font-tech">
                  閲覧・接続許可ロール (未設定時は全員がアクセス可能)
                </label>
                <p className="text-xs text-gray-500 mb-2 font-tech">
                  ※特定のロールのみに部屋を利用させたい場合に設定します。「招待専用」設定とは独立して機能します。
                </p>
                <RoleSelect
                  label="閲覧・接続許可ロール"
                  placeholder="許可するロールを選択..."
                  roles={discordRoles}
                  value={trigger.allowed_role_ids || []}
                  onChange={(ids: any) => updateTrigger(index, 'allowed_role_ids', ids)}
                  multiple={true}
                />
              </div>
            </motion.div>
          ))}

          <button
            onClick={addTrigger}
            className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white p-4 rounded-lg border border-zinc-600 border-dashed transition-colors font-tech"
          >
            <Plus className="w-5 h-5" />
            新しいトリガーを追加
          </button>
        </div>
      </div>
    </div>
  );
}