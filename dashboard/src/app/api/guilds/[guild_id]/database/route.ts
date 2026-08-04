import { NextResponse } from 'next/server';
import { Pool } from 'pg';

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
      // Test Supabase connection first
      let newPool: Pool | null = null;
      try {
        newPool = new Pool({ connectionString: database_url?.replace('?sslmode=require', ''), ssl: { rejectUnauthorized: false } });
        // Run test query
        await newPool.query('SELECT 1');
      } catch (connError: any) {
        if (newPool) await newPool.end().catch(() => {});
        console.error('Supabase connection failed:', connError);
        return NextResponse.json(
          { error: `Supabase（専用データベース）の接続に失敗しました: ${connError.message || 'URLまたはパスワードをご確認ください'}` },
          { status: 400 }
        );
      }

      // Save to master DB after connection succeeds
      await masterPool.query(
        'INSERT INTO guild_databases (guild_id, database_url) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET database_url = EXCLUDED.database_url',
        [guildId, database_url]
      );

      // 注意: 以前はここで dashboard/src/lib/db.ts の setupDbSchema() を呼んでいたが、
      // そのスキーマ定義がBot本体(database.py)のものと食い違っており
      // (例: sticky_templates, anonymous_chats, evaluation_settings など)、
      // 先にこちらが CREATE TABLE IF NOT EXISTS を実行してしまうと
      // Bot側が想定するカラムが永久に作られない不具合の原因になっていた。
      // スキーマ作成はBot本体(database.py の setup_db_schema)に一本化し、
      // ここでは接続確認のみ行う。実際のテーブル初期化はBotの次回起動時
      // (setup_db() が guild_databases を全走査する際)に行われる。
      await newPool.end().catch(() => {});

    } else {
      await masterPool.query(
        'DELETE FROM guild_databases WHERE guild_id = $1',
        [guildId]
      );
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Database POST error:', error);
    return NextResponse.json({ error: `データベース設定の保存に失敗しました: ${error.message}` }, { status: 500 });
  }
}
