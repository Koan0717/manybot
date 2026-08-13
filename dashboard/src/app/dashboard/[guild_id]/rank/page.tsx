'use client';

import { useState, useEffect } from 'react';
import Select from 'react-select';
import { toast } from 'react-hot-toast';
import { Trophy, Save, Shield, MessageSquare, Mic, EyeOff, CheckCircle2, XCircle, Power } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { useSyncStatus, SyncStatusCards, SyncBadge } from '@/lib/useSyncStatus';
import RoleSelect from '@/components/RoleSelect';

export default function RankSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const sync = useSyncStatus(guildId);
  
  const [settings, setSettings] = useState<any>({
    ENABLE_RANK: true,
    ENABLE_TC_RANK: true,
    whitelist_channel_ids: [],
    blacklist_channel_ids: [],
    whitelist_category_ids: [],
    blacklist_category_ids: [],
    ENABLE_EXCLUDE_RANK_ROLE: false,
    EXCLUDE_RANK_ROLE_IDS: [],
    ephemeral_rank_commands: false,
  });
  
  const [channels, setChannels] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/rank`).then((res) => (res.ok ? res.json() : {})),
      fetch(`/api/guilds/${guildId}/channels`).then((res) => (res.ok ? res.json() : [])),
      fetch(`/api/guilds/${guildId}/roles`).then((res) => (res.ok ? res.json() : [])),
    ])
      .then(([settingsData, channelsData, rolesData]: [any, any, any]) => {
        setSettings({
          ENABLE_RANK: settingsData.ENABLE_RANK !== undefined ? settingsData.ENABLE_RANK : true,
          ENABLE_TC_RANK: settingsData.ENABLE_TC_RANK !== undefined ? settingsData.ENABLE_TC_RANK : true,
          whitelist_channel_ids: settingsData.whitelist_channel_ids?.map(String) || [],
          blacklist_channel_ids: settingsData.blacklist_channel_ids?.map(String) || [],
          whitelist_category_ids: settingsData.whitelist_category_ids?.map(String) || [],
          blacklist_category_ids: settingsData.blacklist_category_ids?.map(String) || [],
          ENABLE_EXCLUDE_RANK_ROLE: settingsData.ENABLE_EXCLUDE_RANK_ROLE ?? false,
          EXCLUDE_RANK_ROLE_IDS: settingsData.EXCLUDE_RANK_ROLE_IDS?.map(String) || [],
          ephemeral_rank_commands: settingsData.ephemeral_rank_commands ?? false,
        });
        if (!channelsData.error && Array.isArray(channelsData)) {
          setChannels(channelsData);
        }
        if (!rolesData.error && Array.isArray(rolesData)) {
          setRoles(rolesData.filter((r: any) => r.id !== guildId));
        }
      })
      .catch((err) => {
        console.error(err);
        setError('データの取得に失敗しました');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [guildId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    sync.reset();
    try {
      const res = await fetch(`/api/guilds/${guildId}/rank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('保存に失敗しました');
      const data = await res.json();
      toast.success('ランク設定を保存しました！');
      sync.startPolling(data.sync_request_id ?? null);
    } catch (err) {
      console.error(err);
      setError('設定の保存に失敗しました');
      toast.error('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const textChannels = channels.filter((c) => c.type === 0 || c.type === 2); // Text and Voice
  const categories = channels.filter((c) => c.type === 4); // Categories

  const textChannelOptions = textChannels.map((c) => ({
    value: c.id,
    label: `${c.type === 0 ? '#' : '🔊'} ${c.name}`,
  }));
  const categoryOptions = categories.map((c) => ({
    value: c.id,
    label: `📁 ${c.name}`,
  }));

  const customStyles = {
    control: (base: any) => ({
      ...base,
      backgroundColor: '#18181b',
      borderColor: '#3f3f46',
      color: 'white',
    }),
    menu: (base: any) => ({
      ...base,
      backgroundColor: '#18181b',
      zIndex: 9999,
      borderColor: '#3f3f46',
    }),
    option: (base: any, state: any) => ({
      ...base,
      backgroundColor: state.isFocused ? '#27272a' : '#18181b',
      color: 'white',
      ':active': { backgroundColor: '#3f3f46' },
    }),
    multiValue: (base: any) => ({ ...base, backgroundColor: '#27272a' }),
    multiValueLabel: (base: any) => ({ ...base, color: 'white' }),
  };

  if (loading) return <div className="text-zinc-400 p-8">読み込み中...</div>;

  const isRankMasterEnabled = settings.ENABLE_RANK;

  return (
    <div className="max-w-4xl mx-auto pb-24 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <PageHeader icon={Trophy} title="ランク・経験値設定" subtitle="発言や活動に応じた経験値・ランクを設定します" guildId={guildId} healthKey="rank" />
        <div className="flex items-center gap-3 -mt-8">
          <SyncBadge state={sync.state} botOnline={sync.botOnline} />
          <button
            onClick={handleSave}
            disabled={saving}
            className="mecha-btn-sheen font-mecha flex items-center gap-2 bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white px-5 py-2.5 rounded-lg font-bold shadow-lg shadow-red-900/30 transition-all disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : '設定を保存'}
          </button>
        </div>
      </div>

      <SyncStatusCards sync={sync} />

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* 1. ランク機能マスターON/OFFスイッチ (全体設定) */}
      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isRankMasterEnabled ? 'bg-red-950/80 text-red-400 border border-red-700/60' : 'bg-zinc-800 text-zinc-500'
            }`}>
              <Power className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-mecha text-base font-bold text-white">ランク機能全体 (マスターON/OFF)</h2>
              <p className="font-tech text-xs text-zinc-400">サーバー内での経験値集計・ランクアップ機能全体の有効/無効を切り替えます</p>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={isRankMasterEnabled}
              onChange={(e) => setSettings({ ...settings, ENABLE_RANK: e.target.checked })}
            />
            <div className="w-14 h-7 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-red-600"></div>
          </label>
        </div>

        {/* サブ設定一覧 */}
        <div className={`space-y-4 transition-opacity ${isRankMasterEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
          {/* TCランク */}
          <div className="flex items-center justify-between bg-black/40 p-4 rounded-lg border border-zinc-800">
            <div className="pr-4">
              <p className="font-tech font-bold text-white mb-1 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-cyan-400" />
                TC (テキストチャット) ランク機能
              </p>
              <p className="font-tech text-xs text-zinc-400">
                テキストチャンネルでメッセージを送信した際に経験値を獲得するかどうかを設定します。
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={settings.ENABLE_TC_RANK}
                disabled={!isRankMasterEnabled}
                onChange={(e) => setSettings({ ...settings, ENABLE_TC_RANK: e.target.checked })}
              />
              <div className="w-12 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
            </label>
          </div>

          {/* 特定ロール除外 */}
          <div className="flex items-center justify-between bg-black/40 p-4 rounded-lg border border-zinc-800">
            <div className="pr-4">
              <p className="font-tech font-bold text-white mb-1 flex items-center gap-2">
                <Shield className="w-4 h-4 text-amber-400" />
                特定ロールへのランク付与を除外
              </p>
              <p className="font-tech text-xs text-zinc-400">
                オンにすると、指定したロールを持つユーザーにはレベルアップ時のロール報酬が付与されません。
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={settings.ENABLE_EXCLUDE_RANK_ROLE}
                disabled={!isRankMasterEnabled}
                onChange={(e) => setSettings({ ...settings, ENABLE_EXCLUDE_RANK_ROLE: e.target.checked })}
              />
              <div className="w-12 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
            </label>
          </div>

          {settings.ENABLE_EXCLUDE_RANK_ROLE && (
            <div className="bg-black/30 p-4 rounded-lg border border-zinc-800 space-y-2">
              <label className="block text-xs font-tech text-zinc-300 uppercase tracking-wider font-bold">
                除外対象ロール
              </label>
              <p className="text-xs text-zinc-500 font-tech">
                ここで選択したロールを持つユーザーは、レベル到達時の新しいロールが付与されません（XPは獲得できます）
              </p>
              <RoleSelect
                label="除外対象ロール"
                placeholder="除外するロールを選択..."
                value={settings.EXCLUDE_RANK_ROLE_IDS}
                onChange={(ids) => setSettings({ ...settings, EXCLUDE_RANK_ROLE_IDS: ids })}
                roles={roles}
                multiple={true}
              />
            </div>
          )}

          {/* ランクコマンド秘匿設定 */}
          <div className="flex items-center justify-between bg-black/40 p-4 rounded-lg border border-zinc-800">
            <div className="pr-4">
              <p className="font-tech font-bold text-white mb-1 flex items-center gap-2">
                <EyeOff className="w-4 h-4 text-purple-400" />
                ランクコマンドの秘匿設定
              </p>
              <p className="font-tech text-xs text-zinc-400">
                オンにすると、`/rank info` や `/rank top` コマンドの結果が実行した本人にのみ非公開（Ephemeral）で表示されます。
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={settings.ephemeral_rank_commands}
                disabled={!isRankMasterEnabled}
                onChange={(e) => setSettings({ ...settings, ephemeral_rank_commands: e.target.checked })}
              />
              <div className="w-12 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
            </label>
          </div>
        </div>

        {!isRankMasterEnabled && (
          <div className="bg-amber-950/30 border border-amber-800/60 p-3 rounded-lg text-xs text-amber-300 font-tech">
            ⚠️ ランク機能全体がオフになっているため、ボイス・テキストでの経験値獲得および `/rank` コマンドは停止します。
          </div>
        )}
      </div>

      {/* 2. チャンネル・カテゴリ設定 */}
      <div className={`mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl space-y-6 transition-opacity ${
        isRankMasterEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'
      }`}>
        <h2 className="font-mecha text-base font-bold text-white border-b border-zinc-800 pb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
          経験値獲得の対象チャンネル・カテゴリ
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* ホワイトリスト */}
          <div className="space-y-4 bg-black/30 p-4 rounded-lg border border-zinc-800">
            <h3 className="font-tech text-sm font-bold text-green-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> 許可対象 (ホワイトリスト)
            </h3>
            <p className="text-xs text-zinc-400 font-tech">
              指定した場合、ここで選んだチャンネル/カテゴリでのみ経験値が入ります（未指定の場合は除外対象以外すべてが対象）
            </p>

            <div>
              <label className="block text-xs font-tech text-zinc-400 mb-1.5 uppercase">対象チャンネル</label>
              <Select
                isMulti
                options={textChannelOptions}
                value={textChannelOptions.filter((o) => settings.whitelist_channel_ids.includes(o.value))}
                onChange={(selected: any) =>
                  setSettings({ ...settings, whitelist_channel_ids: selected.map((s: any) => s.value) })
                }
                styles={customStyles}
                placeholder="チャンネルを選択..."
              />
            </div>

            <div>
              <label className="block text-xs font-tech text-zinc-400 mb-1.5 uppercase">対象カテゴリ</label>
              <Select
                isMulti
                options={categoryOptions}
                value={categoryOptions.filter((o) => settings.whitelist_category_ids.includes(o.value))}
                onChange={(selected: any) =>
                  setSettings({ ...settings, whitelist_category_ids: selected.map((s: any) => s.value) })
                }
                styles={customStyles}
                placeholder="カテゴリを選択..."
              />
            </div>
          </div>

          {/* ブラックリスト */}
          <div className="space-y-4 bg-black/30 p-4 rounded-lg border border-zinc-800">
            <h3 className="font-tech text-sm font-bold text-red-400 flex items-center gap-2">
              <XCircle className="w-4 h-4" /> 除外対象 (ブラックリスト)
            </h3>
            <p className="text-xs text-zinc-400 font-tech">
              ここで指定したチャンネル/カテゴリでは、メッセージ送信やVC滞在をしても経験値を獲得しません。
            </p>

            <div>
              <label className="block text-xs font-tech text-zinc-400 mb-1.5 uppercase">除外チャンネル</label>
              <Select
                isMulti
                options={textChannelOptions}
                value={textChannelOptions.filter((o) => settings.blacklist_channel_ids.includes(o.value))}
                onChange={(selected: any) =>
                  setSettings({ ...settings, blacklist_channel_ids: selected.map((s: any) => s.value) })
                }
                styles={customStyles}
                placeholder="チャンネルを選択..."
              />
            </div>

            <div>
              <label className="block text-xs font-tech text-zinc-400 mb-1.5 uppercase">除外カテゴリ</label>
              <Select
                isMulti
                options={categoryOptions}
                value={categoryOptions.filter((o) => settings.blacklist_category_ids.includes(o.value))}
                onChange={(selected: any) =>
                  setSettings({ ...settings, blacklist_category_ids: selected.map((s: any) => s.value) })
                }
                styles={customStyles}
                placeholder="カテゴリを選択..."
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}