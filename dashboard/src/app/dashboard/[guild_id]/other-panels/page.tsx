'use client';
import { useState, useEffect } from 'react';
import Select from 'react-select';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { toast } from 'react-hot-toast';
import { LayoutPanelTop, Plus, Trash2, CheckCircle2, Send } from 'lucide-react';
import PageHeader from '@/components/PageHeader';

type ReactionRoleEntry = { role_id: string; emoji: string };

type PanelConfig = {
  id: number;
  channel_id: string;
  panel_title: string;
  panel_description: string;
  reaction_roles: ReactionRoleEntry[];
  submitting: boolean;
  installed: boolean;
  activeEmojiPicker: number | null;
};

const defaultPanel = (id: number): PanelConfig => ({
  id,
  channel_id: '',
  panel_title: 'ロール付与パネル',
  panel_description: '以下のリアクションを押してロールを取得してください。',
  reaction_roles: [{ role_id: '', emoji: '' }],
  submitting: false,
  installed: false,
  activeEmojiPicker: null,
});

export default function OtherPanelsSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;

  const [channels, setChannels] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panels, setPanels] = useState<PanelConfig[]>([defaultPanel(Date.now())]);
  const [nextId, setNextId] = useState(Date.now() + 1);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/roles`).then(res => res.ok ? res.json() : [])
    ]).then(([channelsData, rolesData]: [any, any]) => {
      if (!channelsData.error) setChannels(channelsData.filter((c: any) => c.type === 0));
      if (!rolesData.error) setRoles(rolesData.filter((r: any) => r.id !== guildId));
    }).catch(() => {
      setError('データの取得に失敗しました');
    }).finally(() => setLoading(false));
  }, [guildId]);

  const updatePanel = (id: number, updates: Partial<PanelConfig>) => {
    setPanels(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const addPanel = () => {
    setPanels(prev => [...prev, defaultPanel(nextId)]);
    setNextId(n => n + 1);
  };

  const removePanel = (id: number) => {
    setPanels(prev => prev.filter(p => p.id !== id));
  };

  const addReactionRole = (id: number) => {
    setPanels(prev => prev.map(p =>
      p.id === id ? { ...p, reaction_roles: [...p.reaction_roles, { role_id: '', emoji: '' }] } : p
    ));
  };

  const removeReactionRole = (panelId: number, index: number) => {
    setPanels(prev => prev.map(p => {
      if (p.id !== panelId) return p;
      const newRoles = [...p.reaction_roles];
      newRoles.splice(index, 1);
      return { ...p, reaction_roles: newRoles };
    }));
  };

  const updateReactionRole = (panelId: number, index: number, field: 'role_id' | 'emoji', value: string) => {
    setPanels(prev => prev.map(p => {
      if (p.id !== panelId) return p;
      const newRoles = [...p.reaction_roles];
      newRoles[index] = { ...newRoles[index], [field]: value };
      return { ...p, reaction_roles: newRoles };
    }));
  };

  const handleSubmit = async (panel: PanelConfig) => {
    if (!panel.channel_id) { toast.error('送信先チャンネルを選択してください。'); return; }
    if (!panel.panel_title) { toast.error('パネルのタイトルを入力してください。'); return; }

    const validReactionRoles = panel.reaction_roles.filter(r => r.role_id && r.emoji);
    if (validReactionRoles.length === 0) {
      toast.error('最低1つのロールと絵文字のペアを設定してください。');
      return;
    }
    if (!confirm('この内容でDiscordにパネルを設置しますか？')) return;

    updatePanel(panel.id, { submitting: true });
    try {
      const res = await fetch(`/api/guilds/${guildId}/other-panels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: panel.channel_id,
          title: panel.panel_title,
          description: panel.panel_description,
          reaction_roles: validReactionRoles
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('パネルの設置に成功しました！');
        updatePanel(panel.id, { installed: true, submitting: false });
      } else {
        toast.error(`設置に失敗しました: ${data.error || '不明なエラー'}`);
        updatePanel(panel.id, { submitting: false });
      }
    } catch {
      toast.error('通信エラーが発生しました。');
      updatePanel(panel.id, { submitting: false });
    }
  };

  if (loading) return <div className="text-zinc-400">読み込み中...</div>;

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <PageHeader icon={LayoutPanelTop} title="その他パネル設定" subtitle="任意ロールパネルを複数のチャンネルにそれぞれ独立して設置できます" guildId={guildId} healthKey="other-panels" />

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

<<<<<<< HEAD
      <div className="space-y-6">
        {panels.map((panel, panelIndex) => (
          <div key={panel.id} className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl relative">
=======
      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl max-w-3xl">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-zinc-300 mb-2">送信先チャンネル <span className="text-red-500">*</span></label>
            <ChannelSelect
              label="送信先チャンネル"
              placeholder="パネルを送信するチャンネルを選択..."
              value={formData.channel_id}
              onChange={(id) => setFormData({ ...formData, channel_id: id })}
              channels={channels}
              multiple={false}
            />
          </div>
>>>>>>> f0d1aeb059f3c0733e50ba1fdf9848e56a4ffa41

            {/* パネルヘッダー */}
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-zinc-700">
              <div className="flex items-center gap-2">
                <span className="text-zinc-400 text-sm font-mono">パネル #{panelIndex + 1}</span>
                {panel.installed && (
                  <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-900/40 border border-emerald-700/50 px-2 py-0.5 rounded-full">
                    <CheckCircle2 size={11} /> 設置済み
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {panel.installed && (
                  <button
                    onClick={() => updatePanel(panel.id, { installed: false })}
                    className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 border border-zinc-700 rounded transition-colors"
                  >
                    再編集
                  </button>
                )}
                {panels.length > 1 && (
                  <button
                    onClick={() => removePanel(panel.id)}
                    className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors"
                    title="このパネルを削除"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>

            <div className={`space-y-5 ${panel.installed ? 'opacity-50 pointer-events-none' : ''}`}>
              {/* チャンネル選択 */}
              <div>
                <label className="block text-sm font-bold text-zinc-300 mb-2">送信先チャンネル <span className="text-red-500">*</span></label>
                <Select
                  options={channelOptions}
                  value={channelOptions.find(o => o.value === panel.channel_id) || null}
                  onChange={(val: any) => updatePanel(panel.id, { channel_id: val ? val.value : '' })}
                  styles={customStyles}
                  placeholder="パネルを送信するチャンネルを選択..."
                />
              </div>

<<<<<<< HEAD
              {/* タイトル */}
              <div>
                <label className="block text-sm font-bold text-zinc-300 mb-2">パネルのタイトル <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={panel.panel_title}
                  onChange={e => updatePanel(panel.id, { panel_title: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all"
                  placeholder="例: ロール付与パネル"
                />
              </div>

              {/* 説明文 */}
              <div>
                <label className="block text-sm font-bold text-zinc-300 mb-2">パネルの説明文</label>
                <textarea
                  value={panel.panel_description}
                  onChange={e => updatePanel(panel.id, { panel_description: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all min-h-[100px]"
                  placeholder="例: 以下のリアクションを押してロールを取得してください。"
                />
              </div>

              {/* ロールと絵文字 */}
              <div>
                <label className="block text-sm font-bold text-zinc-300 mb-3 border-b border-zinc-700 pb-2">ロールと絵文字の設定 <span className="text-red-500">*</span></label>
                <div className="space-y-3">
                  {panel.reaction_roles.map((rr, index) => (
                    <div key={index} className="flex flex-col md:flex-row items-start md:items-center gap-3 bg-zinc-900 p-3 rounded-lg border border-zinc-700">
                      <div className="flex-1 w-full">
                        <Select
                          options={roleOptions}
                          value={roleOptions.find(o => o.value === rr.role_id) || null}
                          onChange={(val: any) => updateReactionRole(panel.id, index, 'role_id', val ? val.value : '')}
                          styles={customStyles}
                          placeholder="付与するロール..."
                        />
                      </div>
                      <div className="w-full md:w-64 relative">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={rr.emoji}
                            onChange={e => updateReactionRole(panel.id, index, 'emoji', e.target.value)}
                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500"
                            placeholder="絵文字 (例: 🍎)"
                          />
                          <button
                            type="button"
                            onClick={() => updatePanel(panel.id, { activeEmojiPicker: panel.activeEmojiPicker === index ? null : index })}
                            className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 rounded transition-colors text-lg"
                            title="絵文字を選択"
                          >
                            😊
                          </button>
                        </div>
                        {panel.activeEmojiPicker === index && (
                          <div className="absolute top-12 right-0 z-50">
                            <div className="fixed inset-0" onClick={() => updatePanel(panel.id, { activeEmojiPicker: null })} />
                            <div className="relative shadow-2xl border border-zinc-700 rounded-lg overflow-hidden">
                              <EmojiPicker
                                theme={Theme.DARK}
                                onEmojiClick={(emojiData) => {
                                  updateReactionRole(panel.id, index, 'emoji', emojiData.emoji);
                                  updatePanel(panel.id, { activeEmojiPicker: null });
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
=======
          <div>
            <label className="block text-sm font-bold text-zinc-300 mb-4 border-b border-zinc-700 pb-2">ロールと絵文字の設定 <span className="text-red-500">*</span></label>
            
            <div className="space-y-3">
              {formData.reaction_roles.map((rr, index) => (
                <div key={index} className="flex flex-col md:flex-row items-start md:items-center gap-3 bg-zinc-900 p-3 rounded-lg border border-zinc-700">
                  <div className="flex-1 w-full">
                    <RoleSelect
                      label="付与するロール"
                      placeholder="付与するロール..."
                      value={rr.role_id}
                      onChange={(id) => handleChangeReactionRole(index, 'role_id', id)}
                      roles={roles}
                      multiple={false}
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
>>>>>>> f0d1aeb059f3c0733e50ba1fdf9848e56a4ffa41
                      <button
                        onClick={() => removeReactionRole(panel.id, index)}
                        className="p-2 text-zinc-500 hover:text-red-500 hover:bg-zinc-800 rounded transition-colors"
                        disabled={panel.reaction_roles.length <= 1}
                        title="この設定を削除"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => addReactionRole(panel.id)}
                  className="mt-3 text-sm text-red-400 hover:text-red-300 font-bold flex items-center gap-1"
                >
                  ＋ さらに追加する
                </button>
              </div>

              {/* 設置ボタン */}
              <div className="pt-4 border-t border-zinc-700 flex justify-end">
                <button
                  onClick={() => handleSubmit(panel)}
                  disabled={panel.submitting}
                  className="mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg font-bold shadow-lg transition-colors flex items-center gap-2"
                >
                  <Send size={15} />
                  {panel.submitting ? '設置しています...' : 'このパネルを設置する'}
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* パネル追加ボタン */}
        <button
          onClick={addPanel}
          className="w-full border-2 border-dashed border-zinc-700 hover:border-red-600/60 text-zinc-500 hover:text-red-400 py-5 rounded-xl transition-colors flex items-center justify-center gap-2 font-bold"
        >
          <Plus size={18} />
          別の場所にパネルを追加する
        </button>
      </div>
    </div>
  );
}
