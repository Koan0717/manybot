import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireGuildMember } from '@/lib/memberAuth';
import { CasinoError, ensureCasinoTables } from '@/lib/casino/db';
import { PlayContext, blackjack, chinchiro, coinflip, highlow, horse, roulette, slot } from '@/lib/casino/games';
import { WebGame, isWebGame, loadCasinoSettings } from '@/lib/casino/settings';
import { canUseFeature, getMemberFlags } from '@/lib/webAccess';

const HANDLERS: Record<WebGame, (ctx: PlayContext, body: any) => Promise<unknown>> = {
  coinflip,
  slot,
  roulette,
  blackjack,
  chinchiro,
  horse,
  highlow,
};

/**
 * POST /api/member/guilds/[guild_id]/casino/[game]
 * ゲームを1回遊ぶ（ブラックジャックは start / hit / stand）。遊ぶのはセッションのDiscord ID本人に固定。
 * 管理ダッシュボードの「Webアクティビティ設定」でOFFのゲームは遊べない。
 */
export async function POST(request: Request, { params }: { params: { guild_id: string; game: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, session, member } = access;
  if (!isWebGame(params.game)) return NextResponse.json({ error: 'ゲームが見つかりません' }, { status: 404 });
  const game = params.game;
  const body = await request.json().catch(() => null);

  try {
    const pool = await getPool(guildId);
    const s = await loadCasinoSettings(pool, guildId);
    // 始めてしまったブラックジャック・High & Low の続きは、途中でOFFにされても最後まで遊べるようにする
    const continuing = (game === 'blackjack' || game === 'highlow') && body?.action !== 'start';
    if (!s.enabled[game] && !continuing) {
      return NextResponse.json({ error: 'このゲームは現在Webでは遊べません' }, { status: 403 });
    }
    if (!continuing && !canUseFeature(await getMemberFlags(pool, guildId, member), 'casino')) {
      return NextResponse.json({ error: 'カジノは現在利用できません' }, { status: 403 });
    }
    await ensureCasinoTables(pool);
    const result = await HANDLERS[game]({ pool, s, guildId, userId: session.discord_id }, body);
    return NextResponse.json({ success: true, currency_name: s.currencyName, ...(result as object) });
  } catch (e: any) {
    if (e instanceof CasinoError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e?.code === '22003') {
      return NextResponse.json({ error: '所持金の上限を超えるため遊べません' }, { status: 400 });
    }
    console.error(`casino ${game} failed:`, e);
    return NextResponse.json({ error: 'ゲームの処理中にエラーが発生しました' }, { status: 500 });
  }
}
