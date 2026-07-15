import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    const body = await request.json();
    const { channel_id, title, description, reaction_roles } = body;
    const token = process.env.DISCORD_BOT_TOKEN;

    if (!channel_id || !title || !reaction_roles || reaction_roles.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Send the embed message via Discord REST API
    const messageResponse = await fetch(`https://discord.com/api/v10/channels/${channel_id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        embeds: [{
          title: title,
          description: description || '',
          color: 16766720 // gold color
        }]
      })
    });

    if (!messageResponse.ok) {
      const errData = await messageResponse.json();
      throw new Error(`Failed to send message: ${JSON.stringify(errData)}`);
    }

    const messageData = await messageResponse.json();
    const messageId = messageData.id;

    // 2. Add each reaction role to DB and add reaction to the message
    for (const rr of reaction_roles) {
      const { role_id, emoji } = rr;
      
      // Save to database
      await pool.query(
        `INSERT INTO reaction_roles (message_id, emoji, role_id) VALUES ($1, $2, $3)`,
        [messageId, emoji, role_id]
      );

      // Parse emoji for Discord API
      // If it's a custom emoji <a:name:id> or <:name:id>, Discord expects "name:id"
      let apiEmoji = emoji.trim();
      const customMatch = apiEmoji.match(/<a?:([^:]+):(\d+)>/);
      if (customMatch) {
        apiEmoji = `${customMatch[1]}:${customMatch[2]}`;
      }
      
      // URL encode the emoji (necessary for both unicode and custom emojis in URLs)
      const encodedEmoji = encodeURIComponent(apiEmoji);

      // Add reaction
      const reactionResponse = await fetch(
        `https://discord.com/api/v10/channels/${channel_id}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bot ${token}`,
            'Content-Length': '0'
          }
        }
      );

      if (!reactionResponse.ok) {
        console.error(`Failed to add reaction ${emoji} to message ${messageId}`, await reactionResponse.text());
        // Continue even if one reaction fails, but log it
      }
      
      // Sleep a bit to avoid rate limits when adding multiple reactions
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return NextResponse.json({ success: true, message_id: messageId });
  } catch (error: any) {
    console.error('Other panels error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
