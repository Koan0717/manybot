import { NextResponse } from 'next/server';
import { getClientId } from '@/lib/discordApi';

// 引数を使わないGETはビルド時に事前生成されてしまい、その最中の no-store fetch が
// DYNAMIC_SERVER_USAGE になる。常にリクエスト時に実行する。
export const dynamic = 'force-dynamic';

/**
 * GET /api/member/discord-config
 * ログイン画面が Activity SDK の初期化に使うクライアントIDを返す（公開情報。シークレットは返さない）。
 * middleware.ts の PUBLIC_PATHS に入れてある。
 */
export async function GET() {
  try {
    return NextResponse.json({
      client_id: await getClientId(),
      // 設定してあれば、ブラウザからのログインはこのURLに戻す（未設定なら今のオリジン + /login/discord-callback）
      redirect_uri: process.env.DISCORD_REDIRECT_URI || null,
    });
  } catch (error) {
    console.error('discord-config failed:', error);
    return NextResponse.json(
      { error: 'DiscordのクライアントIDを取得できませんでした（管理者に連絡してください）' },
      { status: 500 }
    );
  }
}
