import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireGuildMember } from '@/lib/memberAuth';
import { CasinoError } from '@/lib/casino/db';
import { loadCasinoSettings } from '@/lib/casino/settings';
import { buyShopItem, fetchRoleNames, getEvaluationPeriod, isWebShopEnabled, loadShopItems } from '@/lib/shop';

export const dynamic = 'force-dynamic';

/**
 * GET /api/member/guilds/[guild_id]/shop
 * ダッシュボード「ショップ設定」の商品を、名前・価格・用途・対象・効果つきで返す。
 * 「Webアクティビティ設定」でショップがOFFなら enabled: false。
 */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, session, member } = access;

  try {
    const pool = await getPool(guildId);
    if (!(await isWebShopEnabled(pool, guildId))) return NextResponse.json({ enabled: false });
    const [items, s, period, balanceRes] = await Promise.all([
      loadShopItems(pool, guildId),
      loadCasinoSettings(pool, guildId),
      getEvaluationPeriod(pool, guildId, session.discord_id),
      pool.query('SELECT balance FROM users WHERE guild_id = $1 AND user_id = $2', [guildId, session.discord_id]),
    ]);
    const roles = items.length ? await fetchRoleNames(guildId) : new Map();
    const roleInfo = (ids: string[]) =>
      ids
        .map((id) => roles.get(id))
        .filter(Boolean)
        .map((r: any) => ({ id: r.id, name: r.name, color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null }));

    return NextResponse.json({
      enabled: true,
      currency_name: s.currencyName,
      balance: Number(balanceRes.rows[0]?.balance) || 0,
      evaluation_period: period,
      items: items.map((item) => {
        const targets = roleInfo(item.target_role_ids);
        return {
          item_id: item.item_id,
          name: item.name,
          usage: item.usage,
          price: item.price,
          targets,
          // 対象ロール（どれか1つ）を持っているか。サーバーに無いロールしか指定されていなければ誰も買えない（Bot と同じ）
          is_target: !item.target_role_ids.length || item.target_role_ids.some((r) => member.roles.includes(r)),
          is_eval_extend: item.is_eval_extend,
          extend_days: item.extend_days,
          rewards: item.is_eval_extend ? [] : roleInfo(item.reward_role_ids),
          duration_days: item.duration_days && item.duration_days > 0 ? item.duration_days : null,
        };
      }),
    });
  } catch (e) {
    console.error('shop list failed:', e);
    return NextResponse.json({ error: 'ショップの情報を取得できませんでした' }, { status: 500 });
  }
}

/** POST /api/member/guilds/[guild_id]/shop  { item_id } 購入するのはセッションのDiscord ID本人 */
export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, member } = access;
  const body = await request.json().catch(() => null);

  try {
    const pool = await getPool(guildId);
    if (!(await isWebShopEnabled(pool, guildId))) {
      return NextResponse.json({ error: 'ショップは現在Webでは利用できません' }, { status: 403 });
    }
    const s = await loadCasinoSettings(pool, guildId);
    const result = await buyShopItem(pool, guildId, member, body?.item_id, s.currencyName);
    return NextResponse.json({ success: true, currency_name: s.currencyName, ...result });
  } catch (e: any) {
    if (e instanceof CasinoError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('shop buy failed:', e);
    return NextResponse.json({ error: '購入の処理中にエラーが発生しました' }, { status: 500 });
  }
}
