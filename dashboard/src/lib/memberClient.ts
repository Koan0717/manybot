// Discordログインしたメンバー用のクライアント側ヘルパー（ブラウザ／Activity iframe 内でのみ使う）

export interface MemberUser {
  id: string;
  name: string;
  avatar_url: string;
}

export interface MemberGuild {
  id: string;
  name: string;
  icon: string | null;
}

export interface MemberState {
  token: string;
  user: MemberUser;
  guilds: MemberGuild[];
}

// 管理者用の 'dashboard_session' とは別のキーにする
const STORAGE_KEY = 'member_session';

// localStorage が使えない環境（iframe のストレージ制限など）でも、ページ遷移の間は保持する
let memoryState: MemberState | null = null;

export function saveMemberState(state: MemberState) {
  memoryState = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function loadMemberState(): MemberState | null {
  if (memoryState) return memoryState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MemberState;
      if (parsed?.token && parsed.user && Array.isArray(parsed.guilds)) {
        memoryState = parsed;
        return parsed;
      }
    }
  } catch {}
  return null;
}

export function clearMemberState() {
  memoryState = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** /api/member/* 用の fetch。トークンが無効（401）ならセッションを捨てて /login に戻す */
export async function memberFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const state = loadMemberState();
  const headers = new Headers(init.headers);
  if (state) headers.set('Authorization', `Bearer ${state.token}`);
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    clearMemberState();
    window.location.replace('/login');
  }
  return res;
}

/**
 * Discordアクティビティ内でのログイン。
 * SDK で認可コードを取得 → サーバーで検証・トークン発行 → セッションを保存。
 */
export async function discordActivityLogin(): Promise<MemberState> {
  // Activity として起動されたときだけ frame_id が付く
  if (!new URLSearchParams(window.location.search).get('frame_id')) {
    throw new Error('Discordアクティビティの中から開いてください（ブラウザからのDiscordログインには未対応です）');
  }

  // クライアントIDはビルド時の環境変数に頼らず、サーバーから実行時に取得する
  const configRes = await fetch('/api/member/discord-config');
  const config = await configRes.json().catch(() => ({}));
  const clientId: string | undefined = config.client_id;
  if (!configRes.ok || !clientId) {
    throw new Error(config.error || 'DiscordのクライアントIDを取得できませんでした');
  }

  const { DiscordSDK } = await import('@discord/embedded-app-sdk');
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();

  let code: string;
  try {
    const result = await sdk.commands.authorize({
      client_id: clientId,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify', 'guilds'],
    });
    code = result.code;
  } catch {
    throw new Error('Discordでの認可がキャンセルされました');
  }

  const res = await fetch('/api/member/discord-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Discordログインに失敗しました');
  }

  const state: MemberState = { token: data.token, user: data.user, guilds: data.guilds };
  saveMemberState(state);
  return state;
}

export function guildIconUrl(guild: MemberGuild, size = 128): string | null {
  return guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=${size}` : null;
}
