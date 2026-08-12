'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Database, Server, RefreshCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export type SyncState =
  | 'idle'           // 保存操作前 (同期済み)
  | 'pending'        // ポーリング中（Bot処理待ち）
  | 'done'           // 反映完了
  | 'timeout'        // タイムアウト（Bot未応答）
  | 'bot_offline';   // Botがオフライン

export interface DbStatus {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface BotStatus {
  ok: boolean;
  latencyMs?: number | null;
  secondsAgo?: number | null;
  lastSeenAt?: string | null;
}

export interface SyncStatus {
  state: SyncState;
  botOnline: boolean | null;
  lastSeenAt: string | null;
  dbStatus: DbStatus | null;
  botStatus: BotStatus | null;
  loading: boolean;
  /** 反映確認を開始する。保存後のAPI レスポンスから sync_request_id を渡す */
  startPolling: (syncRequestId: number | null) => void;
  /** 手動でステータスを即時リフレッシュする */
  refresh: () => Promise<void>;
  /** ステートをリセットする */
  reset: () => void;
}

const POLL_INTERVAL_MS = 3_500;  // 3.5秒ごとにポーリング
const AUTO_REFRESH_INTERVAL_MS = 15_000; // 通常時15秒ごとにヘルスチェック
const TIMEOUT_MS = 30_000;       // 30秒でタイムアウト

/**
 * ダッシュボード設定保存後のBot反映確認・稼働状況監視フック。
 */
export function useSyncStatus(guildId: string): SyncStatus {
  const [state, setState] = useState<SyncState>('idle');
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const reqId = requestIdRef.current;
      const url = reqId !== null
        ? `/api/guilds/${guildId}/sync-status?request_id=${reqId}`
        : `/api/guilds/${guildId}/sync-status`;

      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();

      if (data.db) setDbStatus(data.db);
      if (data.render) {
        setBotStatus(data.render);
      } else {
        setBotStatus({
          ok: data.bot_online ?? false,
          lastSeenAt: data.last_seen_at ?? null,
        });
      }

      if (reqId !== null) {
        if (!data.bot_online && data.last_seen_at === null) {
          stopPolling();
          setState('bot_offline');
          return;
        }

        if (data.processed) {
          stopPolling();
          setState('done');
        }
      }
    } catch {
      // ネットワークエラーはスルー
    } finally {
      setLoading(false);
    }
  }, [guildId, stopPolling]);

  // 初回マウント時および自動定期ヘルスチェック
  useEffect(() => {
    fetchStatus();
    autoRefreshRef.current = setInterval(() => {
      if (requestIdRef.current === null) {
        fetchStatus();
      }
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
      stopPolling();
    };
  }, [fetchStatus, stopPolling]);

  const startPolling = useCallback(
    (syncRequestId: number | null) => {
      stopPolling();
      setState('idle');

      if (syncRequestId === null) {
        fetchStatus();
        return;
      }

      requestIdRef.current = syncRequestId;
      setState('pending');

      fetchStatus();
      timerRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);

      timeoutRef.current = setTimeout(() => {
        stopPolling();
        setState((prev) => (prev === 'pending' ? 'timeout' : prev));
      }, TIMEOUT_MS);
    },
    [fetchStatus, stopPolling]
  );

  const reset = useCallback(() => {
    stopPolling();
    setState('idle');
    requestIdRef.current = null;
  }, [stopPolling]);

  return {
    state,
    botOnline: botStatus?.ok ?? null,
    lastSeenAt: botStatus?.lastSeenAt ?? null,
    dbStatus,
    botStatus,
    loading,
    startPolling,
    refresh: fetchStatus,
    reset,
  };
}

// ─────────────────────────────────────────────
// SyncStatusCards: 画像と完全一致するメカニカルステータスカード群
// ─────────────────────────────────────────────

interface SyncStatusCardsProps {
  sync: SyncStatus;
  className?: string;
  showSyncCard?: boolean;
}

/**
 * ユーザーが求めるHUDステータスカードコンポーネント。
 * Supabase (DB)、Render (Bot)、設定同期状態 (IPC) を並べて表示する。
 */
export function SyncStatusCards({ sync, className = '', showSyncCard = true }: SyncStatusCardsProps) {
  const { dbStatus, botStatus, state, loading } = sync;

  const colsClass = showSyncCard ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2';

  return (
    <div className={`grid ${colsClass} gap-3 mb-6 ${className}`}>
      {/* 1. Supabase (Database) */}
      <div className="mecha-clip-sm bg-black/40 border border-zinc-800 p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-zinc-900 flex items-center justify-center flex-shrink-0">
          <Database className="w-4 h-4 text-zinc-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-tech text-xs text-zinc-500">Supabase (Database)</div>
          {loading ? (
            <div className="text-sm text-zinc-500 flex items-center gap-1.5 font-tech">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 確認中...
            </div>
          ) : dbStatus?.ok ? (
            <div className="text-sm text-green-400 font-semibold flex items-center gap-1.5 font-tech">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" /> 接続中{' '}
              {dbStatus.latencyMs !== undefined && (
                <span className="text-zinc-500 font-normal">({dbStatus.latencyMs}ms)</span>
              )}
            </div>
          ) : (
            <div className="text-sm text-red-400 font-semibold flex items-center gap-1.5 font-tech" title={dbStatus?.error}>
              <XCircle className="w-4 h-4 text-red-400" /> 接続失敗
            </div>
          )}
        </div>
      </div>

      {/* 2. Render (Bot本体) */}
      <div className="mecha-clip-sm bg-black/40 border border-zinc-800 p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-zinc-900 flex items-center justify-center flex-shrink-0">
          <Server className="w-4 h-4 text-zinc-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-tech text-xs text-zinc-500">Render (Bot本体)</div>
          {loading ? (
            <div className="text-sm text-zinc-500 flex items-center gap-1.5 font-tech">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 確認中...
            </div>
          ) : botStatus?.ok ? (
            <div className="text-sm text-green-400 font-semibold flex items-center gap-1.5 font-tech">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" /> 稼働中{' '}
              {botStatus.latencyMs !== undefined && botStatus.latencyMs !== null ? (
                <span className="text-zinc-500 font-normal">({botStatus.latencyMs}ms)</span>
              ) : botStatus.secondsAgo !== undefined && botStatus.secondsAgo !== null ? (
                <span className="text-zinc-500 font-normal">({botStatus.secondsAgo}秒前)</span>
              ) : null}
            </div>
          ) : (
            <div className="text-sm text-red-400 font-semibold flex items-center gap-1.5 font-tech">
              <XCircle className="w-4 h-4 text-red-400" /> 停止中 (オフライン)
            </div>
          )}
        </div>
      </div>

      {/* 3. 設定反映同期ステータス (IPC Sync) */}
      {showSyncCard && (
        <div className="mecha-clip-sm bg-black/40 border border-zinc-800 p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-zinc-900 flex items-center justify-center flex-shrink-0">
            <RefreshCw className={`w-4 h-4 ${state === 'pending' ? 'text-amber-400 animate-spin' : 'text-zinc-400'}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-tech text-xs text-zinc-500">設定反映状態 (IPC Sync)</div>
            {state === 'pending' ? (
              <div className="text-sm text-amber-300 font-semibold flex items-center gap-1.5 font-tech">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                Botに反映中...
              </div>
            ) : state === 'done' ? (
              <div className="text-sm text-green-400 font-semibold flex items-center gap-1.5 font-tech">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" /> 反映済み (最新)
              </div>
            ) : state === 'timeout' ? (
              <div className="text-sm text-red-400 font-semibold flex items-center gap-1.5 font-tech">
                <XCircle className="w-4 h-4 text-red-400" /> 反映未応答 (30s)
              </div>
            ) : state === 'bot_offline' ? (
              <div className="text-sm text-zinc-400 font-medium flex items-center gap-1.5 font-tech">
                <span className="w-2 h-2 rounded-full bg-zinc-500 flex-shrink-0" /> Botオフライン
              </div>
            ) : (
              <div className="text-sm text-zinc-300 font-medium flex items-center gap-1.5 font-tech">
                <CheckCircle2 className="w-4 h-4 text-zinc-500" /> 同期待機中 (正常)
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// SyncBadge: 既存のインラインバッジ（後方互換）
// ─────────────────────────────────────────────

interface SyncBadgeProps {
  state: SyncState;
  botOnline: boolean | null;
  className?: string;
}

export function SyncBadge({ state, botOnline, className = '' }: SyncBadgeProps) {
  if (state === 'idle') {
    if (botOnline === false) {
      return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-800 border border-zinc-700 text-zinc-400 ${className}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 flex-shrink-0" />
          Bot オフライン
        </span>
      );
    }
    return null;
  }

  if (state === 'pending') {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 border border-amber-500/40 text-amber-300 ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
        Bot に反映中...
      </span>
    );
  }

  if (state === 'done') {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
        Bot に反映済み ✓
      </span>
    );
  }

  if (state === 'timeout') {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 border border-red-500/40 text-red-300 ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
        Bot 未応答 (30s)
      </span>
    );
  }

  if (state === 'bot_offline') {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-800 border border-zinc-700 text-zinc-400 ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 flex-shrink-0" />
        Bot オフライン
      </span>
    );
  }

  return null;
}
