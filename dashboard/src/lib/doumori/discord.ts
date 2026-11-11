/**
 * どう森BOTのトークンで Discord API を呼ぶ。
 *
 * 総合操作パネルのボタン（btn_fish など）は、パネルを送信した Bot にしか届かない。
 * そのため、パネル送信は必ずどう森BOTのトークン（DOUMORI_BOT_TOKEN）で行う。
 * チャンネル・ロール一覧の取得だけは、未設定なら ManyBot のトークンで代用する。
 */
const API = 'https://discord.com/api/v10';

const doumoriToken = () => process.env.DOUMORI_BOT_TOKEN || '';
const anyToken = () => doumoriToken() || process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || '';

export const isDoumoriBotConfigured = () => !!doumoriToken();

async function getList(path: string): Promise<any[]> {
  const token = anyToken();
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

/** どう森BOTが参加しているサーバー一覧（トークン未設定なら null） */
export async function listDoumoriGuilds(): Promise<{ id: string; name: string; icon: string | null }[] | null> {
  const token = doumoriToken();
  if (!token) return null;
  const all: { id: string; name: string; icon: string | null }[] = [];
  let after = '';
  for (let page = 0; page < 10; page++) {
    const res = await fetch(`${API}/users/@me/guilds?limit=200${after ? `&after=${after}` : ''}`, {
      headers: { Authorization: `Bot ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Discord API error: ${res.status}`);
    const batch = await res.json();
    all.push(...batch.map((g: any) => ({ id: String(g.id), name: g.name, icon: g.icon ?? null })));
    if (batch.length < 200) break;
    after = batch[batch.length - 1].id;
  }
  return all;
}

export async function sendChannelMessage(channelId: string, payload: any) {
  const token = doumoriToken();
  if (!token) return { ok: false, error: 'DOUMORI_BOT_TOKEN（どう森BOTのトークン）が設定されていません' };

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
