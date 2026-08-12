'use client';
import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { ShoppingBag, Plus, Trash2, Edit3, Send } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import ChannelSelect from '@/components/ChannelSelect';
import RoleSelect from '@/components/RoleSelect';
import { useSyncStatus, SyncStatusCards } from '@/lib/useSyncStatus';

export default function ShopSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const sync = useSyncStatus(guildId);
  
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
        setChannels(channelsData.filter(c => [0, 5, 11, 12, 15].includes(c.type))); // Include Text, Announcement, Threads, Forums
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
        toast.success('アイテムを削除しました');
      } else {
        toast.error('削除に失敗しました');
      }
    } catch (e) {
      toast.error('エラーが発生しました');
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
      toast.error('アイテム名と有効な価格を入力してください');
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
        toast.success('アイテムを保存しました！');
        setIsModalOpen(false);
      } else {
        toast.error('保存に失敗しました');
      }
    } catch (e) {
      toast.error('エラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  const sendShopPanel = async () => {
    if (!selectedChannelId) {
      toast.error('送信先のチャンネルを選択してください');
      return;
    }
    
    const selectedChannel = channels.find(c => String(c.id) === String(selectedChannelId));
    
    setSendingPanel(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/shop/panel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: selectedChannelId, channel_type: selectedChannel?.type })
      });
      
      if (res.ok) {
        toast.success('ショップパネルを正常に送信しました！');
        setSelectedChannelId('');
      } else {
        const data = await res.json();
        toast.error(`送信に失敗しました: ${data.error || '不明なエラー'}`);
      }
    } catch (e) {
      toast.error('エラーが発生しました');
    } finally {
      setSendingPanel(false);
    }
  };

  if (loading) return <div className="text-zinc-400 p-8">読み込み中...</div>;

  return (
    <div className="max-w-5xl mx-auto pb-24 space-y-6">
      <div className="flex justify-between items-center gap-4 flex-wrap mb-2">
        <PageHeader icon={ShoppingBag} title="ショップ設定" subtitle="コインで交換できるアイテムを管理します" />
        <button 
          onClick={() => openModal()}
          className="mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white px-5 py-2.5 rounded-lg font-bold shadow-lg shadow-red-900/20 transition-all hover:-translate-y-0.5 -mt-8 flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> 新規アイテム追加
        </button>
      </div>

      <SyncStatusCards sync={sync} />

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {/* アイテム一覧 */}
      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl space-y-4">
        <h3 className="font-mecha text-base font-bold text-white border-b border-zinc-800 pb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500"></span>
          販売アイテム一覧 ({items.length}件)
        </h3>

        {items.length === 0 ? (
          <p className="text-zinc-400 text-center py-10 font-tech">現在販売されているアイテムはありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-400 border-b border-zinc-700 font-tech">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">アイテム名</th>
                  <th className="px-4 py-3">価格 (通貨)</th>
                  <th className="px-4 py-3">対象ロール</th>
                  <th className="px-4 py-3">付与ロール</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-tech">
                {items.map(item => (
                  <tr key={item.item_id} className="hover:bg-zinc-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-zinc-500">#{item.item_id}</td>
                    <td className="px-4 py-3 font-bold text-white">{item.name}</td>
                    <td className="px-4 py-3 text-yellow-400 font-mono font-bold">{item.price} 通貨</td>
                    <td className="px-4 py-3">
                      {item.target_role_ids && item.target_role_ids.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {item.target_role_ids.map((id: any) => {
                            const r = roles.find(role => String(role.id) === String(id));
                            return r ? (
                              <span key={id} className="bg-zinc-800 text-zinc-300 text-xs px-2 py-0.5 rounded border border-zinc-700">
                                @{r.name}
                              </span>
                            ) : null;
                          })}
                        </div>
                      ) : (
                        <span className="text-zinc-500 text-xs">全員購入可</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {item.reward_role_ids && item.reward_role_ids.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {item.reward_role_ids.map((id: any) => {
                            const r = roles.find(role => String(role.id) === String(id));
                            return r ? (
                              <span key={id} className="bg-red-950/60 text-red-300 text-xs px-2 py-0.5 rounded border border-red-800/60">
                                @{r.name}
                              </span>
                            ) : null;
                          })}
                        </div>
                      ) : (
                        <span className="text-zinc-500 text-xs">付与なし</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openModal(item)}
                          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white px-2.5 py-1.5 rounded text-xs transition-colors flex items-center gap-1 border border-zinc-700"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> 編集
                        </button>
                        <button
                          onClick={() => handleDelete(item.item_id)}
                          className="bg-red-950/60 hover:bg-red-900/80 text-red-400 hover:text-red-200 px-2.5 py-1.5 rounded text-xs transition-colors flex items-center gap-1 border border-red-800/60"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> 削除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ショップパネルの設置 (ChannelSelect モーダル対応) */}
      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl space-y-4">
        <h3 className="font-mecha text-base font-bold text-white border-b border-zinc-800 pb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
          ショップパネルの設置
        </h3>
        <p className="text-zinc-400 text-sm font-tech">
          指定したチャンネルに、ユーザーがショップを利用するためのパネル（購入ボタン付きメッセージ）を送信します。
        </p>

        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end pt-2">
          <div className="flex-1 w-full space-y-1.5">
            <label className="block text-xs font-tech text-zinc-400 uppercase tracking-wider">
              送信先チャンネル
            </label>
            <ChannelSelect
              label="ショップパネル送信先チャンネル"
              placeholder="🔍 チャンネルを選択または検索..."
              value={selectedChannelId}
              onChange={(id) => setSelectedChannelId(id)}
              channels={channels}
              multiple={false}
            />
          </div>
          <button
            onClick={sendShopPanel}
            disabled={sendingPanel || !selectedChannelId}
            className="w-full sm:w-auto mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg font-bold shadow-lg transition-all flex items-center justify-center gap-2 h-11"
          >
            <Send className="w-4 h-4" />
            {sendingPanel ? '送信中...' : 'パネルを送信'}
          </button>
        </div>
      </div>

      {/* アイテム編集/追加モーダル */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-zinc-900 rounded-xl shadow-2xl border border-zinc-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="p-6">
              <h2 className="text-xl font-bold text-white mb-6 border-b border-zinc-800 pb-3 font-mecha flex items-center gap-2">
                <span className="text-red-500">●</span>
                {editingItem ? 'アイテムを編集' : '新規アイテム追加'}
              </h2>

              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-tech text-zinc-400 mb-1.5 uppercase tracking-wider">
                    アイテム名 <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="text" 
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-red-500 font-tech" 
                    placeholder="例: カラー変更権"
                  />
                </div>

                <div>
                  <label className="block text-xs font-tech text-zinc-400 mb-1.5 uppercase tracking-wider">
                    価格 (通貨) <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="number" 
                    value={formData.price} 
                    onChange={e => setFormData({...formData, price: Number(e.target.value)})}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-red-500 font-tech" 
                    placeholder="1000"
                  />
                </div>

                <div>
                  <label className="block text-xs font-tech text-zinc-400 mb-1.5 uppercase tracking-wider">
                    使用説明・備考
                  </label>
                  <textarea 
                    value={formData.usage} 
                    onChange={e => setFormData({...formData, usage: e.target.value})}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-red-500 h-24 font-tech" 
                    placeholder="購入時の説明や使い方"
                  />
                </div>

                <div>
                  <label className="block text-xs font-tech text-zinc-400 mb-1.5 uppercase tracking-wider">
                    購入可能条件 (対象ロール)
                  </label>
                  <p className="text-xs text-zinc-500 mb-2 font-tech">指定したロールを持っている人だけが買えるようにします。未指定の場合は全員が買えます。</p>
                  <RoleSelect
                    label="購入可能条件 (対象ロール)"
                    placeholder="未指定（全員購入可能）"
                    value={formData.target_role_ids}
                    onChange={(ids) => setFormData({ ...formData, target_role_ids: ids })}
                    roles={roles}
                    multiple={true}
                  />
                </div>

                <div>
                  <label className="block text-xs font-tech text-zinc-400 mb-1.5 uppercase tracking-wider">
                    付与するロール
                  </label>
                  <p className="text-xs text-zinc-500 mb-2 font-tech">購入時に自動的に付与されるロールを設定します。</p>
                  <RoleSelect
                    label="付与するロール"
                    placeholder="未指定（ロール付与なし）"
                    value={formData.reward_role_ids}
                    onChange={(ids) => setFormData({ ...formData, reward_role_ids: ids })}
                    roles={roles}
                    multiple={true}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-tech text-zinc-400 mb-1.5 uppercase tracking-wider">
                      ロール有効期限 (日数)
                    </label>
                    <input 
                      type="number" 
                      value={formData.duration_days} 
                      onChange={e => setFormData({...formData, duration_days: e.target.value})}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-red-500 font-tech" 
                      placeholder="無期限の場合は空欄"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-tech text-zinc-400 mb-1.5 uppercase tracking-wider">
                      評価期限延長 (日数)
                    </label>
                    <input 
                      type="number" 
                      value={formData.extend_days} 
                      onChange={e => setFormData({...formData, extend_days: e.target.value})}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-red-500 font-tech" 
                      placeholder="延長しない場合は空欄"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <label className="flex items-center space-x-3 cursor-pointer bg-zinc-800/40 p-3 rounded-lg border border-zinc-800">
                    <input 
                      type="checkbox" 
                      checked={formData.is_eval_extend}
                      onChange={e => setFormData({...formData, is_eval_extend: e.target.checked})}
                      className="form-checkbox h-4 w-4 text-red-600 bg-zinc-800 border-zinc-700 rounded focus:ring-red-500" 
                    />
                    <span className="text-sm text-white font-tech">このアイテムは「評価期限の延長」専用アイテムとして扱う</span>
                  </label>
                </div>
              </div>

              <div className="mt-8 flex justify-end space-x-3 pt-4 border-t border-zinc-800">
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-zinc-400 hover:text-white transition-colors text-sm font-tech"
                >
                  キャンセル
                </button>
                <button 
                  onClick={saveItem}
                  disabled={saving}
                  className="mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-bold shadow transition-colors text-sm"
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