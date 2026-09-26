import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireGuildMember } from '@/lib/memberAuth';
import { consumeJoinIntent, ensureBoardGameTable } from '@/lib/boardgames/web';

export const dynamic = 'force-dynamic';

/**
 * GET /api/member/guilds/[guild_id]/boardgames/join
 * 招待の「アクティビティで参加」ボタンを押してアクティビティが起動したとき、どの対局を開くか（5分以内・1回だけ）。
 */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  try {
    const pool = await getPool(access.guildId);
    await ensureBoardGameTable(pool);
    return NextResponse.json({ game_id: await consumeJoinIntent(pool, access.guildId, access.session.discord_id) });
  } catch (e) {
    console.error('boardgame join intent failed:', e);
    return NextResponse.json({ game_id: null });
  }
}
