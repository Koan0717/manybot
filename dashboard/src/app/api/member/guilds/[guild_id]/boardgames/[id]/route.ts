import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireGuildMember } from '@/lib/memberAuth';
import { CasinoError } from '@/lib/casino/db';
import { ensureBoardGameTable, expireGames, gameAction, getGame } from '@/lib/boardgames/web';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/member/guilds/[guild_id]/boardgames/[id]  対局の今の状態（相手の番のあいだ画面が数秒ごとに取りに来る）
 * POST /api/member/guilds/[guild_id]/boardgames/[id]  { action: 'move', move } / 'resign' / 'accept' / 'decline' / 'cancel'
 * 操作できるのは対局者本人だけ。始まった対局は、途中でゲームがOFFにされても最後まで指せる。
 */
export async function GET(request: Request, { params }: { params: { guild_id: string; id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  try {
    const pool = await getPool(access.guildId);
    await ensureBoardGameTable(pool);
    await expireGames(pool, access.guildId);
    return NextResponse.json({ game: await getGame(pool, access.guildId, access.session.discord_id, params.id) });
  } catch (e: any) {
    if (e instanceof CasinoError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('boardgame get failed:', e);
    return NextResponse.json({ error: '対局の情報を取得できませんでした' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { guild_id: string; id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const body = await request.json().catch(() => null);
  try {
    const pool = await getPool(access.guildId);
    await ensureBoardGameTable(pool);
    const game = await gameAction(pool, access.guildId, access.session.discord_id, params.id, body);
    return NextResponse.json({ success: true, game });
  } catch (e: any) {
    if (e instanceof CasinoError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e?.code === '22003') return NextResponse.json({ error: '所持金の上限を超えるため精算できません' }, { status: 400 });
    console.error('boardgame action failed:', e);
    return NextResponse.json({ error: '操作の処理中にエラーが発生しました' }, { status: 500 });
  }
}
