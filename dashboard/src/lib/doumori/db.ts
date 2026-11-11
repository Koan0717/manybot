import { Pool } from 'pg';

/**
 * どう森BOT専用のデータベース（ManyBot とは別の Supabase）。
 * どう森BOT本体と同じDBを直接読み書きするので、ここで保存した設定は Bot に即時反映される。
 *
 * 環境変数: DOUMORI_DATABASE_URL
 */
const globalForDoumori = globalThis as unknown as { doumoriPool: Pool | undefined };

const connectionString = process.env.DOUMORI_DATABASE_URL;

export class DoumoriNotConfiguredError extends Error {
  status = 503;
  constructor() {
    super('どう森BOTのデータベースが未設定です（環境変数 DOUMORI_DATABASE_URL を設定してください）');
  }
}

export const isDoumoriDbConfigured = () => !!connectionString;

/** どう森DBのコネクションプール。未設定なら DoumoriNotConfiguredError を投げる */
export function getDoumoriPool(): Pool {
  if (!connectionString) throw new DoumoriNotConfiguredError();
  if (!globalForDoumori.doumoriPool) {
    globalForDoumori.doumoriPool = new Pool({
      connectionString: connectionString.replace('?sslmode=require', ''),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 30000,
      max: 5,
    });
  }
  return globalForDoumori.doumoriPool;
}

/** Discord の ID（数字だけ）かどうか */
export const isSnowflake = (v: unknown) => /^\d{1,21}$/.test(String(v ?? ''));

/** API ルート共通のエラーレスポンス用 */
export function errorStatus(error: any) {
  return error instanceof DoumoriNotConfiguredError ? 503 : 500;
}
