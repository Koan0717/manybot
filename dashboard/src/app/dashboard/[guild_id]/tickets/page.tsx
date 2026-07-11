'use client';
import { useState, useEffect } from 'react';
import Select from 'react-select';

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
    ticket_prefix: 'ticket'
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
        alert('削除に失敗しました');
      }
    } catch (e) {
      alert('エラーが発生しました');
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
        ticket_prefix: panel.ticket_prefix || 'ticket'
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
        ticket_prefix: 'ticket'
      });
    }
    setIsModalOpen(true);
  };

  const savePanel = async () => {
    if (!formData.channel_id || !formData.panel_title) {
      alert('設置先チャンネルとタイトルを入力してください');
      return;
    }
    setSaving(true);
    
    try {
      const res = await fetch(`/api/guilds/${guildId}/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'save', 
          panel: formData 
        })
      });
      
      if (res.ok) {
        // Update local state
        setPanels(prev => {
          const exists = prev.find(p => p.channel_id === formData.channel_id);
          if (exists) {
            return prev.map(p => p.channel_id === formData.channel_id ? formData : p);
          }
          return [...prev, formData];
        });
        setIsModalOpen(false);
      } else {
        alert('保存に失敗しました');
      }
    } catch (e) {
      alert('エラーが発生しました');
    } finally {
      setSaving(false);
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
    singleValue: (base: any) => ({ ...base, color: 'white' }),
    multiValue: (base: any) => ({ ...base, backgroundColor: '#3f3f46' }),
    multiValueLabel: (base: any, state: any) => ({
      ...base,
      color: state.data?.color ? `#${state.data.color.toString(16).padStart(6, '0')}` : 'white'
    })
  };

  if (loading) return <div className="text-zinc-400">読み込み中...</div>;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-white">カスタムチケット設定</h1>
        <button 
          onClick={() => openModal()}
          className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded font-bold shadow-lg transition-colors"
        >
          ＋ パネルを新規作成
        </button>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700">
        <p className="text-sm text-zinc-400 mb-6">
          特定のチャンネルに専用の「お問い合わせ・チケット作成ボタン」を設置できます。
          (設定を保存後、Botが指定されたチャンネルにパネルメッセージを送信します)
        </p>

        {panels.length === 0 ? (
          <p className="text-zinc-500 text-center py-8">設定されているチケットパネルはありません。</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {panels.map(panel => {
              const ch = channels.find(c => c.id === panel.channel_id);
              return (
                <div key={panel.channel_id} className="bg-zinc-900 border border-zinc-700 rounded-lg p-5 hover:border-zinc-500 transition-colors">
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="text-lg font-bold text-white flex items-center">
                      <span className="text-red-500 mr-2">#</span>
                      {ch ? ch.name : panel.channel_id}
                    </h3>
                    <div className="space-x-2">
                      <button onClick={() => openModal(panel)} className="text-blue-400 hover:text-blue-300 text-sm">編集</button>
                      <button onClick={() => handleDelete(panel.channel_id)} className="text-red-500 hover:text-red-400 text-sm">削除</button>
                    </div>
                  </div>
                  <div className="bg-zinc-800 p-3 rounded text-sm mb-3 border border-zinc-700/50">
                    <p className="font-bold text-white mb-1">{panel.panel_title}</p>
                    <p className="text-zinc-400 whitespace-pre-wrap text-xs">{panel.panel_description}</p>
                    <div className="mt-3 inline-block bg-zinc-700 px-3 py-1.5 rounded font-bold text-white cursor-not-allowed">
                      {panel.button_emoji} {panel.button_label}
                    </div>
                  </div>
                  <div className="text-xs text-zinc-500 space-y-1 mb-4">
                    <p>チケットの接頭辞: <span className="text-zinc-300 font-mono">{panel.ticket_prefix}-001</span></p>
                    <p>メンション: {panel.mention_role_ids?.length || 0} 個のロール</p>
                    <p>利用可能: {panel.target_role_ids?.length || '全員'}</p>
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
                        if (res.ok) alert('パネルの設置をリクエストしました！');
                        else alert('リクエストに失敗しました。');
                      } catch (e) {
                        alert('エラーが発生しました。');
                      }
                    }}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded text-sm font-bold shadow transition-colors"
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
            <div className="p-6">
              <h2 className="text-2xl font-bold text-white mb-6 border-b border-zinc-800 pb-2">
                {editingPanel ? 'パネルを編集' : '新規パネル作成'}
              </h2>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">設置先チャンネル <span className="text-red-500">*</span></label>
                  <Select
                    options={channelOptions}
                    value={channelOptions.find(o => o.value === formData.channel_id)}
                    onChange={(selected: any) => setFormData({...formData, channel_id: selected?.value || ''})}
                    styles={customStyles}
                    placeholder="チャンネルを選択..."
                    isDisabled={!!editingPanel} // Cannot change channel once created
                  />
                  {editingPanel && <p className="text-xs text-red-400 mt-1">※既存パネルの設置先チャンネルは変更できません</p>}
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1">パネルのタイトル <span className="text-red-500">*</span></label>
                  <input 
                    type="text" 
                    value={formData.panel_title} 
                    onChange={e => setFormData({...formData, panel_title: e.target.value})}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500" 
                  />
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1">パネルの説明文</label>
                  <textarea 
                    value={formData.panel_description} 
                    onChange={e => setFormData({...formData, panel_description: e.target.value})}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500 h-24" 
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">ボタンの文字</label>
                    <input 
                      type="text" 
                      value={formData.button_label} 
                      onChange={e => setFormData({...formData, button_label: e.target.value})}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500" 
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">ボタンの絵文字</label>
                    <input 
                      type="text" 
                      value={formData.button_emoji} 
                      onChange={e => setFormData({...formData, button_emoji: e.target.value})}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500" 
                      placeholder="🎫, ❓ など"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1">チケット作成時にメンションするロール</label>
                  <Select
                    isMulti
                    options={roleOptions}
                    value={roleOptions.filter(o => formData.mention_role_ids.includes(o.value))}
                    onChange={(selected: any) => setFormData({...formData, mention_role_ids: selected.map((s: any) => s.value)})}
                    styles={customStyles}
                    placeholder="ロールを選択..."
                  />
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1">ボタンを押せるロール (指定なしで全員)</label>
                  <Select
                    isMulti
                    options={roleOptions}
                    value={roleOptions.filter(o => formData.target_role_ids.includes(o.value))}
                    onChange={(selected: any) => setFormData({...formData, target_role_ids: selected.map((s: any) => s.value)})}
                    styles={customStyles}
                    placeholder="ロールを選択..."
                  />
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1">チケットチャンネルの接頭辞</label>
                  <input 
                    type="text" 
                    value={formData.ticket_prefix} 
                    onChange={e => setFormData({...formData, ticket_prefix: e.target.value})}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white font-mono focus:outline-none focus:border-red-500" 
                    placeholder="ticket"
                  />
                  <p className="text-xs text-zinc-500 mt-1">例:「support」と入力すると「support-001」という名前のチャンネルが作成されます</p>
                </div>
              </div>

              <div className="mt-8 flex justify-end space-x-3">
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded text-zinc-400 hover:text-white transition-colors"
                >
                  キャンセル
                </button>
                <button 
                  onClick={savePanel}
                  disabled={saving}
                  className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-6 py-2 rounded font-bold shadow transition-colors"
                >
                  {saving ? '保存中...' : '保存する'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}