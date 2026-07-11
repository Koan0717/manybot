import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    
    const res = await pool.query(
        'SELECT log_type, channel_id, is_enabled FROM log_settings WHERE guild_id = $1',
        [guildId]
    );

    const data: Record<string, any> = {};
    for (const row of res.rows) {
        data[row.log_type] = {
            channel_id: String(row.channel_id),
            is_enabled: row.is_enabled ?? true
        };
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    const body = await request.json();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        await client.query('DELETE FROM log_settings WHERE guild_id = $1', [guildId]);
        
        for (const [logType, conf] of Object.entries(body) as any) {
            const channelId = conf?.channel_id || conf;
            const isEnabled = typeof conf === 'object' && conf.is_enabled !== undefined ? conf.is_enabled : true;

            if (channelId && channelId !== '') {
                await client.query(
                    'INSERT INTO log_settings (guild_id, log_type, channel_id, is_enabled) VALUES ($1, $2, $3, $4)',
                    [guildId, logType, channelId, isEnabled]
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
