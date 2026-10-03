import { NextResponse } from 'next/server';
import { addonError, findLinkByName, getCurrencyName, normalizePlayerName, refreshDiscordStatus, requireAddon } from '@/lib/minecraft';

export const dynamic = 'force-dynamic';

// database.get_next_level_xp と同じ式
const nextLevelXp = (level: number) => Math.floor(100 * Math.pow(level, 1.2) + 100);

/**
 * GET /api/minecraft/profile?player=<ゲーマータグ>
 * 情報端末の「プロフィール」。連携先のDiscordアカウント・ロール・所持金・レベル・出品数。
 */
export async function GET(request: Request) {
  const auth = await requireAddon(request);
  if (!auth.ok) return auth.response;
  const { guildId, pool } = auth;

  const player = normalizePlayerName(new URL(request.url).searchParams.get('player'));
  if (!player) return addonError('プレイヤー名が不正です', 400);

  try {
    const link = await findLinkByName(pool, guildId, player);
    if (!link) return NextResponse.json({ ok: true, linked: false });
    const [status, userRes, linkRes, listings, currency_name] = await Promise.all([
      refreshDiscordStatus(pool, guildId, link.user_id),
      pool.query('SELECT * FROM users WHERE guild_id = $1 AND user_id = $2', [guildId, link.user_id]),
      pool.query(
        'SELECT discord_name, role_names, is_staff, in_guild, linked_at FROM minecraft_links WHERE guild_id = $1 AND user_id = $2',
        [guildId, link.user_id]
      ),
      pool.query('SELECT COUNT(*)::int AS n FROM minecraft_listings WHERE guild_id = $1 AND seller_user_id = $2', [guildId, link.user_id]),
      getCurrencyName(pool, guildId),
    ]);
    const u = userRes.rows[0] ?? {};
    const l = linkRes.rows[0] ?? {};
    const level = (lv: unknown, xp: unknown) => {
      const n = Number(lv ?? 1);
      return { level: n, xp: Number(xp ?? 0), next_xp: nextLevelXp(n) };
    };
    return NextResponse.json({
      ok: true,
      linked: true,
      mc_name: link.mc_name,
      discord_id: link.user_id,
      discord_name: status?.discord_name ?? l.discord_name ?? null,
      in_guild: status?.in_guild ?? l.in_guild ?? true,
      is_staff: status?.is_staff ?? l.is_staff ?? false,
      roles: (status?.role_names ?? l.role_names ?? []).slice(0, 8),
      linked_at: l.linked_at ?? null,
      balance: Number(u.balance ?? 0),
      currency_name,
      tc: level(u.tc_level, u.tc_xp),
      vc: level(u.vc_level, u.vc_xp),
      listings: listings.rows[0]?.n ?? 0,
    });
  } catch (e) {
    console.error('minecraft profile failed:', e);
    return addonError('プロフィールを取得できませんでした', 500);
  }
}
