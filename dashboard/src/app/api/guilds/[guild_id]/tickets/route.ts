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
  const token = process.env.DISCORD_BOT_TOKEN;

  try {
    // 1. Fetch guild channels to know which channels belong to this guild
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${token}` },
      next: { revalidate: 60 }
    });

    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status}`);
    }

    const channels = await response.json();
    const channelIds = channels.map((c: any) => BigInt(c.id).toString());

    if (channelIds.length === 0) {
      return NextResponse.json([]);
    }

    // 2. Fetch ticket panels only for these channels
    const result = await pool.query(
      `SELECT channel_id, panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, ticket_prefix 
       FROM custom_ticket_panels 
       WHERE channel_id = ANY($1::bigint[])`,
      [channelIds]
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
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'save') {
      const { channel_id, panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, ticket_prefix } = body.panel;
      
      await pool.query(
        `INSERT INTO custom_ticket_panels (
          channel_id, panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, ticket_prefix
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (channel_id) DO UPDATE SET 
          panel_title = $2, panel_description = $3, button_label = $4, button_emoji = $5, mention_role_ids = $6, target_role_ids = $7, ticket_prefix = $8`,
        [channel_id, panel_title, panel_description, button_label || 'チケット作成', button_emoji || '', mention_role_ids || [], target_role_ids || [], ticket_prefix || 'ticket']
      );
      return NextResponse.json({ success: true });
    }
    else if (action === 'delete') {
      const { channel_id } = body;
      await pool.query('DELETE FROM custom_ticket_panels WHERE channel_id = $1', [channel_id]);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
