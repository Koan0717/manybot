'use client';
import { useState, useEffect } from 'react';
import ChannelSelect from '@/components/ChannelSelect';
import RoleSelect from '@/components/RoleSelect';
import { toast } from 'react-hot-toast';
import { ShieldAlert } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import NgWordRules from '@/components/NgWordRules';
import MemberSelect, { MemberOption } from '@/components/MemberSelect';
import ApprovedBots from '@/components/ApprovedBots';
import { useSyncStatus, SyncBadge, SyncStatusCards } from '@/lib/useSyncStatus';

export default function AntigriefSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  
  const [settings, setSettings] = useState<any>({
    ENABLE_ANTIGRIEF: true,
    target_category_ids: [],
    target_channel_ids: [],
    exempt_role_ids: [],
    admin_channel_id: '',
    bot_guard_enabled: false,
    bot_guard_action: 'kick',
    bot_guard_allowed_user_ids: []
  });

  const [channels, setChannels] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [approvedRefreshKey, setApprovedRefreshKey] = useState(0);
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
        admin_channel_id: settingsData.admin_channel_id ? String(settingsData.admin_channel_id) : '',
        bot_guard_enabled: settingsData.bot_guard_enabled ?? false,
        bot_guard_action: settingsData.bot_guard_action === 'ban' ? 'ban' : 'kick',
        bot_guard_allowed_user_ids: settingsData.bot_guard_allowed_user_ids?.map(String) || []
      });
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

    // メンバー一覧は大きなサーバーだと時間がかかるので、ページの表示を待たせない
    fetch(`/api/guilds/${guildId}/member-list`)
      .then(res => res.ok ? res.json() : { members: [] })
      .then(data => setMembers(data.members || []))
      .catch(err => console.error(err))
      .finally(() => setMembersLoading(false));
  }, [guildId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    sync.reset();
    try {
      const res = await fetch(`/api/guilds/${guildId}/antigrief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        const msg = data.error || '保存に失敗しました';
        setError(`設定の保存に失敗しました: ${msg}`);
        toast.error(`保存に失敗しました: ${msg}`);
        return;
      }
      toast.success('保存しました');
      setApprovedRefreshKey(k => k + 1);
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

        {/* BOT導入制限 */}
        <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl">
          <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">BOT導入制限</h2>

          <div className="flex items-center justify-between gap-4 bg-zinc-900 p-4 rounded border border-zinc-700">
            <div>
              <p className="font-bold text-white mb-1">許可した人だけBOTを入れられるようにする</p>
              <p className="text-sm text-zinc-400">
                許可していない人が入れたBOTを、参加した瞬間に処分します。未承認のBOTが送信したメッセージはすべて削除します。ONにして保存した時点でサーバーにいるBOTは承認済みになります。（上の「荒らし対策機能」がオフのときは動きません）
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={settings.bot_guard_enabled}
                onChange={e => setSettings({...settings, bot_guard_enabled: e.target.checked})}
              />
              <div className="w-14 h-7 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-red-600"></div>
            </label>
          </div>

          <div className="grid gap-6 mt-6">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">BOTを入れてよい人</label>
              <p className="text-xs text-zinc-500 mb-2">
                ここで選んだ人が入れたBOTは自動で承認します。サーバーオーナーは選ばなくても入れられます。
              </p>
              <MemberSelect
                value={settings.bot_guard_allowed_user_ids}
                onChange={(ids) => setSettings({...settings, bot_guard_allowed_user_ids: ids})}
                members={members}
                loading={membersLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">未許可のBOTへの対応</label>
              <div className="flex gap-2">
                {[
                  { value: 'kick', label: 'キック' },
                  { value: 'ban', label: 'BAN' },
                ].map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSettings({...settings, bot_guard_action: option.value})}
                    className={`px-5 py-2 rounded-lg text-sm font-bold border transition-colors ${
                      settings.bot_guard_action === option.value
                        ? 'bg-red-600 border-red-500 text-white'
                        : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <ApprovedBots guildId={guildId} refreshKey={approvedRefreshKey} />
          </div>
        </div>

        {/* 管理者通知 */}
        <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl">
          <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">管理者通知</h2>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            管理者チャット（タイムアウト・未許可BOTの通知先）
          </label>
          <p className="text-xs text-zinc-500 mb-2">
            荒らし対策・NGワードで誰かをタイムアウトしたときや未許可のBOTを処分したとき、このチャンネルに対象者をメンションして理由とともに通知します。未指定の場合は通知しません。
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

        {/* 監視対象の設定 */}
        <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl">
          <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">スパム検知の監視対象・免除設定</h2>
          <p className="text-sm text-zinc-400 mb-4">
            連投・@everyone・招待URL・メンションスパムの検知対象です。未指定の場合は<strong>すべてのチャンネル</strong>が監視対象になります。（NGワードは下の「NGワードルール」ごとに別で設定します）
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
              <p className="text-xs text-zinc-500 mb-2">このロールを持つユーザーは、スパム検知の監視対象から外れます。</p>
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

        {/* NGワードルール（個別に保存） */}
        <NgWordRules guildId={guildId} channels={channels} roles={roles} />
      </div>
    </div>
  );
}
