import { NextResponse } from 'next/server';
import { getPool, masterPool } from '@/lib/db';

/**
 * GET /api/guilds/[guild_id]/sync-status?request_id=XXX
 *
 * ギルドのDB接続、Bot本体の稼働状況(Heartbeat)、および設定の反映状態(IPC同期)を診断するAPI。
 */
export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const { searchParams } = new URL(request.url);
  const requestIdStr = searchParams.get('request_id');
  const requestId = requestIdStr && !isNaN(Number(requestIdStr)) ? Number(requestIdStr) : null;

  // 1. データベース疎通確認 & レイテンシー測定
  let dbStatus: { ok: boolean; latencyMs?: number; isDedicated?: boolean; error?: string } = { ok: false };
  let pool;
  try {
    const dbStart = Date.now();
    pool = await getPool(guildId);
    await pool.query('SELECT 1');
    
    let isDedicated = false;
    try {
      const dedicatedRes = await masterPool.query(
        'SELECT database_url FROM guild_databases WHERE guild_id = $1',
        [guildId]
      );
      isDedicated = dedicatedRes.rows.length > 0 && !!dedicatedRes.rows[0].database_url;
    } catch {}

    dbStatus = {
      ok: true,
      latencyMs: Date.now() - dbStart,
      isDedicated,
    };
  } catch (e: any) {
    dbStatus = {
      ok: false,
      error: e?.message || String(e),
    };
  }

  // 2. Bot本体の生存確認 (Heartbeat & VPS Health)
  let botOnline = false;
  let lastSeenAt: string | null = null;
  let secondsAgo: number | null = null;
  let botLatencyMs: number | null = null;

  // まず VPS_BOT_HEALTH_URL / RENDER_BOT_HEALTH_URL が設定されていれば直接 Ping
  const healthUrl = process.env.VPS_BOT_HEALTH_URL || process.env.BOT_HEALTH_URL || process.env.RENDER_BOT_HEALTH_URL;
  if (healthUrl) {
    try {
      const renderStart = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(healthUrl, { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timeout);
      if (res.ok) {
        botOnline = true;
        botLatencyMs = Math.max(1, Date.now() - renderStart);
      }
    } catch {
      // Direct ping failed or timed out, fallback to DB heartbeat
    }
  }

  // DBの bot_heartbeat テーブルを確認
  if (pool) {
    try {
      const hbResult = await pool.query(
        'SELECT last_seen_at FROM bot_heartbeat WHERE guild_id = $1',
        [guildId]
      );
      if (hbResult.rows.length > 0) {
        const rawDate = hbResult.rows[0].last_seen_at;
        const lastSeen = rawDate instanceof Date ? rawDate : new Date(rawDate);
        lastSeenAt = lastSeen.toISOString();
        let diffMs = Date.now() - lastSeen.getTime();
        // タイムゾーン差異 (JST vs UTC) の補正と負数クリップ
        if (diffMs < 0) {
          if (diffMs > -120_000) {
            diffMs = 0;
          } else if (diffMs < -8 * 3600 * 1000 && diffMs > -10 * 3600 * 1000) {
            diffMs = diffMs + 9 * 3600 * 1000;
            if (diffMs < 0) diffMs = 0;
          }
        }
        secondsAgo = Math.max(0, Math.floor(diffMs / 1000));
        // 120秒以内であればオンライン判定
        if (diffMs < 120_000) {
          botOnline = true;
          if (botLatencyMs === null) {
            botLatencyMs = Math.max(1, Math.min(120, Math.floor(diffMs / 10) || 12));
          }
        }
      }
    } catch {
      // bot_heartbeat テーブル未作成時はスルー
    }
  }

  // 3. 設定反映 (IPC Sync) の状態
  let processed = true;
  let pendingCount = 0;

  if (pool) {
    try {
      if (requestId !== null) {
        const reqCheck = await pool.query(
          'SELECT id FROM panel_requests WHERE id = $1 LIMIT 1',
          [requestId]
        );
        processed = reqCheck.rows.length === 0;
      }

      // 保留中の全リクエスト件数
      const pendingRes = await pool.query(
        'SELECT COUNT(*) as count FROM panel_requests WHERE guild_id = $1',
        [guildId]
      );
      pendingCount = Number(pendingRes.rows[0]?.count ?? 0);
    } catch {
      // panel_requests テーブル未作成時は処理済み扱い
      processed = true;
    }
  }

  return NextResponse.json({
    db: dbStatus,
    render: {
      ok: botOnline,
      latencyMs: botLatencyMs,
      secondsAgo,
      lastSeenAt,
    },
    sync: {
      processed,
      pendingCount,
      requestId,
    },
    // 下位互換性用
    bot_online: botOnline,
    last_seen_at: lastSeenAt,
    processed,
  });
}
