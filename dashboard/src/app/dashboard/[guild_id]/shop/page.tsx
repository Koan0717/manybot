'use client';
import { useState, useEffect } from 'react';
import Select from 'react-select';

export default function ShopSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  
  const [items, setItems] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Panel state
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [sendingPanel, setSendingPanel] = useState(false);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    usage: '',
    price: 0,
    target_role_ids: [] as string[],
    reward_role_ids: [] as string[],
    duration_days: '' as string | number,
    is_eval_extend: false,
    extend_days: '' as string | number
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/shop`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/roles`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : [])
    ]).then(([itemsData, rolesData, channelsData]: [any, any, any]) => {
      setItems(Array.isArray(itemsData) ? itemsData : []);
      if (!rolesData.error) {
        setRoles(rolesData.filter((r: any) => r.id !== guildId)); // exclude @everyone
      }
      if (!channelsData.error && Array.isArray(channelsData)) {
        setChannels(channelsData.filter(c => c.type === 0)); // Only text channels
      }
    }).catch(err => {
      console.error(err);
      setError('データの取得に失敗しました');
    }).finally(() => {
      setLoading(false);
    });
  }, [guildId]);

  const handleDelete = async (itemId: number) => {
    if (!confirm('本当にこのアイテムを削除しますか？')) return;
    try {
      const res = await fetch(`/api/guilds/${guildId}/shop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', item_id: itemId })
      });
      if (res.ok) {
        setItems(prev => prev.filter(i => i.item_id !== itemId));
      } else {
        alert('削除に失敗しました');
      }
    } catch (e) {
      alert('エラーが発生しました');
    }
  };

  const openModal = (item: any = null) => {
    if (item) {
      setEditingItem(item);
      setFormData({
        name: item.name || '',
        usage: item.usage || '',
        price: item.price || 0,
        target_role_ids: item.target_role_ids?.map(String) || [],
        reward_role_ids: item.reward_role_ids?.map(String) || [],
        duration_days: item.duration_days || '',
        is_eval_extend: item.is_eval_extend || false,
        extend_days: item.extend_days || ''
      });
    } else {
      setEditingItem(null);
      setFormData({
        name: '', usage: '', price: 0, target_role_ids: [], reward_role_ids: [], duration_days: '', is_eval_extend: false, extend_days: ''
      });
    }
    setIsModalOpen(true);
  };

  const saveItem = async () => {
    if (!formData.name || formData.price <= 0) {
      alert('アイテム名と価格を正しく入力してください');
      return;
    }
    setSaving(true);
    
    const payloadItem = {
      ...formData,
      item_id: editingItem?.item_id,
      duration_days: formData.duration_days ? parseInt(formData.duration_days as string) : null,
      extend_days: formData.extend_days ? parseInt(formData.extend_days as string) : null
    };

    try {
      const res = await fetch(`/api/guilds/${guildId}/shop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: editingItem ? 'edit' : 'add', 
          item: payloadItem 
        })
      });
      
      if (res.ok) {
        const data = await res.json();
        if (editingItem) {
          setItems(prev => prev.map(i => i.item_id === editingItem.item_id ? { ...payloadItem, item_id: i.item_id } : i));
        } else {
          setItems(prev => [...prev, { ...payloadItem, item_id: data.item_id }]);
        }
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

  const sendShopPanel = async () => {
    if (!selectedChannelId) {
      alert('送信先のチャンネルを選択してください');
      return;
    }
    
    setSendingPanel(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/shop/panel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: selectedChannelId })
      });
      
      if (res.ok) {
        alert('ショップパネルを送信しました！');
        setSelectedChannelId('');
      } else {
        const data = await res.json();
        alert(`送信に失敗しました: ${data.error || '不明なエラー'}`);
      }
    } catch (e) {
      alert('エラーが発生しました');
    } finally {
      setSendingPanel(false);
    }
  };

  const roleOptions = roles.map(r => ({ value: r.id, label: `@${r.name}`, color: r.color }));

  const customStyles = {
    control: (base: any) => ({ ...base, backgroundColor: '#27272a', borderColor: '#3f3f46', color: 'white' }),
    menu: (base: any) => ({ ...base, backgroundColor: '#27272a', zIndex: 9999 }),
    option: (base: any, state: any) => ({
      ...base,
      backgroundColor: state.isFocused ? '#3f3f46' : '#27272a',
      color: state.data.color ? `#${state.data.color.toString(16).padStart(6, '0')}` : 'white',
      ':active': { backgroundColor: '#52525b' }
    }),
    multiValue: (base: any) => ({ ...base, backgroundColor: '#3f3f46' }),
    multiValueLabel: (base: any, state: any) => ({
      ...base,
      color: state.data.color ? `#${state.data.color.toString(16).padStart(6, '0')}` : 'white'
    })
  };

  if (loading) return <div className="text-zinc-400">読み込み中...</div>;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-white">ショップ設定</h1>
        <button 
          onClick={() => openModal()}
          className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded font-bold shadow-lg transition-colors"
        >
          ＋ 新規アイテム追加
        </button>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700">
        {items.length === 0 ? (
          <p className="text-zinc-400 text-center py-8">現在販売されているアイテムはありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead className="bg-zinc-900/50 text-xs uppercase text-zinc-400 border-b border-zinc-700">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">アイテム名</th>
                  <th className="px-4 py-3">価格 (通貨)</th>
                  <th className="px-4 py-3">対象ロール</th>
                  <th className="px-4 py-3">付与ロール</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.item_id} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-zinc-500">{item.item_id}</td>
                    <td className="px-4 py-3 font-bold text-white">{item.name}</td>
                    <td className="px-4 py-3 text-yellow-400">{item.price} 通貨</td>
                    <td className="px-4 py-3">
                      {item.target_role_ids?.length ? item.target_role_ids.length + '個のロール' : 'なし (全員)'}
                    </td>
                    <td className="px-4 py-3">
                      {item.reward_role_ids?.length ? item.reward_role_ids.length + '個のロール' : 'なし'}
                    </td>
                    <td className="px-4 py-3 text-right space-x-3">
                      <button onClick={() => openModal(item)} className="text-blue-400 hover:text-blue-300">編集</button>
                      <button onClick={() => handleDelete(item.item_id)} className="text-red-500 hover:text-red-400">削除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700 mt-8 mb-12">
        <h2 className="text-xl font-bold text-white mb-4">ショップパネルの設置</h2>
        <p className="text-zinc-400 mb-6 text-sm">
          指定したチャンネルに、ユーザーがショップを利用するためのパネル（ボタン付きメッセージ）を送信します。
        </p>
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-zinc-400 mb-2">送信先チャンネル</label>
            <select
              value={selectedChannelId}
              onChange={(e) => setSelectedChannelId(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">チャンネルを選択してください</option>
              {channels.map(c => (
                <option key={c.id} value={c.id}># {c.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={sendShopPanel}
            disabled={sendingPanel || !selectedChannelId}
            className="w-full sm:w-auto bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg font-bold shadow-lg transition-all"
          >
            {sendingPanel ? '送信中...' : 'パネルを送信'}
          </button>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 rounded-lg shadow-2xl border border-zinc-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-2xl font-bold text-white mb-6 border-b border-zinc-800 pb-2">
                {editingItem ? 'アイテムを編集' : '新規アイテム追加'}
              </h2>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">アイテム名 <span className="text-red-500">*</span></label>
                  <input 
                    type="text" 
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500" 
                    placeholder="例: カラー変更権"
                  />
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1">価格 (通貨) <span className="text-red-500">*</span></label>
                  <input 
                    type="number" 
                    value={formData.price} 
                    onChange={e => setFormData({...formData, price: Number(e.target.value)})}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500" 
                  />
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1">使用説明・備考</label>
                  <textarea 
                    value={formData.usage} 
                    onChange={e => setFormData({...formData, usage: e.target.value})}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500 h-24" 
                    placeholder="購入時の説明や使い方"
                  />
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1">購入可能条件 (対象ロール)</label>
                  <p className="text-xs text-zinc-500 mb-2">指定したロールを持っている人だけが買えるようにします。未指定の場合は全員が買えます。</p>
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
                  <label className="block text-sm text-zinc-400 mb-1">付与するロール</label>
                  <p className="text-xs text-zinc-500 mb-2">購入時に自動的に付与されるロールを設定します。</p>
                  <Select
                    isMulti
                    options={roleOptions}
                    value={roleOptions.filter(o => formData.reward_role_ids.includes(o.value))}
                    onChange={(selected: any) => setFormData({...formData, reward_role_ids: selected.map((s: any) => s.value)})}
                    styles={customStyles}
                    placeholder="ロールを選択..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">ロール有効期限 (日数)</label>
                    <input 
                      type="number" 
                      value={formData.duration_days} 
                      onChange={e => setFormData({...formData, duration_days: e.target.value})}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500" 
                      placeholder="無期限の場合は空欄"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">評価期限延長 (日数)</label>
                    <input 
                      type="number" 
                      value={formData.extend_days} 
                      onChange={e => setFormData({...formData, extend_days: e.target.value})}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500" 
                      placeholder="延長しない場合は空欄"
                    />
                  </div>
                </div>

                <div>
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={formData.is_eval_extend}
                      onChange={e => setFormData({...formData, is_eval_extend: e.target.checked})}
                      className="form-checkbox h-5 w-5 text-red-600 bg-zinc-800 border-zinc-700 rounded focus:ring-red-500 focus:ring-offset-zinc-900" 
                    />
                    <span className="text-sm text-white">このアイテムは「評価期限の延長」専用アイテムとして扱う</span>
                  </label>
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
                  onClick={saveItem}
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