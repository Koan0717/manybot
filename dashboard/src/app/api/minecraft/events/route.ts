import { NextResponse } from 'next/server';
import { masterPool } from '@/lib/db';
import {
  addonError,
  findLinkByName,
  getBalance,
  getCurrencyName,
  normalizePlayerName,
  postToChannel,
  requireAddon,
} from '@/lib/minecraft';

export const dynamic = 'force-dynamic';

/**
 * POST /api/minecraft/events  { type: "join" | "leave", player: "<ゲーマータグ>" }
 * ワールドへの参加・退出。ダッシュボードで設定した「入退出ログチャンネル」に送信し、履歴に残す。
 * 参加時は連携済みなら残高も返す（アドオンが参加メッセージで表示する）。
 */
export async function POST(request: Request) {
  const auth = await requireAddon(request);
  if (!auth.ok) return auth.response;
  const { server, guildId, pool } = auth;

  const body = await request.json().catch(() => ({}));
  const type = body?.type;
  const player = normalizePlayerName(body?.player);
  if (type !== 'join' && type !== 'leave') return addonError('type は join か leave です', 400);
  if (!player) return addonError('プレイヤー名が不正です', 400);

  const link = await findLinkByName(pool, guildId, player).catch(() => null);

  await Promise.all([
    pool
      .query('INSERT INTO minecraft_events (guild_id, kind, mc_name) VALUES ($1, $2, $3)', [guildId, type, player])
      .catch((e) => console.error('minecraft event insert failed:', e)),
    masterPool
      .query('UPDATE minecraft_servers SET last_event_at = NOW() WHERE guild_id = $1', [guildId])
      .catch(() => {}),
  ]);

  const online = Array.isArray(body?.online) ? body.online.length : null;
  const join = type === 'join';
  await postToChannel(server.join_leave_channel_id, {
    embeds: [
      {
        author: { name: player },
        description: join
          ? `🟢 **${player}** がワールドに参加しました${link ? `（<@${link.user_id}>）` : ''}`
          : `🔴 **${player}** がワールドから退出しました${link ? `（<@${link.user_id}>）` : ''}`,
        color: join ? 0x22c55e : 0xef4444,
        timestamp: new Date().toISOString(),
        footer: {
          text: [server.server_name || 'Minecraft', online !== null ? `オンライン ${online}人` : null].filter(Boolean).join(' ・ '),
        },
      },
    ],
  });

  if (join && link) {
    const [balance, currency] = await Promise.all([
      getBalance(pool, guildId, link.user_id).catch(() => null),
      getCurrencyName(pool, guildId),
    ]);
    return NextResponse.json({ ok: true, linked: true, balance, currency_name: currency });
  }
  return NextResponse.json({ ok: true, linked: !!link });
}
