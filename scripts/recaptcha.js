import { loadScript } from './aem.js';

import { isProdHost } from './scripts.js';
/**
 * Google reCAPTCHA Enterprise integration for the protected unauthenticated
 * write endpoints on the Commerce API:
 *
 *   POST /auth/login         → action 'auth_login'
 *   POST /orders/preview     → action 'orders_preview'
 *   POST /orders             → action 'orders_create'
 *
 * When `RECAPTCHA_SITE_KEY` is empty (e.g. a
 * dev environment without the secret provisioned) this module degrades
 * gracefully and the request goes out without a token.
 */

/**
 * reCAPTCHA Enterprise site key. Public — safe to expose client-side.
 *
 * Empty string disables the integration (graceful degradation).
 * Edge/stage hosts (localhost, UAT, integration) use the stage key;
 * production vitamix.com uses the live key.
 */
// eslint-disable-next-line no-nested-ternary
export const RECAPTCHA_SITE_KEY = isProdHost ? '6LcITfcsAAAAADNTZV_Y2sKZAvdQa38GX4s29gS9' : '6LcITfcsAAAAADNTZV_Y2sKZAvdQa38GX4s29gS9';

/** Action name constants mirroring the server's RECAPTCHA_ACTIONS. */
export const RECAPTCHA_ACTIONS = Object.freeze({
  AUTH_LOGIN: 'auth_login',
  ORDERS_PREVIEW: 'orders_preview',
  ORDERS_CREATE: 'orders_create',
});

export const RECAPTCHA_HEADER = 'X-Recaptcha-Token';

/**
 * Maximum time (ms) to wait for the SDK script to load before giving up.
 */
const SDK_LOAD_TIMEOUT_MS = 5000;

let sdkPromise = null;

/**
 * Lazily inject the reCAPTCHA Enterprise SDK and wait until it is fully
 * initialized — not just until the script tag has loaded. Returns the same
 * promise on every call so concurrent callers share a single load.
 *
 * Important: reCAPTCHA Enterprise has two-stage initialization. After the
 * script's `onload` fires, `grecaptcha.enterprise.ready` is available but
 * `grecaptcha.enterprise.execute` is not. `execute` only becomes callable
 * once the SDK's internal bootstrap completes, which is signalled via the
 * `enterprise.ready(callback)` queue. We chain both stages so this promise
 * represents "SDK is ready to mint tokens", letting callers skip race-prone
 * existence checks. Rejects on load error or after {@link SDK_LOAD_TIMEOUT_MS}
 * so callers don't hang indefinitely on a third-party outage.
 *
 * @param {string} [siteKey=RECAPTCHA_SITE_KEY]
 * @returns {Promise<void>}
 */
export function loadRecaptchaSdk(siteKey = RECAPTCHA_SITE_KEY) {
  if (!siteKey) return Promise.resolve();
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.grecaptcha?.enterprise?.execute) return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  const src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(siteKey)}`;
  const load = loadScript(src, { async: 'true', defer: 'true' })
    .then(() => new Promise((resolve, reject) => {
      if (!window.grecaptcha?.enterprise?.ready) {
        reject(new Error('grecaptcha.enterprise.ready unavailable after SDK load'));
        return;
      }
      window.grecaptcha.enterprise.ready(resolve);
    }));

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('reCAPTCHA SDK load timed out')),
      SDK_LOAD_TIMEOUT_MS,
    );
  });

  sdkPromise = Promise.race([load, timeout])
    .then(() => { clearTimeout(timer); })
    .catch((err) => {
      clearTimeout(timer);
      sdkPromise = null;
      throw err;
    });

  return sdkPromise;
}

/**
 * Mint a single-use reCAPTCHA Enterprise token for the given action.
 *
 * Lazily ensures the SDK is loaded — first call awaits the script load
 * (~150 KB), subsequent calls are instant.
 *
 * The third parameter is an optional injection point for tests. Pass an
 * object with the same shape as `window.grecaptcha` to bypass the real
 * SDK; leave undefined in production to use the lazy-loaded SDK.
 *
 * @param {string} action - One of {@link RECAPTCHA_ACTIONS}.
 * @param {string} [siteKey=RECAPTCHA_SITE_KEY] - Override for tests.
 * @param {object} [grecaptcha] - Override for tests; production reads window.grecaptcha.
 * @returns {Promise<string>} A token string, or '' on any failure.
 */
export async function mintRecaptchaToken(
  action,
  siteKey = RECAPTCHA_SITE_KEY, // eslint-disable-line default-param-last
  grecaptcha,
) {
  if (!siteKey) return '';
  let sdk = grecaptcha;
  if (sdk === undefined) {
    if (typeof window === 'undefined') return '';
    // Always await loadRecaptchaSdk — it short-circuits when the SDK is
    // already fully initialized, and otherwise chains through both the
    // script load AND enterprise.ready() so callers don't race the
    // SDK's two-stage init.
    try {
      await loadRecaptchaSdk(siteKey);
    } catch {
      return '';
    }
    sdk = window.grecaptcha;
  }
  if (!sdk?.enterprise?.execute) return '';
  try {
    // ready() is a no-op queue when SDK is already initialized (production
    // path via loadRecaptchaSdk), but kept as a safety net for the test
    // injection path where the caller passes a fresh mock SDK.
    await new Promise((resolve) => { sdk.enterprise.ready(resolve); });
    const token = await sdk.enterprise.execute(siteKey, { action });
    return token || '';
  } catch {
    return '';
  }
}
