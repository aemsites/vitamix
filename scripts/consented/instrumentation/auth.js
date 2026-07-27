import {
  debugLog,
  debugWarn,
  hasMarketingConsent,
} from './shared.js';
import {
  assignDigitalDataUser,
  flushLaunchTrackers,
  triggerLaunchEvent,
  whenSatelliteReady,
} from './adobe-runtime.js';

/**
 * SHA-256 hex digest of the given input, used to derive a pseudonymous user id
 * from the email (avoids putting raw PII into the analytics data layer).
 * @param {string} input
 * @returns {Promise<string>} Lowercase hex digest, or '' if hashing is unavailable
 */
export async function sha256Hex(input) {
  const subtle = window.crypto?.subtle;
  if (!subtle || !input) return '';
  try {
    const bytes = new TextEncoder().encode(input);
    const digest = await subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return '';
  }
}

/**
 * digitalData.page.user payload for a successful login (Adobe Commerce parity).
 * @param {string} userId Pseudonymous user id (hashed email)
 * @returns {{ userID: string, status: string, globalID: string }}
 */
export function buildLoginUserData(userId) {
  return { userID: userId, status: 'success', globalID: userId };
}

let loginStartFired = false;
let logoutFired = false;

/**
 * Fire login analytics after a successful edge OTP login (Adobe Commerce parity).
 * Sets digitalData.page.user with a hashed user id, then fires formStart and
 * loginStart. Deduped so repeat/cross-tab auth events don't re-fire.
 * @param {string} email The authenticated user's email
 * @returns {Promise<void>}
 */
export async function fireLoginStart(email) {
  if (loginStartFired) return;

  if (!hasMarketingConsent()) {
    return;
  }

  const trimmedEmail = `${email || ''}`.trim().toLowerCase();
  if (!trimmedEmail) {
    return;
  }

  const userId = await sha256Hex(trimmedEmail);
  assignDigitalDataUser(buildLoginUserData(userId));
  flushLaunchTrackers();

  if (!(await triggerLaunchEvent('formStart', window.digitalData.page.user))) {
    debugWarn('Adobe Analytics login formStart skipped: Adobe Launch (_satellite) not available');
    return;
  }

  if (!(await triggerLaunchEvent('loginStart', window.digitalData.page.user))) {
    debugWarn('Adobe Analytics loginStart skipped: Adobe Launch (_satellite) not available');
    return;
  }

  loginStartFired = true;
  debugLog('Adobe Analytics loginStart fired', window.digitalData.page.user);
}

/**
 * Fire logout analytics after a successful sign-out (Adobe Commerce parity).
 * Mirrors Commerce: _satellite.track('loggedOut'). Deduped so repeat/cross-tab
 * auth events don't re-fire within the same page view.
 * @returns {Promise<void>}
 */
export async function fireLoggedOut() {
  if (logoutFired) return;

  if (!hasMarketingConsent()) {
    return;
  }

  flushLaunchTrackers();

  if (!(await triggerLaunchEvent('loggedOut', window.digitalData?.page?.user))) {
    debugWarn('Adobe Analytics loggedOut skipped: Adobe Launch (_satellite) not available');
    return;
  }

  logoutFired = true;
  debugLog('Adobe Analytics loggedOut fired');
}

/**
 * Handle commerce:auth-state-changed. Fires login analytics on a fresh login and
 * logout analytics on sign-out, resetting the opposite dedupe flag so the next
 * transition is tracked again.
 * @param {{ loggedIn?: boolean, email?: string }} detail
 * @returns {void}
 */
export function handleAuthStateChanged(detail) {
  const { loggedIn, email } = detail || {};
  if (!loggedIn) {
    loginStartFired = false;
    whenSatelliteReady(() => {
      fireLoggedOut();
    }, 'loggedOut');
    return;
  }
  logoutFired = false;
  whenSatelliteReady(() => {
    fireLoginStart(email);
  }, 'loginStart');
}

let loginTrackingInstalled = false;

/**
 * Listen for edge OTP login state changes (register early in consented.js).
 * @returns {void}
 */
export function trackLogin() {
  if (loginTrackingInstalled) {
    return;
  }
  loginTrackingInstalled = true;

  document.addEventListener('commerce:auth-state-changed', (ev) => {
    handleAuthStateChanged(ev.detail);
  });
}

/** Reset login analytics state (for unit tests). */
export function resetLoginState() {
  loginStartFired = false;
  logoutFired = false;
  loginTrackingInstalled = false;
}
