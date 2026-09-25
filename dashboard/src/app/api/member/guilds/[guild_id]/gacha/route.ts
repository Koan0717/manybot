import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireGuildMember } from '@/lib/memberAuth';
import { CasinoError } from '@/lib/casino/db';
import { loadCasinoSettings } from '@/lib/casino/settings';
import { fetchRoleNames } from '@/lib/shop';
import { canPull, isWebGachaEnabled, loadGacha, pullGacha, rarityOf, recentPulls } from '@/lib/gacha';
import { canUseFeature, getMemberFlags } from '@/lib/webAccess';

export const dynamic = 'force-dynamic';

/**
 * GET /api/member/guilds/[guild_id]/gacha
 * ダッシュボード「福引ガチャ設定」の景品・消費額と、本人が引けるか・最近の結果を返す。
 * 「Webアクティビティ設定」でガチャがOFF、または評価落ち・違反者で使えない設定なら enabled: false。
 */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, session, member } = access;

  try {
    const pool = await getPool(guildId);
    if (!(await isWebGachaEnabled(pool, guildId))) return NextResponse.json({ enabled: false });
    if (!canUseFeature(await getMemberFlags(pool, guildId, member), 'gacha')) return NextResponse.json({ enabled: false });
    const [{ settings, prizes }, s, history, roles] = await Promise.all([
      loadGacha(pool, guildId),
      loadCasinoSettings(pool, guildId),
      recentPulls(pool, guildId, session.discord_id),
      fetchRoleNames(guildId),
    ]);
    const total = prizes.reduce((a, p) => a + p.weight, 0);
    const roleInfo = (id: string | null) => {
      const r = id ? roles.get(id) : null;
      return r ? { id: r.id, name: r.name, color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null } : null;
    };
    return NextResponse.json({
      enabled: true,
      currency_name: s.currencyName,
      is_open: settings.is_enabled,
      pull_cost: settings.pull_cost,
      can_pull: canPull(settings, member),
      allowed_roles: settings.allowed_role_ids.map(roleInfo).filter(Boolean),
      prizes: prizes.map((p) => ({
        prize_number: p.prize_number,
        prize_name: p.prize_name,
        rarity: rarityOf(p.weight, total),
        reward_coins: p.reward_coins,
        reward_role: roleInfo(p.reward_role_id),
        reward_role_duration_days: p.reward_role_duration_days,
      })),
      history,
    });
  } catch (e) {
    console.error('gacha info failed:', e);
    return NextResponse.json({ error: 'ガチャの情報を取得できませんでした' }, { status: 500 });
  }
}

/** POST /api/member/guilds/[guild_id]/gacha  1回引く。引くのはセッションのDiscord ID本人 */
export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, member } = access;

  try {
    const pool = await getPool(guildId);
    if (!(await isWebGachaEnabled(pool, guildId))) {
      return NextResponse.json({ error: 'ガチャは現在Webでは利用できません' }, { status: 403 });
    }
    if (!canUseFeature(await getMemberFlags(pool, guildId, member), 'gacha')) {
      return NextResponse.json({ error: 'ガチャは現在利用できません' }, { status: 403 });
    }
    const s = await loadCasinoSettings(pool, guildId);
    const r = await pullGacha(pool, guildId, member, s.currencyName);
    return NextResponse.json({
      success: true,
      currency_name: s.currencyName,
      prize: { prize_number: r.prize.prize_number, prize_name: r.prize.prize_name, reward_coins: r.prize.reward_coins },
      rarity: r.rarity,
      cost: r.cost,
      balance: r.balance,
      role: r.role,
      role_failed: r.role_failed,
    });
  } catch (e: any) {
    if (e instanceof CasinoError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('gacha pull failed:', e);
    return NextResponse.json({ error: 'ガチャの処理中にエラーが発生しました' }, { status: 500 });
  }
}
