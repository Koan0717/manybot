import { NextResponse } from 'next/server';
import { addonError, findLinkByName, normalizePlayerName, requireAddon } from '@/lib/minecraft';

export const dynamic = 'force-dynamic';

/**
 * POST /api/minecraft/market/cancel  { player, listing_id }
 * 自分の出品を取り下げる。売れ残っていた分（item / quantity）を返すので、アドオンがそれをインベントリに戻す。
 */
export async function POST(request: Request) {
  const auth = await requireAddon(request);
  if (!auth.ok) return auth.response;
  const { guildId, pool } = auth;

  const body = await request.json().catch(() => ({}));
  const player = normalizePlayerName(body?.player);
  const listingId = typeof body?.listing_id === 'string' && /^\d{1,18}$/.test(body.listing_id) ? body.listing_id : null;
  if (!player || !listingId) return addonError('リクエストが不正です', 400);

  const link = await findLinkByName(pool, guildId, player);
  if (!link) return addonError('Discordと連携していません', 400);

  try {
    const r = await pool.query(
      `DELETE FROM minecraft_listings WHERE guild_id = $1 AND id = $2 AND seller_user_id = $3 RETURNING item, quantity`,
      [guildId, listingId, link.user_id]
    );
    if (!r.rows[0]) return addonError('その出品は見つかりません（すでに売り切れたかもしれません）', 404);
    return NextResponse.json({ ok: true, item: r.rows[0].item, quantity: Number(r.rows[0].quantity) });
  } catch (e) {
    console.error('minecraft market cancel failed:', e);
    return addonError('取り下げに失敗しました', 500);
  }
}
