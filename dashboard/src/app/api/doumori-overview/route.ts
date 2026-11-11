import { NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/doumori/auth';
import { isLegacyDbConfigured, listGuildsWithDedicatedDb } from '@/lib/doumori/db';
import { doumoriGuildIds } from '@/lib/doumori/discord';

export const dynamic = 'force-dynamic';

/**
 * GET /api/doumori-overview
 * トップ画面の「どう森BOT」用。サーバーごとの状態（BOT稼働・専用DB登録）を返す。
 * サーバー単位のサブアカウントには見せない（全体管理者だけ）。
 */
export async function GET(request: Request) {
  if (!(await isSuperAdmin(request))) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }
  return NextResponse.json({
    // どう森BOTが動くサーバー（DOUMORI_GUILD_ID）
    active_guild_ids: doumoriGuildIds(),
    // メインダッシュボードでサーバー専用DBが登録済みのサーバー
    dedicated_db_guild_ids: await listGuildsWithDedicatedDb(),
    // 旧どう森DB（DOUMORI_DATABASE_URL）があるか（専用DBが無いサーバーはこれを使う）
    legacy_db_configured: isLegacyDbConfigured(),
  });
}
