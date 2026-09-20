import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { DiscordGuildMember, botRequest, memberAvatarUrl, memberDisplayName } from '@/lib/discordApi';
import { requireGuildMember } from '@/lib/memberAuth';
import { isBotTransferAllowed } from '@/lib/memberSettings';

export const dynamic = 'force-dynamic';

/**
 * GET /api/member/guilds/[guild_id]/members?q=名前
 * 送金先の候補検索。自分自身は除く。Botは「Botへの送金を許可する」設定がONのときだけ含める。
 */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, session } = access;

  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 32);
  if (!q) return NextResponse.json({ members: [] });

  try {
    const [found, allowBots] = await Promise.all([
      botRequest<DiscordGuildMember[]>(
        `/guilds/${guildId}/members/search?query=${encodeURIComponent(q)}&limit=10`
      ),
      getPool(guildId).then((pool) => isBotTransferAllowed(pool, guildId)),
    ]);
    const members = found
      .filter((m) => m.user.id !== session.discord_id && (allowBots || !m.user.bot))
      .map((m) => ({
        id: m.user.id,
        display_name: memberDisplayName(m),
        username: m.user.username,
        avatar_url: memberAvatarUrl(guildId, m),
        is_bot: !!m.user.bot,
      }));
    return NextResponse.json({ members });
  } catch (error) {
    console.error('member search error:', error);
    return NextResponse.json({ error: 'メンバー検索に失敗しました' }, { status: 502 });
  }
}
