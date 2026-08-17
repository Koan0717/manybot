'use client';
import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Ticket } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import ChannelSelect from '@/components/ChannelSelect';
import RoleSelect from '@/components/RoleSelect';

export default function TicketsSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  
  const [panels, setPanels] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPanel, setEditingPanel] = useState<any | null>(null);
  const [formData, setFormData] = useState({
    channel_id: '',
    panel_title: '',
    panel_description: '',
    button_label: 'チケット作成',
    button_emoji: '',
    mention_role_ids: [] as string[],
    target_role_ids: [] as string[],
    ticket_prefix: 'ticket',
    panel_type: 'custom_ticket'
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/tickets`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/roles`).then(res => res.ok ? res.json() : [])
    ]).then(([panelsData, channelsData, rolesData]: [any, any, any]) => {
      setPanels(Array.isArray(panelsData) ? panelsData : []);
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

  const handleDelete = async (channelId: string) => {
    if (!confirm('本当にこのチケットパネルを削除しますか？\n(既に送信されているパネルのメッセージは自動的には消えません)')) return;
    try {
      const res = await fetch(`/api/guilds/${guildId}/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', channel_id: channelId })
      });
      if (res.ok) {
        setPanels(prev => prev.filter(p => p.channel_id !== channelId));
      } else {
        toast.error('削除に失敗しました');
      }
    } catch (e) {
      toast.error('エラーが発生しました');
    }
  };

  const openModal = (panel: any = null) => {
    if (panel) {
      setEditingPanel(panel);
      setFormData({
        channel_id: panel.channel_id,
        panel_title: panel.panel_title || '',
        panel_description: panel.panel_description || '',
        button_label: panel.button_label || 'チケット作成',
        button_emoji: panel.button_emoji || '',
        mention_role_ids: panel.mention_role_ids?.map(String) || [],
        target_role_ids: panel.target_role_ids?.map(String) || [],
        ticket_prefix: panel.ticket_prefix || 'ticket',
        panel_type: panel.panel_type || 'custom_ticket'
      });
    } else {
      setEditingPanel(null);
      setFormData({
        channel_id: '',
        panel_title: 'お問い合わせ',
        panel_description: 'ボタンを押すとチケットが作成されます。',
        button_label: 'チケット作成',
        button_emoji: '🎫',
        mention_role_ids: [],
        target_role_ids: [],
        ticket_prefix: 'ticket',
        panel_type: 'custom_ticket'
      });
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPanel(null);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.channel_id) {
      toast.error('設置先チャンネルを選択してください');
      return;
    }
    if (!formData.panel_title) {
      toast.error('パネルのタイトルを入力してください');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          panel: formData,
          ...formData
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('チケットパネル設定を保存しました');
        // Update local list
        setPanels(prev => {
          const exists = prev.some(p => p.channel_id === formData.channel_id);
          if (exists) {
            return prev.map(p => p.channel_id === formData.channel_id ? { ...p, ...formData } : p);
          } else {
            return [...prev, { ...formData }];
          }
        });
        closeModal();
      } else {
        toast.error(`保存に失敗しました: ${data.error || '不明なエラー'}`);
      }
    } catch (e) {
      toast.error('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  const panelTypeOptions = [
    { value: 'custom_ticket', label: '🎫 汎用お問い合わせチケット' },
    { value: 'stamp', label: '🎨 スタンプ・紋章制作依頼チケット (担当製作者選択)' },
    { value: 'confession', label: '⛪ 懺悔室・告解チケット (告解司祭用)' },
    { value: 'interview', label: '📝 面接チケット' },
    { value: 'anonymous_chat', label: '🎭 匿名チャットチケット' }
  ];

  const handlePanelTypeChange = (newType: string) => {
    let presetTitle = formData.panel_title;
    let presetDesc = formData.panel_description;
    let presetLabel = formData.button_label;
    let presetEmoji = formData.button_emoji;
    let presetPrefix = formData.ticket_prefix;

    if (!editingPanel) {
      if (newType === 'stamp') {
        presetTitle = '🎨 スタンプ制作依頼';
        presetDesc = 'スタンプや紋章の制作を依頼したい方は下のボタンを押してください。\n担当可能な製作者を選択して依頼内容を入力できます。';
        presetLabel = 'スタンプを依頼する';
        presetEmoji = '🎨';
        presetPrefix = 'stamp';
      } else if (newType === 'confession') {
        presetTitle = '⛪ 懺悔室';
        presetDesc = '司祭に相談や告解を行いたい方は下のボタンを押してください。';
        presetLabel = '告解を申し込む';
        presetEmoji = '🙏';
        presetPrefix = 'confess';
      } else if (newType === 'interview') {
        presetTitle = '📝 面接・審査受付';
        presetDesc = '面接や審査を開始する方は下のボタンを押してください。';
        presetLabel = '面接を開始する';
        presetEmoji = '📝';
        presetPrefix = 'interview';
      } else if (newType === 'anonymous_chat') {
        presetTitle = '🎭 匿名チャット';
        presetDesc = '匿名で質問や意見を投稿できるチケットを作成します。';
        presetLabel = '匿名チケット作成';
        presetEmoji = '🎭';
        presetPrefix = 'anon';
      } else {
        presetTitle = 'お問い合わせ';
        presetDesc = 'ボタンを押すとチケットが作成されます。';
        presetLabel = 'チケット作成';
        presetEmoji = '🎫';
        presetPrefix = 'ticket';
      }
    }

    setFormData({
      ...formData,
      panel_type: newType,
      panel_title: presetTitle,
      panel_description: presetDesc,
      button_label: presetLabel,
      button_emoji: presetEmoji,
      ticket_prefix: presetPrefix
    });
  };

  if (loading) return <div className="text-zinc-400">読み込み中...</div>;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-center gap-4 flex-wrap mb-2">
        <PageHeader icon={Ticket} title="カスタムチケット設定" subtitle="問い合わせ用のチケットパネルを管理します" guildId={guildId} healthKey="tickets" />
        <button 
          onClick={() => openModal()}
          className="mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white px-4 py-2 rounded-lg font-bold shadow-lg shadow-red-900/20 transition-all hover:-translate-y-0.5 -mt-8"
        >
          ＋ パネルを新規作成
        </button>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {/* Panels List */}
      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl">
        <p className="text-sm text-zinc-400 mb-6 font-tech">
          特定のチャンネルに専用の「お問い合わせ・チケット作成ボタン」を設置できます。
          (設定を保存後、Botが指定されたチャンネルにパネルメッセージを送信します)
        </p>

        {panels.length === 0 ? (
          <p className="text-zinc-500 text-center py-8 font-tech">設定されているチケットパネルはありません。</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {panels.map(panel => {
              const ch = channels.find(c => c.id === panel.channel_id);
              return (
                <div key={panel.channel_id} className="bg-zinc-900 border border-zinc-700 rounded-lg p-5 hover:border-zinc-500 transition-colors">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg font-bold text-white flex items-center font-tech">
                        <span className="text-red-500 mr-2">#</span>
                        {ch ? ch.name : panel.channel_id}
                      </h3>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-tech font-bold">
                        {panelTypeOptions.find(opt => opt.value === panel.panel_type)?.label || '🎫 汎用チケット'}
                      </span>
                    </div>
                    <div className="space-x-2 font-tech flex-shrink-0">
                      <button onClick={() => openModal(panel)} className="text-blue-400 hover:text-blue-300 text-sm">編集</button>
                      <button onClick={() => handleDelete(panel.channel_id)} className="text-red-500 hover:text-red-400 text-sm">削除</button>
                    </div>
                  </div>
                  <div className="bg-zinc-800 p-3 rounded text-sm mb-3 border border-zinc-700/50">
                    <p className="font-bold text-white mb-1 font-tech">{panel.panel_title}</p>
                    <p className="text-zinc-400 whitespace-pre-wrap text-xs font-tech">{panel.panel_description}</p>
                    <div className="mt-3 inline-block bg-zinc-700 px-3 py-1.5 rounded font-bold text-white cursor-not-allowed font-tech">
                      {panel.button_emoji} {panel.button_label}
                    </div>
                  </div>
                  <div className="text-xs text-zinc-500 space-y-1 mb-4 font-tech">
                    <p>チケットの接頭辞: <span className="text-zinc-300 font-mono">{panel.ticket_prefix}-001</span></p>
                    <p>メンション: {panel.mention_role_ids?.length || 0} 個のロール</p>
                    <p>利用可能: {panel.target_role_ids?.length ? `${panel.target_role_ids.length} 個のロール` : '全員'}</p>
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm('このチャンネルにチケット作成パネルを送信しますか？')) return;
                      try {
                        const res = await fetch(`/api/guilds/${guildId}/rooms`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'deploy_panel', channel_id: panel.channel_id, panel_type: 'custom_ticket' })
                        });
                        if (res.ok) toast.success('パネルの設置をリクエストしました！');
                        else toast.error('リクエストに失敗しました。');
                      } catch (e) {
                        toast.error('エラーが発生しました。');
                      }
                    }}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded text-sm font-bold shadow transition-colors font-tech"
                  >
                    🚀 このチャンネルにパネルを設置する
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 rounded-lg shadow-2xl border border-zinc-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <form onSubmit={handleFormSubmit} className="p-6">
              <h2 className="text-2xl font-bold text-white mb-6 border-b border-zinc-800 pb-2 font-mecha">
                {editingPanel ? 'パネルを編集' : '新規パネル作成'}
              </h2>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1 font-tech">設置先チャンネル <span className="text-red-500">*</span></label>
                  {editingPanel ? (
                    <div className="bg-zinc-800/80 border border-zinc-700 rounded-lg p-3 text-zinc-400 text-sm font-tech">
                      #{channels.find(c => c.id === formData.channel_id)?.name || formData.channel_id} (変更不可)
                    </div>
                  ) : (
                    <ChannelSelect
                      label="設置先チャンネル"
                      placeholder="チャンネルを選択..."
                      channels={channels}
                      value={formData.channel_id}
                      onChange={(id: any) => setFormData({ ...formData, channel_id: id || '' })}
                      multiple={false}
                    />
                  )}
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1 font-tech">パネルの種類（機能） <span className="text-red-500">*</span></label>
                  <select
                    value={formData.panel_type}
                    onChange={(e) => handlePanelTypeChange(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-white focus:outline-none focus:border-red-500 font-tech"
                  >
                    {panelTypeOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-zinc-500 mt-1 font-tech">選択した種類に応じた機能がボタンに割り当てられます。</p>
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1 font-tech">パネルのタイトル <span className="text-red-500">*</span></label>
                  <input 
                    type="text" 
                    value={formData.panel_title} 
                    onChange={e => setFormData({...formData, panel_title: e.target.value})}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500 font-tech" 
                  />
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1 font-tech">パネルの説明文</label>
                  <textarea 
                    value={formData.panel_description} 
                    onChange={e => setFormData({...formData, panel_description: e.target.value})}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500 h-24 font-tech" 
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1 font-tech">ボタンの文字</label>
                    <input 
                      type="text" 
                      value={formData.button_label} 
                      onChange={e => setFormData({...formData, button_label: e.target.value})}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500 font-tech" 
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-zinc-400 mb-1 font-tech">ボタンの絵文字</label>
                    <input 
                      type="text" 
                      value={formData.button_emoji} 
                      onChange={e => setFormData({...formData, button_emoji: e.target.value})}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500 font-tech" 
                      placeholder="🎫, ❓ など"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1 font-tech">チケット作成時にメンションするロール</label>
                  <RoleSelect
                    label="メンションロール"
                    placeholder="ロールを選択..."
                    roles={roles}
                    value={formData.mention_role_ids}
                    onChange={(ids: any) => setFormData({ ...formData, mention_role_ids: ids })}
                    multiple={true}
                  />
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1 font-tech">ボタンを押せるロール (指定なしで全員)</label>
                  <RoleSelect
                    label="利用可能ロール"
                    placeholder="ロールを選択 (未選択で全員)..."
                    roles={roles}
                    value={formData.target_role_ids}
                    onChange={(ids: any) => setFormData({ ...formData, target_role_ids: ids })}
                    multiple={true}
                  />
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1 font-tech">チケットチャンネルの接頭辞</label>
                  <input 
                    type="text" 
                    value={formData.ticket_prefix} 
                    onChange={e => setFormData({...formData, ticket_prefix: e.target.value})}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white font-mono focus:outline-none focus:border-red-500 font-tech" 
                    placeholder="ticket"
                  />
                  <p className="text-xs text-zinc-500 mt-1 font-tech">例:「support」と入力すると「support-001」という名前のチャンネルが作成されます</p>
                </div>
              </div>

              <div className="mt-8 flex justify-end space-x-3">
                <button 
                  type="button" 
                  onClick={closeModal}
                  className="bg-zinc-700 hover:bg-zinc-600 text-white px-5 py-2 rounded font-bold transition-colors font-tech"
                >
                  キャンセル
                </button>
                <button 
                  type="submit" 
                  disabled={saving}
                  className="mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-50 text-white px-6 py-2 rounded font-bold shadow-lg transition-colors"
                >
                  {saving ? '保存中...' : '設定を保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}