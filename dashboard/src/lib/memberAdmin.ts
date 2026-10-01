import { getPool } from '@/lib/db';
import type { DiscordGuildMember } from '@/lib/discordApi';
import { idsFrom } from '@/lib/webAccess';

/**
 * Discordログインしたメンバーが、そのサーバーの運営か。
 * 管理ダッシュボード「基本・評価設定」の「運営管理者ロール」(ADMIN_ROLE_IDS) を1つでも持っていれば運営。
 * 未設定なら誰も当てはまらない。
 */
export async function isGuildAdmin(guildId: string, member: DiscordGuildMember): Promise<boolean> {
  let raw: unknown = null;
  try {
    const pool = await getPool(guildId);
    const res = await pool.query("SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = 'ADMIN_ROLE_IDS'", [guildId]);
    raw = res.rows[0]?.setting_value ?? null;
  } catch (e: any) {
    if (e?.code !== '42P01') throw e;
  }
  const ids = idsFrom(raw);
  return ids.some((id) => member.roles.includes(id));
}
