import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const masterPool = new Pool({ connectionString: process.env.DATABASE_URL?.replace('?sslmode=require', ''), ssl: { rejectUnauthorized: false } });

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  

  try {
    // Check if guild has dedicated DB
    let hasDedicatedDb = false;
    try {
      const dbRes = await masterPool.query(
        'SELECT database_url FROM guild_databases WHERE guild_id = $1',
        [guildId]
      );
      if (dbRes.rows.length > 0 && dbRes.rows[0].database_url) {
        hasDedicatedDb = true;
      }
    } catch (e) {
      // Table might not exist
    }

    // Check if guild has existing settings in master DB
    let isNewServer = true;
    try {
      const settingsRes = await masterPool.query(
        'SELECT 1 FROM bot_settings WHERE guild_id = $1 LIMIT 1',
        [guildId]
      );
      if (settingsRes.rows.length > 0) {
        isNewServer = false;
      }
    } catch (e) {
      // Table might not exist
    }

    let guildName = null;
    try {
      const discordRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN}`
        }
      });
      if (discordRes.ok) {
        const guildData = await discordRes.json();
        guildName = guildData.name;
      }
    } catch (e) {
      // Ignore discord API errors
    }

    return NextResponse.json({
      is_new_server: isNewServer,
      has_dedicated_db: hasDedicatedDb,
      guild_name: guildName
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
