'use client';

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { ClipboardCheck } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import ChannelSelect from '@/components/ChannelSelect';

export default function EvalSheetSettings({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const [settings, setSettings] = useState<any>({
    is_enabled: true,
    auto_generate_period: true,
    auto_fail_on_deadline: false,
    forum_channel_ids: [],
    self_intro_channel_ids: [],
    ENABLE_MINUS_PENALTY: false,
    MINUS_PUNISHMENT_TYPE: 'evaluation_failure'
  });
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/eval-sheet`).then(res => res.ok ? res.json() : {}),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : [])
    ]).then(([settingsData, channelsData]: [any, any]) => {
      if (settingsData && !settingsData.error) {
        setSettings({
          is_enabled: settingsData.is_enabled ?? true,
          auto_generate_period: settingsData.auto_generate_period ?? true,
          auto_fail_on_deadline: settingsData.auto_fail_on_deadline ?? false,
          forum_channel_ids: settingsData.forum_channel_ids ?? [],
          self_intro_channel_ids: settingsData.self_intro_channel_ids ?? [],
          ENABLE_MINUS_PENALTY: settingsData.ENABLE_MINUS_PENALTY ?? false,
          MINUS_PUNISHMENT_TYPE: settingsData.MINUS_PUNISHMENT_TYPE ?? 'evaluation_failure'
        });
      }
      if (channelsData && !channelsData.error && Array.isArray(channelsData)) {
        setChannels(channelsData);
      }
    }).catch(err => {
      console.error(err);
      toast.error('データの取得に失敗しました');
    }).finally(() => {
      setLoading(false);
    });
  }, [guildId]);

  const handleChange = (key: string, value: any) => {
    setSettings((prev: any) => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/eval-sheet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('設定を保存しました');
      } else {
        toast.error('エラーが発生しました: ' + (data.error || '保存に失敗しました'));
      }
    } catch (e) {
      toast.error('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-zinc-400 p-8">読み込み中...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto pb-20 space-y-6">
      <PageHeader 
        icon={ClipboardCheck} 
        title="評価シート自動生成設定" 
        subtitle="自己紹介チャンネルへの投稿を検知し、指定したフォーラムへ評価シートのスレッドを自動作成します" 
        guildId={guildId} 
        healthKey="eval-sheet" 
      />

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-6">
        <div className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
          <div>
            <h2 className="text-lg font-semibold text-white">評価シート自動生成機能</h2>
            <p className="text-sm text-zinc-400">この機能をONにすると、指定したチャンネルでの投稿を監視して自動作成を行います。</p>
          </div>
          <button 
            type="button"
            onClick={() => handleChange('is_enabled', !settings.is_enabled)}
            className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${settings.is_enabled ? 'bg-blue-600' : 'bg-zinc-700'}`}
          >
            <span className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settings.is_enabled ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
          <div>
            <h2 className="text-lg font-semibold text-white">評価期間の自動設定</h2>
            <p className="text-sm text-zinc-400">シート作成時に自動で評価期間（2週間など）を設定します。</p>
          </div>
          <button 
            type="button"
            onClick={() => handleChange('auto_generate_period', !settings.auto_generate_period)}
            className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${settings.auto_generate_period ? 'bg-blue-600' : 'bg-zinc-700'}`}
          >
            <span className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settings.auto_generate_period ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
          <div>
            <h2 className="text-lg font-semibold text-white">期限切れ時の自動「不合格」処理</h2>
            <p className="text-sm text-zinc-400">評価期間を過ぎても結果が出ていない場合、自動的に不合格（評価落ち）として処理します。</p>
          </div>
          <button 
            type="button"
            onClick={() => handleChange('auto_fail_on_deadline', !settings.auto_fail_on_deadline)}
            className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${settings.auto_fail_on_deadline ? 'bg-blue-600' : 'bg-zinc-700'}`}
          >
            <span className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settings.auto_fail_on_deadline ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
          <div>
            <h2 className="text-lg font-semibold text-white">通貨マイナス時の自動降格</h2>
            <p className="text-sm text-zinc-400">この機能をONにすると、所持コインがマイナスになった際に自動的に降格処理を行います。</p>
          </div>
          <button 
            type="button"
            onClick={() => handleChange('ENABLE_MINUS_PENALTY', !settings.ENABLE_MINUS_PENALTY)}
            className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${settings.ENABLE_MINUS_PENALTY ? 'bg-blue-600' : 'bg-zinc-700'}`}
          >
            <span className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settings.ENABLE_MINUS_PENALTY ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>

        {settings.ENABLE_MINUS_PENALTY && (
          <div className="flex flex-col p-4 bg-zinc-800/50 rounded-lg border border-zinc-700/50 space-y-2">
            <label className="text-lg font-semibold text-white">通貨マイナス時の降格先</label>
            <p className="text-sm text-zinc-400 mb-2">マイナスになった際、どのペナルティとして処理するかを選択します。</p>
            <select
              value={settings.MINUS_PUNISHMENT_TYPE}
              onChange={(e) => handleChange('MINUS_PUNISHMENT_TYPE', e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="evaluation_failure">評価落ち</option>
              <option value="violator">違反者</option>
            </select>
          </div>
        )}

        <div className={`space-y-6 transition-opacity duration-300 ${settings.is_enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-white">
              対象の自己紹介チャンネル (複数選択可)
            </label>
            <p className="text-xs text-zinc-400 mb-2">このチャンネルでメッセージが送信された際に、自動生成の対象となります。</p>
            <ChannelSelect
              label="対象の自己紹介チャンネル"
              placeholder="チャンネルを選択..."
              value={settings.self_intro_channel_ids}
              onChange={(val: any) => handleChange('self_intro_channel_ids', val)}
              channels={channels}
              multiple={true}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-white">
              評価シートを作成するフォーラム (複数選択可)
            </label>
            <p className="text-xs text-zinc-400 mb-2">上記の自己紹介チャンネルで投稿があった際、ここに評価スレッドが作成されます。</p>
            <ChannelSelect
              label="評価シートを作成するフォーラム"
              placeholder="フォーラムを選択..."
              value={settings.forum_channel_ids}
              onChange={(val: any) => handleChange('forum_channel_ids', val)}
              channels={channels.filter(c => c.type === 15)} // 15 is GUILD_FORUM type in Discord
              multiple={true}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <button 
          onClick={handleSave} 
          disabled={saving}
          className={`px-8 py-3 rounded-lg font-bold text-white shadow-lg transition-all ${
            saving ? 'bg-zinc-600 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 hover:scale-105'
          }`}
        >
          {saving ? '保存中...' : '設定を保存'}
        </button>
      </div>
    </div>
  );
}