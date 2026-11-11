import { NextResponse } from 'next/server';
import { isDoumoriDbConfigured } from '@/lib/doumori/db';
import { isDoumoriBotConfigured } from '@/lib/doumori/discord';

export const dynamic = 'force-dynamic';

/** どう森ダッシュボードの設定状況（環境変数が揃っているか） */
export async function GET() {
  return NextResponse.json({
    db_configured: isDoumoriDbConfigured(),
    bot_configured: isDoumoriBotConfigured(),
  });
}
