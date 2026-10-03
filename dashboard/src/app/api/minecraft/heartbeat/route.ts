import { NextResponse } from 'next/server';
import { masterPool } from '@/lib/db';
import { getCurrencyName, normalizePlayerName, requireAddon } from '@/lib/minecraft';

export const dynamic = 'force-dynamic';

/**
 * POST /api/minecraft/heartbeat
 * アドオンが60秒ごと（と起動時）に送る生存通知。接続状況・オンラインのプレイヤー・アドオンのバージョンを記録し、
 * ダッシュボード側の設定（通貨名・売却価格など）を返す。
 * Body: { addon_version, server_name?, players: string[], max_players?, info?: { ... } }
 */
export async function POST(request: Request) {
  const auth = await requireAddon(request);
  if (!auth.ok) return auth.response;
  const { server, guildId, pool } = auth;

  const body = await request.json().catch(() => ({}));
  const players: string[] = Array.isArray(body?.players)
    ? body.players.map(normalizePlayerName).filter((n: string | null): n is string => !!n).slice(0, 200)
    : [];
  const addonVersion = typeof body?.addon_version === 'string' ? body.addon_version.slice(0, 32) : null;
  const serverName = typeof body?.server_name === 'string' ? body.server_name.slice(0, 100) : null;
  const maxPlayers = Number.isSafeInteger(body?.max_players) ? body.max_players : null;
  const info = body?.info && typeof body.info === 'object' && !Array.isArray(body.info) ? body.info : {};

  try {
    await masterPool.query(
      `UPDATE minecraft_servers SET
         addon_version = $2,
         server_name = COALESCE($3, server_name),
         online_players = $4::jsonb,
         max_players = $5,
         addon_info = $6::jsonb,
         last_heartbeat_at = NOW()
       WHERE guild_id = $1`,
      [guildId, addonVersion, serverName, JSON.stringify(players), maxPlayers, JSON.stringify(info).slice(0, 4000)]
    );
  } catch (e) {
    console.error('minecraft heartbeat update failed:', e);
    return NextResponse.json({ ok: false, error: '保存に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    guild_id: guildId,
    currency_name: await getCurrencyName(pool, guildId),
    features: { pay: server.allow_pay, sell: server.allow_sell, market: server.allow_market },
    sell_prices: server.sell_prices,
    join_leave_log: !!server.join_leave_channel_id,
  });
}
