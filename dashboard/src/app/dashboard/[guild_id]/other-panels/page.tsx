'use client';
import { useState, useEffect, useRef } from 'react';
import Select from 'react-select';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { toast } from 'react-hot-toast';
import { LayoutPanelTop } from 'lucide-react';
import PageHeader from '@/components/PageHeader';

export default function OtherPanelsSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  
  const [channels, setChannels] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeEmojiPicker, setActiveEmojiPicker] = useState<number | null>(null);
  
  const [formData, setFormData] = useState({
    channel_id: '',
    panel_title: 'ロール付与パネル',
    panel_description: '以下のリアクションを押してロールを取得してください。',
    reaction_roles: [{ role_id: '', emoji: '' }]
  });

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/roles`).then(res => res.ok ? res.json() : [])
    ]).then(([channelsData, rolesData]: [any, any]) => {
      if (!channelsData.error) {
        setChannels(channelsData.filter((c: any) => c.type === 0)); // Text channels only
      }
      if (!rolesData.error) {
        setRoles(rolesData.filter((r: any) => r.id !== guildId));
      }
    }).catch(err => {
      console.error(err);
      setError('データの取得に失敗しました');
    }).finally(() => {
      setLoading(false);
    });
  }, [guildId]);

  const handleAddReactionRole = () => {
    setFormData({
      ...formData,
      reaction_roles: [...formData.reaction_roles, { role_id: '', emoji: '' }]
    });
  };

  const handleRemoveReactionRole = (index: number) => {
    const newRoles = [...formData.reaction_roles];
    newRoles.splice(index, 1);
    setFormData({ ...formData, reaction_roles: newRoles });
  };

  const handleChangeReactionRole = (index: number, field: 'role_id' | 'emoji', value: string) => {
    const newRoles = [...formData.reaction_roles];
    newRoles[index][field] = value;
    setFormData({ ...formData, reaction_roles: newRoles });
  };

  const handleSubmit = async () => {
    if (!formData.channel_id) {
      toast.success('送信先チャンネルを選択してください。');
      return;
    }
    if (!formData.panel_title) {
      toast('パネルのタイトルを入力してください。');
      return;
    }
    
    const validReactionRoles = formData.reaction_roles.filter(r => r.role_id && r.emoji);
    if (validReactionRoles.length === 0) {
      toast.success('最低1つのロールと絵文字のペアを設定してください。');
      return;
    }

    if (!confirm('この内容でDiscordにパネルを設置しますか？')) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/other-panels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: formData.channel_id,
          title: formData.panel_title,
          description: formData.panel_description,
          reaction_roles: validReactionRoles
        })
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('パネルの設置に成功しました！');
        // Reset form to defaults
        setFormData({
          channel_id: '',
          panel_title: 'ロール付与パネル',
          panel_description: '以下のリアクションを押してロールを取得してください。',
          reaction_roles: [{ role_id: '', emoji: '' }]
        });
      } else {
        toast.error(`設置に失敗しました: ${data.error || '不明なエラー'}`);
      }
    } catch (e) {
      toast.error('通信エラーが発生しました。');
    } finally {
      setSubmitting(false);
    }
  };

  const roleOptions = roles.map(r => ({ value: r.id, label: `@${r.name}`, color: r.color }));
  const channelOptions = channels.map(c => ({ value: c.id, label: `# ${c.name}` }));

  const customStyles = {
    control: (base: any) => ({ ...base, backgroundColor: '#27272a', borderColor: '#3f3f46', color: 'white' }),
    menu: (base: any) => ({ ...base, backgroundColor: '#27272a', zIndex: 9999 }),
    option: (base: any, state: any) => ({
      ...base,
      backgroundColor: state.isFocused ? '#3f3f46' : '#27272a',
      color: state.data?.color ? `#${state.data.color.toString(16).padStart(6, '0')}` : 'white',
      ':active': { backgroundColor: '#52525b' }
    }),
    singleValue: (base: any) => ({ ...base, color: 'white' })
  };

  if (loading) return <div className="text-zinc-400">読み込み中...</div>;

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <PageHeader icon={LayoutPanelTop} title="その他パネル設定" subtitle="任意ロールパネル（リアクションでロールを付与・剥奪）をチャンネルに送信して設置します" />

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl max-w-3xl">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-zinc-300 mb-2">送信先チャンネル <span className="text-red-500">*</span></label>
            <Select
              options={channelOptions}
              value={channelOptions.find(o => o.value === formData.channel_id)}
              onChange={(val: any) => setFormData({ ...formData, channel_id: val ? val.value : '' })}
              styles={customStyles}
              placeholder="パネルを送信するチャンネルを選択..."
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-zinc-300 mb-2">パネルのタイトル <span className="text-red-500">*</span></label>
            <input 
              type="text" 
              value={formData.panel_title} 
              onChange={e => setFormData({...formData, panel_title: e.target.value})}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all" 
              placeholder="例: ロール付与パネル"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-zinc-300 mb-2">パネルの説明文</label>
            <textarea 
              value={formData.panel_description} 
              onChange={e => setFormData({...formData, panel_description: e.target.value})}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all min-h-[120px]" 
              placeholder="例: 以下のリアクションを押してロールを取得してください。"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-zinc-300 mb-4 border-b border-zinc-700 pb-2">ロールと絵文字の設定 <span className="text-red-500">*</span></label>
            
            <div className="space-y-3">
              {formData.reaction_roles.map((rr, index) => (
                <div key={index} className="flex flex-col md:flex-row items-start md:items-center gap-3 bg-zinc-900 p-3 rounded-lg border border-zinc-700">
                  <div className="flex-1 w-full">
                    <Select
                      options={roleOptions}
                      value={roleOptions.find(o => o.value === rr.role_id)}
                      onChange={(val: any) => handleChangeReactionRole(index, 'role_id', val ? val.value : '')}
                      styles={customStyles}
                      placeholder="付与するロール..."
                    />
                  </div>
                  <div className="w-full md:w-64 relative">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={rr.emoji}
                        onChange={e => handleChangeReactionRole(index, 'emoji', e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500"
                        placeholder="絵文字 (例: 🍎, <:name:id>)"
                      />
                      <button
                        type="button"
                        onClick={() => setActiveEmojiPicker(activeEmojiPicker === index ? null : index)}
                        className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 rounded transition-colors text-lg"
                        title="絵文字を選択"
                      >
                        😊
                      </button>
                    </div>
                    {activeEmojiPicker === index && (
                      <div className="absolute top-12 right-0 z-50">
                        <div className="fixed inset-0" onClick={() => setActiveEmojiPicker(null)}></div>
                        <div className="relative shadow-2xl border border-zinc-700 rounded-lg overflow-hidden">
                          <EmojiPicker 
                            theme={Theme.DARK} 
                            onEmojiClick={(emojiData) => {
                              handleChangeReactionRole(index, 'emoji', emojiData.emoji);
                              setActiveEmojiPicker(null);
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end w-full md:w-auto">
                    <button
                      onClick={() => handleRemoveReactionRole(index)}
                      className="p-2 text-zinc-500 hover:text-red-500 hover:bg-zinc-800 rounded transition-colors"
                      title="この設定を削除"
                      disabled={formData.reaction_roles.length <= 1}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            
            <button
              onClick={handleAddReactionRole}
              className="mt-3 text-sm text-red-400 hover:text-red-300 font-bold flex items-center gap-1"
            >
              ＋ さらに追加する
            </button>
          </div>

          <div className="pt-6 border-t border-zinc-700 flex justify-end">
            <button 
              onClick={handleSubmit}
              disabled={submitting}
              className="mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold shadow-lg transition-colors flex items-center gap-2"
            >
              {submitting ? '設置しています...' : '🚀 指定チャンネルにパネルを設置する'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
