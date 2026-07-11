import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  try {
    const result = await pool.query(
      "SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = 'ROOM_PRICES'",
      [guildId]
    );

    let roomPrices = null;
    if (result.rows.length > 0) {
      try {
        roomPrices = JSON.parse(result.rows[0].setting_value);
      } catch (e) {
        // error parsing json
      }
    }

    return NextResponse.json({ ROOM_PRICES: roomPrices });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'save') {
      const { ROOM_PRICES } = body;
      
      await pool.query(
        `INSERT INTO bot_settings (guild_id, setting_key, setting_value)
         VALUES ($1, $2, $3)
         ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = $3`,
        [guildId, 'ROOM_PRICES', JSON.stringify(ROOM_PRICES)]
      );
      
      return NextResponse.json({ success: true });
    }
    else if (action === 'deploy_panel') {
      const { channel_id, panel_type } = body;
      
      if (!channel_id || !panel_type) {
        return NextResponse.json({ error: 'channel_id and panel_type are required' }, { status: 400 });
      }

      await pool.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type)
         VALUES ($1, $2, $3)`,
        [guildId, channel_id, panel_type]
      );

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
