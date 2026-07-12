import { cookies } from 'next/headers';
import crypto from 'crypto';

const COOKIE_NAME = 'dashboard_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

// In-memory session store
// Note: Sessions are lost on server restart (user will need to re-login)
const activeSessions = new Set<string>();

/**
 * Generate a cryptographically secure random session token
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate credentials against environment variables
 */
export function validateCredentials(username: string, password: string): boolean {
  const validUsername = process.env.DASHBOARD_USERNAME;
  const validPassword = process.env.DASHBOARD_PASSWORD;

  if (!validUsername || !validPassword) {
    console.error('DASHBOARD_USERNAME or DASHBOARD_PASSWORD is not set in environment variables');
    return false;
  }

  // Use timing-safe comparison to prevent timing attacks
  const usernameMatch =
    username.length === validUsername.length &&
    crypto.timingSafeEqual(Buffer.from(username), Buffer.from(validUsername));

  const passwordMatch =
    password.length === validPassword.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(validPassword));

  return usernameMatch && passwordMatch;
}

/**
 * Create a new session and return the token
 */
export function createSession(): string {
  const token = generateSessionToken();
  activeSessions.add(token);
  return token;
}

/**
 * Validate a session token
 */
export function validateSession(token: string): boolean {
  return activeSessions.has(token);
}

/**
 * Delete a session (logout)
 */
export function deleteSession(token: string): void {
  activeSessions.delete(token);
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
export function isAuthenticated(): boolean {
  const token = getSessionTokenFromCookies();
  if (!token) return false;
  return validateSession(token);
}

export { COOKIE_NAME };
