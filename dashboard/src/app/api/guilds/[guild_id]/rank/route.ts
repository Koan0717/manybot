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
    // Fetch rank settings
    const rankResult = await pool.query(
      'SELECT whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids FROM rank_settings WHERE guild_id = $1',
      [guildId]
    );

    // Fetch bot setting for ENABLE_TC_RANK
    const tcRankResult = await pool.query(
      "SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = 'ENABLE_TC_RANK'",
      [guildId]
    );

    let enableTcRank = true; // default
    if (tcRankResult.rows.length > 0) {
      try {
        enableTcRank = JSON.parse(tcRankResult.rows[0].setting_value);
      } catch (e) {
        enableTcRank = tcRankResult.rows[0].setting_value === 'true';
      }
    }

    const rankSettings = rankResult.rows.length > 0 ? rankResult.rows[0] : {
      whitelist_channel_ids: [],
      blacklist_channel_ids: [],
      whitelist_category_ids: [],
      blacklist_category_ids: []
    };

    return NextResponse.json({
      ...rankSettings,
      ENABLE_TC_RANK: enableTcRank
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
  try {
    const body = await request.json();
    const { 
      ENABLE_TC_RANK, 
      whitelist_channel_ids, 
      blacklist_channel_ids, 
      whitelist_category_ids, 
      blacklist_category_ids 
    } = body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update bot_settings for ENABLE_TC_RANK
      if (ENABLE_TC_RANK !== undefined) {
        await client.query(
          `INSERT INTO bot_settings (guild_id, setting_key, setting_value)
           VALUES ($1, $2, $3)
           ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = $3`,
          [guildId, 'ENABLE_TC_RANK', JSON.stringify(ENABLE_TC_RANK)]
        );
      }

      // Update rank_settings
      await client.query(
        `INSERT INTO rank_settings (guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (guild_id) DO UPDATE SET 
         whitelist_channel_ids = $2, blacklist_channel_ids = $3, whitelist_category_ids = $4, blacklist_category_ids = $5`,
        [
          guildId, 
          whitelist_channel_ids || [], 
          blacklist_channel_ids || [], 
          whitelist_category_ids || [], 
          blacklist_category_ids || []
        ]
      );

      // Request bot to reload the rank settings and bot_settings cache
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
