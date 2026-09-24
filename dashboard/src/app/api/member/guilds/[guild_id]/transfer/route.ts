import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { DiscordApiError, DiscordGuildMember, botRequest, memberDisplayName } from '@/lib/discordApi';
import { isSnowflake, jsonError, requireGuildMember } from '@/lib/memberAuth';
import { isBotTransferAllowed } from '@/lib/memberSettings';
import { TransferSource, ensureTransferLogsTable, recordTransfer } from '@/lib/transferLogs';

// users.balance は INTEGER なので、それを超えない範囲に収める
const MAX_AMOUNT = 1_000_000_000;

class InsufficientBalance extends Error {}

function parseCurrencyName(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return 'コイン';
  try {
    const v = JSON.parse(raw);
    return typeof v === 'string' || typeof v === 'number' ? String(v) : raw;
  } catch {
    return raw;
  }
}

/**
 * POST /api/member/guilds/[guild_id]/transfer  { to: "<discord id>", amount: number, via?: "activity" | "web" }
 * /pay コマンド（cogs/economy.py → database.transfer_balance）と同じ仕様の送金。
 * 送金元は必ずセッションのDiscord ID。
 */
export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, session, member: senderMember } = access;

  const body = await request.json().catch(() => null);
  const to = body?.to;
  const amount = body?.amount;
  if (!isSnowflake(to)) return jsonError('送金先が不正です', 400);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
    return jsonError(`金額は1〜${MAX_AMOUNT.toLocaleString()}の整数で指定してください`, 400);
  }
  if (to === session.discord_id) return jsonError('自分自身には送金できません', 400);
  // どこから送金したか（ログ・履歴の表示用。クライアントの申告だが、金額や相手には影響しない）
  const source: TransferSource = body?.via === 'activity' ? 'activity' : 'web';

  let receiver: DiscordGuildMember;
  try {
    receiver = await botRequest<DiscordGuildMember>(`/guilds/${guildId}/members/${to}`);
  } catch (e) {
    if (e instanceof DiscordApiError && e.status === 404) {
      return jsonError('送金先がサーバー内に見つかりません', 400);
    }
    console.error('transfer receiver lookup failed:', e);
    return jsonError('Discordとの通信に失敗しました', 502);
  }

  const pool = await getPool(guildId);

  // ダッシュボードの「Botへの送金を許可する」設定（/pay と共通）。OFFならBot宛ては拒否
  if (receiver.user.bot) {
    try {
      if (!(await isBotTransferAllowed(pool, guildId))) {
        return jsonError('このサーバーではBotへの送金がOFFになっています', 403);
      }
    } catch (e) {
      console.error('bot transfer setting check failed:', e);
      return jsonError('設定の確認に失敗しました', 500);
    }
  }

  // サーバー側で /pay をOFFにしている場合はWebからも送金させない
  try {
    const cmd = await pool.query(
      "SELECT is_enabled FROM command_settings WHERE guild_id = $1 AND command_name IN ('pay', '/pay') ORDER BY is_enabled ASC LIMIT 1",
      [guildId]
    );
    if (cmd.rows.length > 0 && cmd.rows[0].is_enabled === false) {
      return jsonError('このサーバーでは送金がOFFになっています', 403);
    }
  } catch (e: any) {
    if (e?.code !== '42P01') console.error('command_settings check failed:', e);
  }

  try {
    await ensureTransferLogsTable(pool);
  } catch (e) {
    console.error('ensureTransferLogsTable failed:', e); // 履歴が残せないだけで送金はできる
  }

  const client = await pool.connect();
  let newBalance: number;
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO users (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guildId, to]);

    // 双方向の同時送金でデッドロックしないよう、user_id 昇順で行ロックを取る
    const locked = await client.query(
      'SELECT user_id::text AS uid, balance FROM users WHERE guild_id = $1 AND user_id = ANY($2::bigint[]) ORDER BY users.user_id FOR UPDATE',
      [guildId, [session.discord_id, to]]
    );
    const senderRow = locked.rows.find((r) => r.uid === session.discord_id);
    if (!senderRow || Number(senderRow.balance) < amount) throw new InsufficientBalance();

    const sent = await client.query(
      'UPDATE users SET balance = balance - $1 WHERE guild_id = $2 AND user_id = $3 RETURNING balance',
      [amount, guildId, session.discord_id]
    );
    await client.query('UPDATE users SET balance = balance + $1 WHERE guild_id = $2 AND user_id = $3', [amount, guildId, to]);
    await recordTransfer(client, { guildId, senderId: session.discord_id, receiverId: to, amount, source });
    await client.query('COMMIT');
    newBalance = Number(sent.rows[0].balance);
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (e instanceof InsufficientBalance) return jsonError('残高が不足しています', 400);
    if (e?.code === '22003') return jsonError('相手の所持金が上限を超えるため送金できません', 400);
    console.error('transfer failed:', e);
    return jsonError('送金に失敗しました', 500);
  } finally {
    client.release();
  }

  // ログ送信。ダッシュボードのログ設定「アクティビティ・Webからの送金」(member_transfer) のチャンネルに送る。
  // 未設定・OFFなら従来どおり「経済システム・通貨変動」(currency) のチャンネルに送る。失敗しても送金自体は成功扱い
  let currencyName = 'コイン';
  try {
    const [cur, log] = await Promise.all([
      pool.query("SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = 'CURRENCY_NAME'", [guildId]),
      pool.query(
        "SELECT log_type, channel_id::text AS channel_id, is_enabled FROM log_settings WHERE guild_id = $1 AND log_type IN ('member_transfer', 'member_transfer_public', 'currency')",
        [guildId]
      ),
    ]);
    currencyName = parseCurrencyName(cur.rows[0]?.setting_value);
    const enabled = (type: string) =>
      log.rows.find((r) => r.log_type === type && r.channel_id && (r.is_enabled === null || r.is_enabled));
    const logRow = enabled('member_transfer') ?? enabled('currency');
    const via = source === 'activity' ? 'Discordアクティビティ' : 'Webダッシュボード';
    if (logRow) {
      await botRequest(`/channels/${logRow.channel_id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [
            {
              title: '💸 送金',
              description: `ユーザー間で送金が行われました（${via}経由）。`,
              color: 0x3498db,
              timestamp: new Date().toISOString(),
              fields: [
                { name: '送金元', value: `<@${session.discord_id}> (${session.discord_id})`, inline: false },
                { name: '送金先 (1名)', value: `<@${to}> (${to})`, inline: false },
                { name: '金額', value: `${amount.toLocaleString()} ${currencyName}`, inline: true },
                { name: '送金後の送金元残高', value: `${newBalance.toLocaleString()} ${currencyName}`, inline: true },
                { name: '経由', value: via, inline: true },
              ],
            },
          ],
          allowed_mentions: { parse: [] },
        }),
      }).catch((e) => console.error('transfer log message failed:', e));
    }

    // メンバー向けのお知らせ（/pay の「💵 @相手 に ○○ を送金しました。」と同じ形）。
    // ログ設定「アクティビティ・Webからの送金（お知らせ）」のチャンネルに送る。未設定・OFFなら送らない
    const publicRow = enabled('member_transfer_public');
    if (publicRow) {
      await botRequest(`/channels/${publicRow.channel_id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `💵 <@${session.discord_id}> さんが <@${to}> に **${amount.toLocaleString()} ${currencyName}** を送金しました。（${via}）`,
          // /pay と同じく受け取った人にだけ通知する
          allowed_mentions: { users: [to] },
        }),
      }).catch((e) => console.error('transfer public message failed:', e));
    }
  } catch (e) {
    console.error('transfer log failed:', e);
  }

  return NextResponse.json({
    success: true,
    balance: newBalance,
    amount,
    currency_name: currencyName,
    to: { id: to, display_name: memberDisplayName(receiver) },
    from: { id: session.discord_id, display_name: memberDisplayName(senderMember) },
  });
}
