import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureCircleSchema, toCircleReportJson, REPORT_COLUMNS } from '@/lib/circle';

export const dynamic = 'force-dynamic';

type Params = { params: { guild_id: string; id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureCircleSchema(pool);
    const res = await pool.query(
      `SELECT ${REPORT_COLUMNS} FROM circle_reports WHERE id = $1 AND guild_id = $2`,
      [Number(params.id), guildId]
    );
    if (res.rows.length === 0) return NextResponse.json({ error: 'レポートが見つかりません' }, { status: 404 });
    return NextResponse.json(toCircleReportJson(res.rows[0]));
  } catch (error: any) {
    console.error('Circle report GET error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

/** action: 'send' — 設定した送信先の人へ Bot から DM で送る */
export async function POST(request: Request, { params }: Params) {
  try {
    const guildId = params.guild_id;
    const id = Number(params.id);
    const pool = await getPool(guildId);
    await ensureCircleSchema(pool);
    const body = await request.json().catch(() => ({}));
    if (body.action !== 'send') return NextResponse.json({ error: '不明な操作です' }, { status: 400 });

    const settings = await pool.query(
      'SELECT COALESCE(array_length(recipient_user_ids, 1), 0) AS n FROM circle_settings WHERE guild_id = $1',
      [guildId]
    );
    if (!Number(settings.rows[0]?.n)) {
      return NextResponse.json({ error: '送信先が設定されていません。「送信先設定」で送る人を選んでください' }, { status: 400 });
    }

    // 送信中のまま Bot が止まった場合でも、5分たてば送り直せるようにする
    const upd = await pool.query(
      `UPDATE circle_reports SET send_status = 'pending', send_results = '[]'::jsonb, updated_at = NOW()
       WHERE id = $1 AND guild_id = $2
         AND (send_status <> 'pending' OR updated_at < NOW() - INTERVAL '5 minutes')
       RETURNING id`,
      [id, guildId]
    );
    if (upd.rows.length === 0) {
      const exists = await pool.query('SELECT id FROM circle_reports WHERE id = $1 AND guild_id = $2', [id, guildId]);
      if (exists.rows.length === 0) return NextResponse.json({ error: 'レポートが見つかりません' }, { status: 404 });
      return NextResponse.json({ error: 'すでに送信中です' }, { status: 409 });
    }
    const req = await pool.query(
      `INSERT INTO panel_requests (guild_id, channel_id, panel_type, panel_id) VALUES ($1, 0, 'circle_report_send', $2) RETURNING id`,
      [guildId, id]
    );
    return NextResponse.json({ success: true, sync_request_id: req.rows[0]?.id ?? null });
  } catch (error: any) {
    console.error('Circle report POST error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureCircleSchema(pool);
    const res = await pool.query('DELETE FROM circle_reports WHERE id = $1 AND guild_id = $2 RETURNING id', [Number(params.id), guildId]);
    if (res.rows.length === 0) return NextResponse.json({ error: 'レポートが見つかりません' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Circle report DELETE error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}
