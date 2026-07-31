import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);
  try {
    const result = await pool.query(
      'SELECT channel_id, welcome_channel_id, role_id, template, is_enabled FROM self_intro_role_settings WHERE guild_id = $1',
      [guildId]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ channel_id: null, welcome_channel_id: null, role_id: null, template: '', is_enabled: false });
    }
    const row = result.rows[0];
    return NextResponse.json({
      channel_id: row.channel_id ? String(row.channel_id) : null,
      welcome_channel_id: row.welcome_channel_id ? String(row.welcome_channel_id) : null,
      role_id: row.role_id ? String(row.role_id) : null,
      template: row.template || '',
      is_enabled: row.is_enabled ?? false,
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
    const body = await request.json();
    const { channel_id, welcome_channel_id, role_id, template, is_enabled } = body;
    const sql = [
      'INSERT INTO self_intro_role_settings (guild_id, channel_id, welcome_channel_id, role_id, template, is_enabled)',
      'VALUES ($1, $2, $3, $4, $5, $6)',
      'ON CONFLICT (guild_id) DO UPDATE',
      'SET channel_id = $2, welcome_channel_id = $3, role_id = $4, template = $5, is_enabled = $6'
    ].join(' ');
    await pool.query(sql, [
      guildId,
      channel_id ? channel_id.toString() : null,
      welcome_channel_id ? welcome_channel_id.toString() : null,
      role_id ? role_id.toString() : null,
      template || null,
      is_enabled ?? false,
    ]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
