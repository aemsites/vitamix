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
export const RECAPTCHA_SITE_KEY = isProdHost ? '6LdcY7AtAAAAAPSDJehzAiOvX4zBQmJIRUJ0xvpw' : '6LcITfcsAAAAADNTZV_Y2sKZAvdQa38GX4s29gS9';

/** Action name constants mirroring the server's RECAPTCHA_ACTIONS. */
export const RECAPTCHA_ACTIONS = Object.freeze({
  AUTH_LOGIN: 'auth_login',
  ORDERS_PREVIEW: 'orders_preview',
  ORDERS_CREATE: 'orders_create',
});

export const RECAPTCHA_HEADER = 'X-Recaptcha-Token';

const SDK_URL = 'https://www.google.com/recaptcha/enterprise.js';

/**
 * Time budget (ms) for minting one token: SDK load + bootstrap + execute().
 *
 * The SDK is more than `enterprise.js`: its iframe pulls a ~355 KB
 * `recaptcha__en.js` before `grecaptcha.enterprise.ready()` fires. On a slow
 * mobile connection that took 18.5 s in testing, so the old 5 s budget could
 * never finish a cold load. The first wallet preview runs inside Apple Pay's
 * `onshippingcontactselected`, which must complete within the sheet's ~30 s
 * limit, so this budget + {@link RECAPTCHA_RETRY_MINT_TIMEOUT_MS} + two API
 * round-trips must stay comfortably under that.
 */
export const RECAPTCHA_MINT_TIMEOUT_MS = 10000;

/**
 * Time budget (ms) for the single re-mint after the API rejects a request with
 * a retryable reCAPTCHA failure. The SDK load started by the first attempt is
 * kept alive, so this mostly waits for that load to finish.
 */
export const RECAPTCHA_RETRY_MINT_TIMEOUT_MS = 8000;

/** execute() attempts per mint (Google: retry execute() on browser errors). */
const EXECUTE_ATTEMPTS = 3;
const EXECUTE_RETRY_DELAY_MS = 300;

/**
 * Events that mark the visitor's first interaction. Browsers stop recording
 * Largest Contentful Paint once the user taps, scrolls, or presses a key, so
 * starting the SDK download after one of these cannot affect LCP.
 */
const WARM_EVENTS = ['pointerdown', 'keydown', 'scroll'];

/**
 * Stable failure reasons reported in mint diagnostics.
 * @typedef {'disabled'|'load-error'|'load-timeout'|'ready-unavailable'
 *   |'execute-error'|'execute-timeout'|'empty-token'} RecaptchaFailureReason
 */

/**
 * Non-sensitive diagnostics for one mint attempt. Never contains the token.
 * @typedef {Object} RecaptchaDiagnostics
 * @property {boolean} minted - Whether a token was produced.
 * @property {RecaptchaFailureReason|null} failure - Why minting failed.
 * @property {number} elapsedMs - Time spent minting.
 * @property {boolean} sdkWarm - Whether the SDK was already usable at the start.
 * @property {number} executeAttempts - execute() calls made.
 */

class RecaptchaFailure extends Error {
  /**
   * @param {RecaptchaFailureReason} reason
   * @param {string} message
   */
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

/**
 * Shared in-flight SDK load. It has no timeout of its own: callers race it
 * against their own budget, so a slow download keeps going after a caller gives
 * up and a later caller can still use it. Cleared only on a real failure.
 * @type {Promise<void>|null}
 */
let sdkPromise = null;

let warmArmed = false;

function sdkIsReady() {
  return typeof window?.grecaptcha?.enterprise?.execute === 'function';
}

/**
 * Resolves once `grecaptcha.enterprise.ready()` fires. The SDK initializes in
 * two stages: `ready` exists as soon as `enterprise.js` loads, but `execute`
 * only works after the SDK's own bootstrap completes.
 * @returns {Promise<void>}
 */
function waitForReady() {
  return new Promise((resolve, reject) => {
    if (typeof window?.grecaptcha?.enterprise?.ready !== 'function') {
      reject(new RecaptchaFailure('ready-unavailable', 'grecaptcha.enterprise.ready unavailable after SDK load'));
      return;
    }
    window.grecaptcha.enterprise.ready(() => resolve());
  });
}

/**
 * Lazily inject the reCAPTCHA Enterprise SDK and resolve once it can mint
 * tokens. Every caller shares one in-flight load.
 *
 * The returned promise has no timeout; use {@link mintRecaptchaToken} (which
 * applies a budget) when a token is needed. A load error or a missing `ready()`
 * removes the script so the next call starts a fresh download; a slow load is
 * left running so later callers can adopt it.
 *
 * @param {string} [siteKey=RECAPTCHA_SITE_KEY]
 * @returns {Promise<void>}
 */
export function loadRecaptchaSdk(siteKey = RECAPTCHA_SITE_KEY) {
  if (!siteKey) return Promise.resolve();
  if (sdkIsReady()) return waitForReady();
  if (sdkPromise) return sdkPromise;

  let promise = null;
  let failed = false;
  promise = new Promise((resolve, reject) => {
    let script = null;
    const fail = (reason, message) => {
      failed = true;
      // Only clear the shared load if it is still this one.
      if (promise && sdkPromise === promise) sdkPromise = null;
      script?.remove?.();
      reject(new RecaptchaFailure(reason, message));
    };
    try {
      script = document.createElement('script');
      script.src = `${SDK_URL}?render=${encodeURIComponent(siteKey)}`;
      script.async = true;
      script.addEventListener('load', () => {
        waitForReady().then(resolve, (err) => fail(err.reason, err.message));
      }, { once: true });
      script.addEventListener('error', () => fail('load-error', 'reCAPTCHA SDK failed to load'), { once: true });
      document.head.appendChild(script);
    } catch (err) {
      fail('load-error', err?.message || 'reCAPTCHA SDK could not be injected');
    }
  });
  // A synchronous injection failure settles before `promise` is assigned, so
  // only cache the load when it has not already failed.
  sdkPromise = failed ? null : promise;
  return promise;
}

/**
 * Start downloading the SDK on the visitor's first tap, key press, or scroll,
 * so a token is ready sooner at checkout without touching LCP. Idempotent;
 * load failures are ignored here because the next mint retries the load and
 * reports the failure.
 *
 * @param {string} [siteKey=RECAPTCHA_SITE_KEY]
 */
export function warmRecaptchaOnInteraction(siteKey = RECAPTCHA_SITE_KEY) {
  if (warmArmed || !siteKey || sdkIsReady()) return;
  if (typeof window?.addEventListener !== 'function') return;
  warmArmed = true;
  const start = () => {
    WARM_EVENTS.forEach((type) => window.removeEventListener(type, start, { capture: true }));
    loadRecaptchaSdk(siteKey).catch(() => { /* reported by the next mint */ });
  };
  WARM_EVENTS.forEach((type) => {
    window.addEventListener(type, start, { capture: true, passive: true });
  });
}

/**
 * Race `promise` against the remaining budget.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {RecaptchaFailureReason} reason - Reason used when the budget runs out.
 * @returns {Promise<T>}
 */
function withDeadline(promise, ms, reason) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new RecaptchaFailure(reason, `reCAPTCHA ${reason}`)), Math.max(0, ms));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Mint a single-use reCAPTCHA Enterprise token and report how it went.
 *
 * Never throws. On failure the token is '' and `diagnostics.failure` says why,
 * so callers can attach the diagnostics to error logs.
 *
 * @param {string} action - One of {@link RECAPTCHA_ACTIONS}.
 * @param {Object} [options]
 * @param {string} [options.siteKey=RECAPTCHA_SITE_KEY]
 * @param {number} [options.timeoutMs=RECAPTCHA_MINT_TIMEOUT_MS] - Total budget.
 * @returns {Promise<{ token: string, diagnostics: RecaptchaDiagnostics }>}
 */
export async function mintRecaptchaTokenDetailed(action, {
  siteKey = RECAPTCHA_SITE_KEY,
  timeoutMs = RECAPTCHA_MINT_TIMEOUT_MS,
} = {}) {
  const startedAt = Date.now();
  const sdkWarm = sdkIsReady();
  const remaining = () => timeoutMs - (Date.now() - startedAt);
  const result = (token, failure, executeAttempts = 0) => ({
    token,
    diagnostics: {
      minted: Boolean(token),
      failure,
      elapsedMs: Date.now() - startedAt,
      sdkWarm,
      executeAttempts,
    },
  });

  if (!siteKey) return result('', 'disabled');

  try {
    await withDeadline(loadRecaptchaSdk(siteKey), remaining(), 'load-timeout');
  } catch (err) {
    return result('', err?.reason || 'load-error');
  }

  let failure = 'execute-timeout';
  let attempts = 0;
  while (attempts < EXECUTE_ATTEMPTS && remaining() > 0) {
    attempts += 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      const token = await withDeadline(
        Promise.resolve().then(() => window.grecaptcha.enterprise.execute(siteKey, { action })),
        remaining(),
        'execute-timeout',
      );
      if (token) return result(token, null, attempts);
      failure = 'empty-token';
    } catch (err) {
      failure = err?.reason || 'execute-error';
      if (failure === 'execute-timeout') break;
    }
    if (attempts < EXECUTE_ATTEMPTS && remaining() > EXECUTE_RETRY_DELAY_MS) {
      // eslint-disable-next-line no-await-in-loop
      await delay(EXECUTE_RETRY_DELAY_MS);
    }
  }
  return result('', failure, attempts);
}

/**
 * Mint a single-use reCAPTCHA Enterprise token for the given action.
 *
 * Returns '' on any failure so the request can still go out (the API then
 * decides whether a token is required). Use {@link mintRecaptchaTokenDetailed}
 * when the failure reason is needed.
 *
 * @param {string} action - One of {@link RECAPTCHA_ACTIONS}.
 * @param {Object} [options] - See {@link mintRecaptchaTokenDetailed}.
 * @returns {Promise<string>} A token string, or '' on any failure.
 */
export async function mintRecaptchaToken(action, options) {
  const { token } = await mintRecaptchaTokenDetailed(action, options);
  return token;
}
