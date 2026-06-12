/* eslint-disable no-console -- temporary auth-order debugging; remove when stable */
/**
 * ProductBus / Adobe Commerce Live API client (from helix-tools-website
 * productbus-admin/api.js).
 * Auth is stored per environment (`pbus-auth-{org}-{site}-stage|prod`); switching hosts keeps both
 * sessions.
 */

import { showToast } from './commerce-otp-ui.js';

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

/** SessionStorage key for ProductBus JWT + profile (separate per API host). */
function authStorageKey(org, site, env) {
  return `pbus-auth-${org}-${site}-${env}`;
}

function legacyAuthKey(org, site) {
  return `pbus-auth-${org}-${site}`;
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
  const key = authStorageKey(org, site, keyEnv);
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getAuthState(org, site) {
  const env = getApiEnvironment();
  const key = authStorageKey(org, site, env);
  try {
    let raw = sessionStorage.getItem(key);
    if (!raw) {
      const old = sessionStorage.getItem(legacyAuthKey(org, site));
      if (old) {
        sessionStorage.setItem(key, old);
        sessionStorage.removeItem(legacyAuthKey(org, site));
        raw = old;
      }
    }
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function setAuthState(org, site, state) {
  const env = getApiEnvironment();
  sessionStorage.setItem(authStorageKey(org, site, env), JSON.stringify(state));
  sessionStorage.removeItem(legacyAuthKey(org, site));
  const roles = Array.isArray(state?.roles) ? state.roles.join(',') : String(state?.roles ?? '');
  console.log(`[commerce-admin] setAuthState env=${env} storageKey=pbus-auth-${org}-${site}-${env} hasToken=${Boolean(state?.token)} roles=${roles}`);
}

export function clearAuthState(org, site) {
  const env = getApiEnvironment();
  sessionStorage.removeItem(authStorageKey(org, site, env));
  sessionStorage.removeItem(legacyAuthKey(org, site));
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

export async function apiFetch(org, site, path, options = {}) {
  const { skipAuthRedirect, quiet, ...fetchOptions } = options;
  const base = getApiBase();
  const targetUrl = `${base}/${org}/sites/${site}/${path}`;
  const fetchUrl = `${CORS_PROXY}${encodeURIComponent(targetUrl)}${CORS_KEY}`;
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
