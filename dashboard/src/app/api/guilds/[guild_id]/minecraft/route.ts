import { NextResponse } from 'next/server';
import { masterPool, getPool } from '@/lib/db';
import { DiscordGuildMember, botRequest, memberDisplayName } from '@/lib/discordApi';
import {
  LATEST_ADDON_VERSION,
  HEARTBEAT_TIMEOUT_MS,
  SellPrice,
  ensureMinecraftGuildSchema,
  ensureMinecraftMasterSchema,
  generateApiKey,
  getCurrencyName,
  getMinecraftServer,
  hashApiKey,
  isServerOnline,
  postToChannel,
} from '@/lib/minecraft';

export const dynamic = 'force-dynamic';

const SNOWFLAKE = /^\d{15,25}$/;
const ITEM_ID = /^[a-z0-9_.\-]+:[a-z0-9_.\-/]+$/;

/**
 * GET /api/guilds/[guild_id]/minecraft
 * マイクラ連携の設定と接続状況（サーバー・アドオン・ログ送信・通貨連携）、連携済みプレイヤー、直近の入退出・取引。
 */
export async function GET(_request: Request, { params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  try {
    const server = await getMinecraftServer(guildId);
    const pool = await getPool(guildId);
    await ensureMinecraftGuildSchema(pool);

    const [links, events, transactions, currencyName] = await Promise.all([
      pool.query(
        `SELECT user_id::text AS user_id, mc_name, linked_at FROM minecraft_links WHERE guild_id = $1 ORDER BY linked_at DESC LIMIT 200`,
        [guildId]
      ),
      pool.query(`SELECT id::text, kind, mc_name, created_at FROM minecraft_events WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 30`, [guildId]),
      pool.query(
        `SELECT id::text, user_id::text AS user_id, mc_name, kind, amount::text AS amount, detail, balance_after::text AS balance_after, created_at
         FROM minecraft_transactions WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 30`,
        [guildId]
      ),
      getCurrencyName(pool, guildId),
    ]);

    // 連携済みメンバーの表示名（多すぎるとDiscordのレート制限に当たるので先頭だけ）
    const names = new Map<string, string>();
    await Promise.all(
      links.rows.slice(0, 30).map(async (l) => {
        try {
          const m = await botRequest<DiscordGuildMember>(`/guilds/${guildId}/members/${l.user_id}`);
          names.set(l.user_id, memberDisplayName(m));
        } catch {}
      })
    );

    return NextResponse.json({
      configured: !!server,
      has_api_key: !!server?.api_key_hint,
      settings: server
        ? {
            is_enabled: server.is_enabled,
            join_leave_channel_id: server.join_leave_channel_id ?? '',
            trade_log_channel_id: server.trade_log_channel_id ?? '',
            allow_pay: server.allow_pay,
            allow_sell: server.allow_sell,
            sell_prices: server.sell_prices,
            api_key_hint: server.api_key_hint,
          }
        : null,
      status: server
        ? {
            online: isServerOnline(server),
            server_name: server.server_name,
            addon_version: server.addon_version,
            addon_info: server.addon_info,
            online_players: server.online_players,
            max_players: server.max_players,
            last_heartbeat_at: server.last_heartbeat_at,
            last_event_at: server.last_event_at,
          }
        : null,
      latest_addon_version: LATEST_ADDON_VERSION,
      heartbeat_timeout_ms: HEARTBEAT_TIMEOUT_MS,
      currency_name: currencyName,
      links: links.rows.map((l) => ({ ...l, display_name: names.get(l.user_id) ?? null })),
      events: events.rows,
      transactions: transactions.rows,
    });
  } catch (error: any) {
    console.error('GET minecraft settings failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function parseSellPrices(raw: unknown): SellPrice[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SellPrice[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, 200)) {
    let item = typeof r?.item === 'string' ? r.item.trim().toLowerCase() : '';
    if (!item) continue;
    if (!item.includes(':')) item = `minecraft:${item}`;
    const price = Number(r?.price);
    if (!ITEM_ID.test(item) || !Number.isSafeInteger(price) || price < 1 || price > 1_000_000_000) return null;
    if (seen.has(item)) continue;
    seen.add(item);
    // §（色コード）はゲーム内の表示を崩すので外す
    const label = typeof r?.label === 'string' ? r.label.replace(/§./g, '').trim().slice(0, 32) : '';
    out.push(label ? { item, price, label } : { item, price });
  }
  return out;
}

/**
 * POST /api/guilds/[guild_id]/minecraft
 * action:
 *  - save: 設定を保存 { is_enabled, join_leave_channel_id, trade_log_channel_id, allow_pay, allow_sell, sell_prices }
 *  - regenerate_key: APIキーを（再）発行。平文はこのレスポンスでしか返さない
 *  - test_log: { channel_id } にテストメッセージを送る
 *  - unlink: { user_id } のプレイヤー連携を解除
 */
export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  if (!SNOWFLAKE.test(guildId)) return NextResponse.json({ error: 'サーバーIDが不正です' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const action = body?.action;

  try {
    await ensureMinecraftMasterSchema();

    if (action === 'regenerate_key') {
      const key = generateApiKey();
      await masterPool.query(
        `INSERT INTO minecraft_servers (guild_id, api_key_hash, api_key_hint)
         VALUES ($1, $2, $3)
         ON CONFLICT (guild_id) DO UPDATE SET api_key_hash = EXCLUDED.api_key_hash, api_key_hint = EXCLUDED.api_key_hint, updated_at = NOW()`,
        [guildId, hashApiKey(key), key.slice(-4)]
      );
      return NextResponse.json({ success: true, api_key: key });
    }

    if (action === 'save') {
      const channel = (v: unknown) => (typeof v === 'string' && SNOWFLAKE.test(v) ? v : null);
      const sellPrices = parseSellPrices(body.sell_prices ?? []);
      if (!sellPrices) {
        return NextResponse.json({ error: '売却価格の設定が不正です（アイテムIDは minecraft:diamond の形、価格は1以上の整数）' }, { status: 400 });
      }
      await masterPool.query(
        `INSERT INTO minecraft_servers (guild_id, is_enabled, join_leave_channel_id, trade_log_channel_id, allow_pay, allow_sell, sell_prices)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (guild_id) DO UPDATE SET
           is_enabled = EXCLUDED.is_enabled,
           join_leave_channel_id = EXCLUDED.join_leave_channel_id,
           trade_log_channel_id = EXCLUDED.trade_log_channel_id,
           allow_pay = EXCLUDED.allow_pay,
           allow_sell = EXCLUDED.allow_sell,
           sell_prices = EXCLUDED.sell_prices,
           updated_at = NOW()`,
        [
          guildId,
          body.is_enabled !== false,
          channel(body.join_leave_channel_id),
          channel(body.trade_log_channel_id),
          body.allow_pay !== false,
          body.allow_sell !== false,
          JSON.stringify(sellPrices),
        ]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'test_log') {
      const channelId = typeof body.channel_id === 'string' && SNOWFLAKE.test(body.channel_id) ? body.channel_id : null;
      if (!channelId) return NextResponse.json({ error: 'チャンネルを選択してください' }, { status: 400 });
      const ok = await postToChannel(channelId, {
        embeds: [
          {
            description: '🧪 ManyBot マイクラ連携のテストメッセージです。ここにワールドの参加・退出ログが送信されます。',
            color: 0x22c55e,
            timestamp: new Date().toISOString(),
          },
        ],
      });
      if (!ok) return NextResponse.json({ error: 'メッセージを送信できませんでした（Botの権限を確認してください）' }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    if (action === 'unlink') {
      if (typeof body.user_id !== 'string' || !SNOWFLAKE.test(body.user_id)) {
        return NextResponse.json({ error: 'ユーザーIDが不正です' }, { status: 400 });
      }
      const pool = await getPool(guildId);
      await ensureMinecraftGuildSchema(pool);
      await pool.query('DELETE FROM minecraft_links WHERE guild_id = $1 AND user_id = $2', [guildId, body.user_id]);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: '不明な操作です' }, { status: 400 });
  } catch (error: any) {
    console.error('POST minecraft settings failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
