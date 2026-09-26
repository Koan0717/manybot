'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Save, AlertCircle, Settings, Dices, Coins, Cherry, Spade, Disc, Trophy, Percent, ArrowUpDown } from 'lucide-react';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import ChannelSelect from '@/components/ChannelSelect';
import { toast } from 'react-hot-toast';

/**
 * 数字の入力欄。入力中の文字（空欄や「0.」など）はそのまま見せ、打つたびに onChange で親に知らせる。
 * 親の値で毎回書き換えると、消したり打ち直したりできなくなるため。
 */
function NumberField({ value, onChange, className, step, min, max }: {
  value: string | number;
  onChange: (text: string) => void;
  className?: string;
  step?: string;
  min?: string;
  max?: string;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      max={max}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
      className={className}
    />
  );
}

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
  const [horseChartType, setHorseChartType] = useState<'tan' | 'fuku'>('tan');
  const [channels, setChannels] = useState<any[]>([]);
  
  // Panel state
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [selectedGameType, setSelectedGameType] = useState<string>('chinchiro');
  const [sendingPanel, setSendingPanel] = useState(false);

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
            GAMBLE_HORSE_PANEL_CHANNEL: data.GAMBLE_HORSE_PANEL_CHANNEL ?? '',
            GAMBLE_MAX_PLAYS: data.GAMBLE_MAX_PLAYS ?? 10,
            GAMBLE_DAILY_LIMIT: data.GAMBLE_DAILY_LIMIT ?? 0,
            GAMBLE_MAX_BET: data.GAMBLE_MAX_BET ?? 100000,
            GAMBLE_TAX_ENABLED: data.GAMBLE_TAX_ENABLED ?? false,
            GAMBLE_TAX_RATE: data.GAMBLE_TAX_RATE ?? 0.05,
            
            GAMBLE_SHOW_STATS: data.GAMBLE_SHOW_STATS ?? true,
            GAMBLE_CHINCHIRO_SHOW_STATS: data.GAMBLE_CHINCHIRO_SHOW_STATS ?? true,
            GAMBLE_COINFLIP_SHOW_STATS: data.GAMBLE_COINFLIP_SHOW_STATS ?? true,
            GAMBLE_SLOT_SHOW_STATS: data.GAMBLE_SLOT_SHOW_STATS ?? true,
            GAMBLE_BLACKJACK_SHOW_STATS: data.GAMBLE_BLACKJACK_SHOW_STATS ?? true,
            GAMBLE_ROULETTE_SHOW_STATS: data.GAMBLE_ROULETTE_SHOW_STATS ?? true,
            GAMBLE_HORSE_SHOW_STATS: data.GAMBLE_HORSE_SHOW_STATS ?? true,
            GAMBLE_HIGHLOW_SHOW_STATS: data.GAMBLE_HIGHLOW_SHOW_STATS ?? true,
            
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
            GAMBLE_ROULETTE_MUL_36X: data.GAMBLE_ROULETTE_MUL_36X ?? 36.0,

            GAMBLE_HORSE_RATE_WIN_TAN: data.GAMBLE_HORSE_RATE_WIN_TAN ?? 0.20,
            GAMBLE_HORSE_RATE_WIN_FUKU: data.GAMBLE_HORSE_RATE_WIN_FUKU ?? 0.60,
            GAMBLE_HORSE_MUL_TAN: data.GAMBLE_HORSE_MUL_TAN ?? 4.5,
            GAMBLE_HORSE_MUL_FUKU: data.GAMBLE_HORSE_MUL_FUKU ?? 1.5,

            GAMBLE_HIGHLOW_RATE_WIN: data.GAMBLE_HIGHLOW_RATE_WIN ?? 0.45,
            GAMBLE_HIGHLOW_RATE_DRAW: data.GAMBLE_HIGHLOW_RATE_DRAW ?? 0.07,
            GAMBLE_HIGHLOW_RATE_LOSE: data.GAMBLE_HIGHLOW_RATE_LOSE ?? 0.48,
            GAMBLE_HIGHLOW_MUL: data.GAMBLE_HIGHLOW_MUL ?? 1.8,
            GAMBLE_HIGHLOW_MAX_STREAK: data.GAMBLE_HIGHLOW_MAX_STREAK ?? 5,
            // 連勝ごとの受け取り倍率（カンマ区切り。空なら「1回当てるごとの倍率」を掛けていく）
            GAMBLE_HIGHLOW_STREAK_MULS: data.GAMBLE_HIGHLOW_STREAK_MULS === undefined || data.GAMBLE_HIGHLOW_STREAK_MULS === null ? '' : String(data.GAMBLE_HIGHLOW_STREAK_MULS),
            // 連勝ごとの当たり確率（0〜1 のカンマ区切り。空なら共通の当たり確率）
            GAMBLE_HIGHLOW_STREAK_WIN_RATES: data.GAMBLE_HIGHLOW_STREAK_WIN_RATES === undefined || data.GAMBLE_HIGHLOW_STREAK_WIN_RATES === null ? '' : String(data.GAMBLE_HIGHLOW_STREAK_WIN_RATES)
          });
        }
        if (!channelsData.error && Array.isArray(channelsData)) {
          setChannels(channelsData.filter((c: any) => [0, 5, 11, 12, 15].includes(c.type)));
        }
      })
      .catch(err => {
        console.error(err);
        setError('データの取得に失敗しました');
      })
      .finally(() => setLoading(false));
  }, [guildId]);

  // High & Low の連勝ごとの表は、空欄を今の計算値で埋めてから保存する（Bot は先頭から数字が続くところまでを使うため）
  const settingsForSave = () => {
    const out = { ...settings };
    const max = Math.min(30, Math.max(1, Math.floor(Number(settings.GAMBLE_HIGHLOW_MAX_STREAK) || 1)));
    const step = Number(settings.GAMBLE_HIGHLOW_MUL) || 0;
    const split = (v: unknown) => (v === undefined || v === null || v === '' ? [] : String(v).split(',').map((x) => x.trim()));
    const muls = split(settings.GAMBLE_HIGHLOW_STREAK_MULS);
    if (muls.some((x) => Number(x) > 0)) {
      let v = 1;
      out.GAMBLE_HIGHLOW_STREAK_MULS = Array.from({ length: max }, (_, i) => {
        const n = Number(muls[i]);
        v = muls[i] && n > 0 ? n : v * step;
        return String(Math.round(v * 100) / 100);
      }).join(',');
    } else out.GAMBLE_HIGHLOW_STREAK_MULS = '';
    const wins = split(settings.GAMBLE_HIGHLOW_STREAK_WIN_RATES);
    const baseWin = Number(settings.GAMBLE_HIGHLOW_RATE_WIN) || 0;
    if (wins.some((x) => x !== '' && Number.isFinite(Number(x)))) {
      out.GAMBLE_HIGHLOW_STREAK_WIN_RATES = Array.from({ length: max }, (_, i) => {
        const n = Number(wins[i]);
        return String(wins[i] !== undefined && wins[i] !== '' && Number.isFinite(n) && n >= 0 ? Math.min(1, n) : baseWin);
      }).join(',');
    } else out.GAMBLE_HIGHLOW_STREAK_WIN_RATES = '';
    return out;
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/gambling`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForSave()),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        const msg = data.error || '保存に失敗しました';
        setError(`設定の保存に失敗しました: ${msg}`);
        toast.error(`保存に失敗しました: ${msg}`);
        return;
      }
      toast.success('設定を保存しました！');
    } catch (err: any) {
      console.error(err);
      const msg = err?.message || String(err);
      setError(`設定の保存に失敗しました: ${msg}`);
      toast.error(`保存に失敗しました: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const sendGamblingPanel = async () => {
    if (!selectedChannelId) {
      toast.success('送信先のチャンネルを選択してください');
      return;
    }
    
    const selectedChannel = channels.find(c => c.id === selectedChannelId);
    
    setSendingPanel(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/gambling/panel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          channel_id: selectedChannelId, 
          channel_type: selectedChannel?.type,
          game_type: selectedGameType
        })
      });
      
      if (res.ok) {
        toast.success('ギャンブルパネルを送信しました！');
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
    { id: 'horse', label: '競馬', icon: Trophy },
    { id: 'highlow', label: 'High & Low', icon: ArrowUpDown },
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
  } else if (activeTab === 'horse') {
    if (horseChartType === 'tan') {
      pieData = [
        { name: '単勝的中 (1着)', value: settings.GAMBLE_HORSE_RATE_WIN_TAN },
        { name: '不的中', value: Math.max(0, 1 - settings.GAMBLE_HORSE_RATE_WIN_TAN) },
      ];
    } else if (horseChartType === 'fuku') {
      pieData = [
        { name: '複勝的中 (1〜3着)', value: settings.GAMBLE_HORSE_RATE_WIN_FUKU },
        { name: '不的中', value: Math.max(0, 1 - settings.GAMBLE_HORSE_RATE_WIN_FUKU) },
      ];
    }
  }

  if (activeTab === 'highlow') {
    pieData = [
      { name: '当たり', value: settings.GAMBLE_HIGHLOW_RATE_WIN },
      { name: '引き分け (同じ数字)', value: settings.GAMBLE_HIGHLOW_RATE_DRAW },
      { name: 'ハズレ', value: settings.GAMBLE_HIGHLOW_RATE_LOSE },
    ];
  }

  // High & Low の連勝ごとの受け取り倍率（空欄の連勝数は、前の連勝の倍率に「1回当てるごとの倍率」を掛けた値）
  const hlMaxStreak = Math.min(30, Math.max(1, Math.floor(Number(settings.GAMBLE_HIGHLOW_MAX_STREAK) || 1)));
  const hlStep = Number(settings.GAMBLE_HIGHLOW_MUL) || 0;
  const splitRaw = (v: unknown) => (v === undefined || v === null || v === '' ? [] : String(v).split(',').map((x) => x.trim()));
  const hlRaw = splitRaw(settings.GAMBLE_HIGHLOW_STREAK_MULS);
  const hlMulCustom = (i: number) => {
    const n = Number(hlRaw[i]);
    return hlRaw[i] !== undefined && hlRaw[i] !== '' && Number.isFinite(n) && n > 0 ? n : null;
  };
  const hlMulAt = (n: number) => {
    let v = 1;
    for (let k = 1; k <= n; k++) v = hlMulCustom(k - 1) ?? v * hlStep;
    return Math.round(v * 100) / 100;
  };
  const hlAnyMulCustom = Array.from({ length: hlMaxStreak }, (_, i) => hlMulCustom(i) !== null).some(Boolean);
  const setHlMulAt = (n: number, text: string) => {
    const next = Array.from({ length: hlMaxStreak }, (_, i) => hlRaw[i] ?? '');
    next[n - 1] = text.trim();
    updateSetting('GAMBLE_HIGHLOW_STREAK_MULS', next.every((x) => x === '') ? '' : next.join(','));
  };

  // High & Low の連勝ごとの当たり確率（i 番目 = i 連勝中にめくって当てる確率。空欄は共通の当たり確率）
  const hlWinRaw = splitRaw(settings.GAMBLE_HIGHLOW_STREAK_WIN_RATES);
  const hlBaseWin = Number(settings.GAMBLE_HIGHLOW_RATE_WIN) || 0;
  const hlBaseDraw = Number(settings.GAMBLE_HIGHLOW_RATE_DRAW) || 0;
  const hlBaseLose = Number(settings.GAMBLE_HIGHLOW_RATE_LOSE) || 0;
  const hlWinCustom = (i: number) => {
    const n = Number(hlWinRaw[i]);
    return hlWinRaw[i] !== undefined && hlWinRaw[i] !== '' && Number.isFinite(n) && n >= 0 ? Math.min(1, n) : null;
  };
  // Bot の highlow_rates と同じ
  const hlRatesAt = (streak: number) => {
    const win = hlWinCustom(streak);
    if (win !== null) {
      const draw = Math.min(hlBaseDraw, Math.max(0, 1 - win));
      return { win, draw, lose: Math.max(0, 1 - win - draw) };
    }
    return { win: hlBaseWin, draw: hlBaseDraw, lose: hlBaseLose };
  };
  const setHlWinAt = (streak: number, percent: string) => {
    const next = Array.from({ length: hlMaxStreak }, (_, i) => hlWinRaw[i] ?? '');
    const v = parseFloat(percent);
    next[streak] = isNaN(v) ? '' : String(Math.round((Math.min(100, Math.max(0, v)) / 100) * 10000) / 10000);
    updateSetting('GAMBLE_HIGHLOW_STREAK_WIN_RATES', next.every((x) => x === '') ? '' : next.join(','));
  };
  // n 連勝までたどり着く確率（引き分けはやり直しなので、当たり ÷ (当たり + ハズレ) を掛けていく）
  const hlReach = (n: number) => {
    let p = 1;
    for (let i = 0; i < n; i++) {
      const r = hlRatesAt(i);
      p *= r.win + r.lose > 0 ? r.win / (r.win + r.lose) : 0;
    }
    return p;
  };

  const renderInput = (label: string, key: string, isPercent: boolean = false, step: string = "0.01") => (
    <div className="flex flex-col space-y-2 bg-gray-800/40 p-4 rounded-lg border border-gray-700/50 hover:border-purple-500/30 transition-colors">
      <label className="text-sm text-gray-300 font-medium">{label}</label>
      <div className="relative">
        <NumberField
          step={step}
          value={isPercent ? Number(((Number(settings[key]) || 0) * 100).toFixed(4)) : settings[key]}
          onChange={(text) => (isPercent ? updateRate(key, text) : updateSetting(key, parseFloat(text) || 0))}
          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 pr-8 text-white focus:outline-none focus:border-purple-500 transition-colors"
        />
        {isPercent && <Percent size={14} className="absolute right-3 top-3 text-gray-400 pointer-events-none" />}
      </div>
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

                  <div className="flex flex-col space-y-2 bg-gray-800/40 p-4 rounded-lg border border-gray-700/50">
                    <label className="text-sm text-gray-300 font-medium">ギャンブル全体の戦績ボタン表示</label>
                    <button
                      onClick={() => updateSetting('GAMBLE_SHOW_STATS', !settings.GAMBLE_SHOW_STATS)}
                      className={`px-4 py-2 rounded-lg font-bold transition-colors ${settings.GAMBLE_SHOW_STATS ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                    >
                      {settings.GAMBLE_SHOW_STATS ? '表示 (ON)' : '非表示 (OFF)'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'chinchiro' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-gray-700 pb-2 mb-4">
                  <h3 className="text-xl font-bold text-white">チンチロリン設定</h3>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-300">戦績ボタン表示:</span>
                    <button
                      onClick={() => updateSetting('GAMBLE_CHINCHIRO_SHOW_STATS', !settings.GAMBLE_CHINCHIRO_SHOW_STATS)}
                      className={`px-3 py-1 text-sm rounded-lg font-bold transition-colors ${settings.GAMBLE_CHINCHIRO_SHOW_STATS ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                    >
                      {settings.GAMBLE_CHINCHIRO_SHOW_STATS ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>

                <h4 className="text-lg font-semibold text-gray-200">確率設定 (%)</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {renderInput('ピンゾロ確率', 'GAMBLE_CHINCHIRO_RATE_PINZORO', true)}
                  {renderInput('アラシ確率', 'GAMBLE_CHINCHIRO_RATE_ARASHI', true)}
                  {renderInput('シゴロ確率', 'GAMBLE_CHINCHIRO_RATE_SHIGORO', true)}
                  {renderInput('通常勝ち確率', 'GAMBLE_CHINCHIRO_RATE_NORMAL_WIN', true)}
                  {renderInput('ヒフミ(負け)確率', 'GAMBLE_CHINCHIRO_RATE_HIFUMI', true)}
                  {renderInput('通常負け確率', 'GAMBLE_CHINCHIRO_RATE_LOSE', true)}
                </div>
                
                <h4 className="text-lg font-semibold text-gray-200 mt-8">倍率設定 (倍)</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {renderInput('ピンゾロ倍率', 'GAMBLE_CHINCHIRO_MUL_PINZORO', false, '0.1')}
                  {renderInput('アラシ倍率', 'GAMBLE_CHINCHIRO_MUL_ARASHI', false, '0.1')}
                  {renderInput('シゴロ倍率', 'GAMBLE_CHINCHIRO_MUL_SHIGORO', false, '0.1')}
                  {renderInput('ヒフミ(ペナルティ)倍率', 'GAMBLE_CHINCHIRO_MUL_HIFUMI', false, '0.1')}
                  {renderInput('通常勝ち倍率', 'GAMBLE_CHINCHIRO_MUL_NORMAL', false, '0.1')}
                </div>
              </div>
            )}

            {activeTab === 'coinflip' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-gray-700 pb-2 mb-4">
                  <h3 className="text-xl font-bold text-white">コイントス設定</h3>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-300">戦績ボタン表示:</span>
                    <button
                      onClick={() => updateSetting('GAMBLE_COINFLIP_SHOW_STATS', !settings.GAMBLE_COINFLIP_SHOW_STATS)}
                      className={`px-3 py-1 text-sm rounded-lg font-bold transition-colors ${settings.GAMBLE_COINFLIP_SHOW_STATS ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                    >
                      {settings.GAMBLE_COINFLIP_SHOW_STATS ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {renderInput('勝ち確率', 'GAMBLE_COINFLIP_RATE_WIN', true)}
                  {renderInput('負け確率', 'GAMBLE_COINFLIP_RATE_LOSE', true)}
                  {renderInput('配当倍率', 'GAMBLE_COINFLIP_MUL', false, '0.1')}
                </div>
              </div>
            )}

            {activeTab === 'slot' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-gray-700 pb-2 mb-4">
                  <h3 className="text-xl font-bold text-white">スロット設定</h3>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-300">戦績ボタン表示:</span>
                    <button
                      onClick={() => updateSetting('GAMBLE_SLOT_SHOW_STATS', !settings.GAMBLE_SLOT_SHOW_STATS)}
                      className={`px-3 py-1 text-sm rounded-lg font-bold transition-colors ${settings.GAMBLE_SLOT_SHOW_STATS ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                    >
                      {settings.GAMBLE_SLOT_SHOW_STATS ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>

                <h4 className="text-lg font-semibold text-gray-200">確率設定 (%)</h4>
                <div className="grid grid-cols-2 gap-4">
                  {renderInput('7揃い確率', 'GAMBLE_SLOT_RATE_7', true)}
                  {renderInput('星揃い確率', 'GAMBLE_SLOT_RATE_STAR', true)}
                  {renderInput('3つ揃い確率', 'GAMBLE_SLOT_RATE_THREE', true)}
                  {renderInput('2つ揃い確率', 'GAMBLE_SLOT_RATE_TWO', true)}
                  <div className="text-xs text-gray-500 col-span-2">※ 残りの確率が自動的にハズレになります。</div>
                </div>

                <h4 className="text-lg font-semibold text-gray-200 mt-8">倍率設定 (倍)</h4>
                <div className="grid grid-cols-2 gap-4">
                  {renderInput('7揃い倍率', 'GAMBLE_SLOT_MUL_7', false, '0.1')}
                  {renderInput('星揃い倍率', 'GAMBLE_SLOT_MUL_STAR', false, '0.1')}
                  {renderInput('3つ揃い倍率', 'GAMBLE_SLOT_MUL_THREE', false, '0.1')}
                  {renderInput('2つ揃い倍率', 'GAMBLE_SLOT_MUL_TWO', false, '0.1')}
                </div>
              </div>
            )}

            {activeTab === 'blackjack' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-gray-700 pb-2 mb-4">
                  <h3 className="text-xl font-bold text-white">ブラックジャック設定</h3>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-300">戦績ボタン表示:</span>
                    <button
                      onClick={() => updateSetting('GAMBLE_BLACKJACK_SHOW_STATS', !settings.GAMBLE_BLACKJACK_SHOW_STATS)}
                      className={`px-3 py-1 text-sm rounded-lg font-bold transition-colors ${settings.GAMBLE_BLACKJACK_SHOW_STATS ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                    >
                      {settings.GAMBLE_BLACKJACK_SHOW_STATS ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>

                <h4 className="text-lg font-semibold text-gray-200">確率設定 (%)</h4>
                <div className="grid grid-cols-2 gap-4">
                  {renderInput('通常勝ち確率', 'GAMBLE_BLACKJACK_RATE_NORMAL_WIN', true)}
                  {renderInput('ブラックジャック勝ち確率', 'GAMBLE_BLACKJACK_RATE_BJ_WIN', true)}
                  {renderInput('引き分け確率', 'GAMBLE_BLACKJACK_RATE_DRAW', true)}
                  {renderInput('負け確率', 'GAMBLE_BLACKJACK_RATE_LOSE', true)}
                </div>

                <h4 className="text-lg font-semibold text-gray-200 mt-8">倍率設定 (倍)</h4>
                <div className="grid grid-cols-2 gap-4">
                  {renderInput('通常勝ち倍率', 'GAMBLE_BLACKJACK_MUL_NORMAL', false, '0.1')}
                  {renderInput('BJ勝ち倍率', 'GAMBLE_BLACKJACK_MUL_BJ', false, '0.1')}
                </div>
              </div>
            )}

            {activeTab === 'roulette' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-gray-700 pb-2 mb-4">
                  <h3 className="text-xl font-bold text-white">ルーレット設定</h3>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-300">戦績ボタン表示:</span>
                    <button
                      onClick={() => updateSetting('GAMBLE_ROULETTE_SHOW_STATS', !settings.GAMBLE_ROULETTE_SHOW_STATS)}
                      className={`px-3 py-1 text-sm rounded-lg font-bold transition-colors ${settings.GAMBLE_ROULETTE_SHOW_STATS ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                    >
                      {settings.GAMBLE_ROULETTE_SHOW_STATS ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>

                <h4 className="text-lg font-semibold text-gray-200">確率設定 (%)</h4>
                <div className="grid grid-cols-2 gap-4">
                  {renderInput('2倍賭け当たり確率', 'GAMBLE_ROULETTE_WIN_RATE_2X', true)}
                  {renderInput('3倍賭け当たり確率', 'GAMBLE_ROULETTE_WIN_RATE_3X', true)}
                  {renderInput('1点賭け(36倍)当たり確率', 'GAMBLE_ROULETTE_WIN_RATE_36X', true)}
                </div>

                <h4 className="text-lg font-semibold text-gray-200 mt-8">倍率設定 (倍)</h4>
                <div className="grid grid-cols-3 gap-4">
                  {renderInput('2倍賭け配当', 'GAMBLE_ROULETTE_MUL_2X', false, '0.1')}
                  {renderInput('3倍賭け配当', 'GAMBLE_ROULETTE_MUL_3X', false, '0.1')}
                  {renderInput('1点賭け配当', 'GAMBLE_ROULETTE_MUL_36X', false, '0.1')}
                </div>
              </div>
            )}

            {activeTab === 'horse' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-gray-700 pb-2 mb-4">
                  <h3 className="text-xl font-bold text-white">競馬設定</h3>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-300">戦績ボタン表示:</span>
                    <button
                      onClick={() => updateSetting('GAMBLE_HORSE_SHOW_STATS', !settings.GAMBLE_HORSE_SHOW_STATS)}
                      className={`px-3 py-1 text-sm rounded-lg font-bold transition-colors ${settings.GAMBLE_HORSE_SHOW_STATS ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                    >
                      {settings.GAMBLE_HORSE_SHOW_STATS ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>

                <h4 className="text-lg font-semibold text-gray-200">確率設定 (%)</h4>
                <div className="grid grid-cols-2 gap-4">
                  {renderInput('🥇 単勝当選確率 (1着)', 'GAMBLE_HORSE_RATE_WIN_TAN', true)}
                  {renderInput('🥉 複勝当選確率 (1〜3着)', 'GAMBLE_HORSE_RATE_WIN_FUKU', true)}
                  <div className="text-xs text-gray-500 col-span-2">※ 出走5頭のうち、ユーザーが選んだ馬が1着になる確率（単勝）および1〜3着以内に入る確率（複勝）です。</div>
                </div>

                <h4 className="text-lg font-semibold text-gray-200 mt-8">倍率設定 (倍)</h4>
                <div className="grid grid-cols-2 gap-4">
                  {renderInput('🥇 単勝配当倍率', 'GAMBLE_HORSE_MUL_TAN', false, '0.1')}
                  {renderInput('🥉 複勝配当倍率', 'GAMBLE_HORSE_MUL_FUKU', false, '0.1')}
                </div>
              </div>
            )}

            {activeTab === 'highlow' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-gray-700 pb-2 mb-4">
                  <h3 className="text-xl font-bold text-white">High & Low 設定</h3>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-300">戦績ボタン表示:</span>
                    <button
                      onClick={() => updateSetting('GAMBLE_HIGHLOW_SHOW_STATS', !settings.GAMBLE_HIGHLOW_SHOW_STATS)}
                      className={`px-3 py-1 text-sm rounded-lg font-bold transition-colors ${settings.GAMBLE_HIGHLOW_SHOW_STATS ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                    >
                      {settings.GAMBLE_HIGHLOW_SHOW_STATS ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>

                <div className="text-sm text-gray-400 bg-gray-800/40 border border-gray-700/50 rounded-lg p-4 leading-relaxed">
                  次のカードが今のカードより大きい（High）か小さい（Low）かを当てるゲームです。A が一番小さく K が一番大きく、同じ数字は引き分け（そのまま続行）です。
                  連勝するほど受け取れる額が増え（下の「連勝ごとの受け取り倍率」で連勝数ごとに決められます）、いつでも受け取って勝ち逃げできます。外れると賭け金は没収です。
                </div>

                <h4 className="text-lg font-semibold text-gray-200">確率設定 (%) ※1回めくるごと</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {renderInput('当たり確率', 'GAMBLE_HIGHLOW_RATE_WIN', true)}
                  {renderInput('引き分け確率 (同じ数字)', 'GAMBLE_HIGHLOW_RATE_DRAW', true)}
                  {renderInput('ハズレ確率', 'GAMBLE_HIGHLOW_RATE_LOSE', true)}
                  <div className="text-xs text-gray-500 col-span-2 md:col-span-3">
                    ※ ありえない結果（K で High を選んだときの当たりなど）はハズレ、A で High のときのハズレは引き分けになります。
                  </div>
                </div>

                <h4 className="text-lg font-semibold text-gray-200 mt-8">倍率・連勝設定</h4>
                <div className="grid grid-cols-2 gap-4">
                  {renderInput('1回当てるごとの倍率 (倍)', 'GAMBLE_HIGHLOW_MUL', false, '0.1')}
                  {renderInput('最大連勝数 (到達で自動受け取り)', 'GAMBLE_HIGHLOW_MAX_STREAK', false, '1')}
                </div>
                <div className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <div className="text-sm text-gray-200 font-semibold">連勝ごとの当たり確率 (%)</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        「n連勝目」を当てる確率です（例: 8連勝目を 10% にすると、7連勝中の人が次を当てる確率が10%になります）。引き分けは上の共通の確率で、残りがハズレになります。
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateSetting('GAMBLE_HIGHLOW_STREAK_WIN_RATES', '')}
                      className="px-3 py-1.5 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold"
                    >
                      全部 共通の当たり確率（{(hlBaseWin * 100).toFixed(1)}%）に戻す
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {Array.from({ length: hlMaxStreak }, (_, i) => {
                      const r = hlRatesAt(i);
                      const custom = hlWinCustom(i) !== null;
                      return (
                        <label key={i} className="flex flex-col gap-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2">
                          <span className="text-xs text-gray-400">{i + 1}連勝目を当てる</span>
                          <div className="flex items-center gap-1">
                            <NumberField
                              step="0.1"
                              min="0"
                              max="100"
                              value={Number((r.win * 100).toFixed(2))}
                              onChange={(text) => setHlWinAt(i, text)}
                              className={`w-full min-w-0 bg-transparent text-base font-bold focus:outline-none ${custom ? 'text-emerald-300' : 'text-gray-300'}`}
                            />
                            <span className="text-xs text-gray-500">%</span>
                          </div>
                          <span className="text-[10px] text-gray-500">
                            引き分け {(r.draw * 100).toFixed(1)}% / ハズレ {(r.lose * 100).toFixed(1)}%
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-gray-300">
                      <thead>
                        <tr className="text-gray-500">
                          <th className="text-left font-medium py-1">連勝</th>
                          <th className="text-right font-medium py-1">たどり着く確率</th>
                          <th className="text-right font-medium py-1">受け取り倍率</th>
                          <th className="text-right font-medium py-1">そこで受け取ったときの期待値</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: hlMaxStreak }, (_, i) => {
                          const reach = hlReach(i + 1);
                          const ev = reach * (hlMulAt(i + 1) || 0);
                          return (
                            <tr key={i} className="border-t border-gray-800">
                              <td className="py-1">{i + 1}連勝</td>
                              <td className="text-right py-1">{reach >= 0.001 ? `${(reach * 100).toFixed(2)}%` : `${(reach * 100).toFixed(4)}%`}</td>
                              <td className="text-right py-1">×{hlMulAt(i + 1)}</td>
                              <td className={`text-right py-1 font-bold ${ev > 1 ? 'text-red-400' : 'text-emerald-300'}`}>{ev.toFixed(2)}倍</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="text-[11px] text-gray-500 mt-1">
                      期待値は「賭け金の何倍が戻ってくるか」の平均です。1倍を超える（赤字）と、そこまで狙う人がいるほどサーバー全体のお金が増えます。
                    </div>
                  </div>
                </div>

                <div className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <div className="text-sm text-gray-200 font-semibold">連勝ごとの受け取り倍率 (賭け金の何倍を受け取れるか)</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        例: 8連勝を ×100 にすると、8連勝した人は賭け金の100倍を受け取れます。最大連勝数を増やすと欄が増えます。
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateSetting('GAMBLE_HIGHLOW_STREAK_MULS', '')}
                      className="px-3 py-1.5 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold"
                    >
                      自動（1回ごとの倍率 ×{hlStep} を掛ける）に戻す
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {Array.from({ length: hlMaxStreak }, (_, i) => (
                      <label key={i} className="flex flex-col gap-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2">
                        <span className="text-xs text-gray-400">{i + 1}連勝で ×</span>
                        <NumberField
                          step="0.1"
                          min="0"
                          value={hlMulAt(i + 1)}
                          onChange={(text) => setHlMulAt(i + 1, text)}
                          className={`w-full min-w-0 bg-transparent text-base font-bold focus:outline-none ${hlMulCustom(i) !== null ? 'text-amber-300' : 'text-gray-300'}`}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="text-xs text-gray-500">
                    {hlAnyMulCustom ? '黄色の数字が設定した倍率です（白は自動）。' : '今は自動（1回当てるごとの倍率を掛けていく）です。数字を変えるとその値で保存されます。'}
                    賭け金 1,000 で {hlMaxStreak}連勝すると {Math.trunc(1000 * (hlMulAt(hlMaxStreak) || 0)).toLocaleString()} を受け取れます。
                  </div>
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
              {activeTab === 'horse' && (
                <div className="flex justify-center gap-2 mb-4">
                  {(['tan', 'fuku'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setHorseChartType(type)}
                      className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${
                        horseChartType === type 
                        ? 'bg-purple-600 text-white' 
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {type === 'tan' ? '🥇 単勝' : '🥉 複勝'}
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

      {/* ギャンブルパネルの設置 */}
      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl mt-8 mb-12">
        <h2 className="text-xl font-bold text-white mb-4">ギャンブルパネルの設置</h2>
        <p className="text-zinc-400 mb-6 text-sm">
          指定したチャンネルやフォーラムに、ユーザーがギャンブルを遊ぶためのパネル（ボタン付きメッセージ）を送信します。<br/>
          フォーラムを選択した場合は自動的に新しいスレッドが作成されてパネルが設置されます。
        </p>
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
          <div className="flex-1 w-full max-w-[200px]">
            <label className="block text-sm font-medium text-zinc-400 mb-2">ゲーム種類</label>
            <select
              value={selectedGameType}
              onChange={(e) => setSelectedGameType(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-[11px] text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="chinchiro">🎲 チンチロリン</option>
              <option value="coinflip">🪙 コイントス</option>
              <option value="slot">🎰 スロット</option>
              <option value="blackjack">🃏 ブラックジャック</option>
              <option value="roulette">🎡 ルーレット</option>
              <option value="horse">🏇 競馬</option>
              <option value="highlow">🃏 High & Low</option>
            </select>
          </div>
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-zinc-400 mb-2">送信先チャンネル</label>
            <ChannelSelect
              label="送信先チャンネル"
              placeholder="チャンネルを検索・選択..."
              value={selectedChannelId}
              onChange={(id) => setSelectedChannelId(id || '')}
              channels={channels}
              multiple={false}
            />
          </div>
          <button
            onClick={sendGamblingPanel}
            disabled={sendingPanel || !selectedChannelId}
            className="w-full sm:w-auto bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg font-bold shadow-lg transition-all"
          >
            {sendingPanel ? '送信中...' : 'パネルを送信'}
          </button>
        </div>
      </div>
    </div>
  );
}
