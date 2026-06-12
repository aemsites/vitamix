/* eslint-disable no-console -- temporary auth-order debugging; remove when stable */
/**
 * ProductBus / Adobe Commerce Live API client (from helix-tools-website
 * productbus-admin/api.js).
 * Auth is stored in localStorage per environment (`pbus-auth-{org}-{site}-stage|prod`); switching
 * hosts keeps both sessions. JWT `exp` is enforced client-side (~24h); expired sessions are cleared
 * and the user is sent back to OTP sign-in.
 */

import { showToast } from './commerce-otp-ui.js';

/** Seconds before JWT `exp` to treat the token as expired (clock skew). */
const AUTH_EXPIRY_SKEW_SEC = 30;

let authExpiryTimerId = null;

export const PRODUCTION_API_BASE = 'https://api.adobecommerce.live';
export const STAGE_API_BASE = 'https://api-stage.adobecommerce.live';

/** Session key: value `'false'` means production; absent or other means staging. */
export const PRODUCTBUS_STAGE_SESSION_KEY = 'productbus-stage';

/** Same fcors proxy as PIM / detail (temporary until Adobe API allows this origin). */
const CORS_PROXY = 'https://fcors.org/?url=';
const CORS_KEY = '&key=Mg23N96GgR8O3NjU';

/**
 * Defaults to staging for local dev. Production: sessionStorage
 * `productbus-stage` "false" or query `?stage=false`.
 */
export function getApiBase() {
  const override = localStorage.getItem('productbus-api-url');
  if (override) return override;
  if (sessionStorage.getItem(PRODUCTBUS_STAGE_SESSION_KEY) === 'false') return PRODUCTION_API_BASE;
  return STAGE_API_BASE;
}

/** Resolved environment for UI (matches `getApiBase()` unless a custom base URL is set). */
export function getApiEnvironment() {
  const base = getApiBase();
  if (base === PRODUCTION_API_BASE) return 'prod';
  if (base === STAGE_API_BASE) return 'stage';
  return 'stage';
}

/** Persist prod vs stage and drop custom API URL override so requests match the selection. */
export function setApiEnvironment(env) {
  localStorage.removeItem('productbus-api-url');
  if (env === 'prod') {
    sessionStorage.setItem(PRODUCTBUS_STAGE_SESSION_KEY, 'false');
  } else {
    sessionStorage.removeItem(PRODUCTBUS_STAGE_SESSION_KEY);
  }
}

/** localStorage key for ProductBus JWT + profile (separate per API host). */
function authStorageKey(org, site, env) {
  return `pbus-auth-${org}-${site}-${env}`;
}

function legacyAuthKey(org, site) {
  return `pbus-auth-${org}-${site}`;
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * JWT expiry (Unix seconds). Falls back to `iat + 24h` when `exp` is absent.
 *
 * @param {string} token
 * @returns {number | null}
 */
export function getTokenExpirySec(token) {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  if (typeof payload.exp === 'number') return payload.exp;
  if (typeof payload.iat === 'number') return payload.iat + 86400;
  return null;
}

/**
 * @param {string} token
 * @param {number} [skewSec]
 * @returns {boolean}
 */
export function isAuthTokenExpired(token, skewSec = AUTH_EXPIRY_SKEW_SEC) {
  const exp = getTokenExpirySec(token);
  if (!exp) return true;
  return Date.now() / 1000 >= exp - skewSec;
}

function clearLegacyAuthKeys(org, site) {
  sessionStorage.removeItem(legacyAuthKey(org, site));
  localStorage.removeItem(legacyAuthKey(org, site));
}

function readAuthRaw(org, site, env) {
  const key = authStorageKey(org, site, env);
  try {
    let raw = localStorage.getItem(key);
    if (!raw) {
      const fromSession = sessionStorage.getItem(key);
      if (fromSession) {
        localStorage.setItem(key, fromSession);
        sessionStorage.removeItem(key);
        raw = fromSession;
      }
    }
    if (!raw) {
      const legacy = localStorage.getItem(legacyAuthKey(org, site))
        || sessionStorage.getItem(legacyAuthKey(org, site));
      if (legacy) {
        localStorage.setItem(key, legacy);
        clearLegacyAuthKeys(org, site);
        raw = legacy;
      }
    }
    return raw;
  } catch {
    return null;
  }
}

function clearAuthStateForEnv(org, site, env) {
  const key = authStorageKey(org, site, env);
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
  clearLegacyAuthKeys(org, site);
}

function parseAuthState(org, site, env) {
  const raw = readAuthRaw(org, site, env);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw);
    if (!state?.token) return null;
    if (isAuthTokenExpired(state.token)) {
      clearAuthStateForEnv(org, site, env);
      return null;
    }
    return state;
  } catch {
    clearAuthStateForEnv(org, site, env);
    return null;
  }
}

/**
 * Schedule a one-shot timer for JWT expiry; calls `onExpired` when the token lapses.
 *
 * @param {string} org
 * @param {string} site
 * @param {() => void} onExpired
 */
export function scheduleCommerceAuthExpiry(org, site, onExpired) {
  if (authExpiryTimerId != null) {
    clearTimeout(authExpiryTimerId);
    authExpiryTimerId = null;
  }
  const env = getApiEnvironment();
  const raw = readAuthRaw(org, site, env);
  if (!raw) return;
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    return;
  }
  const expSec = getTokenExpirySec(state?.token);
  if (!expSec) return;
  const delayMs = expSec * 1000 - Date.now() - AUTH_EXPIRY_SKEW_SEC * 1000;
  if (delayMs <= 0) {
    onExpired();
    return;
  }
  authExpiryTimerId = setTimeout(onExpired, delayMs);
}

/**
 * Auth for a specific ProductBus environment, regardless of the active API base.
 * Used e.g. to confirm production OTP before promoting from staging.
 *
 * @param {string} org
 * @param {string} site
 * @param {'stage'|'prod'} env
 */
export function getAuthStateForEnv(org, site, env) {
  const keyEnv = env === 'prod' ? 'prod' : 'stage';
  return parseAuthState(org, site, keyEnv);
}

export function getAuthState(org, site) {
  const env = getApiEnvironment();
  return parseAuthState(org, site, env);
}

export function setAuthState(org, site, state) {
  const env = getApiEnvironment();
  localStorage.setItem(authStorageKey(org, site, env), JSON.stringify(state));
  clearLegacyAuthKeys(org, site);
  sessionStorage.removeItem(authStorageKey(org, site, env));
  const roles = Array.isArray(state?.roles) ? state.roles.join(',') : String(state?.roles ?? '');
  const expSec = getTokenExpirySec(state?.token);
  console.log(`[commerce-admin] setAuthState env=${env} storageKey=pbus-auth-${org}-${site}-${env} hasToken=${Boolean(state?.token)} roles=${roles} exp=${expSec ?? 'unknown'}`);
}

export function clearAuthState(org, site) {
  const env = getApiEnvironment();
  clearAuthStateForEnv(org, site, env);
  if (authExpiryTimerId != null) {
    clearTimeout(authExpiryTimerId);
    authExpiryTimerId = null;
  }
}

/**
 * Commerce Admin requires `admin` or `superuser` (helix-commerce-api role → permission map).
 *
 * @param {unknown} roles
 * @returns {boolean}
 */
export function hasCommerceAdminRole(roles) {
  const list = Array.isArray(roles) ? roles : [];
  return list.includes('admin') || list.includes('superuser');
}

/**
 * Confirm the stored JWT can call admin-scoped ProductBus APIs for this org/site.
 *
 * @param {string} org
 * @param {string} site
 * @returns {Promise<{ ok: true } | { ok: false, status?: number, message: string }>}
 */
export async function verifyCommerceApiAccess(org, site) {
  const auth = getAuthState(org, site);
  if (!auth?.token) {
    return { ok: false, message: 'missing token' };
  }
  if (!hasCommerceAdminRole(auth.roles)) {
    return { ok: false, message: 'not authorized' };
  }

  try {
    const resp = await apiFetch(org, site, 'customers', {
      method: 'GET',
      skipAuthRedirect: true,
      quiet: true,
    });
    if (resp.ok) {
      return { ok: true };
    }
    const message = resp.headers.get('x-error')
      || (await resp.text().catch(() => '')).trim()
      || `HTTP ${resp.status}`;
    return { ok: false, status: resp.status, message };
  } catch (err) {
    return { ok: false, message: err?.message || 'access check failed' };
  }
}

/**
 * Revoke the JWT server-side when possible, then clear local session state.
 *
 * @param {string} org
 * @param {string} site
 */
export async function logoutCommerceSession(org, site) {
  if (getAuthState(org, site)?.token) {
    try {
      await apiFetch(org, site, 'auth/logout', {
        method: 'POST',
        skipAuthRedirect: true,
        quiet: true,
      });
    } catch {
      // best-effort revoke
    }
  }
  clearAuthState(org, site);
}

function notifySessionExpired(skipAuthRedirect, quiet) {
  if (skipAuthRedirect || quiet) return;
  showToast('Your sign-in expired. Please sign in again.', 'error');
  window.dispatchEvent(new CustomEvent('commerce-admin:sign-out'));
}

export async function apiFetch(org, site, path, options = {}) {
  const { skipAuthRedirect, quiet, ...fetchOptions } = options;
  const base = getApiBase();
  const targetUrl = `${base}/${org}/sites/${site}/${path}`;
  const fetchUrl = `${CORS_PROXY}${encodeURIComponent(targetUrl)}${CORS_KEY}`;

  const env = getApiEnvironment();
  const raw = readAuthRaw(org, site, env);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.token && isAuthTokenExpired(parsed.token)) {
        clearAuthState(org, site);
        notifySessionExpired(skipAuthRedirect, quiet);
        throw new Error('Session expired');
      }
    } catch (err) {
      if (err?.message === 'Session expired') throw err;
      clearAuthState(org, site);
    }
  }

  const auth = getAuthState(org, site);

  const headers = {
    'Content-Type': 'application/json',
    ...fetchOptions.headers,
  };

  if (auth?.token) {
    headers.Authorization = `Bearer ${auth.token}`;
  }

  const method = String(fetchOptions.method || 'GET');
  const roles = Array.isArray(auth?.roles) ? auth.roles.join(',') : String(auth?.roles ?? '');
  const htmlOk = document.documentElement.classList.contains('commerce-admin-auth-ok');
  console.log(`[commerce-admin] apiFetch method=${method} path=${path} apiEnv=${getApiEnvironment()} hasBearer=${Boolean(auth?.token)} htmlAuthOk=${htmlOk} roles=${roles}`);

  const response = await fetch(fetchUrl, {
    ...fetchOptions,
    headers,
    credentials: 'omit',
  });

  if (response.status === 401 && !skipAuthRedirect && !quiet) {
    clearAuthState(org, site);
    notifySessionExpired(skipAuthRedirect, quiet);
    throw new Error('Unauthorized');
  }

  if (response.status === 403 && !quiet) {
    const errorMsg = response.headers.get('x-error') || 'Forbidden';
    console.log(`[commerce-admin] apiFetch 403 path=${path} x-error=${errorMsg} hasBearer=${Boolean(auth?.token)} htmlAuthOk=${htmlOk}`);
    showToast(`${errorMsg} (${response.status})`, 'error');
    throw new Error(errorMsg);
  }

  return response;
}
