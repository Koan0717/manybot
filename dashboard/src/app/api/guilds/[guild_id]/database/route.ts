import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const masterPool = new Pool({ connectionString: process.env.DATABASE_URL?.replace('?sslmode=require', ''), ssl: { rejectUnauthorized: false } });

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;

  try {
    // Ensure column exists
    try {
      await masterPool.query(`
        CREATE TABLE IF NOT EXISTS guild_databases (
            guild_id BIGINT PRIMARY KEY,
            database_url TEXT NOT NULL,
            doumori_database_url TEXT
        )
      `);
      await masterPool.query('ALTER TABLE guild_databases ADD COLUMN IF NOT EXISTS doumori_database_url TEXT');
    } catch (e) {}

    const result = await masterPool.query(
      'SELECT database_url, doumori_database_url FROM guild_databases WHERE guild_id = $1',
      [guildId]
    );

    if (result.rows.length > 0) {
      return NextResponse.json({
        database_url: result.rows[0].database_url || '',
        doumori_database_url: result.rows[0].doumori_database_url || process.env.DOUMORI_DATABASE_URL || '',
      });
    }
    return NextResponse.json({
      database_url: '',
      doumori_database_url: process.env.DOUMORI_DATABASE_URL || '',
    });
  } catch (error: any) {
    if (error.code !== '42P01') {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      database_url: '',
      doumori_database_url: process.env.DOUMORI_DATABASE_URL || '',
    });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const { database_url, doumori_database_url } = await request.json();

  try {
    // Ensure table and columns exist
    try {
      await masterPool.query(`
        CREATE TABLE IF NOT EXISTS guild_databases (
            guild_id BIGINT PRIMARY KEY,
            database_url TEXT NOT NULL,
            doumori_database_url TEXT
        )
      `);
      await masterPool.query('ALTER TABLE guild_databases ADD COLUMN IF NOT EXISTS doumori_database_url TEXT');
    } catch (e) {}

    // 1. Manybot DB Test
    if (database_url) {
      let newPool: Pool | null = null;
      try {
        newPool = new Pool({ connectionString: database_url?.replace('?sslmode=require', ''), ssl: { rejectUnauthorized: false } });
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

    // 2. Doumori DB Test & Auto Migration
    if (doumori_database_url) {
      let doumoriTestPool: Pool | null = null;
      try {
        doumoriTestPool = new Pool({ connectionString: doumori_database_url?.replace('?sslmode=require', ''), ssl: { rejectUnauthorized: false } });
        await doumoriTestPool.query('SELECT 1');

        // どうぶつの森テーブルの確認・初期化（スキーマ作成）
        await doumoriTestPool.query(`
          CREATE TABLE IF NOT EXISTS doumori_missions_master (
            id SERIAL PRIMARY KEY,
            guild_id BIGINT DEFAULT 0,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            target_rank INTEGER DEFAULT 0,
            reward_miles INTEGER DEFAULT 100,
            is_active BOOLEAN DEFAULT TRUE,
            times_assigned INTEGER DEFAULT 0,
            times_completed INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS doumori_ranks_master (
            level INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            required_miles INTEGER NOT NULL,
            color TEXT NOT NULL,
            role_name TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS doumori_daily_missions (
            guild_id BIGINT,
            user_id BIGINT,
            date_key TEXT,
            mission_slot INTEGER DEFAULT 1,
            mission_id INTEGER,
            mission_title TEXT,
            mission_desc TEXT,
            reward_miles INTEGER DEFAULT 100,
            status TEXT DEFAULT 'pending',
            proof_url TEXT,
            PRIMARY KEY (guild_id, user_id, date_key, mission_slot)
          );
        `);
      } catch (connError: any) {
        if (doumoriTestPool) await doumoriTestPool.end().catch(() => {});
        return NextResponse.json(
          { error: `どうぶつの森専用データベースの接続に失敗しました: ${connError.message || 'URLまたはパスワードをご確認ください'}` },
          { status: 400 }
        );
      } finally {
        if (doumoriTestPool) await doumoriTestPool.end().catch(() => {});
      }
    }

    // 保存
    await masterPool.query(
      `INSERT INTO guild_databases (guild_id, database_url, doumori_database_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (guild_id)
       DO UPDATE SET
         database_url = COALESCE(EXCLUDED.database_url, guild_databases.database_url),
         doumori_database_url = EXCLUDED.doumori_database_url`,
      [guildId, database_url || '', doumori_database_url || null]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Database POST error:', error);
    return NextResponse.json({ error: `データベース設定の保存に失敗しました: ${error.message}` }, { status: 500 });
  }
}
