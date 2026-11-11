import { Pool } from 'pg';
import { getGuildDbUrl, masterPool } from '@/lib/db';
import { initDoumoriSchema } from '@/lib/doumori/schema';

/**
 * どう森のデータを置くDBの選び方（どう森BOT本体と同じ）:
 *   1. メインダッシュボードの「データベース設定」でこのサーバー専用のDBが登録されていれば、それ
 *   2. 無ければ、旧どう森DB（環境変数 DOUMORI_DATABASE_URL、任意）
 *   3. どちらも無ければ未設定（初期設定が必要）
 */
const globalForDoumori = globalThis as unknown as {
  doumoriPools?: Map<string, Pool>;
  doumoriSchemaReady?: Map<string, Promise<void>>;
};
const pools = (globalForDoumori.doumoriPools ??= new Map());
const schemaReady = (globalForDoumori.doumoriSchemaReady ??= new Map());

const legacyUrl = () => (process.env.DOUMORI_DATABASE_URL || '').trim() || null;

export type DoumoriDbSource = 'guild' | 'legacy';

export class DoumoriNotConfiguredError extends Error {
  status = 409;
  constructor() {
    super('このサーバーのデータベースが未設定です。メインダッシュボードの「データベース設定」で登録してください。');
  }
}

/** このサーバーで使うDBの種類（未設定なら null） */
export async function getDoumoriDbSource(guildId: string): Promise<DoumoriDbSource | null> {
  if (await getGuildDbUrl(guildId)) return 'guild';
  return legacyUrl() ? 'legacy' : null;
}

function poolForUrl(url: string) {
  let pool = pools.get(url);
  if (!pool) {
    pool = new Pool({
      connectionString: url.replace('?sslmode=require', ''),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 30000,
      max: 5,
    });
    pools.set(url, pool);
  }
  return pool;
}

/** このサーバーのどう森DB。未設定なら DoumoriNotConfiguredError。初めて使うDBにはテーブルを作る */
export async function getDoumoriPool(guildId: string): Promise<{ pool: Pool; source: DoumoriDbSource }> {
  const guildUrl = await getGuildDbUrl(guildId);
  const url = guildUrl || legacyUrl();
  if (!url) throw new DoumoriNotConfiguredError();
  const pool = poolForUrl(url);
  if (!schemaReady.has(url)) {
    schemaReady.set(
      url,
      initDoumoriSchema(pool).catch((err) => {
        schemaReady.delete(url);
        throw err;
      })
    );
  }
  await schemaReady.get(url);
  return { pool, source: guildUrl ? 'guild' : 'legacy' };
}

/** サーバー専用DBが登録済みのサーバーID一覧（トップ画面の表示用） */
export async function listGuildsWithDedicatedDb(): Promise<string[]> {
  try {
    const res = await masterPool.query(
      "SELECT guild_id FROM guild_databases WHERE COALESCE(TRIM(database_url), '') <> ''"
    );
    return res.rows.map((r: any) => String(r.guild_id));
  } catch {
    return [];
  }
}

export const isLegacyDbConfigured = () => !!legacyUrl();

/** Discord の ID（数字だけ）かどうか */
export const isSnowflake = (v: unknown) => /^\d{1,21}$/.test(String(v ?? ''));

/** API ルート共通のエラーステータス */
export function errorStatus(error: any) {
  return error instanceof DoumoriNotConfiguredError ? 409 : 500;
}
