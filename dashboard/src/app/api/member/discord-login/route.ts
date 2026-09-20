import { NextResponse } from 'next/server';
import {
  DiscordApiError,
  DiscordUser,
  exchangeCodeForToken,
  listBotGuilds,
  listUserGuilds,
  userAvatarUrl,
  userRequest,
} from '@/lib/discordApi';
import { createMemberSession } from '@/lib/memberAuth';

/**
 * POST /api/member/discord-login
 * Activity SDK の authorize() で得た認可コードを受け取り、
 *   1. Discordでアクセストークンに交換（Client Secretはサーバーだけが持つ）
 *   2. ユーザー本人のIDと所属サーバーをDiscordから取得（クライアントの申告は信用しない）
 *   3. Manybotが参加しているサーバーだけに絞って返す
 * ためのエンドポイント。middleware.ts の PUBLIC_PATHS に入れてある。
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const code = body?.code;
    if (typeof code !== 'string' || !code) {
      return NextResponse.json({ error: '認可コードがありません' }, { status: 400 });
    }

    const accessToken = await exchangeCodeForToken(code);

    const [user, userGuilds, botGuilds] = await Promise.all([
      userRequest<DiscordUser>('/users/@me', accessToken),
      listUserGuilds(accessToken),
      listBotGuilds(),
    ]);

    const botGuildIds = new Set(botGuilds.map((g) => g.id));
    const guilds = userGuilds.filter((g) => botGuildIds.has(g.id));

    const token = await createMemberSession({
      discord_id: user.id,
      username: user.global_name || user.username,
    });

    return NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.global_name || user.username,
        avatar_url: userAvatarUrl(user),
      },
      guilds,
    });
  } catch (error) {
    if (error instanceof DiscordApiError) {
      console.error('discord-login failed:', error.message);
      const status = error.status === 500 ? 500 : 401;
      return NextResponse.json(
        {
          error:
            status === 500
              ? 'サーバー側のDiscord設定が不足しています（管理者に連絡してください）'
              : 'Discord認証に失敗しました。もう一度お試しください',
        },
        { status }
      );
    }
    console.error('discord-login error:', error);
    return NextResponse.json({ error: 'ログイン処理中にエラーが発生しました' }, { status: 500 });
  }
}
