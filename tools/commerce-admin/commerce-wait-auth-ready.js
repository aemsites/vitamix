/* eslint-disable no-console -- temporary auth-order debugging; remove when stable */
import { getAuthState } from './commerce-otp-api.js';

const TICK_MS = 32;
/** OTP + slow networks: sibling module scripts can run before auth finishes; do not cap at ~10s. */
const MAX_WAIT_MS = 5 * 60 * 1000;

/**
 * Wait until a ProductBus JWT exists for this org/site (for the current API env in
 * localStorage). Prefer this over only checking `commerce-admin-auth-ok`: the HTML
 * class can lag `setAuthState`, and a ~10s class-only wait used to fire API calls before
 * OTP completed (`hasBearer=false` then real login logs afterward).
 *
 * @param {string} org
 * @param {string} site
 * @returns {Promise<boolean>} true if `getAuthState(…)?.token` is set before timeout
 */
export default function waitForCommerceAuthReady(org, site) {
  if (getAuthState(org, site)?.token) {
    console.log('[commerce-admin] wait-auth JWT already in localStorage');
    return Promise.resolve(true);
  }
  console.log('[commerce-admin] wait-auth polling until JWT exists (org/site + current API env)');
  const start = Date.now();
  let ticks = 0;

  return new Promise((resolve) => {
    const tick = () => {
      if (getAuthState(org, site)?.token) {
        console.log(
          `[commerce-admin] wait-auth JWT present after ${ticks} ticks (~${Date.now() - start}ms)`,
        );
        resolve(true);
        return;
      }
      if (Date.now() - start >= MAX_WAIT_MS) {
        console.log('[commerce-admin] wait-auth TIMEOUT no JWT after ~5min');
        resolve(false);
        return;
      }
      ticks += 1;
      setTimeout(tick, TICK_MS);
    };
    tick();
  });
}
