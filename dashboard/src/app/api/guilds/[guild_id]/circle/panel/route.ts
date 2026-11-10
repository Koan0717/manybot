import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  ensureCircleSchema, DEFAULT_PANEL_TITLE, DEFAULT_PANEL_DESCRIPTION, DEFAULT_PANEL_BUTTON_LABEL,
} from '@/lib/circle';

export const dynamic = 'force-dynamic';

/** 報告書パネル（チャンネルに置く「報告書を書く」ボタン）の表示内容 */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureCircleSchema(pool);
    const res = await pool.query(
      'SELECT panel_title, panel_description, panel_button_label FROM circle_settings WHERE guild_id = $1',
      [guildId]
    );
    const row = res.rows[0];
    return NextResponse.json({
      panel_title: row?.panel_title || DEFAULT_PANEL_TITLE,
      panel_description: row?.panel_description || DEFAULT_PANEL_DESCRIPTION,
      panel_button_label: row?.panel_button_label || DEFAULT_PANEL_BUTTON_LABEL,
    });
  } catch (error: any) {
    console.error('Circle panel GET error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * 表示内容を保存する。channel_id があれば、そのチャンネルへパネルの設置を Bot に頼む。
 */
export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureCircleSchema(pool);
    const body = await request.json();
    const title = String(body.panel_title || '').trim().slice(0, 256) || DEFAULT_PANEL_TITLE;
    const description = String(body.panel_description || '').trim().slice(0, 2000) || DEFAULT_PANEL_DESCRIPTION;
    const buttonLabel = String(body.panel_button_label || '').trim().slice(0, 80) || DEFAULT_PANEL_BUTTON_LABEL;

    await pool.query(
      `INSERT INTO circle_settings (guild_id, panel_title, panel_description, panel_button_label, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (guild_id) DO UPDATE SET panel_title = $2, panel_description = $3, panel_button_label = $4, updated_at = NOW()`,
      [guildId, title, description, buttonLabel]
    );

    let syncRequestId: number | null = null;
    if (body.channel_id !== undefined && body.channel_id !== null && body.channel_id !== '') {
      const channelId = String(body.channel_id);
      if (!/^\d{6,}$/.test(channelId)) {
        return NextResponse.json({ error: '設置先チャンネルを選択してください' }, { status: 400 });
      }
      const req = await pool.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, $2, 'circle_report_panel') RETURNING id`,
        [guildId, channelId]
      );
      syncRequestId = req.rows[0]?.id ?? null;
    }
    return NextResponse.json({ success: true, sync_request_id: syncRequestId });
  } catch (error: any) {
    console.error('Circle panel POST error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}
