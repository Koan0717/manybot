import { NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/doumori/auth';
import { isDoumoriDbConfigured } from '@/lib/doumori/db';
import { doumoriGuildIds } from '@/lib/doumori/discord';

export const dynamic = 'force-dynamic';

/**
 * GET /api/doumori-overview
 * トップ画面の「どう森BOT」用。DBの設定状況と、どう森の機能を動かすサーバーのIDを返す。
 * サーバー単位のサブアカウントには見せない（全体管理者だけ）。
 */
export async function GET(request: Request) {
  if (!(await isSuperAdmin(request))) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }
  return NextResponse.json({
    db_configured: isDoumoriDbConfigured(),
    guild_ids: doumoriGuildIds(),
  });
}
