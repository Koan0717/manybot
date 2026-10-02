import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireGuildMember } from '@/lib/memberAuth';
import { CasinoError, ensureCasinoTables } from '@/lib/casino/db';
import { poker } from '@/lib/casino/poker';
import { loadCasinoSettings } from '@/lib/casino/settings';
import { loadBoardGameSettings } from '@/lib/boardgames/web';
import { canUseFeature, getMemberFlags } from '@/lib/webAccess';

/**
 * POST /api/member/guilds/[guild_id]/poker
 * メンバー画面「ゲーム」タブのポーカー（AIと1対1）。{ action: 'start' | 'act' | 'next' | 'resign', ... }
 * 管理ダッシュボード「Webアクティビティ設定」のゲーム（WEB_BOARDGAMES_ENABLED.poker）でOFFなら始められない。
 */
export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, session, member } = access;
  const body = await request.json().catch(() => null);

  try {
    const pool = await getPool(guildId);
    // 始めてしまった対戦は、途中でOFFにされても最後まで遊べるようにする
    if (body?.action === 'start') {
      const bg = await loadBoardGameSettings(pool, guildId);
      if (!bg.pokerEnabled) return NextResponse.json({ error: 'ポーカーは現在Webでは遊べません' }, { status: 403 });
      if (!canUseFeature(await getMemberFlags(pool, guildId, member), 'games')) {
        return NextResponse.json({ error: 'ゲームは現在利用できません' }, { status: 403 });
      }
    }
    const s = await loadCasinoSettings(pool, guildId);
    await ensureCasinoTables(pool);
    const result = await poker({ pool, s, guildId, userId: session.discord_id }, body);
    return NextResponse.json({ success: true, currency_name: s.currencyName, ...(result as object) });
  } catch (e: any) {
    if (e instanceof CasinoError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e?.code === '22003') return NextResponse.json({ error: '所持金の上限を超えるため遊べません' }, { status: 400 });
    console.error('poker failed:', e);
    return NextResponse.json({ error: 'ゲームの処理中にエラーが発生しました' }, { status: 500 });
  }
}
