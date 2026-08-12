import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

/**
 * GET /api/guilds/[guild_id]/sync-status?request_id=XXX
 *
 * ダッシュボードで設定保存後、Botが設定を反映済みかどうかをポーリングするAPI。
 *
 * レスポンス:
 * {
 *   processed: boolean,      // panel_requestsから削除済み = Bot反映済み
 *   bot_online: boolean,     // 60秒以内にheartbeatがあればtrue
 *   last_seen_at: string | null  // Bot最終生存時刻 (ISO8601)
 * }
 */
export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const { searchParams } = new URL(request.url);
  const requestIdStr = searchParams.get('request_id');

  if (!requestIdStr || isNaN(Number(requestIdStr))) {
    return NextResponse.json(
      { error: 'request_id is required and must be a number' },
      { status: 400 }
    );
  }
  const requestId = Number(requestIdStr);

  try {
    const pool = await getPool(guildId);

    // 1. panel_requestsに行が残っているか確認 (存在しない = Bot処理済み)
    let processed = false;
    try {
      const reqCheck = await pool.query(
        'SELECT id FROM panel_requests WHERE id = $1 LIMIT 1',
        [requestId]
      );
      // 行が消えていれば processed = true
      processed = reqCheck.rows.length === 0;
    } catch (e) {
      // panel_requestsテーブルが存在しない場合はprocessed扱い
      processed = true;
    }

    // 2. bot_heartbeatから最終生存時刻を取得
    let botOnline = false;
    let lastSeenAt: string | null = null;
    try {
      const hbResult = await pool.query(
        'SELECT last_seen_at FROM bot_heartbeat WHERE guild_id = $1',
        [guildId]
      );
      if (hbResult.rows.length > 0) {
        const lastSeen = hbResult.rows[0].last_seen_at as Date;
        lastSeenAt = lastSeen.toISOString();
        // 60秒以内であればオンライン判定
        const diffMs = Date.now() - lastSeen.getTime();
        botOnline = diffMs < 60_000;
      }
    } catch (e) {
      // bot_heartbeatテーブルが存在しない場合はスルー
    }

    return NextResponse.json({
      processed,
      bot_online: botOnline,
      last_seen_at: lastSeenAt,
    });
  } catch (error: any) {
    console.error('sync-status error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
