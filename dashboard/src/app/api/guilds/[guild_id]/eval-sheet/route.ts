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
      'SELECT is_enabled, forum_channel_ids, self_intro_channel_ids FROM evaluation_settings WHERE guild_id = $1',
      [guildId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({
        is_enabled: true,
        forum_channel_ids: [],
        self_intro_channel_ids: [],
      });
    }

    const row = result.rows[0];
    return NextResponse.json({
      is_enabled: row.is_enabled !== null ? row.is_enabled : true,
      forum_channel_ids: row.forum_channel_ids?.map(String) || [],
      self_intro_channel_ids: row.self_intro_channel_ids?.map(String) || [],
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
    const isEnabled = body.is_enabled !== undefined ? body.is_enabled : true;
    const forumChannelIds = Array.isArray(body.forum_channel_ids) ? body.forum_channel_ids : [];
    const selfIntroChannelIds = Array.isArray(body.self_intro_channel_ids) ? body.self_intro_channel_ids : [];

    await pool.query(
      `INSERT INTO evaluation_settings (guild_id, forum_channel_ids, self_intro_channel_ids, is_enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id)
       DO UPDATE SET forum_channel_ids = $2, self_intro_channel_ids = $3, is_enabled = $4`,
      [guildId, forumChannelIds, selfIntroChannelIds, isEnabled]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
