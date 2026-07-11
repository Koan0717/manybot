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
      'SELECT item_id, name, usage, price, target_role_ids, reward_role_ids, duration_days, is_eval_extend, extend_days FROM shop_items WHERE guild_id = $1 ORDER BY item_id ASC',
      [guildId]
    );
    return NextResponse.json(result.rows);
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

    if (action === 'add') {
      const { name, usage, price, target_role_ids, reward_role_ids, duration_days, is_eval_extend, extend_days } = body.item;
      const result = await pool.query(
        `INSERT INTO shop_items (guild_id, name, usage, price, target_role_ids, reward_role_ids, duration_days, is_eval_extend, extend_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING item_id`,
        [guildId, name, usage || '', price || 0, target_role_ids || [], reward_role_ids || [], duration_days || null, is_eval_extend || false, extend_days || null]
      );
      return NextResponse.json({ success: true, item_id: result.rows[0].item_id });
    } 
    else if (action === 'edit') {
      const { item_id, name, usage, price, target_role_ids, reward_role_ids, duration_days, is_eval_extend, extend_days } = body.item;
      await pool.query(
        `UPDATE shop_items SET name = $1, usage = $2, price = $3, target_role_ids = $4, reward_role_ids = $5, duration_days = $6, is_eval_extend = $7, extend_days = $8 
         WHERE item_id = $9 AND guild_id = $10`,
        [name, usage || '', price || 0, target_role_ids || [], reward_role_ids || [], duration_days || null, is_eval_extend || false, extend_days || null, item_id, guildId]
      );
      return NextResponse.json({ success: true });
    }
    else if (action === 'delete') {
      const { item_id } = body;
      await pool.query('DELETE FROM shop_items WHERE item_id = $1 AND guild_id = $2', [item_id, guildId]);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
