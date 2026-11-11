/**
 * どう森BOT用の Discord API 呼び出し。
 *
 * どう森BOTは ManyBot と同じトークン（同じアプリ）で動かすので、ManyBot のトークンを使う。
 * 総合操作パネルのボタン（btn_fish など）は ManyBot と同じアプリに届き、どう森BOTのプロセスが処理する。
 */
const API = 'https://discord.com/api/v10';

const botToken = () => process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || '';

async function getList(path: string): Promise<any[]> {
  const token = botToken();
  if (!token) return [];
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bot ${token}` },
    cache: 'no-store',
  }).catch(() => null);
  if (!res || !res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

export const fetchGuildChannels = (guildId: string) => getList(`/guilds/${guildId}/channels`);
export const fetchGuildRoles = (guildId: string) => getList(`/guilds/${guildId}/roles`);

/**
 * どう森の機能を動かすサーバー。どう森BOT本体・ManyBot と同じ環境変数 DOUMORI_GUILD_ID（カンマ区切り）で、
 * 未設定ならどう森サーバー。
 */
export const doumoriGuildIds = () =>
  (process.env.DOUMORI_GUILD_ID || '1526696870724894780')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));

export async function sendChannelMessage(channelId: string, payload: any) {
  const token = botToken();
  if (!token) return { ok: false, error: 'DISCORD_BOT_TOKEN が設定されていません' };

  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.message || res.statusText };
  }
  return { ok: true };
}
