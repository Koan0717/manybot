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

/**
 * POST /api/minecraft/pay  { from, to, amount }
 * ゲーム内の /manybot:pay。どちらも連携済みのプレイヤー同士で、鯖内通貨を送金する。
 * Discord の /pay・Webの送金と同じ users.balance を動かし、送金履歴（transfer_logs）にも残す。
 */
export async function POST(request: Request) {
  const auth = await requireAddon(request);
  if (!auth.ok) return auth.response;
  const { server, guildId, pool } = auth;
  if (!server.allow_pay) return addonError('このサーバーではゲーム内送金がOFFになっています', 403);

  const body = await request.json().catch(() => ({}));
  const from = normalizePlayerName(body?.from);
  const to = normalizePlayerName(body?.to);
  const amount = body?.amount;
  if (!from || !to) return addonError('プレイヤー名が不正です', 400);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_MC_AMOUNT) {
    return addonError(`金額は1〜${MAX_MC_AMOUNT.toLocaleString()}の整数で指定してください`, 400);
  }

  const [sender, receiver] = await Promise.all([findLinkByName(pool, guildId, from), findLinkByName(pool, guildId, to)]);
  if (!sender) return addonError('あなたはまだDiscordと連携していません（/manybot:link）', 400);
  if (!receiver) return addonError(`${to} はDiscordと連携していません`, 400);
  if (sender.user_id === receiver.user_id) return addonError('自分自身には送金できません', 400);

  await ensureTransferLogsTable(pool).catch((e) => console.error('ensureTransferLogsTable failed:', e));

  const client = await pool.connect();
  let senderBalance: number;
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO users (guild_id, user_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING', [
      guildId,
      sender.user_id,
      receiver.user_id,
    ]);
    // 双方向の同時送金でデッドロックしないよう、user_id 昇順で行ロックを取る
    await client.query(
      'SELECT 1 FROM users WHERE guild_id = $1 AND user_id = ANY($2::bigint[]) ORDER BY user_id FOR UPDATE',
      [guildId, [sender.user_id, receiver.user_id]]
    );
    const after = await applyBalanceChange(client, {
      guildId, userId: sender.user_id, mcName: sender.mc_name, kind: 'pay_out', amount: -amount, detail: `→ ${receiver.mc_name}`,
    });
    if (after === null) {
      await client.query('ROLLBACK');
      return addonError('残高が不足しています', 400);
    }
    senderBalance = after;
    await applyBalanceChange(client, {
      guildId, userId: receiver.user_id, mcName: receiver.mc_name, kind: 'pay_in', amount, detail: `← ${sender.mc_name}`,
    });
    await recordTransfer(client, { guildId, senderId: sender.user_id, receiverId: receiver.user_id, amount, source: 'minecraft' });
    await client.query('COMMIT');
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (e?.code === '22003') return addonError('相手の所持金が上限を超えるため送金できません', 400);
    console.error('minecraft pay failed:', e);
    return addonError('送金に失敗しました', 500);
  } finally {
    client.release();
  }

  const currency_name = await getCurrencyName(pool, guildId);
  await sendTradeLog(server, {
    title: '💸 マイクラ内送金',
    description: `**${sender.mc_name}** (<@${sender.user_id}>) → **${receiver.mc_name}** (<@${receiver.user_id}>)`,
    color: 0x3498db,
    fields: [{ name: '金額', value: `${amount.toLocaleString()} ${currency_name}`, inline: true }],
  });

  return NextResponse.json({ ok: true, amount, balance: senderBalance, currency_name, to: receiver.mc_name });
}
