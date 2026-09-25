import type { Pool } from 'pg';
import { randomInt } from 'crypto';
import { DiscordApiError, DiscordGuildMember, botRequest } from '@/lib/discordApi';
import { CasinoError, withTransaction } from '@/lib/casino/db';
import { fetchRoleNames } from '@/lib/shop';

/**
 * アクティビティ・Webの福引ガチャ。景品・消費額・対象ロールはダッシュボード「福引ガチャ設定」
 * （gacha_settings / gacha_prizes）をそのまま使い、抽選の流れは cogs/gacha.py と同じ
 * （有効か → 対象ロール → 景品 → 残高 → 支払い → 重み付き抽選 → 報酬 → 履歴）。
 */

export const WEB_GACHA_SETTING_KEY = 'WEB_GACHA_ENABLED';

export interface GachaPrize {
  id: number;
  prize_number: number;
  prize_name: string;
  weight: number;
  reward_coins: number;
  reward_role_id: string | null;
  reward_role_duration_days: number;
}

export interface GachaSettings {
  is_enabled: boolean;
  pull_cost: number;
  allowed_role_ids: string[];
}

/** 当たりやすさからレア度を決める（見た目用。確率 5%以下=SSR / 15%以下=SR / 35%以下=R / それ以外=N） */
export type Rarity = 'SSR' | 'SR' | 'R' | 'N';
export function rarityOf(weight: number, total: number): Rarity {
  const p = total > 0 ? weight / total : 1;
  if (p <= 0.05) return 'SSR';
  if (p <= 0.15) return 'SR';
  if (p <= 0.35) return 'R';
  return 'N';
}

function toPrize(r: any): GachaPrize {
  return {
    id: Number(r.id),
    prize_number: Number(r.prize_number),
    prize_name: String(r.prize_name ?? ''),
    weight: Math.max(0, Number(r.weight) || 0),
    reward_coins: Number(r.reward_coins) || 0,
    reward_role_id: r.reward_role_id ? String(r.reward_role_id) : null,
    reward_role_duration_days: Number(r.reward_role_duration_days) || 0,
  };
}

export async function isWebGachaEnabled(pool: Pool, guildId: string): Promise<boolean> {
  try {
    const res = await pool.query('SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = $2', [
      guildId,
      WEB_GACHA_SETTING_KEY,
    ]);
    const v = res.rows[0]?.setting_value;
    return v === 'true' || v === true;
  } catch (e: any) {
    if (e?.code === '42P01') return false;
    throw e;
  }
}

export async function loadGacha(pool: Pool, guildId: string): Promise<{ settings: GachaSettings; prizes: GachaPrize[] }> {
  try {
    const [s, p] = await Promise.all([
      pool.query('SELECT allowed_role_ids::text[] AS allowed_role_ids, pull_cost, is_enabled FROM gacha_settings WHERE guild_id = $1', [guildId]),
      pool.query(
        `SELECT id, prize_number, prize_name, weight, reward_coins, reward_role_id::text AS reward_role_id, reward_role_duration_days
           FROM gacha_prizes WHERE guild_id = $1 ORDER BY prize_number ASC`,
        [guildId]
      ),
    ]);
    const row = s.rows[0];
    return {
      // Bot と同じく、設定が無ければ「有効・無料・誰でも」
      settings: {
        is_enabled: row ? row.is_enabled !== false : true,
        pull_cost: Number(row?.pull_cost) || 0,
        allowed_role_ids: (row?.allowed_role_ids ?? []).map(String),
      },
      prizes: p.rows.map(toPrize),
    };
  } catch (e: any) {
    if (e?.code === '42P01') return { settings: { is_enabled: false, pull_cost: 0, allowed_role_ids: [] }, prizes: [] };
    throw e;
  }
}

/** 対象ロールを持っているか（Bot と同じく、どれか1つを持っていれば引ける。未設定なら誰でも） */
export function canPull(settings: GachaSettings, member: DiscordGuildMember): boolean {
  return !settings.allowed_role_ids.length || settings.allowed_role_ids.some((r) => member.roles.includes(r));
}

export async function recentPulls(pool: Pool, guildId: string, userId: string, limit = 10) {
  try {
    const res = await pool.query(
      `SELECT prize_number, prize_name, to_char(created_at, 'MM/DD HH24:MI') AS at
         FROM gacha_history WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at DESC, id DESC LIMIT $3`,
      [guildId, userId, limit]
    );
    return res.rows.map((r) => ({ prize_number: Number(r.prize_number), prize_name: String(r.prize_name ?? ''), at: String(r.at) }));
  } catch (e: any) {
    if (e?.code === '42P01') return [];
    throw e;
  }
}

async function sendGachaLog(pool: Pool, guildId: string, fields: { name: string; value: string; inline?: boolean }[]) {
  try {
    const res = await pool.query(
      "SELECT channel_id::text AS channel_id, is_enabled FROM log_settings WHERE guild_id = $1 AND log_type = 'gacha'",
      [guildId]
    );
    const row = res.rows[0];
    if (!row?.channel_id || row.is_enabled === false) return;
    await botRequest(`/channels/${row.channel_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{ title: '🎁 福引ガチャ', color: 0xe74c3c, fields, timestamp: new Date().toISOString(), footer: { text: 'アクティビティ・Web から' } }],
        allowed_mentions: { parse: [] },
      }),
    });
  } catch (e) {
    console.error('sendGachaLog failed:', e);
  }
}

export interface PullResult {
  prize: GachaPrize;
  rarity: Rarity;
  cost: number;
  balance: number;
  role: { name: string; color: string | null; expires_text: string | null; duration_days: number } | null;
  role_failed: string | null;
}

export async function pullGacha(pool: Pool, guildId: string, member: DiscordGuildMember, currencyName: string): Promise<PullResult> {
  const userId = member.user.id;

  const { prize, total, cost, balance, expiresText } = await withTransaction(pool, async (client) => {
    const { settings, prizes } = await loadGacha(pool, guildId);
    if (!settings.is_enabled) throw new CasinoError('現在、福引ガチャは無効になっています', 403);
    if (!canPull(settings, member)) throw new CasinoError('あなたは福引ガチャを引く条件を満たしていません', 403);
    if (!prizes.length) throw new CasinoError('福引ガチャの景品が設定されていません。管理者にお問い合わせください');
    const total = prizes.reduce((a, p) => a + p.weight, 0);
    if (total <= 0) throw new CasinoError('福引ガチャの設定に問題があります。管理者にお問い合わせください');

    // 支払い（行ロックで同時に引いたときの二重払い・残高不足を防ぐ）
    await client.query('INSERT INTO users (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guildId, userId]);
    const bal = await client.query('SELECT balance FROM users WHERE guild_id = $1 AND user_id = $2 FOR UPDATE', [guildId, userId]);
    const have = Number(bal.rows[0]?.balance) || 0;
    const cost = settings.pull_cost;
    if (cost > 0 && have < cost) {
      throw new CasinoError(`所持${currencyName}が足りません（必要: ${cost.toLocaleString()} / 所持: ${have.toLocaleString()}）`);
    }

    // 重み付き抽選（Bot の random.choices と同じ考え方）
    let r = randomInt(0, total);
    let prize = prizes[prizes.length - 1];
    for (const p of prizes) {
      if (r < p.weight) {
        prize = p;
        break;
      }
      r -= p.weight;
    }

    const up = await client.query(
      'UPDATE users SET balance = balance - $1 + $2 WHERE guild_id = $3 AND user_id = $4 RETURNING balance',
      [cost, prize.reward_coins, guildId, userId]
    );
    await client.query(
      'INSERT INTO gacha_history (guild_id, user_id, prize_id, prize_number, prize_name) VALUES ($1, $2, $3, $4, $5)',
      [guildId, userId, prize.id, prize.prize_number, prize.prize_name]
    );

    // 期限付きロール: Bot の add_gacha_user_role と同じく、持っている期限があれば延長。時刻は日本時間の値で持つ
    let expiresText: string | null = null;
    if (prize.reward_role_id && prize.reward_role_duration_days > 0) {
      const days = prize.reward_role_duration_days;
      const existing = await client.query(
        `SELECT id FROM gacha_user_roles
          WHERE guild_id = $1 AND user_id = $2 AND role_id = $3 AND role_removed = FALSE AND expires_at > (NOW() AT TIME ZONE 'Asia/Tokyo')
          ORDER BY expires_at DESC LIMIT 1 FOR UPDATE`,
        [guildId, userId, prize.reward_role_id]
      );
      const row = existing.rows[0]
        ? await client.query(
            `UPDATE gacha_user_roles SET expires_at = GREATEST(expires_at, NOW() AT TIME ZONE 'Asia/Tokyo') + make_interval(days => $2), prize_id = $3
              WHERE id = $1 RETURNING to_char(expires_at, 'YYYY/MM/DD HH24:MI') AS t`,
            [existing.rows[0].id, days, prize.id]
          )
        : await client.query(
            `INSERT INTO gacha_user_roles (guild_id, user_id, role_id, prize_id, expires_at)
             VALUES ($1, $2, $3, $4, (NOW() AT TIME ZONE 'Asia/Tokyo') + make_interval(days => $5))
             RETURNING to_char(expires_at, 'YYYY/MM/DD HH24:MI') AS t`,
            [guildId, userId, prize.reward_role_id, prize.id, days]
          );
      expiresText = String(row.rows[0].t);
    }
    return { prize, total, cost, balance: Number(up.rows[0].balance), expiresText };
  });

  // 報酬ロールの付与（抽選のあと。失敗しても Bot と同じく返金はしない）
  let role: PullResult['role'] = null;
  let roleFailed: string | null = null;
  if (prize.reward_role_id) {
    const info = (await fetchRoleNames(guildId)).get(prize.reward_role_id);
    if (info) {
      try {
        await botRequest(`/guilds/${guildId}/members/${userId}/roles/${prize.reward_role_id}`, {
          method: 'PUT',
          headers: { 'X-Audit-Log-Reason': encodeURIComponent('福引ガチャ当選') },
        });
        role = {
          name: info.name,
          color: info.color ? `#${info.color.toString(16).padStart(6, '0')}` : null,
          expires_text: expiresText,
          duration_days: prize.reward_role_duration_days,
        };
      } catch (e) {
        if (!(e instanceof DiscordApiError)) console.error('gacha grant role failed:', e);
        roleFailed = info.name;
      }
    }
  }

  const fields = [
    { name: '引いた人', value: `<@${userId}> (ID: ${userId})`, inline: false },
    { name: '当選', value: `${prize.prize_number}番『${prize.prize_name}』`, inline: true },
    { name: '消費', value: cost > 0 ? `${cost.toLocaleString()} ${currencyName}` : '無料', inline: true },
  ];
  if (prize.reward_coins) fields.push({ name: '獲得', value: `${prize.reward_coins.toLocaleString()} ${currencyName}`, inline: true });
  if (role) fields.push({ name: '付与ロール', value: role.name + (role.expires_text ? `（期限: ${role.expires_text}まで）` : '（無期限）'), inline: false });
  if (roleFailed) fields.push({ name: '付与失敗ロール (権限不足等)', value: roleFailed, inline: false });
  await sendGachaLog(pool, guildId, fields);

  return { prize, rarity: rarityOf(prize.weight, total), cost, balance, role, role_failed: roleFailed };
}
