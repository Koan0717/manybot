import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

async function ensureTables(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gacha_settings (
      guild_id BIGINT PRIMARY KEY,
      allowed_role_ids BIGINT[] DEFAULT '{}',
      pull_cost INTEGER DEFAULT 0,
      is_enabled BOOLEAN DEFAULT TRUE,
      panel_channel_id BIGINT DEFAULT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gacha_prizes (
      id SERIAL PRIMARY KEY,
      guild_id BIGINT NOT NULL,
      prize_number INTEGER NOT NULL,
      prize_name TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 1,
      reward_coins INTEGER DEFAULT 0,
      reward_role_id BIGINT,
      reward_role_duration_days INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gacha_user_roles (
      id SERIAL PRIMARY KEY,
      guild_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      role_id BIGINT NOT NULL,
      prize_id INTEGER,
      expires_at TIMESTAMP NOT NULL,
      role_removed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  try {
    await pool.query(`
      ALTER TABLE gacha_prizes ADD COLUMN IF NOT EXISTS reward_role_duration_days INTEGER DEFAULT 0;
    `);
  } catch (e) {
    // ignore if already exists
  }
  try {
    await pool.query(`
      ALTER TABLE gacha_settings ADD COLUMN IF NOT EXISTS panel_channel_id BIGINT DEFAULT NULL;
    `);
  } catch (e) {
    // ignore if already exists
  }
}

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  try {
    const pool = await getPool(guildId);
    await ensureTables(pool);

    const settingsRes = await pool.query(
      `SELECT allowed_role_ids, pull_cost, is_enabled, panel_channel_id FROM gacha_settings WHERE guild_id = $1`,
      [guildId]
    );
    const prizesRes = await pool.query(
      `SELECT id, prize_number, prize_name, weight, reward_coins, reward_role_id, reward_role_duration_days FROM gacha_prizes WHERE guild_id = $1 ORDER BY prize_number ASC`,
      [guildId]
    );

    const settings = settingsRes.rows[0] || { allowed_role_ids: [], pull_cost: 0, is_enabled: true, panel_channel_id: null };

    return NextResponse.json({
      allowed_role_ids: (settings.allowed_role_ids || []).map((id: any) => id.toString()),
      pull_cost: settings.pull_cost ?? 0,
      is_enabled: settings.is_enabled ?? true,
      panel_channel_id: settings.panel_channel_id?.toString() ?? '',
      prizes: prizesRes.rows.map((p: any) => ({
        id: p.id,
        prize_number: p.prize_number,
        prize_name: p.prize_name,
        weight: p.weight,
        reward_coins: p.reward_coins,
        reward_role_id: p.reward_role_id?.toString() ?? null,
        reward_role_duration_days: p.reward_role_duration_days ?? 0,
      })),
    });
  } catch (error: any) {
    console.error('[gacha] GET error:', error);
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  try {
    const pool = await getPool(guildId);
    await ensureTables(pool);
    const body = await request.json();

    // パネル設置アクションの処理
    if (body.action === 'deploy') {
      const channelId = body.channel_id || body.panel_channel_id;
      if (!channelId) {
        return NextResponse.json({ error: 'パネル設置チャンネルが指定されていません' }, { status: 400 });
      }

      await pool.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, $2, 'gacha')`,
        [guildId, channelId]
      );

      await pool.query(
        `INSERT INTO gacha_settings (guild_id, panel_channel_id)
         VALUES ($1, $2)
         ON CONFLICT (guild_id) DO UPDATE SET panel_channel_id = $2`,
        [guildId, channelId]
      );

      return NextResponse.json({ success: true });
    }

    const { allowed_role_ids, pull_cost, is_enabled, prizes, panel_channel_id } = body;

    if (!Array.isArray(prizes)) {
      return NextResponse.json({ error: 'prizes は配列である必要があります' }, { status: 400 });
    }
    for (const p of prizes) {
      if (!p.prize_name || p.prize_number === undefined || p.prize_number === null) {
        return NextResponse.json({ error: 'すべての景品に番号と名前を入力してください' }, { status: 400 });
      }
      if (!p.weight || Number(p.weight) <= 0) {
        return NextResponse.json({ error: `「${p.prize_name}」の確率(重み)は1以上にしてください` }, { status: 400 });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO gacha_settings (guild_id, allowed_role_ids, pull_cost, is_enabled, panel_channel_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (guild_id) DO UPDATE
         SET allowed_role_ids = $2, pull_cost = $3, is_enabled = $4, panel_channel_id = $5`,
        [guildId, allowed_role_ids || [], pull_cost || 0, is_enabled !== false, panel_channel_id || null]
      );

      await client.query(`DELETE FROM gacha_prizes WHERE guild_id = $1`, [guildId]);
      for (const p of prizes) {
        await client.query(
          `INSERT INTO gacha_prizes (guild_id, prize_number, prize_name, weight, reward_coins, reward_role_id, reward_role_duration_days)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [guildId, p.prize_number, p.prize_name, p.weight, p.reward_coins || 0, p.reward_role_id || null, p.reward_role_duration_days || 0]
        );
      }

      // Bot側の設定リロードをリクエスト
      await client.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, 0, 'reload_bot_settings')`,
        [guildId]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[gacha] POST error:', error);
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
