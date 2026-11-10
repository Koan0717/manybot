import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureEvalReportSchema } from '@/lib/migrations';

type Params = { params: { guild_id: string; id: string } };

/** action: 'post_panel'（このシートの記入パネルを指定チャンネルに設置） */
export async function POST(request: Request, { params }: Params) {
  try {
    const guildId = params.guild_id;
    const id = Number(params.id);
    const pool = await getPool(guildId);
    await ensureEvalReportSchema(pool);
    const body = await request.json();
    const exists = await pool.query('SELECT id FROM eval_report_sheets WHERE id = $1 AND guild_id = $2', [id, guildId]);
    if (exists.rows.length === 0) return NextResponse.json({ error: 'シートが見つかりません' }, { status: 404 });

    if (body.action !== 'post_panel') return NextResponse.json({ error: '不明な操作です' }, { status: 400 });
    const channelId = String(body.channel_id || '');
    if (!/^\d{6,}$/.test(channelId)) {
      return NextResponse.json({ error: 'パネルを設置するチャンネルを選択してください' }, { status: 400 });
    }
    const req = await pool.query(
      `INSERT INTO panel_requests (guild_id, channel_id, panel_type, panel_id) VALUES ($1, $2, 'eval_report', $3) RETURNING id`,
      [guildId, channelId, id]
    );
    return NextResponse.json({ success: true, sync_request_id: req.rows[0]?.id ?? null });
  } catch (error: any) {
    console.error('Eval report sheet POST error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

/** シートの削除。設置済みのパネルのボタンは「削除されました」と案内するようになる */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const guildId = params.guild_id;
    const id = Number(params.id);
    const pool = await getPool(guildId);
    await ensureEvalReportSchema(pool);
    const res = await pool.query('DELETE FROM eval_report_sheets WHERE id = $1 AND guild_id = $2 RETURNING id', [id, guildId]);
    if (res.rows.length === 0) return NextResponse.json({ error: 'シートが見つかりません' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Eval report sheet DELETE error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}
