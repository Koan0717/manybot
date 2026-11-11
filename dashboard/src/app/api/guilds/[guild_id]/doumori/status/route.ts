import { NextResponse } from 'next/server';
import { getDoumoriDbSource } from '@/lib/doumori/db';
import { doumoriGuildIds } from '@/lib/doumori/discord';

export const dynamic = 'force-dynamic';

/**
 * どう森ダッシュボードの状態
 *   db_source: 'guild'（サーバー専用DB）/ 'legacy'（旧どう森DB）/ null（未設定 → 初期設定が必要）
 *   bot_active: このサーバーでどう森BOTが動く設定か（DOUMORI_GUILD_ID）
 */
export async function GET(_request: Request, { params }: { params: { guild_id: string } }) {
  try {
    return NextResponse.json({
      db_source: await getDoumoriDbSource(params.guild_id),
      bot_active: doumoriGuildIds().includes(params.guild_id),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
