import { NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/doumori/auth';
import { listGuildsWithDedicatedDb } from '@/lib/doumori/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/doumori-overview
 * トップ画面の「どう森」用。メインダッシュボードでサーバー専用DBが登録済みのサーバーを返す。
 * サーバー単位のサブアカウントには見せない（全体管理者だけ）。
 */
export async function GET(request: Request) {
  if (!(await isSuperAdmin(request))) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }
  return NextResponse.json({ dedicated_db_guild_ids: await listGuildsWithDedicatedDb() });
}
