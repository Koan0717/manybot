import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { setupDbSchema } from '@/lib/db';

const masterPool = new Pool({ connectionString: process.env.DATABASE_URL?.replace('?sslmode=require', ''), ssl: { rejectUnauthorized: false } });

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  

  try {
    const result = await masterPool.query(
      'SELECT database_url FROM guild_databases WHERE guild_id = $1',
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
  const guildId = params.guild_id;
  

  const { database_url } = await request.json();

  try {
    // Ensure table exists in master DB
    try {
      await masterPool.query(`
        CREATE TABLE IF NOT EXISTS guild_databases (
            guild_id BIGINT PRIMARY KEY,
            database_url TEXT NOT NULL
        )
      `);
    } catch (e) {}

    if (database_url) {
      await masterPool.query(
        'INSERT INTO guild_databases (guild_id, database_url) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET database_url = EXCLUDED.database_url',
        [guildId, database_url]
      );
      
      // Run setup schema on the newly added DB
      try {
        const newPool = new Pool({ connectionString: database_url?.replace('?sslmode=require', ''), ssl: { rejectUnauthorized: false } });
        await setupDbSchema(newPool);
      } catch (setupError: any) {
        return NextResponse.json({ error: 'テーブルの初期化に失敗しました。URLが正しいか確認してください。' }, { status: 500 });
      }

    } else {
      await masterPool.query(
        'DELETE FROM guild_databases WHERE guild_id = $1',
        [guildId]
      );
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
