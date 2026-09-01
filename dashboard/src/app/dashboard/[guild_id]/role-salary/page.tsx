'use client';

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Banknote, Plus, Trash2, Coins, Zap, BellRing } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import RoleSelect from '@/components/RoleSelect';

interface RoleSalaryEntry {
  role_id: string;
  amount: number;
}

interface DiscordRole {
  id: string;
  name: string;
  color: number;
}

export default function RoleSalaryPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;

  const [payday, setPayday] = useState(1);
  const [entries, setEntries] = useState<RoleSalaryEntry[]>([]);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [payingNow, setPayingNow] = useState<string | null>(null); // role_id being paid, or 'all'
  const [payingAll, setPayingAll] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/role-salary`).then(res => res.ok ? res.json() : {}) as Promise<any>,
      fetch(`/api/guilds/${guildId}/roles`).then(res => res.ok ? res.json() : []) as Promise<any>,
    ]).then(([salaryData, rolesData]) => {
      if (salaryData && !salaryData.error) {
        setPayday(salaryData.payday ?? 1);
        setEntries(Array.isArray(salaryData.entries) ? salaryData.entries : []);
      }
      if (Array.isArray(rolesData)) {
        setRoles(rolesData);
      }
    }).catch(err => {
      console.error(err);
      toast.error('データの取得に失敗しました');
    }).finally(() => {
      setLoading(false);
    });
  }, [guildId]);

  const handleAddEntry = () => {
    setEntries(prev => [...prev, { role_id: '', amount: 0 }]);
  };

  const handleUpdateEntry = (index: number, field: keyof RoleSalaryEntry, value: any) => {
    setEntries(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleRemoveEntry = (index: number) => {
    setEntries(prev => prev.filter((_, i) => i !== index));
  };

  const handlePayNow = async (index: number) => {
    const entry = entries[index];
    if (!entry.role_id) {
      toast.error('ロールを選択してください');
      return;
    }
    if (!entry.amount || entry.amount <= 0) {
      toast.error('金額を1以上に設定してください');
      return;
    }
    setPayingNow(entry.role_id);
    try {
      const res = await fetch(`/api/guilds/${guildId}/role-salary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay_now', role_id: entry.role_id, amount: entry.amount }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const roleName = roles.find(r => r.id === entry.role_id)?.name || entry.role_id;
        toast.success(`@${roleName} に ${entry.amount} コインを即時払いリクエストしました`);
      } else {
        toast.error('即時払いに失敗しました: ' + (data.error || '不明なエラー'));
      }
    } catch (e) {
      toast.error('通信エラーが発生しました');
    } finally {
      setPayingNow(null);
    }
  };

  /** 設定されている全エントリを順番に即時払い */
  const handlePayAll = async () => {
    const validEntries = entries.filter(e => e.role_id && e.amount > 0);
    if (validEntries.length === 0) {
      toast.error('有効な給与エントリがありません');
      return;
    }
    setPayingAll(true);
    let successCount = 0;
    let errorCount = 0;
    for (const entry of validEntries) {
      try {
        const res = await fetch(`/api/guilds/${guildId}/role-salary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'pay_now', role_id: entry.role_id, amount: entry.amount }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
    }
    setPayingAll(false);
    if (errorCount === 0) {
      toast.success(`全 ${successCount} 役職への即時払いをリクエストしました`);
    } else {
      toast.error(`${successCount} 件成功、${errorCount} 件失敗しました`);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/role-salary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payday, entries }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('設定を保存しました');
      } else {
        toast.error('エラーが発生しました: ' + (data.error || '保存に失敗しました'));
      }
    } catch (e) {
      toast.error('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-zinc-400 p-8">読み込み中...</div>;
  }

  const validEntryCount = entries.filter(e => e.role_id && e.amount > 0).length;

  return (
    <div className="max-w-4xl mx-auto pb-20 space-y-6">
      <PageHeader
        icon={Banknote}
        title="役職給与設定"
        subtitle="役職（ロール）ごとに月次の給与（鯖内通貨）を自動支給する設定です"
        guildId={guildId}
      />

      {/* 給与日設定 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Coins className="w-5 h-5 text-yellow-400" />
            給与支払日設定
          </h2>
          <p className="text-sm text-zinc-400 mt-1">
            毎月何日に給与を自動支給するかを設定します。（1〜28日）
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-zinc-300 font-medium">毎月</span>
          <input
            type="number"
            min={1}
            max={28}
            value={payday}
            onChange={e => setPayday(Math.min(28, Math.max(1, Number(e.target.value))))}
            className="w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-center font-bold text-lg focus:outline-none focus:border-blue-500 transition-colors"
          />
          <span className="text-zinc-300 font-medium">日に支給</span>
        </div>
      </div>

      {/* 役職給与エントリ一覧 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Banknote className="w-5 h-5 text-green-400" />
              役職給与リスト
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              ロールを選択し、支給するコイン数を設定してください。
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* 全役職即時払いボタン */}
            <button
              type="button"
              onClick={handlePayAll}
              disabled={payingAll || payingNow !== null || validEntryCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors whitespace-nowrap"
              title={`設定されている全 ${validEntryCount} 役職に今すぐ給与を支給します`}
            >
              <BellRing className="w-4 h-4" />
              {payingAll ? '処理中...' : `全役職に即時払い (${validEntryCount})`}
            </button>
            {/* 追加ボタン */}
            <button
              type="button"
              onClick={handleAddEntry}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              追加
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {entries.length === 0 && (
            <div className="text-center text-zinc-500 py-10 border border-dashed border-zinc-700 rounded-xl">
              給与エントリがありません。「追加」ボタンから追加してください。
            </div>
          )}

          {entries.map((entry, index) => (
            <div
              key={index}
              className="flex flex-col sm:flex-row gap-3 p-4 bg-zinc-800/50 border border-zinc-700/60 rounded-xl items-end"
            >
              {/* ロール選択 */}
              <div className="flex-1 min-w-0 space-y-1">
                <label className="block text-xs font-semibold text-zinc-400">ロール</label>
                <RoleSelect
                  label="給与対象ロール"
                  placeholder="ロールを選択..."
                  value={entry.role_id}
                  onChange={(val: any) => handleUpdateEntry(index, 'role_id', val || '')}
                  roles={roles}
                  multiple={false}
                />
              </div>

              {/* 金額設定 */}
              <div className="w-full sm:w-40 space-y-1">
                <label className="block text-xs font-semibold text-zinc-400">金額（コイン）</label>
                <div className="flex items-center gap-2">
                  <Coins className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                  <input
                    type="number"
                    min={0}
                    value={entry.amount}
                    onChange={e => handleUpdateEntry(index, 'amount', Math.max(0, Number(e.target.value)))}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="0"
                  />
                </div>
              </div>

              {/* 即時払いボタン（個別） */}
              <button
                type="button"
                onClick={() => handlePayNow(index)}
                disabled={payingAll || payingNow === entry.role_id || !entry.role_id || entry.amount <= 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-700 hover:bg-green-600 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors whitespace-nowrap"
                title="このロールのメンバーに今すぐ給与を支給します"
              >
                <Zap className="w-4 h-4" />
                {payingNow === entry.role_id ? '処理中...' : '即時払い'}
              </button>

              {/* 削除ボタン */}
              <button
                type="button"
                onClick={() => handleRemoveEntry(index)}
                className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                title="このエントリを削除"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 保存ボタン */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-8 py-3 rounded-lg font-bold text-white shadow-lg transition-all ${
            saving
              ? 'bg-zinc-600 cursor-not-allowed'
              : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 hover:scale-105'
          }`}
        >
          {saving ? '保存中...' : '設定を保存'}
        </button>
      </div>
    </div>
  );
}
