import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);

  try {
    const result = await pool.query(
      'SELECT panel_channel_id, board_channel_id, vc_category_id FROM call_board_settings WHERE guild_id = $1',
      [guildId]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      return NextResponse.json({
        panel_channel_id: row.panel_channel_id ? String(row.panel_channel_id) : '',
        board_channel_id: row.board_channel_id ? String(row.board_channel_id) : '',
        vc_category_id: row.vc_category_id ? String(row.vc_category_id) : '',
      });
    }

    return NextResponse.json({
      panel_channel_id: '',
      board_channel_id: '',
      vc_category_id: '',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);

  try {
    const body = await request.json();
    const { action, panel_channel_id, board_channel_id, vc_category_id } = body;

    // テーブルが存在しない場合は自動作成
    await pool.query(`
      CREATE TABLE IF NOT EXISTS call_board_settings (
        guild_id BIGINT PRIMARY KEY,
        panel_channel_id BIGINT,
        board_channel_id BIGINT,
        vc_category_id BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS panel_requests (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT,
        channel_id BIGINT,
        panel_type TEXT,
        processed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const panelCh = panel_channel_id ? String(panel_channel_id) : null;
    const boardCh = board_channel_id ? String(board_channel_id) : null;
    const vcCat = vc_category_id ? String(vc_category_id) : null;

    // 設定の保存（saveでもdeployでも保存）
    if (panelCh || boardCh || vcCat) {
      await pool.query(
        `INSERT INTO call_board_settings (guild_id, panel_channel_id, board_channel_id, vc_category_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (guild_id) DO UPDATE
         SET panel_channel_id = EXCLUDED.panel_channel_id,
             board_channel_id = EXCLUDED.board_channel_id,
             vc_category_id = EXCLUDED.vc_category_id`,
        [guildId, panelCh, boardCh, vcCat]
      );
    }

    if (action === 'deploy') {
      if (!panelCh) {
        return NextResponse.json({ error: 'パネル設置チャンネルが指定されていません。' }, { status: 400 });
      }

      await pool.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type)
         VALUES ($1, $2, 'call_board')`,
        [guildId, panelCh]
      );

      return NextResponse.json({ success: true, message: 'パネル設置リクエストを送信しました。' });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
