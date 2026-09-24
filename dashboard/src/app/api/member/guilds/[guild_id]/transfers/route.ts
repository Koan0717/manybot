import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { DiscordGuildMember, DiscordUser, botRequest, memberDisplayName } from '@/lib/discordApi';
import { requireGuildMember } from '@/lib/memberAuth';
import { ensureTransferLogsTable } from '@/lib/transferLogs';

export const dynamic = 'force-dynamic';

const LIMIT = 20;

/** 相手の表示名。サーバーを抜けていればユーザー名、それも取れなければIDを出す */
async function resolveName(guildId: string, userId: string): Promise<string> {
  try {
    return memberDisplayName(await botRequest<DiscordGuildMember>(`/guilds/${guildId}/members/${userId}`));
  } catch {}
  try {
    const user = await botRequest<DiscordUser>(`/users/${userId}`);
    return user.global_name || user.username;
  } catch {}
  return userId;
}

/**
 * GET /api/member/guilds/[guild_id]/transfers
 * ログイン中の本人が関わった送金（送った・受け取った）の直近20件。
 * 対象はセッションのDiscord IDで固定し、他人の履歴は返さない。
 */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, session } = access;

  try {
    const pool = await getPool(guildId);
    await ensureTransferLogsTable(pool);
    const res = await pool.query(
      `SELECT id::text AS id, sender_id::text AS sender_id, receiver_id::text AS receiver_id,
              amount::text AS amount, source, created_at
         FROM transfer_logs
        WHERE guild_id = $1 AND (sender_id = $2 OR receiver_id = $2)
        ORDER BY created_at DESC, id DESC
        LIMIT ${LIMIT}`,
      [guildId, session.discord_id]
    );

    const counterpartIds = Array.from(
      new Set(res.rows.map((r) => (r.sender_id === session.discord_id ? r.receiver_id : r.sender_id)))
    );
    const names = new Map(
      await Promise.all(counterpartIds.map(async (id) => [id, await resolveName(guildId, id)] as const))
    );

    return NextResponse.json({
      transfers: res.rows.map((r) => {
        const sent = r.sender_id === session.discord_id;
        const counterpart = sent ? r.receiver_id : r.sender_id;
        return {
          id: r.id,
          direction: sent ? 'sent' : 'received',
          counterpart: { id: counterpart, display_name: names.get(counterpart) ?? counterpart },
          amount: Number(r.amount),
          source: r.source,
          created_at: new Date(r.created_at).toISOString(),
        };
      }),
    });
  } catch (e) {
    console.error('transfers history failed:', e);
    return NextResponse.json({ error: '送金履歴を取得できませんでした' }, { status: 500 });
  }
}
