import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { DiscordGuildSummary, DiscordRole, botRequest, memberAvatarUrl, memberDisplayName } from '@/lib/discordApi';
import { requireGuildMember } from '@/lib/memberAuth';
import { isBotTransferAllowed } from '@/lib/memberSettings';
import { getRoleGrantDates, getShopRoleSources, loadRoleKinds, roleKind } from '@/lib/memberRoles';

export const dynamic = 'force-dynamic';

// database.get_next_level_xp と同じ式（XPはレベルアップごとに繰り越し形式で保存されている）
const nextLevelXp = (level: number) => Math.floor(100 * Math.pow(level, 1.2) + 100);

function parseSetting(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const v = JSON.parse(raw);
    return typeof v === 'string' || typeof v === 'number' ? String(v) : raw;
  } catch {
    return raw;
  }
}

/**
 * GET /api/member/guilds/[guild_id]/profile
 * ログイン中のメンバー本人の、そのサーバーでのプロフィール（通貨・レベル）と役職を返す。
 * 対象ユーザーは必ずセッションのDiscord IDで、URLやクエリからは受け取らない。
 */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, member, session } = access;

  try {
    const pool = await getPool(guildId);
    const [userRes, currencyRes, guild, roles, allowBotTransfer] = await Promise.all([
      pool.query('SELECT * FROM users WHERE guild_id = $1 AND user_id = $2', [guildId, session.discord_id]),
      pool.query("SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = 'CURRENCY_NAME'", [guildId]),
      botRequest<DiscordGuildSummary>(`/guilds/${guildId}`),
      botRequest<DiscordRole[]>(`/guilds/${guildId}/roles`),
      isBotTransferAllowed(pool, guildId),
    ]);

    const row = userRes.rows[0] ?? {};
    const tcLevel = Number(row.tc_level ?? 1);
    const vcLevel = Number(row.vc_level ?? 1);

    const memberRoleIds = new Set(member.roles);
    const held = roles.filter((r) => memberRoleIds.has(r.id));
    // 付与日・種類（仮メン・準メン・本メン・評価落ち）。取れなくてもプロフィール自体は返す
    const [kinds, dates, shopRoles] = await Promise.all([
      loadRoleKinds(pool, guildId, roles).catch((e) => {
        console.error('loadRoleKinds failed:', e);
        return null;
      }),
      getRoleGrantDates(pool, guildId, session.discord_id, held.map((r) => r.id)).catch((e) => {
        console.error('getRoleGrantDates failed:', e);
        return new Map<string, Date>();
      }),
      getShopRoleSources(pool, guildId, session.discord_id).catch((e) => {
        console.error('getShopRoleSources failed:', e);
        return new Map<string, { item_name: string; purchased_at: Date | null }>();
      }),
    ]);
    const memberRoles = held
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
        granted_at: (dates.get(r.id) ?? shopRoles.get(r.id)?.purchased_at)?.toISOString() ?? null,
        kind: kinds ? roleKind(kinds, r.id) : null,
        // ショップで購入して付いたロールなら、その商品名
        shop_item: shopRoles.get(r.id)?.item_name ?? null,
      }));

    return NextResponse.json({
      guild: { id: guild.id, name: guild.name, icon: guild.icon ?? null },
      member: {
        id: session.discord_id,
        display_name: memberDisplayName(member),
        avatar_url: memberAvatarUrl(guildId, member),
        joined_at: member.joined_at ?? null,
      },
      currency_name: parseSetting(currencyRes.rows[0]?.setting_value) ?? 'コイン',
      allow_bot_transfer: allowBotTransfer,
      stats: {
        balance: Number(row.balance ?? 0),
        event_points: Number(row.event_points ?? 0),
        tc: { level: tcLevel, xp: Number(row.tc_xp ?? 0), next_xp: nextLevelXp(tcLevel) },
        vc: { level: vcLevel, xp: Number(row.vc_xp ?? 0), next_xp: nextLevelXp(vcLevel) },
      },
      roles: memberRoles,
    });
  } catch (error) {
    console.error('member profile error:', error);
    return NextResponse.json({ error: 'プロフィールの取得に失敗しました' }, { status: 500 });
  }
}
