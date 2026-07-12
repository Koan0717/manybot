import { cookies } from 'next/headers';
import crypto from 'crypto';
import * as jose from 'jose';
import bcrypt from 'bcryptjs';
import { masterPool } from '@/lib/db';

const COOKIE_NAME = 'dashboard_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

const jwtSecretStr = process.env.JWT_SECRET || 'fallback_secret_key_change_me_later';
const jwtSecret = new TextEncoder().encode(jwtSecretStr);

export interface SessionPayload {
  username: string;
  role: 'admin' | 'shop' | 'gambling';
  guild_id?: string;
  iat?: number;
  exp?: number;
}

/**
 * Validate credentials against environment variables or database
 */
export async function validateCredentials(username: string, password: string): Promise<SessionPayload | null> {
  const adminUsername = process.env.DASHBOARD_USERNAME;
  const adminPassword = process.env.DASHBOARD_PASSWORD;

  // Check if it's the super admin
  if (adminUsername && adminPassword) {
    if (
      username.length === adminUsername.length &&
      crypto.timingSafeEqual(Buffer.from(username), Buffer.from(adminUsername)) &&
      password.length === adminPassword.length &&
      crypto.timingSafeEqual(Buffer.from(password), Buffer.from(adminPassword))
    ) {
      return { username, role: 'admin' };
    }
  }

  // Check database for sub-accounts
  try {
    const res = await masterPool.query('SELECT * FROM dashboard_users WHERE username = $1', [username]);
    if (res.rows.length > 0) {
      const user = res.rows[0];
      const match = await bcrypt.compare(password, user.password);
      if (match) {
        return {
          username: user.username,
          role: user.role as 'admin' | 'shop' | 'gambling',
          guild_id: user.guild_id,
        };
      }
    }
  } catch (error) {
    console.error('Failed to validate credentials against DB:', error);
  }

  return null;
}

/**
 * Create a new session and return the JWT token
 */
export async function createSession(payload: SessionPayload): Promise<string> {
  const jwt = await new jose.SignJWT(payload as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(jwtSecret);
  
  return jwt;
}

/**
 * Validate a session token
 */
export async function validateSession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, jwtSecret);
    return payload as unknown as SessionPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Delete a session (logout) - JWTs are stateless so we just clear the cookie on the client side
 */
export function deleteSession(token: string): void {
  // No-op for stateless JWT
}

/**
 * Get session cookie options
 */
export function getSessionCookieOptions() {
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    secure: true, // Discord Activity (iframe) requires secure: true when sameSite is none
    sameSite: 'none' as const, // Must be 'none' for iframe cross-site cookies
    path: '/',
    maxAge: SESSION_MAX_AGE,
  };
}

/**
 * Get the session token from the request cookies
 */
export function getSessionTokenFromCookies(): string | undefined {
  const cookieStore = cookies();
  return cookieStore.get(COOKIE_NAME)?.value;
}

/**
 * Check if the current request is authenticated
 */
export async function isAuthenticated(): Promise<SessionPayload | null> {
  const token = getSessionTokenFromCookies();
  if (!token) return null;
  return await validateSession(token);
}

export { COOKIE_NAME };
