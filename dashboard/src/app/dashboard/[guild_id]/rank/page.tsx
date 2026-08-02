'use client';
import { useState, useEffect } from 'react';
import Select from 'react-select';
import { toast } from 'react-hot-toast';
import { Trophy } from 'lucide-react';
import PageHeader from '@/components/PageHeader';

export default function RankSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  
  const [settings, setSettings] = useState<any>({
    ENABLE_TC_RANK: true,
    whitelist_channel_ids: [],
    blacklist_channel_ids: [],
    whitelist_category_ids: [],
    blacklist_category_ids: [],
    ENABLE_EXCLUDE_RANK_ROLE: false,
    EXCLUDE_RANK_ROLE_IDS: [],
    ephemeral_rank_commands: false
  });
  
  const [channels, setChannels] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/rank`).then(res => res.ok ? res.json() : {}),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/roles`).then(res => res.ok ? res.json() : [])
    ]).then(([settingsData, channelsData, rolesData]: [any, any, any]) => {
      setSettings({
        ENABLE_TC_RANK: settingsData.ENABLE_TC_RANK ?? true,
        whitelist_channel_ids: settingsData.whitelist_channel_ids?.map(String) || [],
        blacklist_channel_ids: settingsData.blacklist_channel_ids?.map(String) || [],
        whitelist_category_ids: settingsData.whitelist_category_ids?.map(String) || [],
        blacklist_category_ids: settingsData.blacklist_category_ids?.map(String) || [],
        ENABLE_EXCLUDE_RANK_ROLE: settingsData.ENABLE_EXCLUDE_RANK_ROLE ?? false,
        EXCLUDE_RANK_ROLE_IDS: settingsData.EXCLUDE_RANK_ROLE_IDS?.map(String) || [],
        ephemeral_rank_commands: settingsData.ephemeral_rank_commands ?? false
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
  }, [guildId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/rank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (!res.ok) throw new Error('保存に失敗しました');
      toast.success('保存しました');
    } catch (err) {
      console.error(err);
      setError('設定の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const textChannels = channels.filter(c => c.type === 0 || c.type === 2); // Text and Voice
  const categories = channels.filter(c => c.type === 4); // Categories

  const textChannelOptions = textChannels.map(c => ({ value: c.id, label: `${c.type === 0 ? '#' : '🔊'} ${c.name}` }));
  const categoryOptions = categories.map(c => ({ value: c.id, label: `📁 ${c.name}` }));
  const roleOptions = roles.map(r => ({ value: r.id, label: `@${r.name}` }));

  const customStyles = {
    control: (base: any) => ({ ...base, backgroundColor: '#27272a', borderColor: '#3f3f46', color: 'white' }),
    menu: (base: any) => ({ ...base, backgroundColor: '#27272a', zIndex: 9999 }),
    option: (base: any, state: any) => ({
      ...base,
      backgroundColor: state.isFocused ? '#3f3f46' : '#27272a',
      color: 'white',
      ':active': { backgroundColor: '#52525b' }
    }),
    multiValue: (base: any) => ({ ...base, backgroundColor: '#3f3f46' }),
    multiValueLabel: (base: any) => ({ ...base, color: 'white' })
  };

  if (loading) return <div className="text-zinc-400">読み込み中...</div>;

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <PageHeader icon={Trophy} title="ランク・経験値設定" subtitle="発言や活動に応じた経験値・ランクを設定します" />

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
              <p className="font-bold text-white mb-1">TC (テキストチャット) ランク機能</p>
              <p className="text-sm text-zinc-400">テキストチャンネルでメッセージを送信した際に経験値を獲得するかどうかを設定します。</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer"
                checked={settings.ENABLE_TC_RANK}
                onChange={e => setSettings({...settings, ENABLE_TC_RANK: e.target.checked})}
              />
              <div className="w-14 h-7 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-red-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between bg-zinc-900 p-4 rounded border border-zinc-700 mt-4">
            <div>
              <p className="font-bold text-white mb-1">特定ロールへのランク付与を除外</p>
              <p className="text-sm text-zinc-400">オンにすると、下で指定したロールを持つユーザーにはレベルアップ時のロール報酬が付与されません。</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer"
                checked={settings.ENABLE_EXCLUDE_RANK_ROLE}
                onChange={e => setSettings({...settings, ENABLE_EXCLUDE_RANK_ROLE: e.target.checked})}
              />
              <div className="w-14 h-7 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-red-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between bg-zinc-900 p-4 rounded border border-zinc-700 mt-4">
            <div>
              <p className="font-bold text-white mb-1">ランクコマンドの秘匿設定</p>
              <p className="text-sm text-zinc-400">オンにすると、ランクやリーダーボードのコマンド結果が実行した本人にのみ表示されます。</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer"
                checked={settings.ephemeral_rank_commands}
                onChange={e => setSettings({...settings, ephemeral_rank_commands: e.target.checked})}
              />
              <div className="w-14 h-7 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-red-600"></div>
            </label>
          </div>

          {settings.ENABLE_EXCLUDE_RANK_ROLE && (
            <div className="bg-zinc-900/50 p-4 rounded border border-zinc-700 mt-4">
              <label className="block text-sm font-bold text-zinc-300 mb-2">除外対象ロール</label>
              <p className="text-xs text-zinc-500 mb-2">ここで選択したロールを持つユーザーは、レベル到達時の新しいロールが付与されません（XPは獲得できます）</p>
              <Select
                isMulti
                options={roleOptions}
                value={roleOptions.filter(o => settings.EXCLUDE_RANK_ROLE_IDS.includes(o.value))}
                onChange={(selected: any) => setSettings({...settings, EXCLUDE_RANK_ROLE_IDS: selected.map((s: any) => s.value)})}
                styles={customStyles}
                placeholder="除外するロールを選択..."
              />
            </div>
          )}
        </div>

        {/* チャンネル設定 */}
        <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl">
          <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">経験値獲得の対象チャンネル・カテゴリ</h2>
          <p className="text-sm text-zinc-400 mb-6">
            経験値（XP）を獲得できるチャンネルと、できないチャンネルを指定します。<br/>
            ホワイトリストを指定すると**そのチャンネルのみ**で経験値を獲得でき、ブラックリストを指定すると**そのチャンネル以外**で獲得できるようになります。<br/>
            (※両方指定した場合、システムが競合する可能性がありますのでご注意ください)
          </p>
          
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-zinc-300 mb-2">ホワイトリスト: カテゴリ</label>
              <p className="text-xs text-zinc-500 mb-2">このカテゴリ内のチャンネルでのみXPを獲得します。</p>
              <Select
                isMulti
                options={categoryOptions}
                value={categoryOptions.filter(o => settings.whitelist_category_ids.includes(o.value))}
                onChange={(selected: any) => setSettings({...settings, whitelist_category_ids: selected.map((s: any) => s.value)})}
                styles={customStyles}
                placeholder="カテゴリを選択..."
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-zinc-300 mb-2">ホワイトリスト: チャンネル</label>
              <p className="text-xs text-zinc-500 mb-2">このチャンネルでのみXPを獲得します。</p>
              <Select
                isMulti
                options={textChannelOptions}
                value={textChannelOptions.filter(o => settings.whitelist_channel_ids.includes(o.value))}
                onChange={(selected: any) => setSettings({...settings, whitelist_channel_ids: selected.map((s: any) => s.value)})}
                styles={customStyles}
                placeholder="チャンネルを選択..."
              />
            </div>

            <div className="h-px bg-zinc-700 my-4"></div>

            <div>
              <label className="block text-sm font-bold text-zinc-300 mb-2">ブラックリスト: カテゴリ</label>
              <p className="text-xs text-zinc-500 mb-2">このカテゴリ内のチャンネルではXPを獲得できません。</p>
              <Select
                isMulti
                options={categoryOptions}
                value={categoryOptions.filter(o => settings.blacklist_category_ids.includes(o.value))}
                onChange={(selected: any) => setSettings({...settings, blacklist_category_ids: selected.map((s: any) => s.value)})}
                styles={customStyles}
                placeholder="カテゴリを選択..."
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-zinc-300 mb-2">ブラックリスト: チャンネル</label>
              <p className="text-xs text-zinc-500 mb-2">このチャンネルではXPを獲得できません。</p>
              <Select
                isMulti
                options={textChannelOptions}
                value={textChannelOptions.filter(o => settings.blacklist_channel_ids.includes(o.value))}
                onChange={(selected: any) => setSettings({...settings, blacklist_channel_ids: selected.map((s: any) => s.value)})}
                styles={customStyles}
                placeholder="チャンネルを選択..."
              />
            </div>

          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-64 right-0 p-4 bg-zinc-900/90 backdrop-blur border-t border-zinc-800 flex justify-end z-10">
        <button
          onClick={handleSave}
          disabled={saving}
          className="mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-50 text-white px-8 py-2 rounded font-bold shadow-lg transition-colors"
        >
          {saving ? '保存中...' : '設定を保存'}
        </button>
      </div>
    </div>
  );
}