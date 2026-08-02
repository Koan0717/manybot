'use client';
import { useState, useEffect } from 'react';
import Select from 'react-select';
import { toast } from 'react-hot-toast';
import { DoorOpen } from 'lucide-react';
import PageHeader from '@/components/PageHeader';

const defaultPrices = {
  "宿": {
    "12": { price: 10000, duration_hours: 12 },
    "24": { price: 15000, duration_hours: 24 }
  },
  "高級宿": {
    "12": { price: 150000, duration_hours: 12 },
    "24": { price: 250000, duration_hours: 24 }
  },
  "カスタムVC": {
    "24": { price: 30000, duration_hours: 24 }
  },
  "ゲームVC": {
    "12": { price: 10000, duration_hours: 12 },
    "24": { price: 15000, duration_hours: 24 }
  },
  "賭博VC": {
    "12": { price: 10000, duration_hours: 12 },
    "24": { price: 15000, duration_hours: 24 }
  }
};

export default function RoomsSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  
  const [prices, setPrices] = useState<any>(JSON.parse(JSON.stringify(defaultPrices)));
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [toggles, setToggles] = useState({
    ENABLE_PRICE_MAIN_SUB: false,
    ENABLE_PRICE_NEW_MEMBER: false,
    ENABLE_PRICE_DOWNGRADE: false,
    ENABLE_PRICE_VIOLATOR: false,
    ENABLE_FREE_INN_MAIN_SUB: false
  });
  
  const defaultRolePrices = {
    MAIN_SUB_MEMBER_ROLE: JSON.parse(JSON.stringify(defaultPrices)),
    NEW_MEMBER_ROLE: JSON.parse(JSON.stringify(defaultPrices)),
    DOWNGRADE_ROLE: JSON.parse(JSON.stringify(defaultPrices)),
    VIOLATOR_ROLE: JSON.parse(JSON.stringify(defaultPrices)),
  };
  const [rolePrices, setRolePrices] = useState<any>(defaultRolePrices);

  // Panel configuration states
  const defaultPanelConfigs = {
    inn: { allowTemp: true, allowMainSub: false, categoryId: '' },
    inn_combined: { allowTemp: true, allowMainSub: true, categoryId: '' },
    main_inn: { allowTemp: false, allowMainSub: true, categoryId: '' },
    luxury_inn_single: { allowTemp: true, allowMainSub: true, categoryId: '' }
  };
  const [panelConfigs, setPanelConfigs] = useState<any>(defaultPanelConfigs);
  const [expandedPanels, setExpandedPanels] = useState<{ [key: string]: boolean }>({});

  // Panel deployment states
  const [selectedChannels, setSelectedChannels] = useState<{ [key: string]: string }>({});
  const [deploying, setDeploying] = useState<{ [key: string]: boolean }>({});

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/rooms`).then(res => res.ok ? res.json() : {}),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : [])
    ]).then(([roomsData, channelsData]: [any, any]) => {
      if (roomsData.ROOM_PRICES) {
        // Merge with defaults to ensure all keys exist
        const merged = JSON.parse(JSON.stringify(defaultPrices));
        for (const [rt, durObj] of Object.entries(roomsData.ROOM_PRICES)) {
          if (merged[rt]) {
            for (const [dur, data] of Object.entries(durObj as any)) {
              if (merged[rt][dur]) {
                merged[rt][dur] = data;
              }
            }
          }
        }
        setPrices(merged);
      }
      
      if (roomsData.toggles) {
        setToggles(prev => ({ ...prev, ...roomsData.toggles }));
      }
      if (roomsData.roomPanelConfigs) {
        setPanelConfigs((prev: any) => ({ ...prev, ...roomsData.roomPanelConfigs }));
      }
      if (roomsData.role_prices) {
        const mergedRolePrices = JSON.parse(JSON.stringify(defaultRolePrices));
        for (const rp of roomsData.role_prices) {
          if (mergedRolePrices[rp.role_key] && mergedRolePrices[rp.role_key][rp.room_type] && mergedRolePrices[rp.role_key][rp.room_type][rp.duration]) {
            mergedRolePrices[rp.role_key][rp.room_type][rp.duration].price = rp.price;
          }
        }
        setRolePrices(mergedRolePrices);
      }
      if (!channelsData.error) {
        setChannels(channelsData.filter((c: any) => c.type === 0)); // Text channels
      }
    }).catch(err => {
      console.error(err);
      setError('データの取得に失敗しました');
    }).finally(() => {
      setLoading(false);
    });
  }, [guildId]);

  const handleSavePrices = async () => {
    setSaving(true);
    setError(null);
    try {
      const flattenedRolePrices = [];
      for (const [roleKey, roomTypes] of Object.entries(rolePrices)) {
        for (const [roomType, durations] of Object.entries(roomTypes as any)) {
          for (const [duration, data] of Object.entries(durations as any)) {
            flattenedRolePrices.push({
              role_key: roleKey,
              room_type: roomType,
              duration: parseInt(duration),
              price: (data as any).price
            });
          }
        }
      }

      const res = await fetch(`/api/guilds/${guildId}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', ROOM_PRICES: prices, toggles, role_prices: flattenedRolePrices, ROOM_PANEL_CONFIGS: panelConfigs })
      });
      if (!res.ok) throw new Error('保存に失敗しました');
      toast.success('価格設定を保存しました');
    } catch (err) {
      console.error(err);
      setError('価格設定の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDeployPanel = async (panelType: string) => {
    const channelId = selectedChannels[panelType];
    if (!channelId) {
      toast('設置先のチャンネルを選択してください');
      return;
    }

    setDeploying(prev => ({ ...prev, [panelType]: true }));
    try {
      const res = await fetch(`/api/guilds/${guildId}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deploy_panel', channel_id: channelId, panel_type: panelType })
      });
      if (!res.ok) throw new Error('設置に失敗しました');
      toast.success('Botにパネル設置をリクエストしました！数秒以内にDiscordにパネルが送信されます。');
    } catch (err) {
      console.error(err);
      toast.error('パネルの設置リクエストに失敗しました');
    } finally {
      setDeploying(prev => ({ ...prev, [panelType]: false }));
    }
  };

  const handleRolePriceChange = (roleKey: string, roomType: string, duration: string, newPrice: string) => {
    setRolePrices((prev: any) => ({
      ...prev,
      [roleKey]: {
        ...prev[roleKey],
        [roomType]: {
          ...prev[roleKey][roomType],
          [duration]: {
            ...prev[roleKey][roomType][duration],
            price: parseInt(newPrice) || 0
          }
        }
      }
    }));
  };

  const handlePriceChange = (roomType: string, duration: string, newPrice: string) => {
    setPrices((prev: any) => ({
      ...prev,
      [roomType]: {
        ...prev[roomType],
        [duration]: {
          ...prev[roomType][duration],
          price: parseInt(newPrice) || 0
        }
      }
    }));
  };

  const channelOptions = channels.map(c => ({ value: c.id, label: `# ${c.name}` }));

  const customStyles = {
    control: (base: any) => ({ ...base, backgroundColor: '#27272a', borderColor: '#3f3f46', color: 'white', minHeight: '38px' }),
    menu: (base: any) => ({ ...base, backgroundColor: '#27272a', zIndex: 9999 }),
    option: (base: any, state: any) => ({
      ...base,
      backgroundColor: state.isFocused ? '#3f3f46' : '#27272a',
      color: 'white',
      ':active': { backgroundColor: '#52525b' }
    }),
    singleValue: (base: any) => ({ ...base, color: 'white' })
  };

  if (loading) return <div className="text-zinc-400">読み込み中...</div>;

  return (
    <div className="max-w-5xl mx-auto pb-20">
      <PageHeader icon={DoorOpen} title="VCルーム・宿設定" subtitle="宿泊VCの種類・価格・入室条件を管理します" />

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {/* --- 価格設定 --- */}
      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl mb-8">
        <div className="flex justify-between items-center mb-6 border-b border-zinc-700 pb-2">
          <h2 className="text-xl font-bold text-white">料金設定 (価格)</h2>
          <button
            onClick={handleSavePrices}
            disabled={saving}
            className="mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-50 text-white px-6 py-2 rounded font-bold shadow-lg transition-colors"
          >
            {saving ? '保存中...' : '価格設定を保存'}
          </button>
        </div>
        <p className="text-sm text-zinc-400 mb-6">
          各VCルームの利用料金を設定します。ここで設定・保存した価格は即座に反映されます。
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Object.entries(prices).map(([roomType, durations]: [string, any]) => (
            <div key={roomType} className="bg-zinc-900 border border-zinc-700 rounded-lg p-4">
              <h3 className="font-bold text-white mb-3 flex items-center">
                <span className="text-red-500 mr-2">■</span> {roomType}
              </h3>
              <div className="space-y-3">
                {Object.entries(durations).map(([dur, data]: [string, any]) => (
                  <div key={dur} className="flex items-center justify-between">
                    <span className="text-sm text-zinc-300 w-24">{dur}時間:</span>
                    <div className="flex items-center flex-1">
                      <input 
                        type="number"
                        value={data.price}
                        onChange={e => handlePriceChange(roomType, dur, e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-1.5 text-white focus:outline-none focus:border-red-500 text-right"
                      />
                      <span className="text-sm text-zinc-400 ml-2">通貨</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* --- ロール別特別料金設定 --- */}
      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl mb-8">
        <h2 className="text-xl font-bold text-white mb-6 border-b border-zinc-700 pb-2">ロール別特別料金設定</h2>
        <p className="text-sm text-zinc-400 mb-6">
          特定のロールを持っているユーザーに対して、基本料金とは異なる特別料金を適用できます。
          スイッチをオンにしたロールの料金設定が優先して適用されます。
        </p>

        {/* --- 本メン・準メン宿無料化設定 --- */}
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-lg text-white">本・準メンバーの宿無料化</h3>
              <p className="text-sm text-zinc-400 mt-1">
                これを有効にすると、本メンバー・準メンバーが一般宿を作成・延長する際の料金が0になります。（別々価格より優先されます）
              </p>
            </div>
            <label className="flex items-center cursor-pointer ml-4">
              <div className="relative">
                <input type="checkbox" className="sr-only" 
                  checked={toggles.ENABLE_FREE_INN_MAIN_SUB}
                  onChange={(e) => setToggles({...toggles, ENABLE_FREE_INN_MAIN_SUB: e.target.checked})}
                />
                <div className={`block w-14 h-8 rounded-full transition-colors ${toggles.ENABLE_FREE_INN_MAIN_SUB ? 'bg-red-500' : 'bg-zinc-600'}`}></div>
                <div className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${toggles.ENABLE_FREE_INN_MAIN_SUB ? 'transform translate-x-6' : ''}`}></div>
              </div>
              <div className="ml-3 text-zinc-300 font-medium whitespace-nowrap">
                {toggles.ENABLE_FREE_INN_MAIN_SUB ? '有効' : '無効'}
              </div>
            </label>
          </div>
        </div>

        <div className="space-y-6">
          {[
            { key: 'ENABLE_PRICE_MAIN_SUB', roleKey: 'MAIN_SUB_MEMBER_ROLE', label: '本・準メンバーロール' },
            { key: 'ENABLE_PRICE_NEW_MEMBER', roleKey: 'NEW_MEMBER_ROLE', label: '仮メンバーロール' },
            { key: 'ENABLE_PRICE_DOWNGRADE', roleKey: 'DOWNGRADE_ROLE', label: '評価落ちロール' },
            { key: 'ENABLE_PRICE_VIOLATOR', roleKey: 'VIOLATOR_ROLE', label: '違反者ロール' },
          ].map(setting => (
            <div key={setting.key} className="bg-zinc-900 border border-zinc-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg text-white">{setting.label} 特別料金</h3>
                <label className="flex items-center cursor-pointer">
                  <div className="relative">
                    <input type="checkbox" className="sr-only" 
                      checked={toggles[setting.key as keyof typeof toggles]}
                      onChange={(e) => setToggles({...toggles, [setting.key]: e.target.checked})}
                    />
                    <div className={`block w-14 h-8 rounded-full transition-colors ${toggles[setting.key as keyof typeof toggles] ? 'bg-red-500' : 'bg-zinc-600'}`}></div>
                    <div className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${toggles[setting.key as keyof typeof toggles] ? 'transform translate-x-6' : ''}`}></div>
                  </div>
                  <div className="ml-3 text-zinc-300 font-medium">
                    {toggles[setting.key as keyof typeof toggles] ? '有効' : '無効'}
                  </div>
                </label>
              </div>

              {toggles[setting.key as keyof typeof toggles] && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 pt-4 border-t border-zinc-700">
                  {Object.entries(rolePrices[setting.roleKey]).map(([roomType, durations]: [string, any]) => (
                    <div key={roomType} className="bg-zinc-800 rounded p-3">
                      <h4 className="text-sm font-bold text-zinc-300 mb-2">{roomType}</h4>
                      <div className="space-y-2">
                        {Object.entries(durations).map(([dur, data]: [string, any]) => (
                          <div key={dur} className="flex items-center justify-between text-sm">
                            <span className="text-zinc-400">{dur}時間:</span>
                            <div className="flex items-center">
                              <input 
                                type="number"
                                value={data.price}
                                onChange={e => handleRolePriceChange(setting.roleKey, roomType, dur, e.target.value)}
                                className="w-24 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-white focus:outline-none focus:border-red-500 text-right"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* --- パネル設置 --- */}
      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl">
        <h2 className="text-xl font-bold mb-6 border-b border-zinc-700 pb-2 text-white">パネル設置 (遠隔操作)</h2>
        <p className="text-sm text-zinc-400 mb-6">
          ダッシュボードからDiscordの指定したチャンネルに、部屋作成パネルを設置します。<br/>
          設置したいパネルの種類を選び、チャンネルを指定して「設置」ボタンを押してください。
        </p>

        <div className="space-y-4">
          {[
            { id: 'inn', name: '一般宿作成パネル', desc: '一般宿単独の作成パネル' },
            { id: 'inn_combined', name: '一般宿・高級宿セットパネル', desc: '宿と高級宿の両方のボタンがあるパネル' },
            { id: 'main_inn', name: '本準メン専用の宿パネル', desc: '本/準メンバー専用の一般宿(無料)を作成するパネル' },
            { id: 'luxury_inn_single', name: '高級宿単体のパネル', desc: '高級宿単独の作成パネル' },
            { id: 'game_vc', name: 'ゲームVC作成パネル', desc: 'ゲームVCを作成するパネル' },
            { id: 'gamble_vc', name: '賭博VC作成パネル', desc: '賭博VCを作成するパネル' },
            { id: 'custom_vc', name: 'カスタムVC作成パネル', desc: '任意の名前・人数のカスタムVCを作成するパネル' },
          ].map(panel => (
            <div key={panel.id} className="bg-zinc-900 rounded border border-zinc-700">
              <div className="flex flex-col md:flex-row items-center justify-between p-4 gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-lg">{panel.name}</h3>
                    {panelConfigs[panel.id] && (
                      <button 
                        onClick={() => setExpandedPanels(prev => ({ ...prev, [panel.id]: !prev[panel.id] }))}
                        className="text-xs bg-zinc-700 hover:bg-zinc-600 px-2 py-1 rounded text-white transition-colors"
                      >
                        {expandedPanels[panel.id] ? '設定を閉じる' : '設定を開く'}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">{panel.desc}</p>
                </div>
              <div className="w-full md:w-64">
                <Select
                  options={channelOptions}
                  value={channelOptions.find(o => o.value === selectedChannels[panel.id])}
                  onChange={(selected: any) => setSelectedChannels(prev => ({ ...prev, [panel.id]: selected?.value || '' }))}
                  styles={customStyles}
                  placeholder="設置先チャンネル..."
                />
              </div>
                <button
                  onClick={() => handleDeployPanel(panel.id)}
                  disabled={deploying[panel.id] || !selectedChannels[panel.id]}
                  className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded font-bold shadow transition-colors whitespace-nowrap"
                >
                  {deploying[panel.id] ? 'リクエスト中...' : 'パネルを設置'}
                </button>
              </div>
              
              {expandedPanels[panel.id] && panelConfigs[panel.id] && (
                <div className="bg-zinc-800/50 p-4 border-t border-zinc-700">
                  <h4 className="font-bold text-white mb-4 text-sm">■ {panel.name} の設定</h4>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between bg-zinc-800 p-3 rounded border border-zinc-700">
                      <span className="text-sm text-white font-bold">仮メンバーの利用を許可</span>
                      <label className="flex items-center cursor-pointer">
                        <div className="relative">
                          <input type="checkbox" className="sr-only" 
                            checked={panelConfigs[panel.id].allowTemp}
                            onChange={(e) => setPanelConfigs((prev: any) => ({ ...prev, [panel.id]: { ...prev[panel.id], allowTemp: e.target.checked } }))}
                          />
                          <div className={`block w-12 h-7 rounded-full transition-colors ${panelConfigs[panel.id].allowTemp ? 'bg-red-500' : 'bg-zinc-600'}`}></div>
                          <div className={`dot absolute left-1 top-1 bg-white w-5 h-5 rounded-full transition-transform ${panelConfigs[panel.id].allowTemp ? 'transform translate-x-5' : ''}`}></div>
                        </div>
                      </label>
                    </div>

                    <div className="flex items-center justify-between bg-zinc-800 p-3 rounded border border-zinc-700">
                      <span className="text-sm text-white font-bold">本・準メンバーの利用を許可</span>
                      <label className="flex items-center cursor-pointer">
                        <div className="relative">
                          <input type="checkbox" className="sr-only" 
                            checked={panelConfigs[panel.id].allowMainSub}
                            onChange={(e) => setPanelConfigs((prev: any) => ({ ...prev, [panel.id]: { ...prev[panel.id], allowMainSub: e.target.checked } }))}
                          />
                          <div className={`block w-12 h-7 rounded-full transition-colors ${panelConfigs[panel.id].allowMainSub ? 'bg-red-500' : 'bg-zinc-600'}`}></div>
                          <div className={`dot absolute left-1 top-1 bg-white w-5 h-5 rounded-full transition-transform ${panelConfigs[panel.id].allowMainSub ? 'transform translate-x-5' : ''}`}></div>
                        </div>
                      </label>
                    </div>

                    <div className="bg-zinc-800 p-3 rounded border border-zinc-700">
                      <span className="block text-sm text-white font-bold mb-2">作成先のカテゴリー</span>
                      <p className="text-xs text-zinc-400 mb-2">指定しない場合は、パネルと同じカテゴリーに部屋が作られます。</p>
                      <Select
                        options={[{value: '', label: '指定なし (パネルと同じカテゴリー)'}, ...channels.filter(c => c.type === 4).map(c => ({ value: c.id, label: `📁 ${c.name}` }))]}
                        value={panelConfigs[panel.id].categoryId ? {value: panelConfigs[panel.id].categoryId, label: `📁 ${channels.find(c => c.id === panelConfigs[panel.id].categoryId)?.name || '不明'}`} : {value: '', label: '指定なし (パネルと同じカテゴリー)'}}
                        onChange={(selected: any) => setPanelConfigs((prev: any) => ({ ...prev, [panel.id]: { ...prev[panel.id], categoryId: selected?.value || '' } }))}
                        styles={customStyles}
                        placeholder="カテゴリーを選択..."
                      />
                    </div>
                    
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={handleSavePrices}
                        disabled={saving}
                        className="mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-50 text-white px-4 py-2 rounded font-bold shadow transition-colors text-sm"
                      >
                        {saving ? '保存中...' : '設定を保存'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}