import { NextResponse } from 'next/server';
import { masterPool } from '@/lib/db';

/**
 * GET /api/bots/[bot_id]/guilds
 * 登録Botのトークンを使ってDiscord APIからサーバー一覧を取得
 */
export async function GET(
  _request: Request,
  { params }: { params: { bot_id: string } }
) {
  const { bot_id } = params;
  try {
    // マスターDBからBotのトークンを取得
    const botResult = await masterPool.query(
      'SELECT token, bot_name FROM registered_bots WHERE bot_id = $1',
      [bot_id]
    );
    if (botResult.rows.length === 0) {
      return NextResponse.json({ error: 'Botが見つかりません' }, { status: 404 });
    }

    const { token, bot_name } = botResult.rows[0];

    // そのBotのトークンでDiscord APIからサーバー一覧を取得
    const discordRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bot ${token}` },
      next: { revalidate: 60 },
    });

    if (!discordRes.ok) {
      return NextResponse.json(
        { error: `Discord API エラー (HTTP ${discordRes.status})` },
        { status: discordRes.status }
      );
    }

    const guilds = await discordRes.json();
    return NextResponse.json({ bot_name, guilds });
  } catch (error: any) {
    console.error('GET /api/bots/[bot_id]/guilds error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
