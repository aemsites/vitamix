/**
 * ProductBus / Adobe Commerce Live API client (from helix-tools-website productbus-admin/api.js).
 * Auth state key matches ProductBus admin so the same session can be shared.
 */

import { showToast } from './commerce-otp-ui.js';

const PRODUCTION_API_BASE = 'https://api.adobecommerce.live';
const STAGE_API_BASE = 'https://api-stage.adobecommerce.live';

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
  if (sessionStorage.getItem('productbus-stage') === 'false') return PRODUCTION_API_BASE;
  return STAGE_API_BASE;
}

export function getAuthState(org, site) {
  try {
    const data = sessionStorage.getItem(`pbus-auth-${org}-${site}`);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}

export function setAuthState(org, site, state) {
  sessionStorage.setItem(`pbus-auth-${org}-${site}`, JSON.stringify(state));
}

export function clearAuthState(org, site) {
  sessionStorage.removeItem(`pbus-auth-${org}-${site}`);
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
