import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureVcCoinsSettingsSchema } from '@/lib/migrations';

export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureVcCoinsSettingsSchema(pool);

    const res = await pool.query(
      'SELECT is_enabled, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, whitelist_channels, blacklist_channels, whitelist_categories, blacklist_categories FROM vc_coins_settings WHERE guild_id = $1',
      [guildId]
    );

    const botSettingsRes = await pool.query(
      "SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key IN ('vc_coin_reward_interval', 'vc_coin_reward_amount')",
      [guildId]
    );

    let vc_coin_reward_interval = 10;
    let vc_coin_reward_amount = 100;
    for (const row of botSettingsRes.rows) {
      if (row.setting_key === 'vc_coin_reward_interval') vc_coin_reward_interval = Number(row.setting_value) || 10;
      if (row.setting_key === 'vc_coin_reward_amount') vc_coin_reward_amount = Number(row.setting_value) || 100;
    }

    const cleanIds = (arr: any) => {
      if (!arr) return [];
      if (Array.isArray(arr)) return arr.map(String).filter(id => id && id.length > 5 && !id.endsWith('00'));
      try {
        const parsed = JSON.parse(arr);
        if (Array.isArray(parsed)) return parsed.map(String).filter(id => id && id.length > 5 && !id.endsWith('00'));
      } catch {}
      return [];
    };

    if (res.rows.length > 0) {
      const row = res.rows[0];
      const is_enabled = row.is_enabled !== false;
      const wl_channels = cleanIds(row.whitelist_channel_ids?.length ? row.whitelist_channel_ids : row.whitelist_channels);
      const bl_channels = cleanIds(row.blacklist_channel_ids?.length ? row.blacklist_channel_ids : row.blacklist_channels);
      const wl_categories = cleanIds(row.whitelist_category_ids?.length ? row.whitelist_category_ids : row.whitelist_categories);
      const bl_categories = cleanIds(row.blacklist_category_ids?.length ? row.blacklist_category_ids : row.blacklist_categories);

      const is_whitelist = wl_channels.length > 0 || wl_categories.length > 0 || bl_channels.length === 0;

      return NextResponse.json({
        is_enabled: is_enabled,
        is_whitelist_mode: is_whitelist,
        channels: is_whitelist ? wl_channels : bl_channels,
        categories: is_whitelist ? wl_categories : bl_categories,
        vc_coin_reward_interval,
        vc_coin_reward_amount,
      });
    }

    return NextResponse.json({
      is_enabled: false,
      is_whitelist_mode: true,
      channels: [],
      categories: [],
      vc_coin_reward_interval: 10,
      vc_coin_reward_amount: 100,
    });
  } catch (error: any) {
    console.error('VC coins GET error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureVcCoinsSettingsSchema(pool);
    const body = await request.json();

    const is_enabled = body.is_enabled !== undefined ? !!body.is_enabled : false;
    const is_whitelist = body.is_whitelist_mode ?? true;
    
    const cleanIds = (arr: any) => {
      if (!Array.isArray(arr)) return [];
      return Array.from(new Set(arr.map(String).filter(id => id && id.length > 5 && !(id.length >= 18 && id.endsWith('00')))));
    };

    const channels = cleanIds(body.channels || []);
    const categories = cleanIds(body.categories || []);

    const w_ch = is_whitelist ? channels : [];
    const b_ch = !is_whitelist ? channels : [];
    const w_cat = is_whitelist ? categories : [];
    const b_cat = !is_whitelist ? categories : [];

    const interval = Math.max(1, Number(body.vc_coin_reward_interval) || 10);
    const amount = Math.max(0, Number(body.vc_coin_reward_amount) || 100);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO vc_coins_settings (
          guild_id, is_enabled, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids,
          whitelist_channels, blacklist_channels, whitelist_categories, blacklist_categories
        ) VALUES ($1, $2, $3::bigint[], $4::bigint[], $5::bigint[], $6::bigint[], $7, $8, $9, $10)
        ON CONFLICT (guild_id) DO UPDATE SET
          is_enabled = EXCLUDED.is_enabled,
          whitelist_channel_ids = EXCLUDED.whitelist_channel_ids,
          blacklist_channel_ids = EXCLUDED.blacklist_channel_ids,
          whitelist_category_ids = EXCLUDED.whitelist_category_ids,
          blacklist_category_ids = EXCLUDED.blacklist_category_ids,
          whitelist_channels = EXCLUDED.whitelist_channels,
          blacklist_channels = EXCLUDED.blacklist_channels,
          whitelist_categories = EXCLUDED.whitelist_categories,
          blacklist_categories = EXCLUDED.blacklist_categories`,
        [guildId, is_enabled, w_ch, b_ch, w_cat, b_cat, JSON.stringify(w_ch), JSON.stringify(b_ch), JSON.stringify(w_cat), JSON.stringify(b_cat)]
      );

      // bot_settings にも間隔と量を同期
      await client.query(
        `INSERT INTO bot_settings (guild_id, setting_key, setting_value) VALUES ($1, 'vc_coin_reward_interval', $2)
         ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = $2`,
        [guildId, String(interval)]
      );
      await client.query(
        `INSERT INTO bot_settings (guild_id, setting_key, setting_value) VALUES ($1, 'vc_coin_reward_amount', $2)
         ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = $2`,
        [guildId, String(amount)]
      );

      // Bot に設定再読み込みを通知
      const reqResult = await client.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type)
         VALUES ($1, 0, 'reload_vc_coins')
         RETURNING id`,
        [guildId]
      );

      await client.query('COMMIT');
      const sync_request_id: number | null = reqResult.rows[0]?.id ?? null;
      return NextResponse.json({ success: true, sync_request_id });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('VC coins POST error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}
