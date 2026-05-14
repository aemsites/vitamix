/* eslint-disable no-console -- temporary auth-order debugging; remove when stable */
import { getAuthState } from './commerce-otp-api.js';

const TICK_MS = 32;
/** OTP + slow networks: sibling module scripts can run before auth finishes; do not cap at ~10s. */
const MAX_WAIT_MS = 5 * 60 * 1000;

/**
 * Wait until a ProductBus JWT exists for this org/site (for the current API env in
 * sessionStorage). Prefer this over only checking `commerce-admin-auth-ok`: the HTML
 * class can lag `setAuthState`, and a ~10s class-only wait used to fire API calls before
 * OTP completed (`hasBearer=false` then real login logs afterward).
 *
 * @param {string} org
 * @param {string} site
 * @returns {Promise<boolean>} true if `getAuthState(…)?.token` is set before timeout
 */
export async function waitForCommerceAuthReady(org, site) {
  if (getAuthState(org, site)?.token) {
    console.log('[commerce-admin] wait-auth JWT already in sessionStorage');
    return true;
  }
  console.log('[commerce-admin] wait-auth polling until JWT exists (org/site + current API env)');
  const start = Date.now();
  let ticks = 0;
  while (Date.now() - start < MAX_WAIT_MS) {
    if (getAuthState(org, site)?.token) {
      console.log(`[commerce-admin] wait-auth JWT present after ${ticks} ticks (~${Date.now() - start}ms)`);
      return true;
    }
    ticks += 1;
    await new Promise((r) => {
      setTimeout(r, TICK_MS);
    });
  }
  console.log('[commerce-admin] wait-auth TIMEOUT no JWT after ~5min');
  return false;
}
