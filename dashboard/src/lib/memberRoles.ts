import type { Pool } from 'pg';
import { DiscordRole, botRequest } from '@/lib/discordApi';
import { idsFrom } from '@/lib/webAccess';

/**
 * メンバー画面の「役職」タブ・ショップで使う、ロールの種類（仮メン・準メン・本メン・評価落ち）と付与日。
 */

export type RoleKind = 'new' | 'sub' | 'main' | 'downgrade';

/** 「Webアクティビティ設定」で選ぶ準メン・本メンのロール（未設定なら本・準メンバーロールから名前で判断） */
export const WEB_SUB_MEMBER_KEY = 'WEB_SUB_MEMBER_ROLE_IDS';
export const WEB_MAIN_MEMBER_KEY = 'WEB_MAIN_MEMBER_ROLE_IDS';
const DOWNGRADE_ROLE_NAME = '評価落ち'; // config.EVALUATION_FAILED_ROLE_NAME

export interface RoleKinds {
  newIds: Set<string>;
  subIds: Set<string>;
  mainIds: Set<string>;
  downgradeIds: Set<string>;
}

export async function loadRoleKinds(pool: Pool, guildId: string, roles: DiscordRole[]): Promise<RoleKinds> {
  const s: Record<string, unknown> = {};
  try {
    const res = await pool.query(
      `SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key IN
         ('NEW_MEMBER_ROLE_IDS', 'NEW_MEMBER_ROLE_ID', 'MAIN_SUB_MEMBER_ROLE_IDS', 'DOWNGRADE_ROLE_ID', 'EVALUATION_FAILED_ROLE_ID', $2, $3)`,
      [guildId, WEB_SUB_MEMBER_KEY, WEB_MAIN_MEMBER_KEY]
    );
    for (const row of res.rows) s[row.setting_key] = row.setting_value;
  } catch (e: any) {
    if (e?.code !== '42P01') throw e;
  }
  const byId = new Map(roles.map((r) => [r.id, r]));
  const exists = (ids: string[]) => ids.filter((id) => byId.has(id));

  // 仮メン: Bot の get_new_member_role_ids と同じ（新しい複数設定＋旧設定）
  const newIds = new Set(exists([...idsFrom(s.NEW_MEMBER_ROLE_IDS), ...idsFrom(s.NEW_MEMBER_ROLE_ID)]));

  // 準メン・本メン: 選んであればそれを使い、無ければ「本・準メンバーロール」のうち名前に「準」を含むものを準メンとする
  let subIds = exists(idsFrom(s[WEB_SUB_MEMBER_KEY]));
  let mainIds = exists(idsFrom(s[WEB_MAIN_MEMBER_KEY]));
  if (!subIds.length && !mainIds.length) {
    const mainSub = exists(idsFrom(s.MAIN_SUB_MEMBER_ROLE_IDS));
    subIds = mainSub.filter((id) => byId.get(id)!.name.includes('準'));
    mainIds = mainSub.filter((id) => !byId.get(id)!.name.includes('準'));
  }

  // 評価落ち: Bot の is_downgrade_member と同じ（設定ロール＋「評価落ち」という名前のロール）
  const downgradeIds = new Set([
    ...exists([...idsFrom(s.DOWNGRADE_ROLE_ID), ...idsFrom(s.EVALUATION_FAILED_ROLE_ID)]),
    ...roles.filter((r) => r.name === DOWNGRADE_ROLE_NAME).map((r) => r.id),
  ]);

  return { newIds, subIds: new Set(subIds), mainIds: new Set(mainIds), downgradeIds };
}

export function roleKind(kinds: RoleKinds, roleId: string): RoleKind | null {
  if (kinds.downgradeIds.has(roleId)) return 'downgrade';
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
