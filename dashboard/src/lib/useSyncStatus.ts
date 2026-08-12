'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export type SyncState =
  | 'idle'           // 保存操作前
  | 'pending'        // ポーリング中（Bot処理待ち）
  | 'done'           // 反映完了
  | 'timeout'        // タイムアウト（Bot未応答）
  | 'bot_offline';   // Botがオフライン

export interface SyncStatus {
  state: SyncState;
  botOnline: boolean | null;
  lastSeenAt: string | null;
  /** 反映確認を開始する。保存後のAPI レスポンスから sync_request_id を渡す */
  startPolling: (syncRequestId: number | null) => void;
  /** ステートをリセットする */
  reset: () => void;
}

const POLL_INTERVAL_MS = 4_000;  // 4秒ごとにポーリング
const TIMEOUT_MS = 30_000;       // 30秒でタイムアウト

/**
 * ダッシュボード設定保存後のBot反映確認フック。
 *
 * 使い方:
 * ```tsx
 * const sync = useSyncStatus(guildId);
 *
 * const handleSave = async () => {
 *   const res = await fetch(...);
 *   const data = await res.json();
 *   sync.startPolling(data.sync_request_id);
 * };
 *
 * // JSX:
 * <SyncBadge state={sync.state} botOnline={sync.botOnline} />
 * ```
 */
export function useSyncStatus(guildId: string): SyncStatus {
  const [state, setState] = useState<SyncState>('idle');
  const [botOnline, setBotOnline] = useState<boolean | null>(null);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  const poll = useCallback(async () => {
    const reqId = requestIdRef.current;
    if (reqId === null) return;

    try {
      const res = await fetch(
        `/api/guilds/${guildId}/sync-status?request_id=${reqId}`
      );
      if (!res.ok) return;
      const data = await res.json();

      setBotOnline(data.bot_online ?? null);
      setLastSeenAt(data.last_seen_at ?? null);

      if (!data.bot_online && data.last_seen_at === null) {
        // Botがまだ一度もheartbeatを送っていない（オフライン）
        stopPolling();
        setState('bot_offline');
        return;
      }

      if (data.processed) {
        stopPolling();
        setState('done');
      }
    } catch {
      // ネットワークエラーは無視して次のポーリングへ
    }
  }, [guildId, stopPolling]);

  const startPolling = useCallback(
    (syncRequestId: number | null) => {
      stopPolling();
      setState('idle');

      // sync_request_id が null の場合 (deploy等) はポーリング不要
      if (syncRequestId === null) return;

      requestIdRef.current = syncRequestId;
      setState('pending');

      // 即座に一回ポーリング
      poll();

      // 定期ポーリング
      timerRef.current = setInterval(poll, POLL_INTERVAL_MS);

      // タイムアウト
      timeoutRef.current = setTimeout(() => {
        stopPolling();
        setState((prev) => (prev === 'pending' ? 'timeout' : prev));
      }, TIMEOUT_MS);
    },
    [poll, stopPolling]
  );

  const reset = useCallback(() => {
    stopPolling();
    setState('idle');
    setBotOnline(null);
    setLastSeenAt(null);
    requestIdRef.current = null;
  }, [stopPolling]);

  // アンマウント時にクリーンアップ
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return { state, botOnline, lastSeenAt, startPolling, reset };
}

// ─────────────────────────────────────────────
// SyncBadge: フック状態を表示する小さなUIコンポーネント
// ─────────────────────────────────────────────

interface SyncBadgeProps {
  state: SyncState;
  botOnline: boolean | null;
  className?: string;
}

/**
 * 設定の反映状況を示すインラインバッジ。
 * PageHeader の横などに配置して使う。
 */
export function SyncBadge({ state, botOnline, className = '' }: SyncBadgeProps) {
  if (state === 'idle') {
    // Botがオフラインなら idle でもバッジを出す
    if (botOnline === false) {
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
            bg-zinc-800 border border-zinc-700 text-zinc-400 ${className}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 flex-shrink-0" />
          Bot オフライン
        </span>
      );
    }
    return null;
  }

  if (state === 'pending') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
          bg-amber-500/10 border border-amber-500/40 text-amber-300 ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
        Bot に反映中...
      </span>
    );
  }

  if (state === 'done') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
          bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
        Bot に反映済み ✓
      </span>
    );
  }

  if (state === 'timeout') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
          bg-red-500/10 border border-red-500/40 text-red-300 ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
        Bot 未応答 (30s)
      </span>
    );
  }

  if (state === 'bot_offline') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
          bg-zinc-800 border border-zinc-700 text-zinc-400 ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 flex-shrink-0" />
        Bot オフライン
      </span>
    );
  }

  return null;
}
