const API = 'https://discord.com/api/v10';

export class DiscordApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
}

export interface DiscordGuildSummary {
  id: string;
  name: string;
  icon: string | null;
}

export interface DiscordGuildMember {
  user: DiscordUser;
  nick?: string | null;
  avatar?: string | null;
  roles: string[];
  joined_at?: string | null;
}

export interface DiscordRole {
  id: string;
  name: string;
  color: number;
  position: number;
  managed?: boolean;
}

async function request<T>(path: string, authorization: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: authorization, ...(init.headers || {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new DiscordApiError(res.status, `Discord API error: ${res.status} ${path}`);
  }
  return res.json() as Promise<T>;
}

function botAuthorization(): string {
  const token = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN;
  if (!token) throw new DiscordApiError(500, 'DISCORD_BOT_TOKEN is not set');
  return `Bot ${token}`;
}

export const botRequest = <T>(path: string, init?: RequestInit) =>
  request<T>(path, botAuthorization(), init);

export const userRequest = <T>(path: string, accessToken: string) =>
  request<T>(path, `Bearer ${accessToken}`);

/** /users/@me/guilds は最大200件ずつなので、after で続きを辿る */
export async function listAllGuilds(authorization: string): Promise<DiscordGuildSummary[]> {
  const all: DiscordGuildSummary[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const query = `?limit=200${after ? `&after=${after}` : ''}`;
    const batch = await request<DiscordGuildSummary[]>(`/users/@me/guilds${query}`, authorization);
    all.push(...batch.map((g) => ({ id: g.id, name: g.name, icon: g.icon ?? null })));
    if (batch.length < 200) break;
    after = batch[batch.length - 1].id;
  }
  return all;
}

export const listBotGuilds = () => listAllGuilds(botAuthorization());
export const listUserGuilds = (accessToken: string) => listAllGuilds(`Bearer ${accessToken}`);

let cachedClientId: string | null = null;

/**
 * DiscordアプリケーションのクライアントID。
 * 環境変数があればそれを使い、無ければ DISCORD_BOT_TOKEN から Discord API で取得する
 * （/api/system/status と同じ方式。NEXT_PUBLIC_ の値はビルド時に埋め込まれるため、実行時に取れる形にしてある）。
 */
export async function getClientId(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID;
  if (fromEnv) return fromEnv;
  if (cachedClientId) return cachedClientId;
  const app = await botRequest<{ id: string }>('/oauth2/applications/@me');
  cachedClientId = app.id;
  return app.id;
}

/** ブラウザ（Activity外）からのDiscordログインで、Discordから戻ってくるページ */
export const WEB_OAUTH_CALLBACK_PATH = '/login/discord-callback';

/**
 * 認可コードをアクセストークンに交換する。
 * redirectUri は、ブラウザでの通常のOAuth2（認可時に redirect_uri を指定したもの）のときだけ渡す。
 * Activity の SDK で得たコードは redirect_uri なしで交換する。
 */
export async function exchangeCodeForToken(code: string, redirectUri?: string): Promise<string> {
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientSecret) {
    throw new DiscordApiError(500, 'DISCORD_CLIENT_SECRET が未設定です');
  }
  let clientId: string;
  try {
    clientId = await getClientId();
  } catch {
    throw new DiscordApiError(500, 'DiscordのクライアントIDを取得できませんでした（DISCORD_BOT_TOKEN を確認してください）');
  }

  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new DiscordApiError(401, `Discord token exchange failed: ${res.status}`);
  }
  const data = await res.json();
  if (typeof data.access_token !== 'string') {
    throw new DiscordApiError(401, 'Discord token exchange returned no access_token');
  }
  return data.access_token;
}

export function userAvatarUrl(user: DiscordUser): string {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  }
  const index = Number((BigInt(user.id) >> BigInt(22)) % BigInt(6));
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function memberAvatarUrl(guildId: string, member: DiscordGuildMember): string {
  if (member.avatar) {
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${member.user.id}/avatars/${member.avatar}.png?size=128`;
  }
  return userAvatarUrl(member.user);
}

export function memberDisplayName(member: DiscordGuildMember): string {
  return member.nick || member.user.global_name || member.user.username;
}
