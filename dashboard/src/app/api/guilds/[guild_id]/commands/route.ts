import { NextResponse } from 'next/server';
import { getPool, masterPool } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  
  try {
    // Fetch all available commands from master DB
    const allCommandsResult = await masterPool.query(
      'SELECT command_name, description, category FROM available_commands ORDER BY category, command_name'
    );
    const availableCommands = allCommandsResult.rows;

    // Fetch guild specific settings
    const pool = await getPool(guildId);
    const settingsResult = await pool.query(
      'SELECT command_name, is_enabled FROM command_settings WHERE guild_id = $1',
      [guildId]
    );
    
    const settingsMap = new Map();
    settingsResult.rows.forEach(row => {
      settingsMap.set(row.command_name, row.is_enabled);
    });

    // Combine
    const commandsWithSettings = availableCommands
      .filter(cmd => !['運営 手動付与_複数人選択', '運営 手動付与_ロール指定', '/運営 手動付与_複数人選択', '/運営 手動付与_ロール指定'].includes(cmd.command_name))
      .map(cmd => ({
      ...cmd,
      is_enabled: settingsMap.has(cmd.command_name) ? settingsMap.get(cmd.command_name) : true // Default to true
    }));

    return NextResponse.json(commandsWithSettings);
  } catch (error: any) {
    console.error("Failed to fetch command settings:", error);
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
    const body = await request.json();
    const { command_name, is_enabled } = body;

    if (!command_name || typeof is_enabled !== 'boolean') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    await pool.query(
      `INSERT INTO command_settings (guild_id, command_name, is_enabled) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (guild_id, command_name) 
       DO UPDATE SET is_enabled = EXCLUDED.is_enabled`,
      [guildId, command_name, is_enabled]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to update command setting:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
