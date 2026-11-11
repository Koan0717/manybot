'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Trophy, Save, RefreshCw, Shield } from 'lucide-react';
import { DEFAULT_RANKS } from '@/lib/doumori/settings';

interface RankConfig {
  level: number;
  name: string;
  required_miles: number;
  color: string;
  role_name: string;
}

export default function RanksPage() {
  const { guild_id: guildId } = useParams<{ guild_id: string }>();
  const [ranks, setRanks] = useState<RankConfig[]>(DEFAULT_RANKS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchRanks = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/doumori/ranks`, { cache: 'no-store' });
      const data = await res.json();
      if (Array.isArray(data.ranks)) setRanks(data.ranks);
    } catch {
      toast.error('取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRanks();
  }, []);

  const updateField = (level: number, field: keyof RankConfig, value: any) => {
    setRanks((prev) => prev.map((r) => (r.level === level ? { ...r, [field]: value } : r)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/doumori/ranks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ranks }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('階級・ランク設定を保存しました！');
      } else {
        toast.error('保存エラー: ' + data.error);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto pb-20">
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-leaf-900 flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-500" />
            階級・ランクアップ設定
          </h1>
          <p className="text-sm text-leaf-500 mt-1">住民が昇格する階級ステップとその条件を設定します。</p>
          <p className="text-xs text-amber-600 mt-1">※ 階級設定は全サーバー共通です（変更できるのは全体管理者だけ）。</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchRanks} disabled={loading || saving} className="bg-white border border-leaf-200 hover:bg-leaf-50 text-leaf-700 px-4 py-2.5 rounded-xl text-sm flex items-center gap-2">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            再読み込み
          </button>
          <button onClick={handleSave} disabled={loading || saving} className="bg-amber-500 hover:bg-amber-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2">
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {ranks.map((r) => (
          <div key={r.level} className="bg-white border rounded-2xl p-5 shadow-sm" style={{ borderColor: `${r.color}60` }}>
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-leaf-100">
              <div className="flex items-center gap-2.5">
                <span
                  className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm text-black shadow-md"
                  style={{ backgroundColor: r.color }}
                >
                  {r.level}
                </span>
                <div>
                  <h3 className="font-bold text-leaf-900 text-sm">階級 Rank {r.level}</h3>
                  <span className="text-[11px] text-leaf-400">{r.level === 1 ? '初期階級' : `Rank ${r.level - 1} からの昇格先`}</span>
                </div>
              </div>
              <input
                type="color"
                value={r.color}
                onChange={(e) => updateField(r.level, 'color', e.target.value)}
                className="w-7 h-7 bg-transparent cursor-pointer border border-leaf-200 rounded"
              />
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-leaf-600 block mb-1">階級表示名（絵文字込み）</label>
                <input
                  type="text"
                  className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm"
                  value={r.name}
                  onChange={(e) => updateField(r.level, 'name', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-leaf-600 block mb-1">昇格に必要なマイル数 (pt)</label>
                <input
                  type="number"
                  min={0}
                  step={100}
                  disabled={r.level === 1}
                  className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm font-mono"
                  value={r.required_miles}
                  onChange={(e) => updateField(r.level, 'required_miles', parseInt(e.target.value, 10) || 0)}
                />
              </div>
              <div>
                <label className="text-xs text-leaf-600 flex items-center gap-1.5 mb-1">
                  <Shield className="w-3.5 h-3.5" />
                  Discord 自動付与ロール名
                </label>
                <input
                  type="text"
                  className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm"
                  value={r.role_name}
                  onChange={(e) => updateField(r.level, 'role_name', e.target.value)}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
