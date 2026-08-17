'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { toast } from 'react-hot-toast';
import { LayoutPanelTop, Plus, Trash2, CheckCircle2, Send, X, Smile } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import ChannelSelect from '@/components/ChannelSelect';
import RoleSelect from '@/components/RoleSelect';

type ReactionRoleEntry = { role_id: string; emoji: string };

type PanelConfig = {
  id: number;
  channel_id: string;
  panel_title: string;
  panel_description: string;
  reaction_roles: ReactionRoleEntry[];
  submitting: boolean;
  installed: boolean;
  activeEmojiPicker: number | 'description' | 'title' | null;
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
  const [mounted, setMounted] = useState(false);

  const [panels, setPanels] = useState<PanelConfig[]>([defaultPanel(1)]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/roles`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/other-panels`).then(res => res.ok ? res.json() : [])
    ]).then(([channelsData, rolesData, savedData]: [any, any, any]) => {
      if (!channelsData.error) {
        setChannels(channelsData.filter((c: any) => c.type === 0));
      }
      if (!rolesData.error) {
        setRoles(rolesData.filter((r: any) => r.id !== guildId));
      }
      if (Array.isArray(savedData) && savedData.length > 0) {
        const loaded: PanelConfig[] = savedData.map((s: any, i: number) => ({
          id: i + 1,
          channel_id: s.channel_id || '',
          panel_title: s.panel_title || 'ロール付与パネル',
          panel_description: s.panel_description || '',
          reaction_roles: (s.reaction_roles && s.reaction_roles.length > 0)
            ? s.reaction_roles
            : [{ role_id: '', emoji: '' }],
          submitting: false,
          installed: !!s.message_id,
          activeEmojiPicker: null,
        }));
        setPanels(loaded);
      }
    }).catch(err => {
      console.error(err);
      setError('データの取得に失敗しました');
    }).finally(() => {
      setLoading(false);
    });
  }, [guildId]);

  const updatePanel = (id: number, updates: Partial<PanelConfig>) => {
    setPanels(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const addPanel = () => {
    const nextId = Math.max(0, ...panels.map(p => p.id)) + 1;
    setPanels(prev => [...prev, defaultPanel(nextId)]);
  };

  const removePanel = (id: number) => {
    if (panels.length <= 1) return;
    setPanels(prev => prev.filter(p => p.id !== id));
  };

  const addReactionRole = (panelId: number) => {
    setPanels(prev => prev.map(p => {
      if (p.id !== panelId) return p;
      return { ...p, reaction_roles: [...p.reaction_roles, { role_id: '', emoji: '' }] };
    }));
  };

  const updateReactionRole = (panelId: number, index: number, field: keyof ReactionRoleEntry, value: string) => {
    setPanels(prev => prev.map(p => {
      if (p.id !== panelId) return p;
      const updated = [...p.reaction_roles];
      updated[index] = { ...updated[index], [field]: value };
      return { ...p, reaction_roles: updated };
    }));
  };

  const removeReactionRole = (panelId: number, index: number) => {
    setPanels(prev => prev.map(p => {
      if (p.id !== panelId) return p;
      return { ...p, reaction_roles: p.reaction_roles.filter((_, i) => i !== index) };
    }));
  };

  const handleSubmit = async (panel: PanelConfig) => {
    if (!panel.channel_id) {
      toast.error('送信先チャンネルを選択してください');
      return;
    }
    const validPairs = panel.reaction_roles.filter(rr => rr.role_id && rr.emoji);
    if (validPairs.length === 0) {
      toast.error('ロールと絵文字のペアを最低1つ設定してください');
      return;
    }

    updatePanel(panel.id, { submitting: true });
    try {
      const res = await fetch(`/api/guilds/${guildId}/other-panels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: panel.channel_id,
          panel_title: panel.panel_title,
          panel_description: panel.panel_description,
          reaction_roles: validPairs,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error(`設置に失敗しました: ${data.error || 'エラー'}`);
      } else {
        toast.success(`パネル #${panel.id} を設置しました！`);
        updatePanel(panel.id, { installed: true });
      }
    } catch (err: any) {
      toast.error(`エラーが発生しました: ${err.message}`);
    } finally {
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

      <div className="space-y-6">
        {panels.map((panel, panelIndex) => (
          <div key={panel.id} className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl relative">

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
              {/* 送信先チャンネル */}
              <div>
                <label className="block text-sm font-bold text-zinc-300 mb-2">送信先チャンネル <span className="text-red-500">*</span></label>
                <ChannelSelect
                  label="送信先チャンネル"
                  placeholder="パネルを送信するチャンネルを選択..."
                  value={panel.channel_id}
                  onChange={(val: any) => updatePanel(panel.id, { channel_id: val || '' })}
                  channels={channels}
                  multiple={false}
                />
              </div>

              {/* パネルのタイトル */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-bold text-zinc-300">パネルのタイトル <span className="text-red-500">*</span></label>
                  <button
                    type="button"
                    onClick={() => updatePanel(panel.id, { activeEmojiPicker: panel.activeEmojiPicker === 'title' ? null : 'title' })}
                    className="flex items-center gap-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white px-2 py-0.5 rounded border border-zinc-700 transition-colors font-tech"
                    title="タイトルに絵文字を挿入"
                  >
                    <Smile size={13} />
                    <span>絵文字</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={panel.panel_title}
                  onChange={e => updatePanel(panel.id, { panel_title: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all font-tech"
                  placeholder="例: 📜 ロール付与パネル"
                />

                {/* タイトル用 絵文字ピッカー モーダル */}
                {panel.activeEmojiPicker === 'title' && mounted && createPortal(
                  <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
                    <div 
                      className="fixed inset-0" 
                      onClick={() => updatePanel(panel.id, { activeEmojiPicker: null })} 
                    />
                    <div className="relative z-10 shadow-2xl border border-zinc-700 rounded-2xl overflow-hidden bg-zinc-900 p-3 flex flex-col items-center">
                      <div className="w-full flex items-center justify-between pb-2 mb-2 border-b border-zinc-800 px-1">
                        <span className="text-sm font-bold text-white font-tech">タイトルに絵文字を挿入</span>
                        <button
                          type="button"
                          onClick={() => updatePanel(panel.id, { activeEmojiPicker: null })}
                          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                        >
                          <X size={18} />
                        </button>
                      </div>
                      <EmojiPicker
                        theme={Theme.DARK}
                        width={350}
                        height={420}
                        onEmojiClick={(emojiData) => {
                          updatePanel(panel.id, { 
                            panel_title: (panel.panel_title || '') + emojiData.emoji,
                            activeEmojiPicker: null 
                          });
                        }}
                      />
                    </div>
                  </div>,
                  document.body
                )}
              </div>

              {/* パネルの説明文 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-bold text-zinc-300">パネルの説明文</label>
                  <button
                    type="button"
                    onClick={() => updatePanel(panel.id, { activeEmojiPicker: panel.activeEmojiPicker === 'description' ? null : 'description' })}
                    className="flex items-center gap-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white px-2 py-0.5 rounded border border-zinc-700 transition-colors font-tech"
                    title="説明文に絵文字を挿入"
                  >
                    <Smile size={13} />
                    <span>絵文字を挿入</span>
                  </button>
                </div>
                <textarea
                  value={panel.panel_description}
                  onChange={e => updatePanel(panel.id, { panel_description: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all min-h-[100px] font-tech"
                  placeholder="例: 以下のリアクションを押してロールを取得してください。"
                />

                {/* 説明文用 絵文字ピッカー モーダル */}
                {panel.activeEmojiPicker === 'description' && mounted && createPortal(
                  <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
                    <div 
                      className="fixed inset-0" 
                      onClick={() => updatePanel(panel.id, { activeEmojiPicker: null })} 
                    />
                    <div className="relative z-10 shadow-2xl border border-zinc-700 rounded-2xl overflow-hidden bg-zinc-900 p-3 flex flex-col items-center">
                      <div className="w-full flex items-center justify-between pb-2 mb-2 border-b border-zinc-800 px-1">
                        <span className="text-sm font-bold text-white font-tech">説明文に絵文字を挿入</span>
                        <button
                          type="button"
                          onClick={() => updatePanel(panel.id, { activeEmojiPicker: null })}
                          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                        >
                          <X size={18} />
                        </button>
                      </div>
                      <EmojiPicker
                        theme={Theme.DARK}
                        width={350}
                        height={420}
                        onEmojiClick={(emojiData) => {
                          updatePanel(panel.id, { 
                            panel_description: (panel.panel_description || '') + emojiData.emoji,
                            activeEmojiPicker: null 
                          });
                        }}
                      />
                    </div>
                  </div>,
                  document.body
                )}
              </div>

              {/* ロールと絵文字の設定 */}
              <div>
                <label className="block text-sm font-bold text-zinc-300 mb-3 border-b border-zinc-700 pb-2">ロールと絵文字の設定 <span className="text-red-500">*</span></label>
                <div className="space-y-3">
                  {panel.reaction_roles.map((rr, index) => (
                    <div key={index} className="flex flex-col md:flex-row items-start md:items-center gap-3 bg-zinc-900 p-3 rounded-lg border border-zinc-700">
                      <div className="flex-1 w-full">
                        <RoleSelect
                          label="付与ロール"
                          placeholder="付与するロールを選択..."
                          value={rr.role_id}
                          onChange={(val: any) => updateReactionRole(panel.id, index, 'role_id', val || '')}
                          roles={roles}
                          multiple={false}
                        />
                      </div>
                      <div className="w-full md:w-64 relative">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={rr.emoji}
                            onChange={e => updateReactionRole(panel.id, index, 'emoji', e.target.value)}
                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500 font-tech"
                            placeholder="絵文字 (例: 🍎)"
                          />
                          <button
                            type="button"
                            onClick={() => updatePanel(panel.id, { activeEmojiPicker: panel.activeEmojiPicker === index ? null : index })}
                            className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 rounded transition-colors text-lg flex-shrink-0"
                            title="絵文字を選択"
                          >
                            😊
                          </button>
                        </div>

                        {/* 各行用 絵文字ピッカー モーダル */}
                        {panel.activeEmojiPicker === index && mounted && createPortal(
                          <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
                            <div 
                              className="fixed inset-0" 
                              onClick={() => updatePanel(panel.id, { activeEmojiPicker: null })} 
                            />
                            <div className="relative z-10 shadow-2xl border border-zinc-700 rounded-2xl overflow-hidden bg-zinc-900 p-3 flex flex-col items-center">
                              <div className="w-full flex items-center justify-between pb-2 mb-2 border-b border-zinc-800 px-1">
                                <span className="text-sm font-bold text-white font-tech">絵文字を選択</span>
                                <button
                                  type="button"
                                  onClick={() => updatePanel(panel.id, { activeEmojiPicker: null })}
                                  className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                                >
                                  <X size={18} />
                                </button>
                              </div>
                              <EmojiPicker
                                theme={Theme.DARK}
                                width={350}
                                height={420}
                                onEmojiClick={(emojiData) => {
                                  updateReactionRole(panel.id, index, 'emoji', emojiData.emoji);
                                  updatePanel(panel.id, { activeEmojiPicker: null });
                                }}
                              />
                            </div>
                          </div>,
                          document.body
                        )}
                      </div>
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
                  className="mt-3 text-sm text-red-400 hover:text-red-300 font-bold flex items-center gap-1 font-tech"
                >
                  ＋ さらに追加する
                </button>
              </div>

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

        <button
          onClick={addPanel}
          className="w-full border-2 border-dashed border-zinc-700 hover:border-red-600/60 text-zinc-500 hover:text-red-400 py-5 rounded-xl transition-colors flex items-center justify-center gap-2 font-bold font-tech"
        >
          <Plus size={18} />
          別の場所にパネルを追加する
        </button>
      </div>
    </div>
  );
}