import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { DiscordApiError, DiscordGuildMember, botRequest, memberDisplayName } from '@/lib/discordApi';
import { isSnowflake, jsonError, requireGuildMember } from '@/lib/memberAuth';
import { isBotTransferAllowed } from '@/lib/memberSettings';

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
 * POST /api/member/guilds/[guild_id]/transfer  { to: "<discord id>", amount: number }
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

  // 通貨ログ（/pay と同じ "currency" ログ）。失敗しても送金自体は成功扱い
  let currencyName = 'コイン';
  try {
    const [cur, log] = await Promise.all([
      pool.query("SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = 'CURRENCY_NAME'", [guildId]),
      pool.query("SELECT channel_id::text AS channel_id, is_enabled FROM log_settings WHERE guild_id = $1 AND log_type = 'currency'", [guildId]),
    ]);
    currencyName = parseCurrencyName(cur.rows[0]?.setting_value);
    const logRow = log.rows[0];
    if (logRow && (logRow.is_enabled === null || logRow.is_enabled)) {
      await botRequest(`/channels/${logRow.channel_id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [
            {
              title: '💸 送金',
              description: 'ユーザー間で送金が行われました（Discordアクティビティ経由）。',
              color: 0x3498db,
              timestamp: new Date().toISOString(),
              fields: [
                { name: '送金元', value: `<@${session.discord_id}> (${session.discord_id})`, inline: false },
                { name: '送金先 (1名)', value: `<@${to}> (${to})`, inline: false },
                { name: '1人あたりの金額', value: `${amount.toLocaleString()} ${currencyName}`, inline: true },
                { name: '合計金額', value: `${amount.toLocaleString()} ${currencyName}`, inline: true },
              ],
            },
          ],
          allowed_mentions: { parse: [] },
        }),
      });
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
