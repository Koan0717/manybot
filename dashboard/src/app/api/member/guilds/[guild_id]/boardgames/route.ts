import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireGuildMember } from '@/lib/memberAuth';
import { CasinoError } from '@/lib/casino/db';
import { canUseFeature, getMemberFlags } from '@/lib/webAccess';
import {
  BOARD_GAMES,
  BOARD_GAME_LABEL,
  createAiGame,
  createInvite,
  ensureBoardGameTable,
  expireGames,
  isBoardGame,
  listGames,
  loadBoardGameSettings,
  voicePeers,
} from '@/lib/boardgames/web';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/member/guilds/[guild_id]/boardgames
 *   遊べるゲーム（Webアクティビティ設定でONのもの）と、自分の対局・届いた招待。
 * POST /api/member/guilds/[guild_id]/boardgames
 *   { action: 'ai', game, level, bet? }     AI対戦を始める
 *   { action: 'invite', game, opponent_id } メンバーに対局を申し込む
 */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, session, member } = access;
  try {
    const pool = await getPool(guildId);
    const s = await loadBoardGameSettings(pool, guildId);
    const allowed = canUseFeature(await getMemberFlags(pool, guildId, member), 'games');
    const games = BOARD_GAMES.filter((g) => allowed && s.enabled[g]);
    await ensureBoardGameTable(pool);
    await expireGames(pool, guildId);
    const mine = await listGames(pool, guildId, session.discord_id);
    // アクティビティを通話で開いているときは、その通話にいる人（すぐ申し込めるように）
    const channelId = new URL(request.url).searchParams.get('channel_id');
    const peers = channelId ? await voicePeers(pool, guildId, channelId, session.discord_id) : [];
    // ゲームがOFFでも、始めてしまった対局は最後まで遊べるようにする
    if (!games.length && !mine.some((g) => g.status === 'active')) return NextResponse.json({ enabled: false });
    return NextResponse.json({
      enabled: true,
      currency_name: s.currencyName,
      games: games.map((g) => ({ key: g, label: BOARD_GAME_LABEL[g], bet_enabled: s.bet[g].enabled, ai_mult: s.bet[g].aiMult })),
      mine,
      voice_peers: peers,
    });
  } catch (e) {
    console.error('boardgames list failed:', e);
    return NextResponse.json({ error: 'ゲームの情報を取得できませんでした' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, session, member } = access;
  const body = await request.json().catch(() => null);
  try {
    const pool = await getPool(guildId);
    const s = await loadBoardGameSettings(pool, guildId);
    const game = body?.game;
    if (!isBoardGame(game) || !s.enabled[game]) return NextResponse.json({ error: 'このゲームは現在Webでは遊べません' }, { status: 403 });
    if (!canUseFeature(await getMemberFlags(pool, guildId, member), 'games')) {
      return NextResponse.json({ error: 'ゲームは現在利用できません' }, { status: 403 });
    }
    await ensureBoardGameTable(pool);
    const view =
      body?.action === 'ai'
        ? await createAiGame(pool, s, guildId, session.discord_id, game, body?.level, body?.bet)
        : body?.action === 'invite'
          ? await createInvite(pool, s, guildId, session.discord_id, game, body?.opponent_id, body?.bet)
          : null;
    if (!view) return NextResponse.json({ error: '操作が不正です' }, { status: 400 });
    return NextResponse.json({ success: true, game: view });
  } catch (e: any) {
    if (e instanceof CasinoError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('boardgames create failed:', e);
    return NextResponse.json({ error: 'ゲームを始められませんでした' }, { status: 500 });
  }
}
