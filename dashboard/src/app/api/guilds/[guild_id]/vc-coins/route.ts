import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureVcCoinsSettingsSchema } from '@/lib/migrations';

const cleanIds = (arr: any) => {
  if (!arr) return [];
  if (Array.isArray(arr)) return arr.map(String).filter(id => id && id.length > 5 && !id.endsWith('00'));
  try {
    const parsed = JSON.parse(arr);
    if (Array.isArray(parsed)) return parsed.map(String).filter(id => id && id.length > 5 && !id.endsWith('00'));
  } catch {}
  return [];
};

const cleanIdsStrict = (arr: any) => {
  if (!Array.isArray(arr)) return [];
  return Array.from(new Set(arr.map(String).filter(id => id && id.length > 5 && !(id.length >= 18 && id.endsWith('00')))));
};

export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureVcCoinsSettingsSchema(pool);

    const res = await pool.query(
      `SELECT is_enabled, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids,
              whitelist_channels, blacklist_channels, whitelist_categories, blacklist_categories,
              use_common_reward, role_scope_per_rule, stack_multiple_roles, common_reward_amount, common_reward_interval
       FROM vc_coins_settings WHERE guild_id = $1`,
      [guildId]
    );

    const roleRewardsRes = await pool.query(
      `SELECT role_id, reward_amount, reward_interval, is_whitelist_mode,
              whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids
       FROM vc_coins_role_rewards WHERE guild_id = $1 ORDER BY id ASC`,
      [guildId]
    );

    const role_rewards = roleRewardsRes.rows.map(r => ({
      role_id: String(r.role_id),
      reward_amount: Number(r.reward_amount) || 0,
      reward_interval: Number(r.reward_interval) || 10,
      is_whitelist_mode: r.is_whitelist_mode !== false,
      channels: cleanIds(r.is_whitelist_mode !== false ? r.whitelist_channel_ids : r.blacklist_channel_ids),
      categories: cleanIds(r.is_whitelist_mode !== false ? r.whitelist_category_ids : r.blacklist_category_ids),
    }));

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
        vc_coin_reward_interval: Number(row.common_reward_interval) || 10,
        vc_coin_reward_amount: Number(row.common_reward_amount) || 100,
        use_common_reward: row.use_common_reward !== false,
        role_scope_per_rule: row.role_scope_per_rule === true,
        stack_multiple_roles: row.stack_multiple_roles === true,
        role_rewards,
      });
    }

    return NextResponse.json({
      is_enabled: false,
      is_whitelist_mode: true,
      channels: [],
      categories: [],
      vc_coin_reward_interval: 10,
      vc_coin_reward_amount: 100,
      use_common_reward: true,
      role_scope_per_rule: false,
      stack_multiple_roles: false,
      role_rewards: [],
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

    const channels = cleanIdsStrict(body.channels || []);
    const categories = cleanIdsStrict(body.categories || []);

    const w_ch = is_whitelist ? channels : [];
    const b_ch = !is_whitelist ? channels : [];
    const w_cat = is_whitelist ? categories : [];
    const b_cat = !is_whitelist ? categories : [];

    const interval = Math.max(1, Number(body.vc_coin_reward_interval) || 10);
    const amount = Math.max(0, Number(body.vc_coin_reward_amount) || 100);
    const use_common_reward = body.use_common_reward !== undefined ? !!body.use_common_reward : true;
    const role_scope_per_rule = !!body.role_scope_per_rule;
    const stack_multiple_roles = !!body.stack_multiple_roles;

    const rawRoleRewards = Array.isArray(body.role_rewards) ? body.role_rewards : [];
    const roleRewards = rawRoleRewards
      .filter((r: any) => r && r.role_id)
      .map((r: any) => {
        const rIsWhitelist = r.is_whitelist_mode ?? true;
        const rChannels = cleanIdsStrict(r.channels || []);
        const rCategories = cleanIdsStrict(r.categories || []);
        return {
          role_id: String(r.role_id),
          reward_amount: Math.max(0, Number(r.reward_amount) || 0),
          reward_interval: Math.max(1, Number(r.reward_interval) || 10),
          is_whitelist_mode: rIsWhitelist,
          whitelist_channel_ids: rIsWhitelist ? rChannels : [],
          blacklist_channel_ids: !rIsWhitelist ? rChannels : [],
          whitelist_category_ids: rIsWhitelist ? rCategories : [],
          blacklist_category_ids: !rIsWhitelist ? rCategories : [],
        };
      });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO vc_coins_settings (
          guild_id, is_enabled, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids,
          whitelist_channels, blacklist_channels, whitelist_categories, blacklist_categories,
          use_common_reward, role_scope_per_rule, stack_multiple_roles, common_reward_amount, common_reward_interval
        ) VALUES ($1, $2, $3::bigint[], $4::bigint[], $5::bigint[], $6::bigint[], $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (guild_id) DO UPDATE SET
          is_enabled = EXCLUDED.is_enabled,
          whitelist_channel_ids = EXCLUDED.whitelist_channel_ids,
          blacklist_channel_ids = EXCLUDED.blacklist_channel_ids,
          whitelist_category_ids = EXCLUDED.whitelist_category_ids,
          blacklist_category_ids = EXCLUDED.blacklist_category_ids,
          whitelist_channels = EXCLUDED.whitelist_channels,
          blacklist_channels = EXCLUDED.blacklist_channels,
          whitelist_categories = EXCLUDED.whitelist_categories,
          blacklist_categories = EXCLUDED.blacklist_categories,
          use_common_reward = EXCLUDED.use_common_reward,
          role_scope_per_rule = EXCLUDED.role_scope_per_rule,
          stack_multiple_roles = EXCLUDED.stack_multiple_roles,
          common_reward_amount = EXCLUDED.common_reward_amount,
          common_reward_interval = EXCLUDED.common_reward_interval`,
        [
          guildId, is_enabled, w_ch, b_ch, w_cat, b_cat,
          JSON.stringify(w_ch), JSON.stringify(b_ch), JSON.stringify(w_cat), JSON.stringify(b_cat),
          use_common_reward, role_scope_per_rule, stack_multiple_roles, amount, interval,
        ]
      );

      // 役職ごとの獲得ルールは全件入れ替え
      await client.query('DELETE FROM vc_coins_role_rewards WHERE guild_id = $1', [guildId]);
      for (const r of roleRewards) {
        await client.query(
          `INSERT INTO vc_coins_role_rewards (
            guild_id, role_id, reward_amount, reward_interval, is_whitelist_mode,
            whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids
          ) VALUES ($1, $2, $3, $4, $5, $6::bigint[], $7::bigint[], $8::bigint[], $9::bigint[])`,
          [
            guildId, r.role_id, r.reward_amount, r.reward_interval, r.is_whitelist_mode,
            r.whitelist_channel_ids, r.blacklist_channel_ids, r.whitelist_category_ids, r.blacklist_category_ids,
          ]
        );
      }

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
