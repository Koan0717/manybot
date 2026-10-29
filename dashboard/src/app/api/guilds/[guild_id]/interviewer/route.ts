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
      'SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = $2',
      [guildId, 'AUTO_DETECT_MANUAL_JOIN']
    );
    let autoDetect = false;
    if (result.rows.length > 0) {
      try {
        autoDetect = JSON.parse(result.rows[0].setting_value);
      } catch (e) {
        autoDetect = result.rows[0].setting_value === 'true';
      }
    }

    const statsResult = await pool.query(
      'SELECT interviewer_id, total_handled FROM interviewer_stats WHERE guild_id = $1 ORDER BY total_handled DESC',
      [guildId]
    );

    return NextResponse.json({
      autoDetect,
      stats: statsResult.rows.map(r => ({
        interviewer_id: r.interviewer_id,
        total_handled: r.total_handled
      }))
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
    
    if (body.action === 'update_stat') {
      const { interviewer_id, total_handled } = body;
      await pool.query(
        `INSERT INTO interviewer_stats (guild_id, interviewer_id, total_handled)
         VALUES ($1, $2, $3)
         ON CONFLICT (guild_id, interviewer_id) 
         DO UPDATE SET total_handled = $3`,
        [guildId, interviewer_id, total_handled]
      );
      return NextResponse.json({ success: true });
    }

    if (body.action === 'delete_stat') {
      const { interviewer_id } = body;
      await pool.query(
        `DELETE FROM interviewer_stats WHERE guild_id = $1 AND interviewer_id = $2`,
        [guildId, interviewer_id]
      );
      return NextResponse.json({ success: true });
    }

    if (body.action === 'save_setting') {
      const { autoDetect } = body;
      await pool.query(
        `INSERT INTO bot_settings (guild_id, setting_key, setting_value)
         VALUES ($1, $2, $3)
         ON CONFLICT (guild_id, setting_key)
         DO UPDATE SET setting_value = $3`,
        [guildId, 'AUTO_DETECT_MANUAL_JOIN', JSON.stringify(autoDetect)]
      );
      return NextResponse.json({ success: true });
    }

    // 入界パネル（interview_entry）・告知パネル（interview_announce）の設置をBotに依頼する
    if (body.action === 'post_panel') {
      const panelType = String(body.panel_type || '');
      if (panelType !== 'interview_entry' && panelType !== 'interview_announce') {
        return NextResponse.json({ error: 'パネルの種類が正しくありません' }, { status: 400 });
      }
      const channelId = String(body.channel_id || '');
      if (!/^\d{6,}$/.test(channelId)) {
        return NextResponse.json({ error: 'パネルを設置するチャンネルを選択してください' }, { status: 400 });
      }
      const req = await pool.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, $2, $3) RETURNING id`,
        [guildId, channelId, panelType]
      );
      return NextResponse.json({ success: true, sync_request_id: req.rows[0]?.id ?? null });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
