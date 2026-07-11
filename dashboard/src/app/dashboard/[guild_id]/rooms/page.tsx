'use client';
import { useState, useEffect } from 'react';
import Select from 'react-select';

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
      const res = await fetch(`/api/guilds/${guildId}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', ROOM_PRICES: prices })
      });
      if (!res.ok) throw new Error('保存に失敗しました');
      alert('価格設定を保存しました');
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
      alert('設置先のチャンネルを選択してください');
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
      alert('Botにパネル設置をリクエストしました！数秒以内にDiscordにパネルが送信されます。');
    } catch (err) {
      console.error(err);
      alert('パネルの設置リクエストに失敗しました');
    } finally {
      setDeploying(prev => ({ ...prev, [panelType]: false }));
    }
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
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-white">VCルーム・宿設定</h1>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {/* --- 価格設定 --- */}
      <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700 mb-8">
        <div className="flex justify-between items-center mb-6 border-b border-zinc-700 pb-2">
          <h2 className="text-xl font-bold text-white">料金設定 (価格)</h2>
          <button
            onClick={handleSavePrices}
            disabled={saving}
            className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-6 py-2 rounded font-bold shadow-lg transition-colors"
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

      {/* --- パネル設置 --- */}
      <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700">
        <h2 className="text-xl font-bold mb-6 border-b border-zinc-700 pb-2 text-white">パネル設置 (遠隔操作)</h2>
        <p className="text-sm text-zinc-400 mb-6">
          ダッシュボードからDiscordの指定したチャンネルに、部屋作成パネルを設置します。<br/>
          設置したいパネルの種類を選び、チャンネルを指定して「設置」ボタンを押してください。
        </p>

        <div className="space-y-4">
          {[
            { id: 'inn_combined', name: '一般宿・高級宿セットパネル', desc: '宿と高級宿の両方のボタンがあるパネル' },
            { id: 'game_vc', name: 'ゲームVC・賭博VCセットパネル', desc: 'ゲームVCと賭博VCの両方のボタンがあるパネル' },
            { id: 'custom_vc', name: 'カスタムVC作成パネル', desc: '任意の名前・人数のカスタムVCを作成するパネル' },
          ].map(panel => (
            <div key={panel.id} className="flex flex-col md:flex-row items-center justify-between bg-zinc-900 p-4 rounded border border-zinc-700 gap-4">
              <div className="flex-1">
                <h3 className="font-bold text-white text-lg">{panel.name}</h3>
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
          ))}
        </div>
      </div>
    </div>
  );
}