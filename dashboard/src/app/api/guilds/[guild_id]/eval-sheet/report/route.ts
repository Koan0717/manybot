import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureEvalReportSchema } from '@/lib/migrations';
import { cleanItems, clampScale, toSheetJson, DEFAULT_SHEET_NAME } from '@/lib/evalReport';

/** 評価シートの一覧（作成順） */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureEvalReportSchema(pool);
    const res = await pool.query('SELECT * FROM eval_report_sheets WHERE guild_id = $1 ORDER BY id', [guildId]);
    return NextResponse.json(res.rows.map(toSheetJson));
  } catch (error: any) {
    console.error('Eval report GET error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

/** シートの作成（id なし）または更新（id あり） */
export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureEvalReportSchema(pool);
    const body = await request.json();

    const name = String(body.name || '').trim().slice(0, 100) || DEFAULT_SHEET_NAME;
    const { items, error } = cleanItems(body.items);
    if (error) return NextResponse.json({ error }, { status: 400 });
    if (items.length === 0) return NextResponse.json({ error: '評価項目を1つ以上追加してください' }, { status: 400 });
    const outputChannelId = /^\d{6,}$/.test(String(body.output_channel_id || '')) ? String(body.output_channel_id) : null;
    const panelTitle = String(body.panel_title || '').trim().slice(0, 256);
    const panelDescription = String(body.panel_description || '').slice(0, 2000);
    const buttonLabel = String(body.button_label || '').trim().slice(0, 80);
    const ratingScale = clampScale(body.rating_scale);
    const values = [JSON.stringify(items), outputChannelId, panelTitle, panelDescription, buttonLabel, ratingScale, name];

    const id = Number(body.id) || null;
    let res;
    if (id) {
      res = await pool.query(
        `UPDATE eval_report_sheets SET items = $3::jsonb, output_channel_id = $4, panel_title = $5,
           panel_description = $6, button_label = $7, rating_scale = $8, name = $9
         WHERE id = $1 AND guild_id = $2 RETURNING *`,
        [id, guildId, ...values]
      );
      if (res.rows.length === 0) return NextResponse.json({ error: 'シートが見つかりません' }, { status: 404 });
    } else {
      res = await pool.query(
        `INSERT INTO eval_report_sheets (guild_id, items, output_channel_id, panel_title, panel_description, button_label, rating_scale, name)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [guildId, ...values]
      );
    }
    return NextResponse.json({ success: true, sheet: toSheetJson(res.rows[0]) });
  } catch (error: any) {
    console.error('Eval report POST error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}
