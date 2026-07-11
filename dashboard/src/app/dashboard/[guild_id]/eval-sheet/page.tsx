'use client';

import { useState, useEffect } from 'react';

function CustomChannelSelect({ multiple, value, onChange, channels, loading }: { multiple: boolean, value: any, onChange: (val: any) => void, channels: any[], loading: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const valArray = multiple ? (Array.isArray(value) ? value : []) : (value ? [value] : []);

  if (loading) return <div className="bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-500 text-sm h-10 flex items-center">読み込み中...</div>;

  const toggleOption = (id: string) => {
    if (multiple) {
      if (valArray.includes(id)) {
        onChange(valArray.filter((v: string) => v !== id));
      } else {
        onChange([...valArray, id]);
      }
    } else {
      onChange(id);
      setIsOpen(false);
    }
  };

  const selectedChannels = channels.filter(c => valArray.includes(c.id));

  return (
    <div className="relative">
      <div 
        className="bg-zinc-900 border border-zinc-700 rounded p-2 min-h-10 cursor-pointer flex flex-wrap gap-2 items-center"
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedChannels.length === 0 ? (
          <span className="text-zinc-500 text-sm">未設定</span>
        ) : (
          selectedChannels.map(c => (
            <span key={c.id} className="bg-zinc-800 text-white px-2 py-1 rounded text-sm flex items-center border border-zinc-600">
              # {c.name}
              {multiple && (
                <button 
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleOption(c.id); }}
                  className="ml-2 text-zinc-400 hover:text-red-400 font-bold"
                >&times;</button>
              )}
            </span>
          ))
        )}
      </div>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)}></div>
          <div className="absolute z-20 mt-1 w-full bg-zinc-900 border border-zinc-700 rounded shadow-xl max-h-60 overflow-y-auto">
            {!multiple && (
              <div 
                className="p-3 hover:bg-zinc-800 cursor-pointer text-zinc-400 italic border-b border-zinc-800"
                onClick={() => { onChange(''); setIsOpen(false); }}
              >
                未設定にする
              </div>
            )}
            {channels.map(c => {
              const isSelected = valArray.includes(c.id);
              return (
                <div 
                  key={c.id} 
                  className={`p-3 hover:bg-zinc-800 cursor-pointer flex items-center transition-colors ${isSelected ? 'bg-zinc-800' : ''}`}
                  onClick={() => toggleOption(c.id)}
                >
                  {multiple && (
                    <div className={`w-4 h-4 rounded border flex items-center justify-center mr-3 ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-zinc-500'}`}>
                      {isSelected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                    </div>
                  )}
                  <span className={isSelected ? 'font-bold text-white' : 'text-zinc-300'}># {c.name}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}


export default function EvalSheetSettings({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const [settings, setSettings] = useState<any>({
    is_enabled: true,
    forum_channel_ids: [],
    self_intro_channel_ids: []
  });
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.json()),
      fetch(`/api/guilds/${guildId}/eval-sheet`).then(res => res.json())
    ])
    .then(([channelsData, settingsData]) => {
      if (!channelsData.error) {
        setChannels(channelsData);
      }
      if (!settingsData.error) {
        setSettings(settingsData);
      }
    })
    .catch(console.error)
    .finally(() => setLoading(false));
  }, [guildId]);

  const handleChange = (key: string, value: any) => {
    setSettings((prev: any) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/eval-sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (data.success) {
        alert('設定を保存しました！');
      } else {
        alert('エラーが発生しました: ' + data.error);
      }
    } catch (e) {
      alert('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-white p-8">読み込み中...</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">評価シート自動生成</h1>
        <p className="text-zinc-400">指定した自己紹介チャンネルで投稿があった際、自動的にフォーラムに評価用のスレッドを作成します。</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-6 shadow-xl">
        <div className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
          <div>
            <h2 className="text-lg font-semibold text-white">自動生成の有効化</h2>
            <p className="text-sm text-zinc-400">この機能をONにすると、自己紹介時に自動でスレッドが生成されます。</p>
          </div>
          <button 
            type="button"
            onClick={() => handleChange('is_enabled', !settings.is_enabled)}
            className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${settings.is_enabled ? 'bg-blue-600' : 'bg-zinc-700'}`}
          >
            <span className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settings.is_enabled ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className={`space-y-6 transition-opacity duration-300 ${settings.is_enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-white">
              対象の自己紹介チャンネル (複数選択可)
            </label>
            <p className="text-xs text-zinc-400 mb-2">このチャンネルでメッセージが送信された際に、自動生成の対象となります。</p>
            <CustomChannelSelect
              multiple={true}
              value={settings.self_intro_channel_ids}
              onChange={(val) => handleChange('self_intro_channel_ids', val)}
              channels={channels}
              loading={loading}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-white">
              評価シートを作成するフォーラム (複数選択可)
            </label>
            <p className="text-xs text-zinc-400 mb-2">上記の自己紹介チャンネルで投稿があった際、ここに評価スレッドが作成されます。</p>
            <CustomChannelSelect
              multiple={true}
              value={settings.forum_channel_ids}
              onChange={(val) => handleChange('forum_channel_ids', val)}
              channels={channels.filter(c => c.type === 15)} // 15 is GUILD_FORUM type in Discord
              loading={loading}
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
