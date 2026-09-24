import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireGuildMember } from '@/lib/memberAuth';
import { ensureCasinoTables } from '@/lib/casino/db';
import { WEB_GAMES, loadCasinoSettings } from '@/lib/casino/settings';
import { canUseFeature, getMemberFlags } from '@/lib/webAccess';

export const dynamic = 'force-dynamic';

/**
 * GET /api/member/guilds/[guild_id]/casino/stats
 * 本人の戦績（Bot の「📊 自分の戦績」と同じ user_game_stats）。Discordのパネルで遊んだ分も含む。
 * Web で遊べるゲームのうち、ギャンブル設定で戦績表示がOFFでないものだけ返す。
 */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, session, member } = access;

  try {
    const pool = await getPool(guildId);
    const s = await loadCasinoSettings(pool, guildId);
    const allowed = canUseFeature(await getMemberFlags(pool, guildId, member), 'casino');
    const games = WEB_GAMES.filter((g) => allowed && s.enabled[g] && s.showStats[g]);
    await ensureCasinoTables(pool);
    const res = games.length
      ? await pool.query(
          `SELECT game_type, plays, wins, losses, draws, total_bet::text AS total_bet, total_payout::text AS total_payout,
                  net_profit::text AS net_profit, max_win::text AS max_win, extra_data
             FROM user_game_stats WHERE guild_id = $1 AND user_id = $2 AND game_type = ANY($3)`,
          [guildId, session.discord_id, games]
        )
      : { rows: [] as any[] };
    const byGame = new Map(res.rows.map((r) => [r.game_type, r]));

    return NextResponse.json({
      stats: Object.fromEntries(
        games.map((g) => {
          const r = byGame.get(g);
          let extra: Record<string, number> = {};
          if (r?.extra_data && typeof r.extra_data === 'object') extra = r.extra_data;
          else if (typeof r?.extra_data === 'string') {
            try {
              extra = JSON.parse(r.extra_data);
            } catch {}
          }
          return [
            g,
            {
              plays: Number(r?.plays) || 0,
              wins: Number(r?.wins) || 0,
              losses: Number(r?.losses) || 0,
              draws: Number(r?.draws) || 0,
              total_bet: Number(r?.total_bet) || 0,
              total_payout: Number(r?.total_payout) || 0,
              net_profit: Number(r?.net_profit) || 0,
              max_win: Number(r?.max_win) || 0,
              extra,
            },
          ];
        })
      ),
    });
  } catch (e) {
    console.error('casino stats failed:', e);
    return NextResponse.json({ error: '戦績を取得できませんでした' }, { status: 500 });
  }
}
