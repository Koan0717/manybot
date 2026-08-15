import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

async function ensureTables(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gacha_settings (
      guild_id BIGINT PRIMARY KEY,
      allowed_role_ids BIGINT[] DEFAULT '{}',
      pull_cost INTEGER DEFAULT 0,
      is_enabled BOOLEAN DEFAULT TRUE
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
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
      `SELECT allowed_role_ids, pull_cost, is_enabled FROM gacha_settings WHERE guild_id = $1`,
      [guildId]
    );
    const prizesRes = await pool.query(
      `SELECT id, prize_number, prize_name, weight, reward_coins, reward_role_id FROM gacha_prizes WHERE guild_id = $1 ORDER BY prize_number ASC`,
      [guildId]
    );

    const settings = settingsRes.rows[0] || { allowed_role_ids: [], pull_cost: 0, is_enabled: true };

    return NextResponse.json({
      allowed_role_ids: (settings.allowed_role_ids || []).map((id: any) => id.toString()),
      pull_cost: settings.pull_cost ?? 0,
      is_enabled: settings.is_enabled ?? true,
      prizes: prizesRes.rows.map((p: any) => ({
        id: p.id,
        prize_number: p.prize_number,
        prize_name: p.prize_name,
        weight: p.weight,
        reward_coins: p.reward_coins,
        reward_role_id: p.reward_role_id?.toString() ?? null,
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
    const { allowed_role_ids, pull_cost, is_enabled, prizes } = body;

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
        `INSERT INTO gacha_settings (guild_id, allowed_role_ids, pull_cost, is_enabled)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (guild_id) DO UPDATE
         SET allowed_role_ids = $2, pull_cost = $3, is_enabled = $4`,
        [guildId, allowed_role_ids || [], pull_cost || 0, is_enabled !== false]
      );

      await client.query(`DELETE FROM gacha_prizes WHERE guild_id = $1`, [guildId]);
      for (const p of prizes) {
        await client.query(
          `INSERT INTO gacha_prizes (guild_id, prize_number, prize_name, weight, reward_coins, reward_role_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [guildId, p.prize_number, p.prize_name, p.weight, p.reward_coins || 0, p.reward_role_id || null]
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
