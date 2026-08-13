'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

type Check = { label: string; ok: boolean; detail?: string };
type FeatureStatus = { ok: boolean; checks: Check[] };

// 1画面内で複数の HealthBadge が同時に fetch しないよう、
// guildId単位でレスポンスをキャッシュ・共有する簡易ストア
const cache = new Map<string, Promise<Record<string, FeatureStatus>>>();

function fetchHealth(guildId: string, force = false): Promise<Record<string, FeatureStatus>> {
  if (force) cache.delete(guildId);
  if (!cache.has(guildId)) {
    cache.set(
      guildId,
      fetch(`/api/guilds/${guildId}/health`, { cache: 'no-store' })
        .then(res => res.json())
        .catch(() => ({}))
    );
  }
  return cache.get(guildId)!;
}

export function invalidateHealthCache(guildId: string) {
  cache.delete(guildId);
}

export default function HealthBadge({ guildId, featureKey }: { guildId: string; featureKey: string }) {
  const [status, setStatus] = useState<FeatureStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = (force = false) => {
    setLoading(true);
    fetchHealth(guildId, force).then(data => {
      setStatus(data[featureKey] || { ok: true, checks: [] });
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId, featureKey]);

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 font-tech text-xs text-zinc-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> 動作確認中...
      </span>
    );
  }

  if (!status) return null;

  const problems = status.checks.filter(c => !c.ok);

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setExpanded(v => !v)}
        className={`inline-flex items-center gap-1.5 font-tech text-xs px-2.5 py-1 rounded-full border transition-colors ${
          status.ok
            ? 'bg-green-500/10 border-green-500/40 text-green-400 hover:bg-green-500/20'
            : 'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20'
        }`}
        title="クリックで詳細を表示"
      >
        {status.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
        {status.ok ? '正常に動作中' : `問題あり (${problems.length})`}
      </button>

      {expanded && (
        <div className="absolute z-30 mt-2 left-0 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-tech text-[11px] text-zinc-400 uppercase tracking-wide">動作状況</span>
            <button
              onClick={() => load(true)}
              className="text-zinc-500 hover:text-white transition-colors"
              title="再チェック"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          {status.checks.length === 0 ? (
            <p className="text-xs text-zinc-500">このページに紐づく確認項目はありません。</p>
          ) : (
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {status.checks.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  {c.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <p className={c.ok ? 'text-zinc-300' : 'text-red-300'}>{c.label}</p>
                    {c.detail && <p className="text-zinc-500">{c.detail}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
