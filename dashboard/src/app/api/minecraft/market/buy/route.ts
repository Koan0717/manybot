import { NextResponse } from 'next/server';
import { ensureTransferLogsTable, recordTransfer } from '@/lib/transferLogs';
import {
  MAX_MC_AMOUNT,
  addonError,
  applyBalanceChange,
  findLinkByName,
  getCurrencyName,
  normalizePlayerName,
  requireAddon,
  sendTradeLog,
} from '@/lib/minecraft';

export const dynamic = 'force-dynamic';

class BuyError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * POST /api/minecraft/market/buy  { player, listing_id, quantity, unit_price }
 * 出品を買う。買い手の残高（鯖内通貨）から代金を引いて出品者に入れ、出品の在庫を減らす（1つのトランザクション）。
 * unit_price は画面に出ていた値段。出品者が出し直して値段が変わっていたら買わない。
 * 成功したら item / quantity を返すので、アドオンが買い手にアイテムを渡す。
 */
export async function POST(request: Request) {
  const auth = await requireAddon(request);
  if (!auth.ok) return auth.response;
  const { server, guildId, pool } = auth;
  if (!server.allow_market) return addonError('このサーバーではマーケットがOFFになっています', 403);

  const body = await request.json().catch(() => ({}));
  const player = normalizePlayerName(body?.player);
  const listingId = typeof body?.listing_id === 'string' && /^\d{1,18}$/.test(body.listing_id) ? body.listing_id : null;
  const quantity = body?.quantity;
  if (!player || !listingId) return addonError('リクエストが不正です', 400);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return addonError('個数が不正です', 400);

  const buyer = await findLinkByName(pool, guildId, player);
  if (!buyer) return addonError('購入するにはDiscordとの連携が必要です（/manybot:link）', 400);

  await ensureTransferLogsTable(pool).catch((e) => console.error('ensureTransferLogsTable failed:', e));

  const client = await pool.connect();
  let result: { item: string; seller_user_id: string; seller_mc_name: string; total: number; unit_price: number; balance: number; left: number };
  try {
    await client.query('BEGIN');
    const l = await client.query(
      `SELECT item, quantity, unit_price::text AS unit_price, seller_user_id::text AS seller_user_id, seller_mc_name
       FROM minecraft_listings WHERE guild_id = $1 AND id = $2 FOR UPDATE`,
      [guildId, listingId]
    );
    const listing = l.rows[0];
    if (!listing) throw new BuyError('その出品はもうありません（売り切れか取り下げ）', 404);
    const unitPrice = Number(listing.unit_price);
    if (body?.unit_price !== undefined && body.unit_price !== unitPrice) throw new BuyError('値段が変わっています。もう一度開き直してください', 409);
    if (listing.seller_user_id === buyer.user_id) throw new BuyError('自分の出品は買えません（取り下げは「自分の出品」から）');
    if (quantity > listing.quantity) throw new BuyError(`在庫が足りません（残り${listing.quantity}個）`, 409);
    const total = unitPrice * quantity;
    if (!Number.isSafeInteger(total) || total > MAX_MC_AMOUNT) throw new BuyError('合計金額が大きすぎます');

    // 送金と同じく、デッドロックしないよう user_id 昇順で行ロック
    await client.query('INSERT INTO users (guild_id, user_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING', [
      guildId,
      buyer.user_id,
      listing.seller_user_id,
    ]);
    await client.query('SELECT 1 FROM users WHERE guild_id = $1 AND user_id = ANY($2::bigint[]) ORDER BY user_id FOR UPDATE', [
      guildId,
      [buyer.user_id, listing.seller_user_id],
    ]);
    const detail = `${listing.item} x${quantity} @${unitPrice}`;
    const balance = await applyBalanceChange(client, {
      guildId, userId: buyer.user_id, mcName: buyer.mc_name, kind: 'market_buy', amount: -total, detail: `${detail} ← ${listing.seller_mc_name}`,
    });
    if (balance === null) throw new BuyError('残高が不足しています');
    await applyBalanceChange(client, {
      guildId, userId: listing.seller_user_id, mcName: listing.seller_mc_name, kind: 'market_sell', amount: total, detail: `${detail} → ${buyer.mc_name}`,
    });
    const left = listing.quantity - quantity;
    if (left > 0) {
      await client.query('UPDATE minecraft_listings SET quantity = $3, updated_at = NOW() WHERE guild_id = $1 AND id = $2', [guildId, listingId, left]);
    } else {
      await client.query('DELETE FROM minecraft_listings WHERE guild_id = $1 AND id = $2', [guildId, listingId]);
    }
    await recordTransfer(client, { guildId, senderId: buyer.user_id, receiverId: listing.seller_user_id, amount: total, source: 'minecraft' });
    await client.query('COMMIT');
    result = { item: listing.item, seller_user_id: listing.seller_user_id, seller_mc_name: listing.seller_mc_name, total, unit_price: unitPrice, balance, left };
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (e instanceof BuyError) return addonError(e.message, e.status);
    if (e?.code === '22003') return addonError('出品者の所持金が上限を超えるため購入できません', 400);
    console.error('minecraft market buy failed:', e);
    return addonError('購入に失敗しました', 500);
  } finally {
    client.release();
  }

  const currency_name = await getCurrencyName(pool, guildId);
  await sendTradeLog(server, {
    title: '🛒 マーケットで購入',
    description: `**${buyer.mc_name}** (<@${buyer.user_id}>) が **${result.seller_mc_name}** (<@${result.seller_user_id}>) から \`${result.item}\` x${quantity} を購入しました`,
    color: 0x8b5cf6,
    fields: [
      { name: '合計', value: `${result.total.toLocaleString()} ${currency_name}`, inline: true },
      { name: '1個', value: `${result.unit_price.toLocaleString()} ${currency_name}`, inline: true },
    ],
  });

  return NextResponse.json({
    ok: true,
    item: result.item,
    quantity,
    total: result.total,
    balance: result.balance,
    left: result.left,
    seller: result.seller_mc_name,
    currency_name,
  });
}
