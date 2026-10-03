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
 * POST /api/minecraft/adjust  { player, amount, reason }
 * ゲーム内のショップ・クエスト報酬など、アドオン（や他のスクリプト）から残高を直接増減する。
 * amount が負なら支払い。残高が足りなければ失敗する（マイナスにはならない）。
 */
export async function POST(request: Request) {
  const auth = await requireAddon(request);
  if (!auth.ok) return auth.response;
  const { server, guildId, pool } = auth;

  const body = await request.json().catch(() => ({}));
  const player = normalizePlayerName(body?.player);
  const amount = body?.amount;
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 100) : null;
  if (!player) return addonError('プレイヤー名が不正です', 400);
  if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > MAX_MC_AMOUNT) {
    return addonError('金額が不正です', 400);
  }

  const link = await findLinkByName(pool, guildId, player);
  if (!link) return addonError('まだDiscordと連携していません（/manybot:link）', 400);

  const client = await pool.connect();
  let balance: number | null;
  try {
    await client.query('BEGIN');
    balance = await applyBalanceChange(client, {
      guildId, userId: link.user_id, mcName: link.mc_name, kind: 'adjust', amount, detail: reason,
    });
    if (balance === null) {
      await client.query('ROLLBACK');
      return addonError('残高が不足しています', 400);
    }
    await client.query('COMMIT');
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (e?.code === '22003') return addonError('所持金が上限を超えます', 400);
    console.error('minecraft adjust failed:', e);
    return addonError('残高の変更に失敗しました', 500);
  } finally {
    client.release();
  }

  const currency_name = await getCurrencyName(pool, guildId);
  await sendTradeLog(server, {
    title: amount > 0 ? '➕ マイクラ内で獲得' : '➖ マイクラ内で支払い',
    description: `**${link.mc_name}** (<@${link.user_id}>)${reason ? `\n理由: ${reason}` : ''}`,
    color: amount > 0 ? 0x22c55e : 0xf59e0b,
    fields: [{ name: '金額', value: `${amount > 0 ? '+' : ''}${amount.toLocaleString()} ${currency_name}`, inline: true }],
  });

  return NextResponse.json({ ok: true, amount, balance, currency_name });
}
