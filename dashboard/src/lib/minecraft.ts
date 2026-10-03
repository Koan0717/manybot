import crypto from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextResponse } from 'next/server';
import { masterPool, getPool } from '@/lib/db';
import { DiscordApiError, DiscordGuildMember, DiscordRole, botRequest, memberDisplayName } from '@/lib/discordApi';
import { isGuildAdmin } from '@/lib/memberAdmin';

/**
 * マイクラ（統合版 / Bedrock Dedicated Server）連携。
 *
 * - マスターDBの minecraft_servers: サーバー（Discordギルド）ごとの連携設定・APIキー・接続状態。
 *   アドオンはAPIキーだけを送ってくるので、キー → ギルドの対応はマスターDBで引く。
 * - ギルドのDB（getPool）: プレイヤー連携・取引履歴・入退出ログ。
 *   残高は Bot と同じ users.balance をそのまま使うので、マイクラ内の通貨 = 鯖内通貨になる。
 */

/** リポジトリ内の minecraft-addon/ の最新バージョン（アドオンが送ってくる値と比べて「更新あり」を出す） */
export const LATEST_ADDON_VERSION = '1.3.0';

/** ハートビートがこれより古ければ「オフライン」扱い（アドオンは60秒ごとに送る） */
export const HEARTBEAT_TIMEOUT_MS = 3 * 60 * 1000;

/** users.balance は INTEGER なので、1回の増減はこの範囲に収める */
export const MAX_MC_AMOUNT = 1_000_000_000;

const LINK_CODE_TTL_MIN = 10;

export interface Lobby {
  x: number;
  y: number;
  z: number;
  /** minecraft:overworld / minecraft:nether / minecraft:the_end */
  dimension: string;
}

export const LOBBY_DIMENSIONS = ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end'] as const;

export interface SellPrice {
  item: string;
  price: number;
  /** ゲーム内ショップでの表示名（未設定ならアイテムIDを表示） */
  label?: string;
}

export interface MinecraftServerRow {
  guild_id: string;
  api_key_hint: string | null;
  is_enabled: boolean;
  join_leave_channel_id: string | null;
  trade_log_channel_id: string | null;
  allow_pay: boolean;
  allow_sell: boolean;
  allow_market: boolean;
  sell_prices: SellPrice[];
  lobby: Lobby | null;
  server_name: string | null;
  addon_version: string | null;
  addon_info: Record<string, unknown>;
  online_players: string[];
  max_players: number | null;
  last_heartbeat_at: string | null;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
}

let masterEnsured: Promise<void> | null = null;

export function ensureMinecraftMasterSchema(): Promise<void> {
  if (!masterEnsured) {
    masterEnsured = masterPool
      .query(`
        CREATE TABLE IF NOT EXISTS minecraft_servers (
          guild_id VARCHAR(50) PRIMARY KEY,
          api_key_hash TEXT UNIQUE,
          api_key_hint TEXT,
          is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          join_leave_channel_id VARCHAR(50),
          trade_log_channel_id VARCHAR(50),
          allow_pay BOOLEAN NOT NULL DEFAULT TRUE,
          allow_sell BOOLEAN NOT NULL DEFAULT TRUE,
          allow_market BOOLEAN NOT NULL DEFAULT TRUE,
          sell_prices JSONB NOT NULL DEFAULT '[]',
          server_name TEXT,
          addon_version TEXT,
          addon_info JSONB NOT NULL DEFAULT '{}',
          online_players JSONB NOT NULL DEFAULT '[]',
          max_players INT,
          last_heartbeat_at TIMESTAMPTZ,
          last_event_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      // 後から追加したカラム
      .then(() => masterPool.query('ALTER TABLE minecraft_servers ADD COLUMN IF NOT EXISTS allow_market BOOLEAN NOT NULL DEFAULT TRUE'))
      .then(() => masterPool.query('ALTER TABLE minecraft_servers ADD COLUMN IF NOT EXISTS lobby JSONB'))
      .then(() => undefined)
      .catch((e) => {
        masterEnsured = null; // 次のリクエストでやり直す
        throw e;
      });
  }
  return masterEnsured;
}

const guildEnsured = new WeakSet<Pool>();

export async function ensureMinecraftGuildSchema(pool: Pool): Promise<void> {
  if (guildEnsured.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS minecraft_links (
      guild_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      mc_name TEXT NOT NULL,
      mc_name_lower TEXT NOT NULL,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, mc_name_lower),
      UNIQUE (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS minecraft_link_codes (
      guild_id BIGINT NOT NULL,
      code TEXT NOT NULL,
      mc_name TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (guild_id, code)
    );
    CREATE TABLE IF NOT EXISTS minecraft_transactions (
      id BIGSERIAL PRIMARY KEY,
      guild_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      mc_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount BIGINT NOT NULL,
      detail TEXT,
      balance_after BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_minecraft_transactions_guild ON minecraft_transactions (guild_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS minecraft_events (
      id BIGSERIAL PRIMARY KEY,
      guild_id BIGINT NOT NULL,
      kind TEXT NOT NULL,
      mc_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_minecraft_events_guild ON minecraft_events (guild_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS minecraft_listings (
      id BIGSERIAL PRIMARY KEY,
      guild_id BIGINT NOT NULL,
      seller_user_id BIGINT NOT NULL,
      seller_mc_name TEXT NOT NULL,
      item TEXT NOT NULL,
      name_key TEXT,
      quantity INT NOT NULL CHECK (quantity > 0),
      unit_price BIGINT NOT NULL CHECK (unit_price > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_minecraft_listings_guild ON minecraft_listings (guild_id, seller_user_id);
    -- 連携時・参加時に取り直すDiscord側の情報と、OPの反映状況（後から追加したカラム）
    ALTER TABLE minecraft_links ADD COLUMN IF NOT EXISTS discord_name TEXT;
    ALTER TABLE minecraft_links ADD COLUMN IF NOT EXISTS role_names JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE minecraft_links ADD COLUMN IF NOT EXISTS is_staff BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE minecraft_links ADD COLUMN IF NOT EXISTS in_guild BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE minecraft_links ADD COLUMN IF NOT EXISTS roles_checked_at TIMESTAMPTZ;
    ALTER TABLE minecraft_links ADD COLUMN IF NOT EXISTS op_status TEXT;
    ALTER TABLE minecraft_links ADD COLUMN IF NOT EXISTS op_reported_at TIMESTAMPTZ;
  `);
  guildEnsured.add(pool);
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): string {
  return `mbmc_${crypto.randomBytes(24).toString('base64url')}`;
}

function toServerRow(r: any): MinecraftServerRow {
  return {
    guild_id: String(r.guild_id),
    api_key_hint: r.api_key_hint ?? null,
    is_enabled: r.is_enabled !== false,
    join_leave_channel_id: r.join_leave_channel_id ?? null,
    trade_log_channel_id: r.trade_log_channel_id ?? null,
    allow_pay: r.allow_pay !== false,
    allow_sell: r.allow_sell !== false,
    allow_market: r.allow_market !== false,
    lobby: parseLobby(r.lobby),
    sell_prices: Array.isArray(r.sell_prices) ? r.sell_prices : [],
    server_name: r.server_name ?? null,
    addon_version: r.addon_version ?? null,
    addon_info: r.addon_info && typeof r.addon_info === 'object' ? r.addon_info : {},
    online_players: Array.isArray(r.online_players) ? r.online_players : [],
    max_players: r.max_players ?? null,
    last_heartbeat_at: r.last_heartbeat_at ? new Date(r.last_heartbeat_at).toISOString() : null,
    last_event_at: r.last_event_at ? new Date(r.last_event_at).toISOString() : null,
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
  };
}

const SERVER_COLUMNS = `guild_id, api_key_hint, is_enabled, join_leave_channel_id, trade_log_channel_id,
  allow_pay, allow_sell, allow_market, sell_prices, lobby, server_name, addon_version, addon_info, online_players, max_players,
  last_heartbeat_at, last_event_at, created_at, updated_at`;

export async function getMinecraftServer(guildId: string): Promise<MinecraftServerRow | null> {
  await ensureMinecraftMasterSchema();
  const res = await masterPool.query(`SELECT ${SERVER_COLUMNS} FROM minecraft_servers WHERE guild_id = $1`, [guildId]);
  return res.rows[0] ? toServerRow(res.rows[0]) : null;
}

export async function listMinecraftServers(): Promise<MinecraftServerRow[]> {
  await ensureMinecraftMasterSchema();
  const res = await masterPool.query(`SELECT ${SERVER_COLUMNS} FROM minecraft_servers ORDER BY updated_at DESC`);
  return res.rows.map(toServerRow);
}

export function isServerOnline(row: Pick<MinecraftServerRow, 'last_heartbeat_at'>): boolean {
  return !!row.last_heartbeat_at && Date.now() - new Date(row.last_heartbeat_at).getTime() < HEARTBEAT_TIMEOUT_MS;
}

/** プレイヤー名（ゲーマータグ）として受け付ける形。空白を含む名前もあるので英数字・空白・_ - を許可 */
export function normalizePlayerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (!name || name.length > 32 || !/^[A-Za-z0-9 _\-]+$/.test(name)) return null;
  return name;
}

export function parseCurrencyName(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return 'コイン';
  try {
    const v = JSON.parse(raw);
    return typeof v === 'string' || typeof v === 'number' ? String(v) : raw;
  } catch {
    return raw;
  }
}

export async function getCurrencyName(pool: Pool, guildId: string): Promise<string> {
  try {
    const r = await pool.query("SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = 'CURRENCY_NAME'", [guildId]);
    return parseCurrencyName(r.rows[0]?.setting_value);
  } catch {
    return 'コイン';
  }
}

// ------------------------------------------------------------
// アドオンからのリクエスト
// ------------------------------------------------------------

export type AddonAuth =
  | { ok: true; server: MinecraftServerRow; guildId: string; pool: Pool }
  | { ok: false; response: NextResponse };

export function addonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * アドオンのリクエストを X-ManyBot-Key（BDSの secrets.json に入れたAPIキー）で認証する。
 * 統合版の @minecraft/server-admin の SecretString は文字列連結できないので、
 * Authorization: Bearer ではなくキーだけを入れる専用ヘッダーで受け取る。
 */
export async function requireAddon(request: Request): Promise<AddonAuth> {
  const key = request.headers.get('x-manybot-key')?.trim();
  if (!key) return { ok: false, response: addonError('APIキーがありません', 401) };
  try {
    await ensureMinecraftMasterSchema();
    const res = await masterPool.query(
      `SELECT ${SERVER_COLUMNS} FROM minecraft_servers WHERE api_key_hash = $1`,
      [hashApiKey(key)]
    );
    if (!res.rows[0]) return { ok: false, response: addonError('APIキーが無効です', 401) };
    const server = toServerRow(res.rows[0]);
    if (!server.is_enabled) return { ok: false, response: addonError('このサーバーのマイクラ連携はOFFになっています', 403) };
    const pool = await getPool(server.guild_id);
    await ensureMinecraftGuildSchema(pool);
    return { ok: true, server, guildId: server.guild_id, pool };
  } catch (e) {
    console.error('requireAddon failed:', e);
    return { ok: false, response: addonError('サーバー内部エラー', 500) };
  }
}

export function parseLobby(raw: any): Lobby | null {
  if (!raw || typeof raw !== 'object') return null;
  const [x, y, z] = [Number(raw.x), Number(raw.y), Number(raw.z)];
  if (![x, y, z].every(Number.isFinite)) return null;
  const dimension = (LOBBY_DIMENSIONS as readonly string[]).includes(raw.dimension) ? raw.dimension : 'minecraft:overworld';
  return { x, y, z, dimension };
}

// ------------------------------------------------------------
// Discordのロール・運営かどうか（OPの付与に使う）
// ------------------------------------------------------------

export interface DiscordStatus {
  in_guild: boolean;
  is_staff: boolean;
  discord_name: string | null;
  role_names: string[];
}

/** メンバー情報から、表示名・ロール名（上位順）・運営（基本・評価設定の「運営管理者ロール」）を出す */
export async function discordStatusOf(guildId: string, member: DiscordGuildMember, roles?: DiscordRole[]): Promise<DiscordStatus> {
  const allRoles = roles ?? (await botRequest<DiscordRole[]>(`/guilds/${guildId}/roles`));
  const held = allRoles
    .filter((r) => member.roles.includes(r.id))
    .sort((a, b) => b.position - a.position)
    .map((r) => r.name);
  return { in_guild: true, is_staff: await isGuildAdmin(guildId, member), discord_name: memberDisplayName(member), role_names: held };
}

/** Discordから取り直す。サーバーにいなければ in_guild=false・運営ではない扱い */
export async function fetchDiscordStatus(guildId: string, userId: string, roles?: DiscordRole[]): Promise<DiscordStatus> {
  try {
    const member = await botRequest<DiscordGuildMember>(`/guilds/${guildId}/members/${userId}`);
    return await discordStatusOf(guildId, member, roles);
  } catch (e) {
    if (e instanceof DiscordApiError && e.status === 404) return { in_guild: false, is_staff: false, discord_name: null, role_names: [] };
    throw e;
  }
}

export async function saveDiscordStatus(pool: Pool | PoolClient, guildId: string, userId: string, st: DiscordStatus) {
  await pool.query(
    `UPDATE minecraft_links SET in_guild = $3, is_staff = $4, discord_name = COALESCE($5, discord_name), role_names = $6::jsonb, roles_checked_at = NOW()
     WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId, st.in_guild, st.is_staff, st.discord_name, JSON.stringify(st.role_names.slice(0, 50))]
  );
}

/** Discordから取り直して保存する。失敗したら前回の保存内容のまま（null） */
export async function refreshDiscordStatus(pool: Pool, guildId: string, userId: string): Promise<DiscordStatus | null> {
  try {
    const st = await fetchDiscordStatus(guildId, userId);
    await saveDiscordStatus(pool, guildId, userId, st);
    return st;
  } catch (e) {
    console.error('refreshDiscordStatus failed:', e);
    return null;
  }
}

export async function findLinkByName(pool: Pool | PoolClient, guildId: string, mcName: string) {
  const r = await pool.query(
    'SELECT user_id::text AS user_id, mc_name FROM minecraft_links WHERE guild_id = $1 AND mc_name_lower = $2',
    [guildId, mcName.toLowerCase()]
  );
  return (r.rows[0] as { user_id: string; mc_name: string } | undefined) ?? null;
}

export async function getBalance(pool: Pool, guildId: string, userId: string): Promise<number> {
  const r = await pool.query('SELECT balance FROM users WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
  return Number(r.rows[0]?.balance ?? 0);
}

/** 6桁の連携コードを発行する（同じプレイヤーの古いコードは消す） */
export async function issueLinkCode(pool: Pool, guildId: string, mcName: string): Promise<string> {
  await pool.query('DELETE FROM minecraft_link_codes WHERE guild_id = $1 AND (expires_at < NOW() OR lower(mc_name) = $2)', [
    guildId,
    mcName.toLowerCase(),
  ]);
  for (let i = 0; i < 5; i++) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const r = await pool.query(
      `INSERT INTO minecraft_link_codes (guild_id, code, mc_name, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '${LINK_CODE_TTL_MIN} minutes')
       ON CONFLICT DO NOTHING RETURNING code`,
      [guildId, code, mcName]
    );
    if (r.rows[0]) return code;
  }
  throw new Error('連携コードを発行できませんでした');
}

export const LINK_CODE_TTL_SECONDS = LINK_CODE_TTL_MIN * 60;

/**
 * 残高を増減してマイクラ取引履歴に残す（トランザクション内で呼ぶ）。
 * 減らすときに残高が足りなければ null を返す。
 */
export async function applyBalanceChange(
  client: PoolClient,
  row: { guildId: string; userId: string; mcName: string; kind: string; amount: number; detail?: string | null }
): Promise<number | null> {
  await client.query('INSERT INTO users (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [row.guildId, row.userId]);
  const upd = await client.query(
    `UPDATE users SET balance = balance + $1
     WHERE guild_id = $2 AND user_id = $3 AND balance + $1 >= 0
     RETURNING balance`,
    [row.amount, row.guildId, row.userId]
  );
  if (!upd.rows[0]) return null;
  const balance = Number(upd.rows[0].balance);
  await client.query(
    `INSERT INTO minecraft_transactions (guild_id, user_id, mc_name, kind, amount, detail, balance_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.guildId, row.userId, row.mcName, row.kind, row.amount, row.detail ?? null, balance]
  );
  return balance;
}

/** 設定されたチャンネルにメッセージを送る。失敗してもゲーム側の処理は止めない */
export async function postToChannel(channelId: string | null, payload: Record<string, unknown>): Promise<boolean> {
  if (!channelId) return false;
  try {
    await botRequest(`/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
    });
    return true;
  } catch (e) {
    console.error('minecraft log message failed:', e);
    return false;
  }
}

export async function sendTradeLog(
  server: MinecraftServerRow,
  embed: { title: string; description: string; color?: number; fields?: { name: string; value: string; inline?: boolean }[] }
) {
  await postToChannel(server.trade_log_channel_id, {
    embeds: [{ color: 0x22c55e, timestamp: new Date().toISOString(), footer: { text: 'Minecraft' }, ...embed }],
  });
}

export const MC_TX_KIND_LABEL: Record<string, string> = {
  sell: 'アイテム売却',
  pay_out: '送金（送った）',
  pay_in: '送金（受け取った）',
  adjust: 'アドオンからの増減',
  market_sell: 'マーケットで売れた',
  market_buy: 'マーケットで購入',
};

// ------------------------------------------------------------
// マーケット（プレイヤー同士の出品・購入）
// ------------------------------------------------------------

/** 1人が同時に出せる出品の数 */
export const MAX_LISTINGS_PER_PLAYER = 20;
/** 1回の出品の最大個数（インベントリ全部 = 36枠 × 64） */
export const MAX_LISTING_QUANTITY = 64 * 36;

export const ITEM_TYPE_ID = /^[a-z0-9_.\-]+:[a-z0-9_.\-/]+$/;

export interface Listing {
  id: string;
  seller_user_id: string;
  seller_mc_name: string;
  item: string;
  name_key: string | null;
  quantity: number;
  unit_price: number;
  created_at: string;
}

export async function listListings(pool: Pool, guildId: string, sellerUserId?: string): Promise<Listing[]> {
  const r = await pool.query(
    `SELECT id::text, seller_user_id::text, seller_mc_name, item, name_key, quantity, unit_price::text AS unit_price, created_at
     FROM minecraft_listings
     WHERE guild_id = $1 AND ($2::bigint IS NULL OR seller_user_id = $2)
     ORDER BY seller_mc_name, created_at`,
    [guildId, sellerUserId ?? null]
  );
  return r.rows.map((x) => ({ ...x, quantity: Number(x.quantity), unit_price: Number(x.unit_price) }));
}
