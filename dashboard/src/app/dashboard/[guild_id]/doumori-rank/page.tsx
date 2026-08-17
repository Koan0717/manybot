'use client';

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useSyncStatus, SyncStatusCards } from '@/lib/useSyncStatus';
import { Trophy, ArrowRight, Save, RefreshCw, Sparkles, Shield } from 'lucide-react';

interface RankConfig {
  level: number;
  name: string;
  required_miles: number;
  color: string;
  role_name: string;
}

const DEFAULT_RANKS: RankConfig[] = [
  { level: 1, name: '🌱 新規住人', required_miles: 0, color: '#A8E6CF', role_name: '新規住人' },
  { level: 2, name: '🏠 住人', required_miles: 4000, color: '#3498DB', role_name: '住人' },
  { level: 3, name: '☕ 常連住人', required_miles: 15000, color: '#E67E22', role_name: '常連住人' },
  { level: 4, name: '🌟 人気住人', required_miles: 45000, color: '#FFD700', role_name: '人気住人' },
];

export default function DoumoriRankSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const sync = useSyncStatus(guildId);

  const [ranks, setRanks] = useState<RankConfig[]>(DEFAULT_RANKS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchRanks = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/doumori-rank`);
      const data = await res.json();
      if (!data.error && Array.isArray(data.ranks)) {
        setRanks(data.ranks);
      } else {
        toast.error('階級設定の取得に失敗しました');
      }
    } catch {
      toast.error('ネットワークエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRanks();
  }, [guildId]);

  const updateRankField = (level: number, field: keyof RankConfig, value: any) => {
    setRanks((prev) =>
      prev.map((r) => (r.level === level ? { ...r, [field]: value } : r))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/doumori-rank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ranks }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('階級・ランク設定を保存しました！Bot側に即座に反映されます。');
      } else {
        toast.error('保存エラー: ' + data.error);
      }
    } catch {
      toast.error('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto pb-20">
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="mecha-led w-2 h-2 rounded-full bg-amber-400 text-amber-400"></span>
            <span className="font-tech text-[11px] tracking-[0.25em] text-amber-400/90 uppercase">
              Rank-Core // Step-up Resident System
            </span>
          </div>
          <h1 className="font-mecha text-2xl md:text-3xl font-black text-white flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-10 h-10 mecha-clip-sm bg-amber-600/20 border border-amber-500/50 text-amber-400">
              <Trophy className="w-5 h-5" />
            </span>
            どうぶつの森 階級・ランクアップ設定
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchRanks}
            className="mecha-btn-sheen mecha-clip-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2.5 font-tech text-xs flex items-center gap-2 border border-zinc-700"
            disabled={loading || saving}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            再読み込み
          </button>
          <button
            onClick={handleSave}
            className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-black px-6 py-2.5 font-mecha text-sm font-black flex items-center gap-2 shadow-lg shadow-amber-950/50 border border-amber-300"
            disabled={loading || saving}
          >
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : '階級設定を保存 / EXECUTE'}
          </button>
        </div>
      </div>

      <SyncStatusCards sync={sync} showSyncCard={false} />

      {/* Step-up visual banner */}
      <div className="mecha-clip-sm bg-gradient-to-r from-emerald-950/40 via-blue-950/40 to-amber-950/40 border border-amber-700/40 p-5 mb-8">
        <h3 className="font-mecha text-sm font-bold text-amber-300 mb-3 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          住民ステップアップ階級昇格ルート
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {ranks.map((r, idx) => (
            <div
              key={r.level}
              className="bg-black/60 border mecha-clip-sm p-3 relative overflow-hidden"
              style={{ borderColor: `${r.color}50` }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[10px] text-zinc-500">LEVEL {r.level}</span>
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: r.color }}></span>
              </div>
              <p className="font-mecha text-sm font-black truncate" style={{ color: r.color }}>
                {r.name}
              </p>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                必要マイル: <strong className="text-white">{r.required_miles.toLocaleString()}</strong> pt
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Rank cards editor */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
        {ranks.map((r) => (
          <div
            key={r.level}
            className="mecha-corners mecha-scan-wrap mecha-grid-bg bg-neutral-900/90 border mecha-clip p-5 shadow-xl transition-all"
            style={{ borderColor: `${r.color}60` }}
          >
            {/* Card Header */}
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <span
                  className="w-8 h-8 rounded-lg flex items-center justify-center font-mecha font-black text-sm text-black shadow-md"
                  style={{ backgroundColor: r.color }}
                >
                  {r.level}
                </span>
                <div>
                  <h3 className="font-mecha font-bold text-white text-base">
                    階級 Rank {r.level}
                  </h3>
                  <span className="font-tech text-[10px] text-zinc-500">
                    {r.level === 1 ? '初期階級' : `Rank ${r.level - 1} からの昇格先`}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={r.color}
                  onChange={(e) => updateRankField(r.level, 'color', e.target.value)}
                  className="w-7 h-7 bg-transparent cursor-pointer border border-zinc-700 rounded"
                  title="テーマカラー選択"
                />
              </div>
            </div>

            {/* Fields */}
            <div className="space-y-4 font-tech text-sm">
              {/* Name */}
              <div>
                <label className="text-xs text-zinc-400 block mb-1">
                  階級表示名（絵文字込み）
                </label>
                <input
                  type="text"
                  className="w-full bg-black/70 border border-zinc-700 mecha-clip-sm px-3 py-2 text-white text-sm focus:border-amber-500 outline-none"
                  value={r.name}
                  onChange={(e) => updateRankField(r.level, 'name', e.target.value)}
                  placeholder="例: 🌱 新規住人"
                />
              </div>

              {/* Required Miles */}
              <div>
                <label className="text-xs text-zinc-400 block mb-1">
                  昇格に必要なマイル数 (pt)
                </label>
                <input
                  type="number"
                  min={0}
                  step={100}
                  className="w-full bg-black/70 border border-zinc-700 mecha-clip-sm px-3 py-2 text-white font-mono text-sm focus:border-amber-500 outline-none"
                  value={r.required_miles}
                  onChange={(e) => updateRankField(r.level, 'required_miles', parseInt(e.target.value, 10) || 0)}
                  disabled={r.level === 1} // 新規住人は0固定
                />
                {r.level === 1 && (
                  <span className="text-[10px] text-zinc-500 block mt-0.5">※新規住人は初期ランクのため0pt固定です。</span>
                )}
              </div>

              {/* Role Name */}
              <div>
                <label className="text-xs text-zinc-400 block mb-1 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-zinc-400" />
                  Discord 自動付与ロール名
                </label>
                <input
                  type="text"
                  className="w-full bg-black/70 border border-zinc-700 mecha-clip-sm px-3 py-2 text-white text-sm focus:border-amber-500 outline-none"
                  value={r.role_name}
                  onChange={(e) => updateRankField(r.level, 'role_name', e.target.value)}
                  placeholder="例: 新規住人"
                />
                <span className="text-[10px] text-zinc-500 block mt-0.5">
                  ※サーバー内に同名ロールが存在しない場合は昇格時に自動生成されます。
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Save Button floating/sticky bottom bar */}
      <div className="p-4 bg-neutral-900/90 border border-amber-900/40 mecha-clip-sm flex items-center justify-between shadow-2xl">
        <p className="text-xs font-tech text-zinc-400">
          💡 保存すると、Botコマンド（`/ランクアップ`, `/マイル`, `/住民カード`）の判定基準に即座に反映されます。
        </p>
        <button
          onClick={handleSave}
          className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-black px-6 py-2.5 font-mecha text-sm font-black flex items-center gap-2 shadow-lg border border-amber-300"
          disabled={loading || saving}
        >
          <Save className="w-4 h-4" />
          {saving ? '保存中...' : '階級設定を保存 / EXECUTE'}
        </button>
      </div>
    </div>
  );
}
