import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const masterPool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = parseInt(params.guild_id);
  if (isNaN(guildId)) return NextResponse.json({ error: 'Invalid guild_id' }, { status: 400 });

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

    return NextResponse.json({
      is_new_server: isNewServer,
      has_dedicated_db: hasDedicatedDb
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
