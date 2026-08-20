import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);

  try {
    // OTHELLO_PANEL_CHANNELをbot_settingsから取得
    const settingRes = await pool.query(
      "SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = 'OTHELLO_PANEL_CHANNEL'",
      [guildId]
    );

    const channelId = settingRes.rows[0]?.setting_value;
    if (!channelId || channelId === '' || channelId === '0') {
      return NextResponse.json({ error: 'パネル設置チャンネルが設定されていません' }, { status: 400 });
    }

    await pool.query(
      "INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, $2, 'othello')",
      [guildId, channelId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to send othello panel:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
