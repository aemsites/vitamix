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
}

export function clearAuthState(org, site) {
  const env = getApiEnvironment();
  sessionStorage.removeItem(authStorageKey(org, site, env));
  sessionStorage.removeItem(legacyAuthKey(org, site));
}

export async function apiFetch(org, site, path, options = {}) {
  const { skipAuthRedirect, ...fetchOptions } = options;
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

  const response = await fetch(fetchUrl, {
    ...fetchOptions,
    headers,
    credentials: 'omit',
  });

  if (response.status === 401 && !skipAuthRedirect) {
    clearAuthState(org, site);
    throw new Error('Unauthorized');
  }

  if (response.status === 403) {
    const errorMsg = response.headers.get('x-error') || 'Forbidden';
    showToast(`${errorMsg} (${response.status})`, 'error');
    throw new Error(errorMsg);
  }

  return response;
}
