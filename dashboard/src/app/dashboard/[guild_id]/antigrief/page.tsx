'use client';
import { useState, useEffect } from 'react';
import ChannelSelect from '@/components/ChannelSelect';
import RoleSelect from '@/components/RoleSelect';
import { toast } from 'react-hot-toast';
import { ShieldAlert } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { useSyncStatus, SyncBadge, SyncStatusCards } from '@/lib/useSyncStatus';

function parseKeywords(text: string): string[] {
  return Array.from(new Set(text.split('\n').map(k => k.trim()).filter(k => k.length > 0)));
}

export default function AntigriefSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  
  const [settings, setSettings] = useState<any>({
    ENABLE_ANTIGRIEF: true,
    target_category_ids: [],
    target_channel_ids: [],
    exempt_role_ids: [],
    admin_channel_id: ''
  });
  // NGキーワードは1行1キーワードで編集する
  const [keywordsText, setKeywordsText] = useState('');
  
  const [channels, setChannels] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sync = useSyncStatus(guildId);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/antigrief`).then(res => res.ok ? res.json() : {}),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/roles`).then(res => res.ok ? res.json() : [])
    ]).then(([settingsData, channelsData, rolesData]: [any, any, any]) => {
      setSettings({
        ENABLE_ANTIGRIEF: settingsData.ENABLE_ANTIGRIEF ?? true,
        target_category_ids: settingsData.target_category_ids?.map(String) || [],
        target_channel_ids: settingsData.target_channel_ids?.map(String) || [],
        exempt_role_ids: settingsData.exempt_role_ids?.map(String) || [],
        admin_channel_id: settingsData.admin_channel_id ? String(settingsData.admin_channel_id) : ''
      });
      setKeywordsText((settingsData.ng_keywords || []).join('\n'));
      if (!channelsData.error) {
        setChannels(channelsData);
      }
      if (!rolesData.error && Array.isArray(rolesData)) {
        setRoles(rolesData);
      }
    }).catch(err => {
      console.error(err);
      setError('データの取得に失敗しました');
    }).finally(() => {
      setLoading(false);
    });
  }, [guildId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    sync.reset();
    try {
      const res = await fetch(`/api/guilds/${guildId}/antigrief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, ng_keywords: parseKeywords(keywordsText) })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        const msg = data.error || '保存に失敗しました';
        setError(`設定の保存に失敗しました: ${msg}`);
        toast.error(`保存に失敗しました: ${msg}`);
        return;
      }
      toast.success('保存しました');
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

  const textChannels = channels.filter(c => c.type === 0 || c.type === 2); // Text and Voice
  const adminChatChannels = channels.filter(c => c.type === 0 || c.type === 5); // Text and Announcement
  const keywordCount = parseKeywords(keywordsText).length;
  const categories = channels.filter(c => c.type === 4); // Categories

  if (loading) return <div className="text-zinc-400">読み込み中...</div>;

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <PageHeader icon={ShieldAlert} title="荒らし対策設定" subtitle="不審な操作からサーバーを自動で守ります" guildId={guildId} healthKey="antigrief" />
        <SyncBadge state={sync.state} botOnline={sync.botOnline} className="mt-1" />
      </div>

      <SyncStatusCards sync={sync} />

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* 全体設定 */}
        <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl">
          <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">全体設定</h2>
          
          <div className="flex items-center justify-between bg-zinc-900 p-4 rounded border border-zinc-700">
            <div>
              <p className="font-bold text-white mb-1">荒らし対策機能のオン/オフ</p>
              <p className="text-sm text-zinc-400">連投スパム・メンションスパム・NGキーワードを自動で検知し、ユーザーを1時間タイムアウトする機能を有効にします。</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer"
                checked={settings.ENABLE_ANTIGRIEF}
                onChange={e => setSettings({...settings, ENABLE_ANTIGRIEF: e.target.checked})}
              />
              <div className="w-14 h-7 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-red-600"></div>
            </label>
          </div>
        </div>

        {/* NGキーワード・管理者通知 */}
        <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl">
          <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">NGキーワード・管理者通知</h2>
          <p className="text-sm text-zinc-400 mb-4">
            指定したキーワードを含む発言があった場合、メッセージを削除して<strong>1時間タイムアウト</strong>します。
            全角/半角・大文字/小文字の違いは区別しません。
          </p>

          <div className="grid gap-6">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                NGキーワード（1行に1つ）
                <span className="ml-2 text-xs text-zinc-500">{keywordCount}件</span>
              </label>
              <textarea
                className="w-full min-h-[140px] bg-zinc-900 border border-zinc-700 rounded p-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-red-500"
                placeholder={'例:\n荒らしワード1\n荒らしワード2'}
                value={keywordsText}
                onChange={e => setKeywordsText(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                管理者チャット（タイムアウト通知先）
              </label>
              <p className="text-xs text-zinc-500 mb-2">
                荒らし対策で誰かをタイムアウトしたとき、このチャンネルに対象者をメンションして理由とともに通知します。未指定の場合は通知しません。
              </p>
              <ChannelSelect
                label="管理者チャット"
                placeholder="チャンネルを選択..."
                value={settings.admin_channel_id}
                onChange={(id) => setSettings({...settings, admin_channel_id: id || ''})}
                channels={adminChatChannels}
                multiple={false}
              />
            </div>
          </div>
        </div>

        {/* 監視対象の設定 */}
        <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl">
          <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">監視対象・免除設定</h2>
          <p className="text-sm text-zinc-400 mb-4">
            特定のチャンネルやカテゴリのみを監視対象にすることができます。未指定の場合は<strong>すべてのチャンネル</strong>が監視対象になります。
          </p>
          
          <div className="grid gap-6">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                対象カテゴリー
              </label>
              <ChannelSelect
                label="対象カテゴリー"
                placeholder="カテゴリーを選択..."
                value={settings.target_category_ids}
                onChange={(ids) => setSettings({...settings, target_category_ids: ids})}
                channels={categories}
                multiple={true}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                対象チャンネル
              </label>
              <ChannelSelect
                label="対象チャンネル"
                placeholder="チャンネルを選択..."
                value={settings.target_channel_ids}
                onChange={(ids) => setSettings({...settings, target_channel_ids: ids})}
                channels={textChannels}
                multiple={true}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                免除ロール
              </label>
              <p className="text-xs text-zinc-500 mb-2">このロールを持つユーザーは、荒らし対策の監視対象から外れます。</p>
              <RoleSelect
                label="免除ロール"
                placeholder="免除ロールを選択..."
                value={settings.exempt_role_ids}
                onChange={(ids) => setSettings({...settings, exempt_role_ids: ids})}
                roles={roles}
                multiple={true}
              />
            </div>
          </div>
        </div>

        {/* 保存ボタン */}
        <div className="flex justify-end pt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-8 py-3 rounded-lg font-bold text-white shadow-lg transition-all
              ${saving 
                ? 'bg-zinc-600 cursor-not-allowed' 
                : 'bg-red-600 hover:bg-red-500 hover:scale-105 active:scale-95'
              }`}
          >
            {saving ? '保存中...' : '設定を保存する'}
          </button>
        </div>
      </div>
    </div>
  );
}
