import type { Pool } from 'pg';

/**
 * ダッシュボード「経済・レベリング設定」の「Botへの送金を許可する」(ALLOW_PAY_TO_BOT)。
 * 未設定はON（許可）。Bot本体の /pay（cogs/economy.py）も同じキーを見る。
 */
export async function isBotTransferAllowed(pool: Pool, guildId: string): Promise<boolean> {
  let raw: unknown;
  try {
    const res = await pool.query(
      "SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = 'ALLOW_PAY_TO_BOT'",
      [guildId]
    );
    raw = res.rows[0]?.setting_value;
  } catch (e: any) {
    if (e?.code === '42P01') return true; // bot_settings テーブル自体が無い＝未設定
    throw e; // 制限の読み取りに失敗したら許可側に倒さず、呼び出し元でエラーにする
  }
  if (typeof raw !== 'string') return true;
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {}
  return !(value === false || value === 'false' || value === 0);
}
