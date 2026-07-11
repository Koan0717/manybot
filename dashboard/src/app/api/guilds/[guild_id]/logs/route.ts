import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = parseInt(params.guild_id);
    if (isNaN(guildId)) return NextResponse.json({ error: 'Invalid guild_id' }, { status: 400 });

    const pool = await getPool(guildId);
    
    const res = await pool.query(
        'SELECT log_type, channel_id FROM log_settings WHERE guild_id = ',
        [guildId]
    );

    const data: Record<string, string> = {};
    for (const row of res.rows) {
        data[row.log_type] = String(row.channel_id);
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = parseInt(params.guild_id);
    if (isNaN(guildId)) return NextResponse.json({ error: 'Invalid guild_id' }, { status: 400 });

    const pool = await getPool(guildId);
    const body = await request.json();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // delete old ones not in body or empty
        await client.query('DELETE FROM log_settings WHERE guild_id = ', [guildId]);
        
        for (const [logType, channelId] of Object.entries(body)) {
            if (channelId && channelId !== '') {
                await client.query(
                    'INSERT INTO log_settings (guild_id, log_type, channel_id) VALUES (, , )',
                    [guildId, logType, channelId]
                );
            }
        }

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
