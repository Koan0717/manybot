import type { Pool } from 'pg';
import type { DiscordGuildMember } from '@/lib/discordApi';

/**
 * 評価落ち・違反者のメンバーが、アクティビティ・Webのカジノ・ショップ・ガチャを使えるか。
 * 管理ダッシュボード「Webアクティビティ設定」の WEB_ROLE_ACCESS で決める（未設定は使える）。
 * 評価落ち・違反者の判定は「基本・評価設定」の評価落ちロール・違反者ロールで行う。
 */
export const WEB_ROLE_ACCESS_KEY = 'WEB_ROLE_ACCESS';
export type WebFeature = 'casino' | 'shop' | 'gacha';
export type RoleAccess = Record<'downgrade' | 'violator', Record<WebFeature, boolean>>;

export function parseRoleAccess(raw: unknown): RoleAccess {
  let v: any = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      v = null;
    }
  }
  const pick = (group: string, feature: WebFeature) => v?.[group]?.[feature] !== false; // 明示的にOFFのときだけ使えない
  return {
    downgrade: { casino: pick('downgrade', 'casino'), shop: pick('downgrade', 'shop'), gacha: pick('downgrade', 'gacha') },
    violator: { casino: pick('violator', 'casino'), shop: pick('violator', 'shop'), gacha: pick('violator', 'gacha') },
  };
}

/** 設定値からロールIDを取り出す。16桁以上の数字は JSON の数値だと精度が落ちるので文字列として読む */
export function idsFrom(raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === '') return [];
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return Array.from(new Set(text.match(/\d{15,25}/g) ?? []));
}

export interface MemberFlags {
  downgrade: boolean;
  violator: boolean;
  access: RoleAccess;
}

export async function getMemberFlags(pool: Pool, guildId: string, member: DiscordGuildMember): Promise<MemberFlags> {
  const s: Record<string, unknown> = {};
  try {
    const res = await pool.query(
      `SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key IN
         ('DOWNGRADE_ROLE_ID', 'GAMBLE_VIOLATOR_ROLE_IDS', $2)`,
      [guildId, WEB_ROLE_ACCESS_KEY]
    );
    for (const row of res.rows) s[row.setting_key] = row.setting_value;
  } catch (e: any) {
    if (e?.code !== '42P01') throw e;
  }
  const has = (ids: string[]) => ids.some((id) => member.roles.includes(id));
  // 判定は「基本・評価設定」の評価落ちロール・違反者ロールだけ（未設定なら誰も当てはまらない）
  return {
    downgrade: has(idsFrom(s.DOWNGRADE_ROLE_ID)),
    violator: has(idsFrom(s.GAMBLE_VIOLATOR_ROLE_IDS)),
    access: parseRoleAccess(s[WEB_ROLE_ACCESS_KEY]),
  };
}

/** その機能を使えるか。評価落ち・違反者の両方に当てはまるなら、どちらか一方でもOFFなら使えない */
export function canUseFeature(flags: MemberFlags, feature: WebFeature): boolean {
  if (flags.downgrade && !flags.access.downgrade[feature]) return false;
  if (flags.violator && !flags.access.violator[feature]) return false;
  return true;
}
