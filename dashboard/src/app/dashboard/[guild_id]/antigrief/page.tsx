'use client';
import { useState, useEffect } from 'react';
import Select from 'react-select';
import { toast } from 'react-hot-toast';
import { ShieldAlert } from 'lucide-react';
import PageHeader from '@/components/PageHeader';

export default function AntigriefSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  
  const [settings, setSettings] = useState<any>({
    ENABLE_ANTIGRIEF: true,
    target_category_ids: [],
    target_channel_ids: [],
    exempt_role_ids: []
  });
  
  const [channels, setChannels] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        exempt_role_ids: settingsData.exempt_role_ids?.map(String) || []
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
      const res = await fetch(`/api/guilds/${guildId}/antigrief`, {
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
      <PageHeader icon={ShieldAlert} title="荒らし対策設定" subtitle="不審な操作からサーバーを自動で守ります" guildId={guildId} healthKey="antigrief" />

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
              <p className="text-sm text-zinc-400">連投スパムやメンションスパムを自動で検知し、ユーザーをミュートする機能を有効にします。</p>
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
              <Select
                isMulti
                options={categoryOptions}
                value={categoryOptions.filter(o => settings.target_category_ids.includes(o.value))}
                onChange={(selected) => setSettings({...settings, target_category_ids: selected.map((s: any) => s.value)})}
                placeholder="カテゴリーを選択..."
                styles={customStyles}
                noOptionsMessage={() => "見つかりません"}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                対象チャンネル
              </label>
              <Select
                isMulti
                options={textChannelOptions}
                value={textChannelOptions.filter(o => settings.target_channel_ids.includes(o.value))}
                onChange={(selected) => setSettings({...settings, target_channel_ids: selected.map((s: any) => s.value)})}
                placeholder="チャンネルを選択..."
                styles={customStyles}
                noOptionsMessage={() => "見つかりません"}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                免除ロール
              </label>
              <p className="text-xs text-zinc-500 mb-2">このロールを持つユーザーは、荒らし対策の監視対象から外れます。</p>
              <Select
                isMulti
                options={roleOptions}
                value={roleOptions.filter(o => settings.exempt_role_ids.includes(o.value))}
                onChange={(selected) => setSettings({...settings, exempt_role_ids: selected.map((s: any) => s.value)})}
                placeholder="免除ロールを選択..."
                styles={customStyles}
                noOptionsMessage={() => "見つかりません"}
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
