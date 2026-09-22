import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const masterPool = new Pool({ connectionString: process.env.DATABASE_URL?.replace('?sslmode=require', ''), ssl: { rejectUnauthorized: false } });

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;

  try {
    // Ensure table exists
    try {
      await masterPool.query(`
        CREATE TABLE IF NOT EXISTS guild_databases (
            guild_id BIGINT PRIMARY KEY,
            database_url TEXT NOT NULL
        )
      `);
    } catch (e) {}

    const result = await masterPool.query(
      'SELECT database_url FROM guild_databases WHERE guild_id = $1',
      [guildId]
    );

    if (result.rows.length > 0) {
      return NextResponse.json({
        database_url: result.rows[0].database_url || '',
      });
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
  const { database_url, confirm_remove } = await request.json();
  const trimmedUrl = typeof database_url === 'string' ? database_url.trim() : '';

  try {
    // Ensure table exists
    try {
      await masterPool.query(`
        CREATE TABLE IF NOT EXISTS guild_databases (
            guild_id BIGINT PRIMARY KEY,
            database_url TEXT NOT NULL
        )
      `);
    } catch (e) {}

    // 空のURLで上書きすると、専用データベースへの参照が失われ、
    // ボットがマスターデータベースを見に行ってしまう（データが全消えしたように見える）。
    // 解除は confirm_remove を明示した場合のみ許可する。
    if (!trimmedUrl) {
      if (!confirm_remove) {
        const existing = await masterPool.query(
          'SELECT database_url FROM guild_databases WHERE guild_id = $1',
          [guildId]
        );
        const hasExisting = existing.rows.length > 0 && (existing.rows[0].database_url || '').trim() !== '';
        if (hasExisting) {
          return NextResponse.json(
            { error: '接続URLが空のままでは保存できません。現在の設定を解除する場合は、解除ボタンから実行してください。' },
            { status: 400 }
          );
        }
      }
      // 解除が明示された場合、または元々未設定の場合は行ごと削除する
      await masterPool.query('DELETE FROM guild_databases WHERE guild_id = $1', [guildId]);
      return NextResponse.json({ success: true, removed: true });
    }

    // Manybot DB Test
    if (trimmedUrl) {
      let newPool: Pool | null = null;
      try {
        newPool = new Pool({ connectionString: trimmedUrl.replace('?sslmode=require', ''), ssl: { rejectUnauthorized: false } });
        await newPool.query('SELECT 1');
      } catch (connError: any) {
        if (newPool) await newPool.end().catch(() => {});
        return NextResponse.json(
          { error: `Manybot専用データベースの接続に失敗しました: ${connError.message || 'URLまたはパスワードをご確認ください'}` },
          { status: 400 }
        );
      } finally {
        if (newPool) await newPool.end().catch(() => {});
      }
    }

    // 保存
    await masterPool.query(
      `INSERT INTO guild_databases (guild_id, database_url)
       VALUES ($1, $2)
       ON CONFLICT (guild_id)
       DO UPDATE SET database_url = EXCLUDED.database_url`,
      [guildId, trimmedUrl]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Database POST error:', error);
    return NextResponse.json({ error: `データベース設定の保存に失敗しました: ${error.message}` }, { status: 500 });
  }
}
