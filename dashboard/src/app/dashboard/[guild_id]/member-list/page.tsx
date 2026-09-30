'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { ListOrdered, Search, RefreshCw, Download, Copy, AlertCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import PageHeader from '@/components/PageHeader';

interface Role { id: string; name: string; color: number }
interface Row {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string;
  roles: Role[];
  balance: number;
  vc_level: number;
  tc_level: number;
}
type SortKey = 'balance' | 'vc_level' | 'tc_level';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'balance', label: '残高' },
  { key: 'vc_level', label: 'VCレベル' },
  { key: 'tc_level', label: 'TCレベル' },
];
const PAGE = 100;
const fmt = (n: number) => n.toLocaleString('ja-JP');
const roleColor = (c: number) => (c ? `#${c.toString(16).padStart(6, '0')}` : '#a1a1aa');

/** メンバー一覧（残高の多い順）。名前・ID・ロール・残高・VC/TCレベル */
export default function MemberListPage() {
  const params = useParams();
  const guildId = params.guild_id as string;

  const [rows, setRows] = useState<Row[] | null>(null);
  const [currency, setCurrency] = useState('コイン');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('balance');
  const [limit, setLimit] = useState(PAGE);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/guilds/${guildId}/member-list`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '取得に失敗しました');
      setRows(data.members ?? []);
      setCurrency(data.currency_name || 'コイン');
    } catch (e: any) {
      setError(e?.message || '取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);

  // 並び順は常に「選んだ項目の多い順」。順位はその並びでの位置
  const sorted = useMemo(() => {
    if (!rows) return [];
    return [...rows].sort((a, b) => b[sort] - a[sort] || b.balance - a.balance);
  }, [rows, sort]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ranked = sorted.map((r, i) => ({ ...r, rank: i + 1 }));
    if (!q) return ranked;
    return ranked.filter(
      (r) =>
        r.display_name.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q) ||
        r.id.includes(q) ||
        r.roles.some((role) => role.name.toLowerCase().includes(q))
    );
  }, [sorted, query]);

  const total = useMemo(() => (rows ?? []).reduce((s, r) => s + r.balance, 0), [rows]);

  const downloadCsv = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      ['順位', '名前', 'ユーザー名', 'ID', 'ロール', `残高(${currency})`, 'VCレベル', 'TCレベル'].map(esc).join(','),
      ...filtered.map((r) =>
        [r.rank, r.display_name, r.username, r.id, r.roles.map((x) => x.name).join(' / '), r.balance, r.vc_level, r.tc_level]
          .map(esc)
          .join(',')
      ),
    ];
    // Excel で文字化けしないよう BOM を付ける
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `members_${guildId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast.success('IDをコピーしました');
    } catch {
      toast.error('コピーできませんでした');
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      <PageHeader
        icon={ListOrdered}
        title="メンバー残高一覧"
        subtitle="サーバーのメンバーを残高の多い順に表示します（名前・ID・ロール・残高・VC/TCレベル）"
        eyebrow="System // Member Ledger"
        tone="amber"
      />

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl flex items-center gap-3">
          <AlertCircle size={20} />
          <span className="font-tech text-sm">{error}</span>
        </div>
      )}

      <section className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-4 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="名前・ID・ロールで検索"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white font-tech focus:outline-none focus:border-amber-500"
            />
          </div>
          <div className="flex rounded-lg overflow-hidden border border-zinc-700">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`px-3 py-2 text-xs font-bold font-tech ${sort === s.key ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}
              >
                {s.label}順
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 更新
          </button>
          <button
            onClick={downloadCsv}
            disabled={!rows?.length}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 hover:text-white disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>

        {rows && (
          <div className="text-xs font-tech text-zinc-500">
            メンバー {fmt(rows.length)} 人 ・ 残高合計 {fmt(total)} {currency}
            {query && ` ・ 検索結果 ${fmt(filtered.length)} 人`}
          </div>
        )}

        {rows === null ? (
          <div className="py-16 text-center text-amber-400 font-tech">{loading ? 'Loading...' : ''}</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-zinc-500 text-sm">該当するメンバーがいません</div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs font-tech text-zinc-500 border-b border-zinc-800">
                  <th className="py-2 px-2 w-12 text-right">#</th>
                  <th className="py-2 px-2">メンバー</th>
                  <th className="py-2 px-2">ID</th>
                  <th className="py-2 px-2">ロール</th>
                  <th className="py-2 px-2 text-right">残高</th>
                  <th className="py-2 px-2 text-right">VC Lv</th>
                  <th className="py-2 px-2 text-right">TC Lv</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((r) => (
                  <tr key={r.id} className="border-b border-zinc-800/60 hover:bg-zinc-800/30 align-top">
                    <td className={`py-2.5 px-2 text-right font-bold font-tech ${r.rank <= 3 ? 'text-amber-400' : 'text-zinc-500'}`}>{r.rank}</td>
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.avatar_url} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="font-semibold text-white truncate max-w-[180px]">{r.display_name}</div>
                          <div className="text-xs text-zinc-500 truncate max-w-[180px]">@{r.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-2">
                      <button onClick={() => copyId(r.id)} className="flex items-center gap-1 text-xs font-mono text-zinc-400 hover:text-white" title="コピー">
                        {r.id} <Copy className="w-3 h-3" />
                      </button>
                    </td>
                    <td className="py-2.5 px-2">
                      <div className="flex flex-wrap gap-1 max-w-[280px]">
                        {r.roles.length === 0 ? (
                          <span className="text-xs text-zinc-600">なし</span>
                        ) : (
                          r.roles.map((role) => (
                            <span
                              key={role.id}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-200"
                            >
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: roleColor(role.color) }} />
                              {role.name}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-bold text-amber-300 whitespace-nowrap">
                      {fmt(r.balance)} <span className="text-xs font-normal text-zinc-500">{currency}</span>
                    </td>
                    <td className="py-2.5 px-2 text-right font-tech text-cyan-300">{r.vc_level}</td>
                    <td className="py-2.5 px-2 text-right font-tech text-emerald-300">{r.tc_level}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > limit && (
              <div className="pt-4 text-center">
                <button
                  onClick={() => setLimit((l) => l + PAGE)}
                  className="px-5 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-300 hover:text-white"
                >
                  さらに表示（残り {fmt(filtered.length - limit)} 人）
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
