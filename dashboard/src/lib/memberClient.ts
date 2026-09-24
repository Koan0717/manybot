// Discordログインしたメンバー用のクライアント側ヘルパー（ブラウザ／Activity iframe 内でのみ使う）
import {
  ACTIVITY_QUERY_KEY,
  BACKUP_KEY,
  BACKUP_TTL_MS,
  TRANSIENT_PARAMS,
  WINDOW_NAME_PREFIX,
} from '@/lib/activityStash';

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

// 期限の延長は1日に1回で十分
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
let refreshing = false;

function tokenIssuedAt(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.iat === 'number' ? payload.iat * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * ログアウトするまでログインしたままにするため、メンバー画面を開いたときにセッションの期限を延ばす。
 * 通信に失敗しても今のトークンはそのまま使う（無効と分かったときだけ memberFetch がログイン画面に戻す）。
 */
export async function keepMemberSessionAlive(): Promise<void> {
  const state = loadMemberState();
  if (!state || refreshing) return;
  const issuedAt = tokenIssuedAt(state.token);
  if (issuedAt !== null && Date.now() - issuedAt < REFRESH_AFTER_MS) return;
  refreshing = true;
  try {
    const res = await memberFetch('/api/member/session', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    const current = loadMemberState();
    if (res.ok && data.token && current) saveMemberState({ ...current, token: data.token });
  } catch {
  } finally {
    refreshing = false;
  }
}

/** /api/member/* 用の fetch。トークンが無効（401）ならセッションを捨てて /login に戻す */
export async function memberFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const state = loadMemberState();
  const headers = new Headers(init.headers);
  if (state) headers.set('Authorization', `Bearer ${state.token}`);
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    clearMemberState();
    window.location.replace(`/login${window.location.search}`);
  }
  return res;
}

function stashActivityQuery(search: string) {
  const params = new URLSearchParams(search);
  TRANSIENT_PARAMS.forEach((key) => params.delete(key));
  const value = `?${params.toString()}`;
  try {
    sessionStorage.setItem(ACTIVITY_QUERY_KEY, value);
  } catch {}
  try {
    window.name = WINDOW_NAME_PREFIX + value;
  } catch {}
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ q: value, t: Date.now() }));
  } catch {}
}

function readStashedActivityQuery(): string | null {
  const readers = [
    () => sessionStorage.getItem(ACTIVITY_QUERY_KEY),
    () => (window.name.startsWith(WINDOW_NAME_PREFIX) ? window.name.slice(WINDOW_NAME_PREFIX.length) : null),
    () => {
      const backup = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null');
      return backup && Date.now() - backup.t < BACKUP_TTL_MS ? (backup.q as string) : null;
    },
  ];
  for (const read of readers) {
    try {
      const value = read();
      if (value && new URLSearchParams(value).get('frame_id')) return value;
    } catch {}
  }
  return null;
}

/**
 * Activity として起動されたときだけ、URL に frame_id 等が付く。Discord SDK は現在のURLからそれを読むため、
 * 画面遷移（リダイレクト）で失われていたら、退避しておいた起動パラメータをURLに戻す。
 * Activity ではない（frame_id が見つからない）場合は false。
 * ログイン画面を開いた時点でも呼んでおき、URLにあるうちに退避する。
 */
export function restoreActivityParams(): boolean {
  const current = new URLSearchParams(window.location.search);
  if (current.get('frame_id')) {
    stashActivityQuery(window.location.search);
    return true;
  }
  const stashed = readStashedActivityQuery();
  if (!stashed) return false;
  try {
    new URLSearchParams(stashed).forEach((value, key) => {
      if (!current.has(key)) current.set(key, value);
    });
    // Next.js のルーター状態(history.state)は保ったままURLだけ差し替える
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${current.toString()}`);
    return true;
  } catch {
    return false;
  }
}

// 「Activityの中から開いてください」が出たときに、原因を切り分けるための情報（値は出さず、名前と有無だけ）
function activityDiagnostics(): string {
  const keys = Array.from(new URLSearchParams(window.location.search).keys()).join(',') || 'なし';
  let inFrame = true;
  try {
    inFrame = window.self !== window.top;
  } catch {}
  const has = (read: () => unknown) => {
    try {
      return read() ? 'あり' : 'なし';
    } catch {
      return '使用不可';
    }
  };
  let redirects = '?';
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav) redirects = String(nav.redirectCount);
  } catch {}
  const parts = [
    `iframe=${inFrame ? 'はい' : 'いいえ'}`,
    `host=${window.location.host}`,
    `URLパラメータ=${keys}`,
    `退避(ss/name/ls)=${has(() => sessionStorage.getItem(ACTIVITY_QUERY_KEY))}/${has(() => window.name.startsWith(WINDOW_NAME_PREFIX))}/${has(() => localStorage.getItem(BACKUP_KEY))}`,
    `リダイレクト数=${redirects}`,
    `referrer=${document.referrer || 'なし'}`,
  ];
  return `診断r3: ${parts.join(' / ')}`;
}

const withTimeout = <T,>(promise: Promise<T>, ms: number, message: string) => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

async function fetchWithTimeout(input: string, init: RequestInit, ms: number, timeoutMessage: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error(timeoutMessage);
    throw new Error('サーバーに接続できませんでした');
  } finally {
    clearTimeout(timer);
  }
}

/** ログインの進行段階。止まったときにどこで止まったか分かるよう、画面にも出す */
export type LoginStep = 'config' | 'connect' | 'authorize' | 'verify';
export const LOGIN_STEP_LABEL: Record<LoginStep, string> = {
  config: 'Discordの設定を取得中...',
  connect: 'Discordに接続中...',
  authorize: 'Discordの許可画面を待っています...',
  verify: 'サーバーを確認中...',
};

/**
 * Discordアクティビティ内でのログイン。
 * SDK で認可コードを取得 → サーバーで検証・トークン発行 → セッションを保存。
 */
export async function discordActivityLogin(onStep?: (step: LoginStep) => void): Promise<MemberState> {
  const step = (s: LoginStep) => {
    console.info(`[discord-login] ${s}`);
    onStep?.(s);
  };

  if (!restoreActivityParams()) {
    throw new Error(
      `Discordアクティビティの起動パラメータが見つかりません [${activityDiagnostics()}]`
    );
  }

  // 1) クライアントIDはビルド時の環境変数に頼らず、サーバーから実行時に取得する
  step('config');
  const { clientId } = await fetchDiscordConfig();

  // 2) SDK の読み込みとDiscordクライアントとの接続（ハンドシェイク）
  step('connect');
  const sdk = await withTimeout(
    (async () => {
      const { DiscordSDK } = await import('@discord/embedded-app-sdk');
      // 上のawaitの間にNext.jsがURLを書き戻すことがあるので、SDKが同期的にURLを読む直前にもう一度保証する
      if (!restoreActivityParams()) {
        throw new Error(`Discordの起動パラメータ(frame_id)が失われました [${activityDiagnostics()}]`);
      }
      const instance = new DiscordSDK(clientId);
      await instance.ready();
      return instance;
    })(),
    15000,
    `Discordに接続できませんでした（時間切れ）。アクティビティを開き直してください [使用したクライアントID: ${clientId}]`
  );

  // 3) Discordの許可（認可）。初回は許可画面が出る
  step('authorize');
  let code: string;
  try {
    const result = await withTimeout(
      sdk.commands.authorize({
        client_id: clientId,
        response_type: 'code',
        state: '',
        prompt: 'none',
        scope: ['identify', 'guilds'],
      }),
      120000,
      'Discordの許可画面が完了しませんでした（時間切れ）'
    );
    code = result.code;
  } catch (e) {
    const detail = e instanceof Error ? e.message : (e as { message?: string })?.message;
    // Activity の認可には、Developer Portal の OAuth2 に Redirect URI が1つ登録されている必要がある
    const hint = detail?.includes('redirect_uri')
      ? '（Discord Developer Portal の OAuth2 → Redirects に https://127.0.0.1 を追加して保存してください）'
      : '';
    throw new Error(`Discordでの認可に失敗しました${detail ? `: ${detail}` : ''}${hint}`);
  }

  // 4) サーバー側で認可コードを検証し、所属サーバーを取得
  step('verify');
  return verifyCode({ code });
}

/** 認可コードをサーバーで検証し、メンバーのセッションを保存する（Activity・ブラウザ共通） */
async function verifyCode(body: { code: string; redirect_uri?: string }): Promise<MemberState> {
  const res = await fetchWithTimeout(
    '/api/member/discord-login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    30000,
    'サーバーの確認に時間がかかりすぎました（時間切れ）'
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Discordログインに失敗しました');
  }

  const state: MemberState = { token: data.token, user: data.user, guilds: data.guilds };
  saveMemberState(state);
  return state;
}

// ---- ブラウザ（Activity外）からのDiscordログイン：通常のOAuth2（認可コード方式） ----

const WEB_OAUTH_KEY = 'discord_web_oauth';
const WEB_OAUTH_CALLBACK_PATH = '/login/discord-callback';

async function fetchDiscordConfig(): Promise<{ clientId: string; redirectUri: string | null }> {
  const res = await fetchWithTimeout('/api/member/discord-config', {}, 15000, 'ダッシュボードから設定を取得できませんでした（時間切れ）');
  const config = await res.json().catch(() => ({}));
  if (!res.ok || !config.client_id) {
    throw new Error(config.error || 'DiscordのクライアントIDを取得できませんでした');
  }
  return { clientId: config.client_id, redirectUri: config.redirect_uri || null };
}

/** Discordの認可画面へ移動する（戻り先は /login/discord-callback） */
export async function startDiscordWebLogin(): Promise<void> {
  const { clientId, redirectUri: fixedRedirectUri } = await fetchDiscordConfig();
  const redirectUri = fixedRedirectUri || `${window.location.origin}${WEB_OAUTH_CALLBACK_PATH}`;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  // CSRF対策の state と、交換時に同じ値が必要な redirect_uri を覚えておく
  const saved = JSON.stringify({ state, redirectUri });
  try {
    sessionStorage.setItem(WEB_OAUTH_KEY, saved);
  } catch {
    throw new Error('ブラウザのストレージが使えないため、ログインできません');
  }

  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'identify guilds');
  url.searchParams.set('state', state);
  window.location.assign(url.toString());
}

/** /login/discord-callback で、Discordから戻ってきた認可コードを検証する */
export async function finishDiscordWebLogin(params: URLSearchParams): Promise<MemberState> {
  let saved: { state?: string; redirectUri?: string } | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(WEB_OAUTH_KEY) || 'null');
    sessionStorage.removeItem(WEB_OAUTH_KEY);
  } catch {}

  const error = params.get('error');
  if (error) {
    throw new Error(error === 'access_denied' ? 'Discordでの許可がキャンセルされました' : `Discordでの認可に失敗しました: ${error}`);
  }
  const code = params.get('code');
  const state = params.get('state');
  if (!code) throw new Error('Discordから認可コードが返ってきませんでした');
  if (!saved?.state || !saved.redirectUri || saved.state !== state) {
    throw new Error('ログインの確認に失敗しました（別のタブで開いたか、時間が経ちすぎています）。もう一度お試しください');
  }
  return verifyCode({ code, redirect_uri: saved.redirectUri });
}

/** Discordアクティビティとして開かれているか（起動パラメータ frame_id があるか） */
export function isDiscordActivity(): boolean {
  return restoreActivityParams();
}

// ログアウト直後は、Activity内でも自動でDiscordログインを始めない（専用ログインを選べるようにする）
const LOGGED_OUT_KEY = 'member_logged_out';

export function markLoggedOut() {
  try {
    sessionStorage.setItem(LOGGED_OUT_KEY, '1');
  } catch {}
}

export function consumeLoggedOut(): boolean {
  try {
    const value = sessionStorage.getItem(LOGGED_OUT_KEY);
    sessionStorage.removeItem(LOGGED_OUT_KEY);
    return value === '1';
  } catch {
    return false;
  }
}

export function guildIconUrl(guild: MemberGuild, size = 128): string | null {
  return guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=${size}` : null;
}
