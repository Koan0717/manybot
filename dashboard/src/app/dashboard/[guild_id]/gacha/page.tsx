'use client';
import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Gift, Plus, Trash2, Save, Loader2, Percent } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import PageHeader from '@/components/PageHeader';
import RoleSelect from '@/components/RoleSelect';
import type { RoleOption } from '@/components/RoleSelect';

const COLORS = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#14b8a6', '#a3e635'];

type Prize = {
  id?: number;
  prize_number: number;
  prize_name: string;
  weight: number;
  reward_coins: number;
  reward_role_id: string | null;
};



export default function GachaSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;

  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [isEnabled, setIsEnabled] = useState(true);
  const [allowedRoleIds, setAllowedRoleIds] = useState<string[]>([]);
  const [pullCost, setPullCost] = useState(0);
  const [currencyName, setCurrencyName] = useState('通貨');
  const [prizes, setPrizes] = useState<Prize[]>([
    { prize_number: 1, prize_name: '', weight: 1, reward_coins: 0, reward_role_id: null },
  ]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/roles`).then(r => (r.ok ? r.json() : [])),
      fetch(`/api/guilds/${guildId}/gacha`).then(r => (r.ok ? r.json() : null)),
      fetch(`/api/guilds/${guildId}/settings`).then(r => (r.ok ? r.json() : null)),
    ])
      .then(([rolesData, gachaData, settingsData]) => {
        if (!rolesData.error) setRoles(rolesData.filter((r: any) => r.id !== guildId));
        if (gachaData && !gachaData.error) {
          setIsEnabled(gachaData.is_enabled);
          setAllowedRoleIds(gachaData.allowed_role_ids || []);
          setPullCost(gachaData.pull_cost || 0);
          if (gachaData.prizes && gachaData.prizes.length > 0) setPrizes(gachaData.prizes);
        }
        if (settingsData && settingsData.CURRENCY_NAME) setCurrencyName(settingsData.CURRENCY_NAME);
      })
      .catch(() => toast.error('データの取得に失敗しました'))
      .finally(() => setLoading(false));
  }, [guildId]);

  const roleOptions = roles;

  const totalWeight = prizes.reduce((sum, p) => sum + (Number(p.weight) || 0), 0);

  const pieData = prizes
    .filter(p => p.prize_name.trim() && p.weight > 0)
    .map(p => ({
      name: `${p.prize_number}番 ${p.prize_name}`,
      value: totalWeight > 0 ? (p.weight / totalWeight) * 100 : 0,
    }));

  const addPrize = () => {
    const nextNumber = prizes.length > 0 ? Math.max(...prizes.map(p => p.prize_number)) + 1 : 1;
    setPrizes([...prizes, { prize_number: nextNumber, prize_name: '', weight: 1, reward_coins: 0, reward_role_id: null }]);
  };

  const removePrize = (index: number) => {
    setPrizes(prizes.filter((_, i) => i !== index));
  };

  const updatePrize = (index: number, field: keyof Prize, value: any) => {
    const next = [...prizes];
    (next[index] as any)[field] = value;
    setPrizes(next);
  };

  const handleSave = async () => {
    if (prizes.some(p => !p.prize_name.trim())) {
      toast.error('すべての景品に名前を入力してください');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/gacha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_enabled: isEnabled,
          allowed_role_ids: allowedRoleIds,
          pull_cost: pullCost,
          prizes,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success('保存しました');
    } catch (e: any) {
      toast.error(`保存に失敗しました: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-zinc-400 p-8">読み込み中...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto pb-24 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <PageHeader icon={Gift} title="福引ガチャ設定" subtitle="/ガチャ コマンドで引ける福引の景品・確率・報酬を設定します" guildId={guildId} healthKey="gacha" />
        <button
          onClick={handleSave}
          disabled={saving}
          className="mecha-btn-sheen font-mecha flex items-center gap-2 bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold shadow-lg shadow-red-900/30 transition-all -mt-8"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          設定を保存
        </button>
      </div>

      {/* 基本設定 */}
      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-tech text-sm text-white font-semibold">福引ガチャを有効にする</p>
            <p className="text-xs text-zinc-500 mt-0.5">OFFにすると /ガチャ コマンドが利用できなくなります</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
            <input type="checkbox" className="sr-only peer" checked={isEnabled} onChange={() => setIsEnabled(v => !v)} />
            <div className="w-12 h-6 bg-zinc-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-white after:rounded-full after:h-[18px] after:w-[18px] after:transition-all peer-checked:bg-green-600"></div>
          </label>
        </div>

        <div>
          <label className="block font-tech text-xs text-zinc-400 mb-1.5">対象者ロール(引ける人を限定する。未設定なら全員が引けます)</label>
          <RoleSelect
            label="対象者ロール"
            multiple={true}
            roles={roles}
            value={allowedRoleIds}
            onChange={(vals: string[]) => setAllowedRoleIds(vals)}
            loading={loading}
            placeholder="ロールを選択（未選択なら全員対象）"
          />
        </div>

        <div>
          <label className="block font-tech text-xs text-zinc-400 mb-1.5">1回あたりの消費{currencyName}(0で無料)</label>
          <input
            type="number"
            min={0}
            value={pullCost}
            onChange={e => setPullCost(Number(e.target.value))}
            className="w-full md:w-48 bg-black/40 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:border-red-600 outline-none"
          />
        </div>
      </div>

      {/* 景品リスト + 円グラフ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-mecha text-sm font-bold text-white">景品・確率設定</h2>
            <span className="text-xs text-zinc-500 flex items-center gap-1">
              <Percent className="w-3.5 h-3.5" /> 確率は各景品の「重み」÷ 合計重みで自動計算されます
            </span>
          </div>

          <div className="space-y-3">
            {prizes.map((prize, i) => {
              const percent = totalWeight > 0 ? ((prize.weight / totalWeight) * 100).toFixed(1) : '0.0';
              return (
                <div key={i} className="bg-black/40 border border-zinc-800 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-tech text-xs text-zinc-500 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      景品 #{i + 1}
                    </span>
                    <button onClick={() => removePrize(i)} className="text-zinc-500 hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] text-zinc-500 mb-1">番号</label>
                      <input
                        type="number"
                        value={prize.prize_number}
                        onChange={e => updatePrize(i, 'prize_number', Number(e.target.value))}
                        className="w-full bg-black/40 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-white focus:border-red-600 outline-none"
                      />
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      <label className="block text-[11px] text-zinc-500 mb-1">景品名</label>
                      <input
                        value={prize.prize_name}
                        onChange={e => updatePrize(i, 'prize_name', e.target.value)}
                        placeholder="例: 特賞"
                        className="w-full bg-black/40 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-white focus:border-red-600 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-500 mb-1">重み ({percent}%)</label>
                      <input
                        type="number"
                        min={1}
                        value={prize.weight}
                        onChange={e => updatePrize(i, 'weight', Number(e.target.value))}
                        className="w-full bg-black/40 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-white focus:border-red-600 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-500 mb-1">報酬{currencyName}</label>
                      <input
                        type="number"
                        min={0}
                        value={prize.reward_coins}
                        onChange={e => updatePrize(i, 'reward_coins', Number(e.target.value))}
                        className="w-full bg-black/40 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-white focus:border-red-600 outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-500 mb-1">報酬ロール(任意)</label>
                    <RoleSelect
                      label="報酬ロール"
                      multiple={false}
                      roles={roles}
                      value={prize.reward_role_id || ''}
                      onChange={(val: string) => updatePrize(i, 'reward_role_id', val || null)}
                      loading={loading}
                      placeholder="未設定（ロールなし）"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={addPrize}
            className="w-full flex items-center justify-center gap-2 border border-dashed border-zinc-700 hover:border-red-600 text-zinc-400 hover:text-white rounded-lg py-2.5 text-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> 景品を追加
          </button>
        </div>

        {/* 円グラフ */}
        <div className="lg:col-span-1">
          <div className="mecha-clip bg-gradient-to-b from-neutral-900 to-neutral-950 border border-zinc-800/80 p-6 shadow-2xl sticky top-6">
            <h3 className="text-center font-mecha text-sm font-bold text-red-400 mb-1">現在の当選確率</h3>
            <p className="text-center text-[11px] text-zinc-500 mb-4">景品名が未入力のものはグラフに反映されません</p>

            {pieData.length > 0 ? (
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={95}
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
                      formatter={(value: any) => [`${(Number(value)).toFixed(1)}%`, '確率']}
                      contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', color: '#fff' }}
                    />
                    <Legend verticalAlign="bottom" height={48} wrapperStyle={{ fontSize: '11px', color: '#a1a1aa' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[280px] flex items-center justify-center text-zinc-600 text-sm">
                景品を追加すると表示されます
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
