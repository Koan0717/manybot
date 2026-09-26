import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireGuildMember } from '@/lib/memberAuth';
import { ensureCasinoTables, getPlayerStatus } from '@/lib/casino/db';
import { HORSE_LIST, activeBlackjack, activeHighLow, settleStaleBlackjack, settleStaleHighLow } from '@/lib/casino/games';
import { WEB_GAMES, WEB_GAME_LABEL, loadCasinoSettings } from '@/lib/casino/settings';
import { canUseFeature, getMemberFlags } from '@/lib/webAccess';

export const dynamic = 'force-dynamic';

/**
 * GET /api/member/guilds/[guild_id]/casino
 * Web・アクティビティで遊べるゲーム（管理ダッシュボードの「Webアクティビティ設定」でONのもの）と、
 * 賭け金の上限・今日の回数・倍率など画面の表示に使う情報を返す。
 */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, session, member } = access;

  try {
    const pool = await getPool(guildId);
    const s = await loadCasinoSettings(pool, guildId);
    await ensureCasinoTables(pool);
    // 評価落ち・違反者で使えない設定なら、ゲームを1つも返さない（カジノタブ自体が出ない）
    const allowed = canUseFeature(await getMemberFlags(pool, guildId, member), 'casino');
    const ctx = { pool, s, guildId, userId: session.discord_id };
    await settleStaleBlackjack(ctx);
    await settleStaleHighLow(ctx);
    const [status, blackjack, highlow] = await Promise.all([
      getPlayerStatus(pool, guildId, session.discord_id),
      activeBlackjack(ctx),
      activeHighLow(ctx),
    ]);

    return NextResponse.json({
      currency_name: s.currencyName,
      games: WEB_GAMES.filter((g) => allowed && s.enabled[g]).map((g) => ({ key: g, label: WEB_GAME_LABEL[g] })),
      limits: { max_bet: s.maxBet, max_plays: s.maxPlays, daily_limit: s.dailyLimit, tax_rate: s.taxEnabled ? s.taxRate : 0 },
      status: { balance: status.balance, plays_today: status.playsToday, bet_today: status.betToday },
      multipliers: {
        coinflip: s.coinflip.mul,
        slot: { seven: s.slot.mul7, star: s.slot.mulStar, three: s.slot.mulThree, two: s.slot.mulTwo },
        roulette: { two: s.roulette.mul2, three: s.roulette.mul3, number: s.roulette.mul36 },
        blackjack: { normal: s.blackjack.mulNormal, bj: s.blackjack.mulBj },
        horse: { tan: s.horse.mulTan, fuku: s.horse.mulFuku },
        highlow: { mul: s.highlow.mul, max_streak: s.highlow.maxStreak },
      },
      horses: HORSE_LIST,
      // ゲームがOFFにされても、始めてしまったブラックジャックは最後まで遊べるようにする
      active_blackjack: blackjack,
      active_highlow: highlow,
    });
  } catch (e) {
    console.error('casino info failed:', e);
    return NextResponse.json({ error: 'カジノの情報を取得できませんでした' }, { status: 500 });
  }
}
