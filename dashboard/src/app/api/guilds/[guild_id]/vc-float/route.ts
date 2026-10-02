import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureVcFloatSchema } from '@/lib/migrations';

const REWARD_TYPES = ['coin', 'none'] as const;

const cleanIds = (arr: any): string[] => {
  if (!Array.isArray(arr)) return [];
  return Array.from(new Set(arr.map(String).filter(id => /^\d{6,}$/.test(id))));
};

const DEFAULTS = {
  is_enabled: false,
  is_whitelist_mode: true,
  channels: [] as string[],
  categories: [] as string[],
  required_minutes: 30,
  daily_limit: 1,
  reset_on_leave: false,
  exclude_muted: false,
  exclude_deafened: false,
  rewards: [] as any[],
};

export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureVcFloatSchema(pool);

    const res = await pool.query(
      `SELECT is_enabled, is_whitelist_mode, channel_ids, category_ids, required_minutes, daily_limit, reset_on_leave,
              exclude_muted, exclude_deafened
       FROM vc_float_settings WHERE guild_id = $1`,
      [guildId]
    );
    const rewardsRes = await pool.query(
      `SELECT reward_type, label, amount, weight FROM vc_float_rewards WHERE guild_id = $1 ORDER BY id ASC`,
      [guildId]
    );
    const rewards = rewardsRes.rows.map(r => ({
      reward_type: r.reward_type,
      label: r.label || '',
      amount: Number(r.amount) || 0,
      weight: Number(r.weight) || 0,
    }));

    if (res.rows.length === 0) {
      return NextResponse.json({ ...DEFAULTS, rewards });
    }
    const row = res.rows[0];
    return NextResponse.json({
      is_enabled: row.is_enabled === true,
      is_whitelist_mode: row.is_whitelist_mode !== false,
      channels: (row.channel_ids || []).map(String),
      categories: (row.category_ids || []).map(String),
      required_minutes: Number(row.required_minutes) || 30,
      daily_limit: Number(row.daily_limit) || 0,
      reset_on_leave: row.reset_on_leave === true,
      exclude_muted: row.exclude_muted === true,
      exclude_deafened: row.exclude_deafened === true,
      rewards,
    });
  } catch (error: any) {
    console.error('VC float GET error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureVcFloatSchema(pool);
    const body = await request.json();

    const is_enabled = !!body.is_enabled;
    const is_whitelist_mode = body.is_whitelist_mode !== false;
    const channels = cleanIds(body.channels);
    const categories = cleanIds(body.categories);
    const required_minutes = Math.max(1, Math.floor(Number(body.required_minutes) || 30));
    const daily_limit = Math.max(0, Math.floor(Number(body.daily_limit) || 0));
    const reset_on_leave = !!body.reset_on_leave;
    const exclude_muted = !!body.exclude_muted;
    const exclude_deafened = !!body.exclude_deafened;

    const rewards = (Array.isArray(body.rewards) ? body.rewards : [])
      .filter((r: any) => r && REWARD_TYPES.includes(r.reward_type))
      .map((r: any) => ({
        reward_type: r.reward_type as string,
        label: String(r.label || '').slice(0, 100),
        amount: r.reward_type === 'coin' ? Math.max(0, Math.floor(Number(r.amount) || 0)) : 0,
        weight: Math.max(0, Number(r.weight) || 0),
      }));

    if (is_enabled && rewards.reduce((s: number, r: any) => s + r.weight, 0) <= 0) {
      return NextResponse.json({ error: '報酬を1つ以上、割合を0より大きく設定してください' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO vc_float_settings (
          guild_id, is_enabled, is_whitelist_mode, channel_ids, category_ids, required_minutes, daily_limit, reset_on_leave,
          exclude_muted, exclude_deafened
        ) VALUES ($1, $2, $3, $4::bigint[], $5::bigint[], $6, $7, $8, $9, $10)
        ON CONFLICT (guild_id) DO UPDATE SET
          is_enabled = EXCLUDED.is_enabled,
          is_whitelist_mode = EXCLUDED.is_whitelist_mode,
          channel_ids = EXCLUDED.channel_ids,
          category_ids = EXCLUDED.category_ids,
          required_minutes = EXCLUDED.required_minutes,
          daily_limit = EXCLUDED.daily_limit,
          reset_on_leave = EXCLUDED.reset_on_leave,
          exclude_muted = EXCLUDED.exclude_muted,
          exclude_deafened = EXCLUDED.exclude_deafened`,
        [guildId, is_enabled, is_whitelist_mode, channels, categories, required_minutes, daily_limit, reset_on_leave,
         exclude_muted, exclude_deafened]
      );

      // 報酬は全件入れ替え
      await client.query('DELETE FROM vc_float_rewards WHERE guild_id = $1', [guildId]);
      for (const r of rewards) {
        await client.query(
          `INSERT INTO vc_float_rewards (guild_id, reward_type, label, amount, weight) VALUES ($1, $2, $3, $4, $5)`,
          [guildId, r.reward_type, r.label, r.amount, r.weight]
        );
      }

      // Bot に設定再読み込みを通知
      const reqResult = await client.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type)
         VALUES ($1, 0, 'reload_vc_float')
         RETURNING id`,
        [guildId]
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true, sync_request_id: reqResult.rows[0]?.id ?? null });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('VC float POST error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}
