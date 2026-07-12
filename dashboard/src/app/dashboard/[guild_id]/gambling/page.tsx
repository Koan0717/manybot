'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Save, AlertCircle, Settings, Dices, Coins, Cherry, Spade, Disc, Percent } from 'lucide-react';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import Select from 'react-select';

const COLORS = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#6366f1'];

export default function GamblingSettingsPage() {
  const params = useParams();
  const guildId = params.guild_id as string;
  
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('common');
  const [rouletteChartType, setRouletteChartType] = useState<'2x' | '3x' | '36x'>('2x');
  const [channels, setChannels] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/gambling`).then(res => res.ok ? res.json() : { error: true }),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : [])
    ]).then(([data, channelsData]: [any, any]) => {
        if (!data.error) {
          setSettings({
            GAMBLE_CHINCHIRO_PANEL_CHANNEL: data.GAMBLE_CHINCHIRO_PANEL_CHANNEL ?? '',
            GAMBLE_COINFLIP_PANEL_CHANNEL: data.GAMBLE_COINFLIP_PANEL_CHANNEL ?? '',
            GAMBLE_SLOT_PANEL_CHANNEL: data.GAMBLE_SLOT_PANEL_CHANNEL ?? '',
            GAMBLE_BLACKJACK_PANEL_CHANNEL: data.GAMBLE_BLACKJACK_PANEL_CHANNEL ?? '',
            GAMBLE_ROULETTE_PANEL_CHANNEL: data.GAMBLE_ROULETTE_PANEL_CHANNEL ?? '',
            GAMBLE_MAX_PLAYS: data.GAMBLE_MAX_PLAYS ?? 10,
            GAMBLE_DAILY_LIMIT: data.GAMBLE_DAILY_LIMIT ?? 0,
            GAMBLE_MAX_BET: data.GAMBLE_MAX_BET ?? 100000,
            GAMBLE_TAX_ENABLED: data.GAMBLE_TAX_ENABLED ?? false,
            GAMBLE_TAX_RATE: data.GAMBLE_TAX_RATE ?? 0.05,
            
            GAMBLE_CHINCHIRO_RATE_PINZORO: data.GAMBLE_CHINCHIRO_RATE_PINZORO ?? 0.02,
            GAMBLE_CHINCHIRO_RATE_ARASHI: data.GAMBLE_CHINCHIRO_RATE_ARASHI ?? 0.05,
            GAMBLE_CHINCHIRO_RATE_SHIGORO: data.GAMBLE_CHINCHIRO_RATE_SHIGORO ?? 0.08,
            GAMBLE_CHINCHIRO_RATE_NORMAL_WIN: data.GAMBLE_CHINCHIRO_RATE_NORMAL_WIN ?? 0.295,
            GAMBLE_CHINCHIRO_RATE_HIFUMI: data.GAMBLE_CHINCHIRO_RATE_HIFUMI ?? 0.11,
            GAMBLE_CHINCHIRO_RATE_LOSE: data.GAMBLE_CHINCHIRO_RATE_LOSE ?? 0.445,
            
            GAMBLE_CHINCHIRO_MUL_PINZORO: data.GAMBLE_CHINCHIRO_MUL_PINZORO ?? 5.0,
            GAMBLE_CHINCHIRO_MUL_ARASHI: data.GAMBLE_CHINCHIRO_MUL_ARASHI ?? 3.0,
            GAMBLE_CHINCHIRO_MUL_SHIGORO: data.GAMBLE_CHINCHIRO_MUL_SHIGORO ?? 2.0,
            GAMBLE_CHINCHIRO_MUL_HIFUMI: data.GAMBLE_CHINCHIRO_MUL_HIFUMI ?? -2.0,
            GAMBLE_CHINCHIRO_MUL_NORMAL: data.GAMBLE_CHINCHIRO_MUL_NORMAL ?? 1.0,
            
            GAMBLE_COINFLIP_RATE_WIN: data.GAMBLE_COINFLIP_RATE_WIN ?? 0.475,
            GAMBLE_COINFLIP_RATE_LOSE: data.GAMBLE_COINFLIP_RATE_LOSE ?? 0.525,
            GAMBLE_COINFLIP_MUL: data.GAMBLE_COINFLIP_MUL ?? 2.0,
            
            GAMBLE_SLOT_RATE_7: data.GAMBLE_SLOT_RATE_7 ?? 0.002,
            GAMBLE_SLOT_RATE_STAR: data.GAMBLE_SLOT_RATE_STAR ?? 0.002,
            GAMBLE_SLOT_RATE_THREE: data.GAMBLE_SLOT_RATE_THREE ?? 0.012,
            GAMBLE_SLOT_RATE_TWO: data.GAMBLE_SLOT_RATE_TWO ?? 0.328,
            GAMBLE_SLOT_MUL_7: data.GAMBLE_SLOT_MUL_7 ?? 10.0,
            GAMBLE_SLOT_MUL_STAR: data.GAMBLE_SLOT_MUL_STAR ?? 5.0,
            GAMBLE_SLOT_MUL_THREE: data.GAMBLE_SLOT_MUL_THREE ?? 3.0,
            GAMBLE_SLOT_MUL_TWO: data.GAMBLE_SLOT_MUL_TWO ?? 1.5,
            
            GAMBLE_BLACKJACK_RATE_NORMAL_WIN: data.GAMBLE_BLACKJACK_RATE_NORMAL_WIN ?? 0.38,
            GAMBLE_BLACKJACK_RATE_BJ_WIN: data.GAMBLE_BLACKJACK_RATE_BJ_WIN ?? 0.05,
            GAMBLE_BLACKJACK_RATE_DRAW: data.GAMBLE_BLACKJACK_RATE_DRAW ?? 0.09,
            GAMBLE_BLACKJACK_RATE_LOSE: data.GAMBLE_BLACKJACK_RATE_LOSE ?? 0.48,
            GAMBLE_BLACKJACK_MUL_NORMAL: data.GAMBLE_BLACKJACK_MUL_NORMAL ?? 2.0,
            GAMBLE_BLACKJACK_MUL_BJ: data.GAMBLE_BLACKJACK_MUL_BJ ?? 2.5,
            
            GAMBLE_ROULETTE_WIN_RATE_2X: data.GAMBLE_ROULETTE_WIN_RATE_2X ?? 0.475,
            GAMBLE_ROULETTE_WIN_RATE_3X: data.GAMBLE_ROULETTE_WIN_RATE_3X ?? 0.316,
            GAMBLE_ROULETTE_WIN_RATE_36X: data.GAMBLE_ROULETTE_WIN_RATE_36X ?? 0.0264,
            GAMBLE_ROULETTE_MUL_2X: data.GAMBLE_ROULETTE_MUL_2X ?? 2.0,
            GAMBLE_ROULETTE_MUL_3X: data.GAMBLE_ROULETTE_MUL_3X ?? 3.0,
            GAMBLE_ROULETTE_MUL_36X: data.GAMBLE_ROULETTE_MUL_36X ?? 36.0
          });
        }
        if (!channelsData.error && Array.isArray(channelsData)) {
          setChannels(channelsData.filter((c: any) => [0, 10, 11, 12].includes(c.type)));
        }
      })
      .catch(err => {
        console.error(err);
        setError('データの取得に失敗しました');
      })
      .finally(() => setLoading(false));
  }, [guildId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/gambling`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('保存に失敗しました');
      alert('設定を保存しました！');
    } catch (err) {
      console.error(err);
      setError('設定の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const updateRate = (key: string, percentStr: string) => {
    const val = parseFloat(percentStr) / 100;
    updateSetting(key, isNaN(val) ? 0 : val);
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64 text-purple-400">Loading...</div>;
  }

  const tabs = [
    { id: 'common', label: '共通設定', icon: Settings },
    { id: 'chinchiro', label: 'チンチロ', icon: Dices },
    { id: 'coinflip', label: 'コイントス', icon: Coins },
    { id: 'slot', label: 'スロット', icon: Cherry },
    { id: 'blackjack', label: 'ブラックジャック', icon: Spade },
    { id: 'roulette', label: 'ルーレット', icon: Disc },
  ];

  // Pie chart data generation
  let pieData: any[] = [];
  if (activeTab === 'chinchiro') {
    pieData = [
      { name: 'ピンゾロ', value: settings.GAMBLE_CHINCHIRO_RATE_PINZORO },
      { name: 'アラシ', value: settings.GAMBLE_CHINCHIRO_RATE_ARASHI },
      { name: 'シゴロ', value: settings.GAMBLE_CHINCHIRO_RATE_SHIGORO },
      { name: '通常勝ち', value: settings.GAMBLE_CHINCHIRO_RATE_NORMAL_WIN },
      { name: 'ヒフミ (負け)', value: settings.GAMBLE_CHINCHIRO_RATE_HIFUMI },
      { name: '通常負け', value: settings.GAMBLE_CHINCHIRO_RATE_LOSE },
    ];
  } else if (activeTab === 'coinflip') {
    pieData = [
      { name: '勝ち', value: settings.GAMBLE_COINFLIP_RATE_WIN },
      { name: '負け', value: settings.GAMBLE_COINFLIP_RATE_LOSE },
    ];
  } else if (activeTab === 'slot') {
    const loseRate = Math.max(0, 1 - (settings.GAMBLE_SLOT_RATE_7 + settings.GAMBLE_SLOT_RATE_STAR + settings.GAMBLE_SLOT_RATE_THREE + settings.GAMBLE_SLOT_RATE_TWO));
    pieData = [
      { name: '7揃い', value: settings.GAMBLE_SLOT_RATE_7 },
      { name: '星揃い', value: settings.GAMBLE_SLOT_RATE_STAR },
      { name: '3つ揃い', value: settings.GAMBLE_SLOT_RATE_THREE },
      { name: '2つ揃い', value: settings.GAMBLE_SLOT_RATE_TWO },
      { name: 'ハズレ', value: loseRate },
    ];
  } else if (activeTab === 'blackjack') {
    pieData = [
      { name: '通常勝ち', value: settings.GAMBLE_BLACKJACK_RATE_NORMAL_WIN },
      { name: 'BJ勝ち', value: settings.GAMBLE_BLACKJACK_RATE_BJ_WIN },
      { name: '引き分け', value: settings.GAMBLE_BLACKJACK_RATE_DRAW },
      { name: '負け', value: settings.GAMBLE_BLACKJACK_RATE_LOSE },
    ];
  } else if (activeTab === 'roulette') {
    if (rouletteChartType === '2x') {
      pieData = [
        { name: '2倍賭け当たり', value: settings.GAMBLE_ROULETTE_WIN_RATE_2X },
        { name: '2倍賭けハズレ', value: Math.max(0, 1 - settings.GAMBLE_ROULETTE_WIN_RATE_2X) },
      ];
    } else if (rouletteChartType === '3x') {
      pieData = [
        { name: '3倍賭け当たり', value: settings.GAMBLE_ROULETTE_WIN_RATE_3X },
        { name: '3倍賭けハズレ', value: Math.max(0, 1 - settings.GAMBLE_ROULETTE_WIN_RATE_3X) },
      ];
    } else if (rouletteChartType === '36x') {
      pieData = [
        { name: '1点賭け当たり', value: settings.GAMBLE_ROULETTE_WIN_RATE_36X },
        { name: '1点賭けハズレ', value: Math.max(0, 1 - settings.GAMBLE_ROULETTE_WIN_RATE_36X) },
      ];
    }
  }

  const renderInput = (label: string, key: string, isPercent: boolean = false, step: string = "0.01") => (
    <div className="flex flex-col space-y-2 bg-gray-800/40 p-4 rounded-lg border border-gray-700/50 hover:border-purple-500/30 transition-colors">
      <label className="text-sm text-gray-300 font-medium">{label}</label>
      <div className="relative">
        <input
          type="number"
          step={step}
          value={isPercent ? (settings[key] * 100).toFixed(2) : settings[key]}
          onChange={(e) => isPercent ? updateRate(key, e.target.value) : updateSetting(key, parseFloat(e.target.value) || 0)}
          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 pr-8 text-white focus:outline-none focus:border-purple-500 transition-colors"
        />
        {isPercent && <Percent size={14} className="absolute right-3 top-3 text-gray-400 pointer-events-none" />}
      </div>
    </div>
  );

  const channelOptions = [{ value: '', label: '設置しない' }, ...channels.map(c => ({ value: c.id, label: `#${c.name}` }))];

  const renderChannelSelect = (label: string, key: string) => (
    <div className="flex flex-col space-y-2 bg-gray-800/40 p-4 rounded-lg border border-gray-700/50 hover:border-purple-500/30 transition-colors">
      <label className="text-sm text-gray-300 font-medium">{label}</label>
      <Select
        options={channelOptions}
        value={channelOptions.find(o => o.value === (settings[key] || '')) || channelOptions[0]}
        onChange={(selected: any) => updateSetting(key, selected ? selected.value : '')}
        styles={{
          control: (base) => ({
            ...base,
            backgroundColor: '#111827',
            borderColor: '#4B5563',
            color: 'white',
          }),
          menu: (base) => ({
            ...base,
            backgroundColor: '#111827',
            color: 'white',
          }),
          option: (base, state) => ({
            ...base,
            backgroundColor: state.isFocused ? '#374151' : '#111827',
            color: 'white',
            ':active': { backgroundColor: '#4B5563' }
          }),
          singleValue: (base) => ({
            ...base,
            color: 'white',
          }),
          input: (base) => ({
            ...base,
            color: 'white',
          })
        }}
        isSearchable
        placeholder="検索して選択..."
        noOptionsMessage={() => "見つかりませんでした"}
      />
    </div>
  );

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      <div className="flex justify-between items-center bg-gray-900/80 p-6 rounded-2xl border border-purple-500/20 backdrop-blur-sm sticky top-0 z-10 shadow-2xl">
        <div>
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 flex items-center gap-3">
            <Dices className="text-purple-500" size={32} />
            ギャンブル設定
          </h1>
          <p className="text-gray-400 mt-2 text-sm">各ゲームの確率バランスや配当倍率、1日の利用制限をカスタマイズします。</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center space-x-2 px-8 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl shadow-[0_0_15px_rgba(139,92,246,0.5)] transition-all disabled:opacity-50 font-bold"
        >
          <Save size={20} />
          <span>{saving ? '保存中...' : '設定を保存'}</span>
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl flex items-center space-x-3">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map(t => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center space-x-2 px-5 py-3 rounded-lg transition-all font-medium ${
                isActive 
                ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30' 
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              <Icon size={18} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Side: Inputs */}
        <div className="lg:col-span-2 space-y-6">
          <motion.div 
            key={activeTab}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700/50 rounded-2xl p-6 shadow-xl"
          >
            {activeTab === 'common' && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2 mb-4">共通ルール</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {renderInput('1日のプレイ回数上限 (0で無制限)', 'GAMBLE_MAX_PLAYS', false, '1')}
                  {renderInput('1日の合計ベット額上限 (0で無制限)', 'GAMBLE_DAILY_LIMIT', false, '1000')}
                  {renderInput('1回の最大ベット額', 'GAMBLE_MAX_BET', false, '100')}
                  
                  <div className="flex flex-col space-y-2 bg-gray-800/40 p-4 rounded-lg border border-gray-700/50">
                    <label className="text-sm text-gray-300 font-medium">カジノ手数料徴収</label>
                    <button
                      onClick={() => updateSetting('GAMBLE_TAX_ENABLED', !settings.GAMBLE_TAX_ENABLED)}
                      className={`px-4 py-2 rounded-lg font-bold transition-colors ${settings.GAMBLE_TAX_ENABLED ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                    >
                      {settings.GAMBLE_TAX_ENABLED ? '有効 (ON)' : '無効 (OFF)'}
                    </button>
                  </div>
                  
                  {settings.GAMBLE_TAX_ENABLED && renderInput('手数料率', 'GAMBLE_TAX_RATE', true)}
                </div>
              </div>
            )}

            {activeTab === 'chinchiro' && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2 mb-4">確率設定 (%)</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {renderInput('ピンゾロ確率', 'GAMBLE_CHINCHIRO_RATE_PINZORO', true)}
                  {renderInput('アラシ確率', 'GAMBLE_CHINCHIRO_RATE_ARASHI', true)}
                  {renderInput('シゴロ確率', 'GAMBLE_CHINCHIRO_RATE_SHIGORO', true)}
                  {renderInput('通常勝ち確率', 'GAMBLE_CHINCHIRO_RATE_NORMAL_WIN', true)}
                  {renderInput('ヒフミ(負け)確率', 'GAMBLE_CHINCHIRO_RATE_HIFUMI', true)}
                  {renderInput('通常負け確率', 'GAMBLE_CHINCHIRO_RATE_LOSE', true)}
                </div>
                
                <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2 mb-4 mt-8">倍率設定 (倍)</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {renderInput('ピンゾロ倍率', 'GAMBLE_CHINCHIRO_MUL_PINZORO', false, '0.1')}
                  {renderInput('アラシ倍率', 'GAMBLE_CHINCHIRO_MUL_ARASHI', false, '0.1')}
                  {renderInput('シゴロ倍率', 'GAMBLE_CHINCHIRO_MUL_SHIGORO', false, '0.1')}
                  {renderInput('ヒフミ(ペナルティ)倍率', 'GAMBLE_CHINCHIRO_MUL_HIFUMI', false, '0.1')}
                  {renderInput('通常勝ち倍率', 'GAMBLE_CHINCHIRO_MUL_NORMAL', false, '0.1')}
                </div>

                <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2 mb-4 mt-8">パネル設置</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {renderChannelSelect('パネル設置先チャンネル', 'GAMBLE_CHINCHIRO_PANEL_CHANNEL')}
                </div>
              </div>
            )}

            {activeTab === 'coinflip' && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2 mb-4">設定</h3>
                <div className="grid grid-cols-2 gap-4">
                  {renderInput('勝ち確率', 'GAMBLE_COINFLIP_RATE_WIN', true)}
                  {renderInput('負け確率', 'GAMBLE_COINFLIP_RATE_LOSE', true)}
                  {renderInput('配当倍率', 'GAMBLE_COINFLIP_MUL', false, '0.1')}
                </div>

                <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2 mb-4 mt-8">パネル設置</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {renderChannelSelect('パネル設置先チャンネル', 'GAMBLE_COINFLIP_PANEL_CHANNEL')}
                </div>
              </div>
            )}

            {activeTab === 'slot' && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2 mb-4">確率設定 (%)</h3>
                <div className="grid grid-cols-2 gap-4">
                  {renderInput('7揃い確率', 'GAMBLE_SLOT_RATE_7', true)}
                  {renderInput('星揃い確率', 'GAMBLE_SLOT_RATE_STAR', true)}
                  {renderInput('3つ揃い確率', 'GAMBLE_SLOT_RATE_THREE', true)}
                  {renderInput('2つ揃い確率', 'GAMBLE_SLOT_RATE_TWO', true)}
                  <div className="text-xs text-gray-500 col-span-2">※ 残りの確率が自動的にハズレになります。</div>
                </div>

                <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2 mb-4 mt-8">倍率設定 (倍)</h3>
                <div className="grid grid-cols-2 gap-4">
                  {renderInput('7揃い倍率', 'GAMBLE_SLOT_MUL_7', false, '0.1')}
                  {renderInput('星揃い倍率', 'GAMBLE_SLOT_MUL_STAR', false, '0.1')}
                  {renderInput('3つ揃い倍率', 'GAMBLE_SLOT_MUL_THREE', false, '0.1')}
                  {renderInput('2つ揃い倍率', 'GAMBLE_SLOT_MUL_TWO', false, '0.1')}
                </div>

                <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2 mb-4 mt-8">パネル設置</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {renderChannelSelect('パネル設置先チャンネル', 'GAMBLE_SLOT_PANEL_CHANNEL')}
                </div>
              </div>
            )}

            {activeTab === 'blackjack' && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2 mb-4">確率設定 (%)</h3>
                <div className="grid grid-cols-2 gap-4">
                  {renderInput('通常勝ち確率', 'GAMBLE_BLACKJACK_RATE_NORMAL_WIN', true)}
                  {renderInput('ブラックジャック勝ち確率', 'GAMBLE_BLACKJACK_RATE_BJ_WIN', true)}
                  {renderInput('引き分け確率', 'GAMBLE_BLACKJACK_RATE_DRAW', true)}
                  {renderInput('負け確率', 'GAMBLE_BLACKJACK_RATE_LOSE', true)}
                </div>

                <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2 mb-4 mt-8">倍率設定 (倍)</h3>
                <div className="grid grid-cols-2 gap-4">
                  {renderInput('通常勝ち倍率', 'GAMBLE_BLACKJACK_MUL_NORMAL', false, '0.1')}
                  {renderInput('BJ勝ち倍率', 'GAMBLE_BLACKJACK_MUL_BJ', false, '0.1')}
                </div>

                <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2 mb-4 mt-8">パネル設置</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {renderChannelSelect('パネル設置先チャンネル', 'GAMBLE_BLACKJACK_PANEL_CHANNEL')}
                </div>
              </div>
            )}

            {activeTab === 'roulette' && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2 mb-4">確率設定 (%)</h3>
                <div className="grid grid-cols-2 gap-4">
                  {renderInput('2倍賭け当たり確率', 'GAMBLE_ROULETTE_WIN_RATE_2X', true)}
                  {renderInput('3倍賭け当たり確率', 'GAMBLE_ROULETTE_WIN_RATE_3X', true)}
                  {renderInput('1点賭け(36倍)当たり確率', 'GAMBLE_ROULETTE_WIN_RATE_36X', true)}
                </div>

                <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2 mb-4 mt-8">倍率設定 (倍)</h3>
                <div className="grid grid-cols-3 gap-4">
                  {renderInput('2倍賭け配当', 'GAMBLE_ROULETTE_MUL_2X', false, '0.1')}
                  {renderInput('3倍賭け配当', 'GAMBLE_ROULETTE_MUL_3X', false, '0.1')}
                  {renderInput('1点賭け配当', 'GAMBLE_ROULETTE_MUL_36X', false, '0.1')}
                </div>

                <h3 className="text-xl font-bold text-white border-b border-gray-700 pb-2 mb-4 mt-8">パネル設置</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {renderChannelSelect('パネル設置先チャンネル', 'GAMBLE_ROULETTE_PANEL_CHANNEL')}
                </div>
              </div>
            )}
          </motion.div>
        </div>

        {/* Right Side: Pie Chart */}
        {activeTab !== 'common' && pieData.length > 0 && (
          <div className="lg:col-span-1">
            <div className="bg-gradient-to-b from-gray-900 to-gray-950 border border-gray-700/50 rounded-2xl p-6 shadow-2xl sticky top-28">
              <h3 className="text-center text-lg font-bold text-purple-400 mb-2">現在の確率バランス</h3>
              {activeTab === 'roulette' && (
                <div className="flex justify-center gap-2 mb-4">
                  {(['2x', '3x', '36x'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setRouletteChartType(type)}
                      className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${
                        rouletteChartType === type 
                        ? 'bg-purple-600 text-white' 
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {type === '2x' ? '2倍賭け' : type === '3x' ? '3倍賭け' : '1点賭け'}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-center text-xs text-gray-500 mb-6">設定値の合計が100%になるように調整してください。</p>
              
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                      animationDuration={800}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip 
                      formatter={(value: any) => [`${(Number(value) * 100).toFixed(2)}%`, '確率']}
                      contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px', color: '#fff' }}
                    />
                    <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '12px', color: '#9ca3af' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-800">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-400">合計確率:</span>
                  <span className={`font-bold ${pieData.reduce((a, b) => a + b.value, 0) > 1.01 || pieData.reduce((a, b) => a + b.value, 0) < 0.99 ? 'text-red-400' : 'text-green-400'}`}>
                    {(pieData.reduce((a, b) => a + b.value, 0) * 100).toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
