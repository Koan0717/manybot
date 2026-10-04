import { NextResponse } from 'next/server';
import {
  ITEM_TYPE_ID,
  MAX_LISTINGS_PER_PLAYER,
  MAX_LISTING_QUANTITY,
  MAX_MC_AMOUNT,
  addonError,
  findLinkByName,
  getCurrencyName,
  normalizePlayerName,
  requireAddon,
  sendTradeLog,
} from '@/lib/minecraft';

export const dynamic = 'force-dynamic';

/**
 * POST /api/minecraft/market/list  { player, item, name_key?, quantity, unit_price }
 * 出品する。アイテムはアドオンが先にインベントリから預かっており、ここが失敗したら返却する。
 * 代金は売れたときに出品者の残高（鯖内通貨）に入るので、出品者は連携済みである必要がある。
 */
export async function POST(request: Request) {
  const auth = await requireAddon(request);
  if (!auth.ok) return auth.response;
  const { server, guildId, pool } = auth;
  if (!server.allow_market) return addonError('このサーバーではマーケットがOFFになっています', 403);

  const body = await request.json().catch(() => ({}));
  const player = normalizePlayerName(body?.player);
  const item = typeof body?.item === 'string' ? body.item.trim().toLowerCase() : '';
  const nameKey = typeof body?.name_key === 'string' && /^[\w.:\-]{1,120}$/.test(body.name_key) ? body.name_key : null;
  const quantity = body?.quantity;
  const unitPrice = body?.unit_price;
  if (!player) return addonError('プレイヤー名が不正です', 400);
  if (!ITEM_TYPE_ID.test(item)) return addonError('アイテムが不正です', 400);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_LISTING_QUANTITY) return addonError('個数が不正です', 400);
  if (!Number.isSafeInteger(unitPrice) || unitPrice < 1 || unitPrice > MAX_MC_AMOUNT) {
    return addonError(`値段は1〜${MAX_MC_AMOUNT.toLocaleString()}の整数で指定してください`, 400);
  }

  const link = await findLinkByName(pool, guildId, player);
  if (!link) return addonError('出品するにはDiscordとの連携が必要です（/manybot:link）', 400);

  try {
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM minecraft_listings WHERE guild_id = $1 AND seller_user_id = $2', [
      guildId,
      link.user_id,
    ]);
    if (count.rows[0].n >= MAX_LISTINGS_PER_PLAYER) {
      return addonError(`出品できるのは${MAX_LISTINGS_PER_PLAYER}件までです。売れ残りを取り下げてください`, 400);
    }
    const r = await pool.query(
      `INSERT INTO minecraft_listings (guild_id, seller_user_id, seller_mc_name, item, name_key, quantity, unit_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
      [guildId, link.user_id, link.mc_name, item, nameKey, quantity, unitPrice]
    );
    const currency_name = await getCurrencyName(pool, guildId);
    await sendTradeLog(server, {
      title: '🏷️ マーケットに出品',
      description: `**${link.mc_name}** (<@${link.user_id}>) が \`${item}\` x${quantity} を出品しました`,
      color: 0x8b5cf6,
      fields: [{ name: '値段', value: `1個 ${unitPrice.toLocaleString()} ${currency_name}`, inline: true }],
    });
    return NextResponse.json({ ok: true, listing_id: r.rows[0].id, currency_name });
  } catch (e) {
    console.error('minecraft market list create failed:', e);
    return addonError('出品に失敗しました', 500);
  }
}
