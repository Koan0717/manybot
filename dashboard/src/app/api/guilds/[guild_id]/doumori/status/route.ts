import { NextResponse } from 'next/server';
import { getDoumoriDbSource } from '@/lib/doumori/db';

export const dynamic = 'force-dynamic';

/** どう森ダッシュボードの状態。db_source: 'guild'（サーバー専用DB）/ null（未登録 → 初期設定が必要） */
export async function GET(_request: Request, { params }: { params: { guild_id: string } }) {
  try {
    return NextResponse.json({ db_source: await getDoumoriDbSource(params.guild_id) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
