import { NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/doumori/auth';
import { isDoumoriDbConfigured } from '@/lib/doumori/db';
import { isDoumoriBotConfigured, listDoumoriGuilds } from '@/lib/doumori/discord';

export const dynamic = 'force-dynamic';

/**
 * GET /api/doumori-overview
 * トップ画面の「どう森BOT」用。設定状況と、どう森BOTが参加しているサーバーのIDを返す。
 * サーバー単位のサブアカウントには見せない（全体管理者だけ）。
 */
export async function GET(request: Request) {
  if (!(await isSuperAdmin(request))) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let guildIds: string[] | null = null;
  let guildError: string | null = null;
  try {
    const guilds = await listDoumoriGuilds();
    guildIds = guilds ? guilds.map((g) => g.id) : null;
  } catch (e: any) {
    guildError = e?.message || 'どう森BOTのサーバー一覧を取得できませんでした';
  }

  return NextResponse.json({
    db_configured: isDoumoriDbConfigured(),
    bot_configured: isDoumoriBotConfigured(),
    // どう森BOTのトークンが未設定なら null（その場合は ManyBot のサーバー一覧から選ぶ）
    guild_ids: guildIds,
    guild_error: guildError,
  });
}
