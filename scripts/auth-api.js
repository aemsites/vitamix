import { ORDERS_API_ORIGIN } from './scripts.js';

/** sessionStorage key for the JWT issued after OTP verification */
export const AUTH_TOKEN_KEY = 'auth_token';

/** localStorage key for the serialised user object { email, roles } */
export const AUTH_USER_KEY = 'auth_user';

/** CustomEvent name dispatched on document when auth state changes */
export const AUTH_EVENT = 'commerce:auth-state-changed';

/**
 * Dispatches a `commerce:auth-state-changed` CustomEvent on document.
 * @param {boolean} loggedIn - Whether the user is now authenticated
 * @param {string|null} email - The user's email, or null when logged out
 */
function dispatchAuthEvent(loggedIn, email) {
  document.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: { loggedIn, email } }));
}

/**
 * Initiates the OTP login flow for the given email address.
 * Sends a POST to /auth/login, which triggers the API to email a 6-digit
 * one-time code to the user. The returned `hash` and `exp` values must be
 * passed back to `verifyCode` to complete authentication.
 *
 * @param {string} email - The user's email address
 * @param {string} [country] - ISO 3166-1 alpha-2 country code (e.g. 'us', 'ca')
 * @param {string} [locale] - BCP-47 locale (e.g. 'en-US', 'fr-CA')
 * @returns {Promise<{ email: string, hash: string, exp: number }>}
 * @throws {Error} If the request fails or the API returns an error
 */
export async function login(email, country, locale) {
  const resp = await fetch(`${ORDERS_API_ORIGIN}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, country, locale }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || `Login failed: ${resp.status}`);
  }
  return resp.json();
}

/**
 * Completes the OTP login flow by verifying the code the user received.
 * Sends a POST to /auth/callback with the code and the `hash`/`exp` values
 * returned by `login`. On success, stores the JWT in sessionStorage (cleared
 * when the browser tab closes) and the user object in localStorage (persists
 * across sessions for UI restoration), then dispatches an auth state event.
 *
 * @param {string} email - The user's email address
 * @param {string} code - The 6-digit OTP code from the user's email
 * @param {string} hash - The HMAC hash returned by `login`
 * @param {number} exp - The expiry timestamp returned by `login`
 * @returns {Promise<{ success: boolean, token: string, email: string, roles: string[] }>}
 * @throws {Error} If the code is invalid, expired, or the request fails
 */
export async function verifyCode(email, code, hash, exp) {
  const resp = await fetch(`${ORDERS_API_ORIGIN}/auth/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email, code, hash, exp,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || `Verification failed: ${resp.status}`);
  }
  const data = await resp.json();
  if (data.token) {
    sessionStorage.setItem(AUTH_TOKEN_KEY, data.token);
  }
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify({
    email: data.email,
    roles: data.roles,
  }));
  dispatchAuthEvent(true, data.email);
  return data;
}

/**
 * Logs the current user out.
 * Makes a best-effort POST to /auth/logout to invalidate the token server-side,
 * then unconditionally clears the JWT from sessionStorage and the user object
 * from localStorage regardless of whether the server call succeeds.
 * Dispatches an auth state event on completion.
 *
 * @returns {Promise<void>}
 */
export async function logout() {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  try {
    await fetch(`${ORDERS_API_ORIGIN}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch { /* best-effort */ }
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  dispatchAuthEvent(false, null);
}

/**
 * Returns whether the current user has an active session.
 * Checks for the presence of a JWT in sessionStorage. Note that this does not
 * validate the token with the server — it only checks local storage state.
 *
 * @returns {boolean}
 */
export function isLoggedIn() {
  return !!sessionStorage.getItem(AUTH_TOKEN_KEY);
}

/**
 * Returns the stored user object for the current session, or null if not
 * logged in. The object is written to localStorage by `verifyCode` and
 * persists across browser sessions for UI restoration purposes, but a missing
 * JWT in sessionStorage means the user is effectively logged out.
 *
 * @returns {{ email: string, roles: string[] }|null}
 */
export function getUser() {
  const raw = localStorage.getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Wrapper around `fetch` that attaches the current user's Bearer token to the
 * Authorization header. If the server responds with 401, the local session is
 * cleared and an auth state event is dispatched so the UI can react.
 *
 * @param {string} url - The URL to fetch
 * @param {RequestInit} [options={}] - Standard fetch options (method, body, etc.)
 * @returns {Promise<Response>}
 * @throws {Error} If the user is not authenticated (no token in sessionStorage)
 */
export async function authFetch(url, options = {}) {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) throw new Error('Not authenticated');

  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);

  const resp = await fetch(url, { ...options, headers });
  if (resp.status === 401) {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    dispatchAuthEvent(false, null);
  }
  return resp;
}
