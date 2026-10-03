import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { DiscordApiError, DiscordGuildMember, DiscordRole, botRequest, userAvatarUrl } from '@/lib/discordApi';
import { discordStatusOf, ensureMinecraftGuildSchema, getMinecraftServer, saveDiscordStatus } from '@/lib/minecraft';

export const dynamic = 'force-dynamic';

/**
 * GET /api/guilds/[guild_id]/minecraft/members
 * マイクラメンバー一覧。連携済みプレイヤーごとに、Discordアカウントが今もサーバーにいるか・ロール・運営か・
 * OPの反映状況・最終ログインを、Discordから取り直して返す（取り直した内容は保存する）。
 * あわせて、ワールドに来たことがあるのに連携していないプレイヤーも返す。
 */
export async function GET(_request: Request, { params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  try {
    const pool = await getPool(guildId);
    await ensureMinecraftGuildSchema(pool);
    const [server, linksRes, lastSeenRes, roles] = await Promise.all([
      getMinecraftServer(guildId),
      pool.query(
        `SELECT user_id::text AS user_id, mc_name, linked_at, discord_name, role_names, is_staff, in_guild,
                roles_checked_at, op_status, op_reported_at
         FROM minecraft_links WHERE guild_id = $1 ORDER BY lower(mc_name) LIMIT 300`,
        [guildId]
      ),
      pool.query(
        `SELECT lower(mc_name) AS name_lower, MAX(mc_name) AS mc_name, MAX(created_at) AS last_seen
         FROM minecraft_events WHERE guild_id = $1 AND kind = 'join' GROUP BY lower(mc_name)`,
        [guildId]
      ),
      botRequest<DiscordRole[]>(`/guilds/${guildId}/roles`).catch(() => undefined),
    ]);
    const lastSeen = new Map(lastSeenRes.rows.map((r) => [r.name_lower, r.last_seen]));
    const online = new Set((server?.online_players ?? []).map((n) => n.toLowerCase()));

    // Discordのレート制限に当たらないよう、5件ずつ取り直す
    const rows = linksRes.rows;
    const members: any[] = [];
    for (let i = 0; i < rows.length; i += 5) {
      const chunk = await Promise.all(
        rows.slice(i, i + 5).map(async (l) => {
          let avatar: string | null = null;
          let username: string | null = null;
          let checkError = false;
          try {
            const m = await botRequest<DiscordGuildMember>(`/guilds/${guildId}/members/${l.user_id}`);
            const st = await discordStatusOf(guildId, m, roles);
            await saveDiscordStatus(pool, guildId, l.user_id, st);
            Object.assign(l, st);
            avatar = userAvatarUrl(m.user);
            username = m.user.username;
          } catch (e) {
            if (e instanceof DiscordApiError && e.status === 404) {
              const st = { in_guild: false, is_staff: false, discord_name: null, role_names: [] };
              await saveDiscordStatus(pool, guildId, l.user_id, st);
              Object.assign(l, { in_guild: false, is_staff: false, role_names: [] });
            } else {
              checkError = true; // 取れなかったときは前回保存した内容のまま
            }
          }
          return {
            user_id: l.user_id,
            mc_name: l.mc_name,
            linked_at: l.linked_at,
            discord_name: l.discord_name,
            username,
            avatar_url: avatar,
            role_names: Array.isArray(l.role_names) ? l.role_names : [],
            is_staff: !!l.is_staff,
            in_guild: l.in_guild !== false,
            check_error: checkError,
            op_status: l.op_status,
            op_reported_at: l.op_reported_at,
            online: online.has(l.mc_name.toLowerCase()),
            last_seen: lastSeen.get(l.mc_name.toLowerCase()) ?? null,
          };
        })
      );
      members.push(...chunk);
    }

    const linkedNames = new Set(rows.map((l) => l.mc_name.toLowerCase()));
    const unlinked = lastSeenRes.rows
      .filter((r) => !linkedNames.has(r.name_lower))
      .map((r) => ({ mc_name: r.mc_name, last_seen: r.last_seen, online: online.has(r.name_lower) }))
      .sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime());
    // 一度も参加ログが無くても、今オンラインなら未連携として出す
    for (const name of server?.online_players ?? []) {
      const lower = name.toLowerCase();
      if (!linkedNames.has(lower) && !unlinked.some((u) => u.mc_name.toLowerCase() === lower)) {
        unlinked.unshift({ mc_name: name, last_seen: null, online: true });
      }
    }

    return NextResponse.json({ members, unlinked });
  } catch (error: any) {
    console.error('GET minecraft members failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
