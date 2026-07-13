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
      'SELECT setting_value FROM bot_settings WHERE guild_id =  AND setting_key = ',
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
      'SELECT interviewer_id, total_handled FROM interviewer_stats WHERE guild_id =  ORDER BY total_handled DESC',
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
        INSERT INTO interviewer_stats (guild_id, interviewer_id, total_handled)
         VALUES (, , )
         ON CONFLICT (guild_id, interviewer_id) 
         DO UPDATE SET total_handled = ,
        [guildId, interviewer_id, total_handled]
      );
      return NextResponse.json({ success: true });
    }

    if (body.action === 'delete_stat') {
      const { interviewer_id } = body;
      await pool.query(
        DELETE FROM interviewer_stats WHERE guild_id =  AND interviewer_id = ,
        [guildId, interviewer_id]
      );
      return NextResponse.json({ success: true });
    }

    if (body.action === 'save_setting') {
      const { autoDetect } = body;
      await pool.query(
        INSERT INTO bot_settings (guild_id, setting_key, setting_value)
         VALUES (, , )
         ON CONFLICT (guild_id, setting_key)
         DO UPDATE SET setting_value = ,
        [guildId, 'AUTO_DETECT_MANUAL_JOIN', JSON.stringify(autoDetect)]
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
