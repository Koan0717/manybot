import { NextResponse } from 'next/server';
import { getClientId } from '@/lib/discordApi';

/**
 * GET /api/member/discord-config
 * ログイン画面が Activity SDK の初期化に使うクライアントIDを返す（公開情報。シークレットは返さない）。
 * middleware.ts の PUBLIC_PATHS に入れてある。
 */
export async function GET() {
  try {
    return NextResponse.json({ client_id: await getClientId() });
  } catch (error) {
    console.error('discord-config failed:', error);
    return NextResponse.json(
      { error: 'DiscordのクライアントIDを取得できませんでした（管理者に連絡してください）' },
      { status: 500 }
    );
  }
}
