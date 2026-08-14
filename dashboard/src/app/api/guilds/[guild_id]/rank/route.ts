import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureRankSettingsSchema } from '@/lib/migrations';

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);
  try {
    await ensureRankSettingsSchema(pool);

    const rankResult = await pool.query(
      'SELECT whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids, ephemeral_rank_commands FROM rank_settings WHERE guild_id = $1',
      [guildId]
    );

    const botSettingsResult = await pool.query(
      "SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key IN ('ENABLE_RANK', 'ENABLE_TC_RANK')",
      [guildId]
    );

    let enableRank = true;
    let enableTcRank = true;
    for (const row of botSettingsResult.rows) {
      if (row.setting_key === 'ENABLE_RANK') {
        try { enableRank = JSON.parse(row.setting_value); } catch { enableRank = row.setting_value === 'true'; }
      } else if (row.setting_key === 'ENABLE_TC_RANK') {
        try { enableTcRank = JSON.parse(row.setting_value); } catch { enableTcRank = row.setting_value === 'true'; }
      }
    }

    const rankSettings = rankResult.rows.length > 0 ? rankResult.rows[0] : {
      whitelist_channel_ids: [],
      blacklist_channel_ids: [],
      whitelist_category_ids: [],
      blacklist_category_ids: [],
      enable_exclude_rank_role: false,
      exclude_rank_role_ids: [],
      ephemeral_rank_commands: false
    };

    return NextResponse.json({
      ...rankSettings,
      ENABLE_RANK: enableRank,
      ENABLE_TC_RANK: enableTcRank,
      ENABLE_EXCLUDE_RANK_ROLE: rankSettings.enable_exclude_rank_role,
      EXCLUDE_RANK_ROLE_IDS: rankSettings.exclude_rank_role_ids?.map(String) || [],
      ephemeral_rank_commands: rankSettings.ephemeral_rank_commands ?? false
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);
  try {
    await ensureRankSettingsSchema(pool);

    const body = await request.json();
    const { 
      ENABLE_RANK,
      ENABLE_TC_RANK, 
      ENABLE_EXCLUDE_RANK_ROLE,
      EXCLUDE_RANK_ROLE_IDS,
      whitelist_channel_ids, 
      blacklist_channel_ids, 
      whitelist_category_ids, 
      blacklist_category_ids,
      ephemeral_rank_commands
    } = body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const updateSetting = async (key: string, value: any) => {
        if (value !== undefined) {
          await client.query(
            `INSERT INTO bot_settings (guild_id, setting_key, setting_value)
             VALUES ($1, $2, $3)
             ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = $3`,
            [guildId, key, JSON.stringify(value)]
          );
        }
      };

      await updateSetting('ENABLE_RANK', ENABLE_RANK !== undefined ? ENABLE_RANK : true);
      await updateSetting('ENABLE_TC_RANK', ENABLE_TC_RANK);

      await client.query(
        `INSERT INTO rank_settings (guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids, ephemeral_rank_commands)
         VALUES ($1, $2::bigint[], $3::bigint[], $4::bigint[], $5::bigint[], $6, $7::bigint[], $8)
         ON CONFLICT (guild_id) DO UPDATE SET 
         whitelist_channel_ids = $2::bigint[], blacklist_channel_ids = $3::bigint[], whitelist_category_ids = $4::bigint[], blacklist_category_ids = $5::bigint[], enable_exclude_rank_role = $6, exclude_rank_role_ids = $7::bigint[], ephemeral_rank_commands = $8`,
        [
          guildId, 
          (whitelist_channel_ids || []).map(String), 
          (blacklist_channel_ids || []).map(String), 
          (whitelist_category_ids || []).map(String), 
          (blacklist_category_ids || []).map(String),
          ENABLE_EXCLUDE_RANK_ROLE || false,
          (EXCLUDE_RANK_ROLE_IDS || []).map(String),
          ephemeral_rank_commands || false
        ]
      );

      await client.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type)
         VALUES ($1, $2, $3)`,
        [guildId, 0, 'reload_rank_and_bot_settings']
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
