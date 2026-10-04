import { NextResponse } from 'next/server';
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

/**
 * POST /api/minecraft/sell  { player, item: "minecraft:diamond", count }
 * ゲーム内の /manybot:sell。手に持ったアイテムを、ダッシュボードで設定した売却価格で鯖内通貨に換える。
 * 価格はサーバー側の設定だけを使う（アドオンから金額は受け取らない）。
 * アドオンは先にアイテムを消し、ここが失敗したら返却する。
 */
export async function POST(request: Request) {
  const auth = await requireAddon(request);
  if (!auth.ok) return auth.response;
  const { server, guildId, pool } = auth;
  if (!server.allow_sell) return addonError('このサーバーではアイテム売却がOFFになっています', 403);

  const body = await request.json().catch(() => ({}));
  const player = normalizePlayerName(body?.player);
  const item = typeof body?.item === 'string' ? body.item.trim().toLowerCase() : '';
  const count = body?.count;
  if (!player) return addonError('プレイヤー名が不正です', 400);
  if (!item) return addonError('アイテムが指定されていません', 400);
  if (!Number.isSafeInteger(count) || count < 1 || count > 64 * 36) return addonError('個数が不正です', 400);

  const entry = server.sell_prices.find((p) => p.item.toLowerCase() === item);
  if (!entry || !(entry.price > 0)) return addonError('このアイテムは売却できません', 400);
  const earned = entry.price * count;
  if (!Number.isSafeInteger(earned) || earned > MAX_MC_AMOUNT) return addonError('売却額が大きすぎます', 400);

  const link = await findLinkByName(pool, guildId, player);
  if (!link) return addonError('まだDiscordと連携していません（/manybot:link）', 400);

  const client = await pool.connect();
  let balance: number | null;
  try {
    await client.query('BEGIN');
    balance = await applyBalanceChange(client, {
      guildId, userId: link.user_id, mcName: link.mc_name, kind: 'sell', amount: earned, detail: `${item} x${count}`,
    });
    await client.query('COMMIT');
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (e?.code === '22003') return addonError('所持金が上限を超えるため売却できません', 400);
    console.error('minecraft sell failed:', e);
    return addonError('売却に失敗しました', 500);
  } finally {
    client.release();
  }

  const currency_name = await getCurrencyName(pool, guildId);
  await sendTradeLog(server, {
    title: '🪙 アイテム売却',
    description: `**${link.mc_name}** (<@${link.user_id}>) が \`${item}\` x${count} を売却しました`,
    fields: [{ name: '受け取り', value: `${earned.toLocaleString()} ${currency_name}`, inline: true }],
  });

  return NextResponse.json({ ok: true, earned, unit_price: entry.price, balance, currency_name });
}
