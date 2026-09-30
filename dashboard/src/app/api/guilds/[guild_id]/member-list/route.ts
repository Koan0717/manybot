import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { DiscordGuildMember, DiscordRole, botRequest, memberAvatarUrl, memberDisplayName } from '@/lib/discordApi';

export const dynamic = 'force-dynamic';

/** サーバーの全メンバー（Botは除く）。1回 1000 人ずつ取る */
async function fetchAllMembers(guildId: string): Promise<DiscordGuildMember[]> {
  const all: DiscordGuildMember[] = [];
  let after = '0';
  for (let i = 0; i < 100; i++) {
    const page = await botRequest<DiscordGuildMember[]>(`/guilds/${guildId}/members?limit=1000&after=${after}`);
    all.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  return all.filter((m) => !m.user.bot);
}

/**
 * GET /api/guilds/[guild_id]/member-list
 * メンバー一覧（名前・ID・ロール・残高・VC/TCレベル）。残高の多い順。
 */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  try {
    const pool = await getPool(guildId);
    const [members, roles, users, cur] = await Promise.all([
      fetchAllMembers(guildId),
      botRequest<DiscordRole[]>(`/guilds/${guildId}/roles`),
      pool.query(
        `SELECT user_id::text AS user_id, COALESCE(balance, 0)::text AS balance,
                COALESCE(vc_level, 1) AS vc_level, COALESCE(tc_level, 1) AS tc_level
           FROM users WHERE guild_id = $1`,
        [guildId]
      ),
      pool
        .query("SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = 'CURRENCY_NAME'", [guildId])
        .catch(() => ({ rows: [] as any[] })),
    ]);

    const stats = new Map(users.rows.map((r) => [r.user_id, r]));
    // ロールは上位（Discordの並び順が上）から。@everyone は出さない
    const roleMap = new Map(roles.filter((r) => r.id !== guildId).map((r) => [r.id, r]));

    const rows = members.map((m) => {
      const s = stats.get(m.user.id);
      const memberRoles = m.roles
        .map((id) => roleMap.get(id))
        .filter((r): r is DiscordRole => !!r)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.color }));
      return {
        id: m.user.id,
        display_name: memberDisplayName(m),
        username: m.user.username,
        avatar_url: memberAvatarUrl(guildId, m),
        roles: memberRoles,
        balance: s ? Number(s.balance) : 0,
        vc_level: s ? Number(s.vc_level) : 1,
        tc_level: s ? Number(s.tc_level) : 1,
      };
    });
    rows.sort((a, b) => b.balance - a.balance || b.vc_level - a.vc_level || b.tc_level - a.tc_level);

    const currency = String(cur.rows[0]?.setting_value ?? '').replace(/^"|"$/g, '') || 'コイン';
    return NextResponse.json({ currency_name: currency, members: rows });
  } catch (e: any) {
    console.error('member-list failed:', e);
    const msg = e?.status === 403 ? 'Botにメンバー一覧を読む権限がありません（Server Members Intent を確認してください）' : 'メンバー一覧を取得できませんでした';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
