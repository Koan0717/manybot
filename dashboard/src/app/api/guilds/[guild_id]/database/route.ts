import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = parseInt(params.guild_id);
  if (isNaN(guildId)) return NextResponse.json({ error: 'Invalid guild_id' }, { status: 400 });

  try {
    const result = await pool.query(
      'SELECT database_url FROM guild_databases WHERE guild_id = ',
      [guildId]
    );

    if (result.rows.length > 0) {
      return NextResponse.json({ database_url: result.rows[0].database_url });
    }
    return NextResponse.json({ database_url: '' });
  } catch (error: any) {
    if (error.code !== '42P01') {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ database_url: '' });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = parseInt(params.guild_id);
  if (isNaN(guildId)) return NextResponse.json({ error: 'Invalid guild_id' }, { status: 400 });

  const { database_url } = await request.json();

  try {
    if (database_url) {
      await pool.query(
        'INSERT INTO guild_databases (guild_id, database_url) VALUES (, ) ON CONFLICT (guild_id) DO UPDATE SET database_url = EXCLUDED.database_url',
        [guildId, database_url]
      );
    } else {
      await pool.query(
        'DELETE FROM guild_databases WHERE guild_id = ',
        [guildId]
      );
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.code === '42P01') {
      try {
        await pool.query(
          CREATE TABLE IF NOT EXISTS guild_databases (
              guild_id BIGINT PRIMARY KEY,
              database_url TEXT NOT NULL
          )
        );
        if (database_url) {
          await pool.query(
            'INSERT INTO guild_databases (guild_id, database_url) VALUES (, ) ON CONFLICT (guild_id) DO UPDATE SET database_url = EXCLUDED.database_url',
            [guildId, database_url]
          );
        } else {
          await pool.query(
            'DELETE FROM guild_databases WHERE guild_id = ',
            [guildId]
          );
        }
        return NextResponse.json({ success: true });
      } catch (retryError: any) {
        return NextResponse.json({ error: retryError.message }, { status: 500 });
      }
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
