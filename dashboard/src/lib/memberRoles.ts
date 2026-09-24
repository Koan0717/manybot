import type { Pool } from 'pg';
import { botRequest } from '@/lib/discordApi';
import { idsFrom } from '@/lib/webAccess';

/**
 * メンバー画面の「役職」タブ・ショップで使う、ロールの種類（仮メン・準メン・本メン・評価落ち）と付与日。
 */

export type RoleKind = 'new' | 'sub' | 'main' | 'downgrade' | 'violator';

/**
 * 判定に使う「基本・評価設定」のロール。名前での推測はせず、未設定なら当てはまる人はいない扱い。
 */
export const ROLE_SETTING_KEYS = {
  new: ['NEW_MEMBER_ROLE_IDS', 'NEW_MEMBER_ROLE_ID'], // 仮（新規）メンバーロール（旧設定の単一IDも）
  main: ['MAIN_MEMBER_ROLE_IDS'], // 本メンバーロール
  sub: ['SUB_MEMBER_ROLE_IDS'], // 準メンバーロール
  downgrade: ['DOWNGRADE_ROLE_ID'], // 評価落ちロール
  violator: ['GAMBLE_VIOLATOR_ROLE_IDS'], // 違反者ロール
} as const;

export interface RoleKinds {
  newIds: Set<string>;
  subIds: Set<string>;
  mainIds: Set<string>;
  downgradeIds: Set<string>;
  violatorIds: Set<string>;
}

/** 「基本・評価設定」のロールID（サーバーに存在しないものも含む。表示で「未設定」を判断するのに使う） */
export async function loadRoleSettingIds(pool: Pool, guildId: string): Promise<Record<keyof typeof ROLE_SETTING_KEYS, string[]>> {
  const keys = Object.values(ROLE_SETTING_KEYS).flat();
  const s: Record<string, unknown> = {};
  try {
    const res = await pool.query('SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = ANY($2)', [
      guildId,
      keys,
    ]);
    for (const row of res.rows) s[row.setting_key] = row.setting_value;
  } catch (e: any) {
    if (e?.code !== '42P01') throw e;
  }
  const pick = (ks: readonly string[]) => Array.from(new Set(ks.flatMap((k) => idsFrom(s[k]))));
  return {
    new: pick(ROLE_SETTING_KEYS.new),
    main: pick(ROLE_SETTING_KEYS.main),
    sub: pick(ROLE_SETTING_KEYS.sub),
    downgrade: pick(ROLE_SETTING_KEYS.downgrade),
    violator: pick(ROLE_SETTING_KEYS.violator),
  };
}

export async function loadRoleKinds(pool: Pool, guildId: string): Promise<RoleKinds> {
  const ids = await loadRoleSettingIds(pool, guildId);
  return {
    newIds: new Set(ids.new),
    subIds: new Set(ids.sub),
    mainIds: new Set(ids.main),
    downgradeIds: new Set(ids.downgrade),
    violatorIds: new Set(ids.violator),
  };
}

export function roleKind(kinds: RoleKinds, roleId: string): RoleKind | null {
  if (kinds.downgradeIds.has(roleId)) return 'downgrade';
  if (kinds.violatorIds.has(roleId)) return 'violator';
  if (kinds.mainIds.has(roleId)) return 'main';
  if (kinds.subIds.has(roleId)) return 'sub';
  if (kinds.newIds.has(roleId)) return 'new';
  return null;
}

const ensured = new WeakSet<Pool>();

async function ensureTables(pool: Pool) {
  if (ensured.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_history (
      id BIGSERIAL PRIMARY KEY,
      guild_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      role_id BIGINT NOT NULL,
      role_name TEXT,
      action TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'bot',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_role_history_user ON role_history (guild_id, user_id, created_at DESC)');
  // 監査ログを最後に調べた時刻（何度も調べてレート制限にかからないよう、1人1日1回まで）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_history_scans (
      guild_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  ensured.add(pool);
}

// Discord のIDには作成時刻が入っている（上位ビット ÷ 2^22 + Discord の基準時刻）
const snowflakeTime = (id: string) => new Date(Number(BigInt(id) / BigInt(4194304)) + 1420070400000);

interface AuditEntry {
  id: string;
  target_id: string | null;
  changes?: { key: string; new_value?: { id: string; name: string }[] }[];
}

/**
 * Bot が記録を始める前に付いたロールの付与日を、Discord の監査ログ（残るのは直近45日）から探して role_history に保存する。
 * 監査ログを見る権限が無いときや見つからないときは何もしない（「付与日不明」になる）。
 */
async function backfillFromAuditLog(pool: Pool, guildId: string, userId: string, missing: Set<string>) {
  const scanned = await pool.query(
    `SELECT 1 FROM role_history_scans WHERE guild_id = $1 AND user_id = $2 AND scanned_at > NOW() - INTERVAL '1 day'`,
    [guildId, userId]
  );
  if (scanned.rows[0]) return;
  await pool.query(
    `INSERT INTO role_history_scans (guild_id, user_id, scanned_at) VALUES ($1, $2, NOW())
     ON CONFLICT (guild_id, user_id) DO UPDATE SET scanned_at = NOW()`,
    [guildId, userId]
  );

  const found = new Map<string, { name: string; at: Date }>();
  let before: string | undefined;
  try {
    // 新しい順に最大5ページ（500件）まで見る。一番新しい付与がいまのロールの付与日
    for (let page = 0; page < 5 && !Array.from(missing).every((id) => found.has(id)); page++) {
      const q = `?action_type=25&limit=100${before ? `&before=${before}` : ''}`;
      const res = await botRequest<{ audit_log_entries: AuditEntry[] }>(`/guilds/${guildId}/audit-logs${q}`);
      const entries = res.audit_log_entries ?? [];
      for (const e of entries) {
        if (e.target_id !== userId) continue;
        for (const c of e.changes ?? []) {
          if (c.key !== '$add') continue;
          for (const r of c.new_value ?? []) {
            // 新しい順に見ているので、最初に見つかったものがそのロールの一番新しい付与。
            // 1日1回しか調べないので、いま足りないロール以外の分も保存しておく
            if (!found.has(r.id)) found.set(r.id, { name: r.name, at: snowflakeTime(e.id) });
          }
        }
      }
      if (entries.length < 100) break;
      before = entries[entries.length - 1].id;
    }
  } catch (e) {
    console.error('role audit log scan failed:', e); // 監査ログの権限が無いなど
  }
  for (const [roleId, { name, at }] of Array.from(found)) {
    // 同じ付与をもう記録済みなら入れない
    await pool.query(
      `INSERT INTO role_history (guild_id, user_id, role_id, role_name, action, source, created_at)
       SELECT $1, $2, $3, $4, 'add', 'audit', $5
        WHERE NOT EXISTS (SELECT 1 FROM role_history WHERE guild_id = $1 AND user_id = $2 AND role_id = $3 AND action = 'add' AND created_at >= $5)`,
      [guildId, userId, roleId, name, at.toISOString()]
    );
  }
}

/** いま持っているロールそれぞれの付与日（一番新しく付いた日）。分からないロールは入らない */
export async function getRoleGrantDates(pool: Pool, guildId: string, userId: string, roleIds: string[]): Promise<Map<string, Date>> {
  await ensureTables(pool);
  const load = async () => {
    const res = await pool.query(
      `SELECT role_id::text AS role_id, MAX(created_at) AS at FROM role_history
        WHERE guild_id = $1 AND user_id = $2 AND action = 'add' AND role_id = ANY($3::bigint[])
        GROUP BY role_id`,
      [guildId, userId, roleIds]
    );
    return new Map<string, Date>(res.rows.map((r) => [r.role_id, new Date(r.at)]));
  };
  let dates = await load();
  const missing = new Set(roleIds.filter((id) => !dates.has(id)));
  if (missing.size) {
    await backfillFromAuditLog(pool, guildId, userId, missing);
    dates = await load();
  }
  return dates;
}

/**
 * ショップで購入して付いたロール（有効期限内・剥奪前のもの）と、その商品名・購入日時。
 * Bot の add_user_item は guild_id を入れないので、商品（shop_items）のサーバーで絞り込む。
 */
export async function getShopRoleSources(pool: Pool, guildId: string, userId: string): Promise<Map<string, { item_name: string; purchased_at: Date | null }>> {
  const result = new Map<string, { item_name: string; purchased_at: Date | null }>();
  try {
    const res = await pool.query(
      `SELECT si.name, si.reward_role_ids, ui.purchased_at
         FROM user_items ui JOIN shop_items si ON si.item_id = ui.item_id
        WHERE si.guild_id = $1 AND ui.user_id = $2
          AND COALESCE(ui.role_removed, FALSE) = FALSE
          AND (ui.expire_at IS NULL OR ui.expire_at > (NOW() AT TIME ZONE 'Asia/Tokyo'))
        ORDER BY ui.purchased_at DESC NULLS LAST, ui.id DESC`,
      [guildId, userId]
    );
    for (const row of res.rows) {
      for (const roleId of idsFrom(row.reward_role_ids)) {
        // 新しい購入が先に来るので、最初のものを使う
        if (!result.has(roleId)) {
          result.set(roleId, { item_name: String(row.name ?? ''), purchased_at: row.purchased_at ? new Date(row.purchased_at) : null });
        }
      }
    }
  } catch (e: any) {
    // ショップ未使用（表や列が無い）なら空
    if (e?.code !== '42P01' && e?.code !== '42703') throw e;
  }
  return result;
}
