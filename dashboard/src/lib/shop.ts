import type { Pool } from 'pg';
import { DiscordApiError, DiscordGuildMember, DiscordRole, botRequest } from '@/lib/discordApi';
import { CasinoError, withTransaction } from '@/lib/casino/db';

/**
 * アクティビティ・Webのショップ。商品はダッシュボード「ショップ設定」（shop_items）をそのまま使い、
 * 購入の流れ（対象ロール → 評価期間中か → 残高 → 支払い → 効果 → ログ）は cogs/shop.py と同じ。
 */

export const WEB_SHOP_SETTING_KEY = 'WEB_SHOP_ENABLED';

export interface ShopItem {
  item_id: number;
  name: string;
  usage: string;
  price: number;
  target_role_ids: string[];
  reward_role_ids: string[];
  duration_days: number | null;
  is_eval_extend: boolean;
  extend_days: number | null;
}

/** BIGINT[] でも、古い形式の文字列（JSON やカンマ区切り）でもロールIDの配列にする */
function parseIds(raw: unknown): string[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    const text = raw.trim();
    try {
      const parsed = JSON.parse(text.replace(/(\d{16,})/g, '"$1"'));
      list = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      list = text.replace(/[{}\[\]"]/g, '').split(',');
    }
  } else if (typeof raw === 'number' || typeof raw === 'bigint') list = [raw];
  return list.map((x) => String(x).trim()).filter((x) => /^\d{15,25}$/.test(x));
}

function toItem(r: any): ShopItem {
  return {
    item_id: Number(r.item_id),
    name: String(r.name ?? ''),
    usage: String(r.usage ?? ''),
    price: Number(r.price) || 0,
    target_role_ids: parseIds(r.target_role_ids),
    reward_role_ids: parseIds(r.reward_role_ids),
    duration_days: r.duration_days === null || r.duration_days === undefined ? null : Number(r.duration_days),
    is_eval_extend: r.is_eval_extend === true,
    extend_days: r.extend_days === null || r.extend_days === undefined ? null : Number(r.extend_days),
  };
}

export async function isWebShopEnabled(pool: Pool, guildId: string): Promise<boolean> {
  try {
    const res = await pool.query('SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = $2', [
      guildId,
      WEB_SHOP_SETTING_KEY,
    ]);
    const v = res.rows[0]?.setting_value;
    return v === 'true' || v === true;
  } catch (e: any) {
    if (e?.code === '42P01') return false;
    throw e;
  }
}

export async function loadShopItems(pool: Pool, guildId: string): Promise<ShopItem[]> {
  try {
    const res = await pool.query(
      `SELECT item_id, name, usage, price, target_role_ids, reward_role_ids, duration_days, is_eval_extend, extend_days
         FROM shop_items WHERE guild_id = $1 ORDER BY item_id ASC`,
      [guildId]
    );
    return res.rows.map(toItem);
  } catch (e: any) {
    if (e?.code === '42P01') return []; // ショップ未設定
    throw e;
  }
}

/** 評価期間（評価期間延長の商品で使う）。終了時刻は Bot と同じく日本時間の値で持っている */
export async function getEvaluationPeriod(pool: Pool, guildId: string, userId: string) {
  try {
    const res = await pool.query(
      `SELECT to_char(end_time, 'YYYY/MM/DD HH24:MI') AS end_text,
              EXTRACT(EPOCH FROM (end_time AT TIME ZONE 'Asia/Tokyo'))::bigint AS end_unix
         FROM evaluation_periods WHERE guild_id = $1 AND user_id = $2`,
      [guildId, userId]
    );
    const row = res.rows[0];
    return row ? { end_text: String(row.end_text), end_unix: Number(row.end_unix) } : null;
  } catch (e: any) {
    if (e?.code === '42P01' || e?.code === '42703') return null;
    throw e;
  }
}

const ensured = new WeakSet<Pool>();

/** 購入記録の表。Bot の add_user_item / 期限切れ処理が使う列（expire_at, role_removed）を用意する */
async function ensureUserItems(pool: Pool) {
  if (ensured.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_items (
      id SERIAL PRIMARY KEY,
      guild_id BIGINT,
      user_id BIGINT,
      item_id INTEGER,
      purchased_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query('ALTER TABLE user_items ADD COLUMN IF NOT EXISTS guild_id BIGINT');
  await pool.query('ALTER TABLE user_items ADD COLUMN IF NOT EXISTS expire_at TIMESTAMP');
  await pool.query('ALTER TABLE user_items ADD COLUMN IF NOT EXISTS role_removed BOOLEAN DEFAULT FALSE');
  ensured.add(pool);
}

export async function fetchRoleNames(guildId: string): Promise<Map<string, DiscordRole>> {
  try {
    const roles = await botRequest<DiscordRole[]>(`/guilds/${guildId}/roles`);
    return new Map(roles.map((r) => [r.id, r]));
  } catch (e) {
    console.error('fetchRoleNames failed:', e);
    return new Map();
  }
}

async function sendShopLog(pool: Pool, guildId: string, embed: { title: string; color: number; fields: { name: string; value: string; inline?: boolean }[] }) {
  try {
    const res = await pool.query(
      "SELECT channel_id::text AS channel_id, is_enabled FROM log_settings WHERE guild_id = $1 AND log_type = 'shop'",
      [guildId]
    );
    const row = res.rows[0];
    if (!row?.channel_id || row.is_enabled === false) return;
    await botRequest(`/channels/${row.channel_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{ ...embed, timestamp: new Date().toISOString(), footer: { text: 'アクティビティ・Web から' } }],
        allowed_mentions: { parse: [] },
      }),
    });
  } catch (e) {
    console.error('sendShopLog failed:', e);
  }
}

/** 評価スレッドに延長を知らせる（Bot と同じく、Botが作った評価フォーラムのスレッドのうち本人のもの）。失敗しても購入は成立 */
async function notifyEvaluationThread(pool: Pool, guildId: string, member: DiscordGuildMember, message: string) {
  try {
    const res = await pool.query('SELECT forum_channel_ids FROM evaluation_settings WHERE guild_id = $1', [guildId]);
    const forums = new Set(parseIds(res.rows[0]?.forum_channel_ids));
    if (!forums.size) return;
    const [me, active] = await Promise.all([
      botRequest<{ id: string }>('/users/@me'),
      botRequest<{ threads: { id: string; parent_id: string; owner_id: string; name: string }[] }>(`/guilds/${guildId}/threads/active`),
    ]);
    const username = member.user.username.toLowerCase();
    const thread = active.threads.find(
      (t) =>
        forums.has(t.parent_id) &&
        t.owner_id === me.id &&
        (t.name.includes(member.user.id) || t.name.toLowerCase().includes(username))
    );
    if (!thread) return;
    await botRequest(`/channels/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message, allowed_mentions: { users: [member.user.id] } }),
    });
  } catch (e) {
    console.error('notifyEvaluationThread failed:', e);
  }
}

export interface BuyResult {
  item: ShopItem;
  balance: number;
  granted: string[];
  failed: string[];
  expire_days: number | null;
  new_end: { end_text: string; end_unix: number } | null;
}

export async function buyShopItem(
  pool: Pool,
  guildId: string,
  member: DiscordGuildMember,
  itemId: unknown,
  currencyName: string
): Promise<BuyResult> {
  if (!Number.isSafeInteger(itemId)) throw new CasinoError('商品を選んでください');
  const userId = member.user.id;
  await ensureUserItems(pool);

  const { item, balance, newEnd } = await withTransaction(pool, async (client) => {
    const res = await client.query(
      `SELECT item_id, name, usage, price, target_role_ids, reward_role_ids, duration_days, is_eval_extend, extend_days
         FROM shop_items WHERE guild_id = $1 AND item_id = $2`,
      [guildId, itemId]
    );
    if (!res.rows[0]) throw new CasinoError('商品が見つかりませんでした', 404);
    const item = toItem(res.rows[0]);

    // 対象ロールチェック（Bot と同じく、どれか1つを持っていれば買える）
    if (item.target_role_ids.length && !item.target_role_ids.some((r) => member.roles.includes(r))) {
      throw new CasinoError('この商品は対象のロールを持っていないため購入できません', 403);
    }
    if (item.is_eval_extend) {
      const period = await client.query('SELECT 1 FROM evaluation_periods WHERE guild_id = $1 AND user_id = $2 FOR UPDATE', [
        guildId,
        userId,
      ]);
      if (!period.rows[0]) throw new CasinoError('あなたは現在、評価期間中ではないため、この商品を購入できません', 403);
    }

    // 支払い（行ロックで同時購入による二重払い・残高不足を防ぐ）
    await client.query('INSERT INTO users (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guildId, userId]);
    const bal = await client.query('SELECT balance FROM users WHERE guild_id = $1 AND user_id = $2 FOR UPDATE', [guildId, userId]);
    if ((Number(bal.rows[0]?.balance) || 0) < item.price) throw new CasinoError('所持金が足りません');
    const paid = await client.query(
      'UPDATE users SET balance = balance - $1 WHERE guild_id = $2 AND user_id = $3 RETURNING balance',
      [item.price, guildId, userId]
    );

    let newEnd: { end_text: string; end_unix: number } | null = null;
    if (item.is_eval_extend) {
      const up = await client.query(
        `UPDATE evaluation_periods SET end_time = end_time + make_interval(days => $3)
          WHERE guild_id = $1 AND user_id = $2
          RETURNING to_char(end_time, 'YYYY/MM/DD HH24:MI') AS end_text,
                    EXTRACT(EPOCH FROM (end_time AT TIME ZONE 'Asia/Tokyo'))::bigint AS end_unix`,
        [guildId, userId, item.extend_days || 0]
      );
      newEnd = { end_text: String(up.rows[0].end_text), end_unix: Number(up.rows[0].end_unix) };
      await client.query('INSERT INTO user_items (guild_id, user_id, item_id, expire_at, role_removed) VALUES ($1, $2, $3, NULL, FALSE)', [
        guildId,
        userId,
        item.item_id,
      ]);
    } else {
      // 有効期限は Bot と同じく日本時間の日時で持つ（Bot が1分ごとに期限切れのロールを外す）
      const days = item.duration_days && item.duration_days > 0 ? item.duration_days : null;
      await client.query(
        `INSERT INTO user_items (guild_id, user_id, item_id, expire_at, role_removed)
         VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE (NOW() AT TIME ZONE 'Asia/Tokyo') + make_interval(days => $4::int) END, FALSE)`,
        [guildId, userId, item.item_id, days]
      );
    }
    return { item, balance: Number(paid.rows[0].balance), newEnd };
  });

  // 特典ロールの付与（支払い後。失敗しても Bot と同じく返金はせず、失敗したロールを伝える）
  const roles = item.reward_role_ids.length && !item.is_eval_extend ? await fetchRoleNames(guildId) : new Map<string, DiscordRole>();
  const granted: string[] = [];
  const failed: string[] = [];
  for (const rid of item.is_eval_extend ? [] : item.reward_role_ids) {
    const role = roles.get(rid);
    if (!role) continue; // サーバーに無いロールは Bot と同じく飛ばす
    try {
      await botRequest(`/guilds/${guildId}/members/${userId}/roles/${rid}`, {
        method: 'PUT',
        headers: { 'X-Audit-Log-Reason': encodeURIComponent(`ショップ購入: ${item.name}`) },
      });
      granted.push(role.name);
    } catch (e) {
      if (!(e instanceof DiscordApiError)) console.error('grant role failed:', e);
      failed.push(role.name);
    }
  }

  const fields = [
    { name: '購入者', value: `<@${userId}> (ID: ${userId})`, inline: false },
    { name: '商品ID', value: String(item.item_id), inline: true },
    { name: '商品名', value: item.name, inline: true },
    { name: '支払額', value: `${item.price.toLocaleString()} ${currencyName}`, inline: true },
  ];
  if (item.is_eval_extend && newEnd) {
    fields.push({ name: '延長日数', value: `${item.extend_days}日間`, inline: true });
    fields.push({ name: '新しい終了予定', value: `${newEnd.end_text} (<t:${newEnd.end_unix}:R>)`, inline: false });
    await notifyEvaluationThread(
      pool,
      guildId,
      member,
      `🎉 <@${userId}> 評価期間を **${item.extend_days}日間** 延長するアイテムを購入しました！\n新しい終了予定: ${newEnd.end_text} (<t:${newEnd.end_unix}:R>)`
    );
  } else {
    if (granted.length) {
      fields.push({ name: '付与ロール', value: granted.join('、'), inline: false });
      if (item.duration_days) fields.push({ name: '有効期限', value: `${item.duration_days}日間`, inline: true });
    }
    if (failed.length) fields.push({ name: '付与失敗ロール (権限不足等)', value: failed.join('、'), inline: false });
  }
  await sendShopLog(pool, guildId, {
    title: item.is_eval_extend ? '🛒 商品購入 (評価期間延長)' : '🛒 商品購入',
    color: 0xf1c40f,
    fields,
  });

  return {
    item,
    balance,
    granted,
    failed,
    expire_days: item.duration_days && item.duration_days > 0 ? item.duration_days : null,
    new_end: newEnd,
  };
}
