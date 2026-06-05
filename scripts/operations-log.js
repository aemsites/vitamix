/**
 * Operations logging for the purchase flow.
 *
 * Posts structured events (errors and critical-step markers) to the
 * operations-log endpoint. Every call here is fire-and-forget and MUST NOT
 * throw or block page processing — logging failures are swallowed.
 *
 * The endpoint path is NOT localized: all countries/languages log to the
 * `us/en_us` endpoint. On `.vitamix.com` hosts we POST same-origin (relative);
 * everywhere else we POST to the AEM network origin.
 */

// V8 captures at most `stackTraceLimit` frames when an Error is constructed
// (default 10). Raising it early — this module is imported during initial page
// bootstrap — gives deeper stacks for async errors and unhandled rejections,
// where the relevant app frame is often buried below framework/await frames.
// No-op in engines that don't honour it (Firefox/Safari).
try { Error.stackTraceLimit = 100; } catch { /* read-only in some engines */ }

const OPERATIONS_LOG_PATH = '/us/en_us/products/operations-log';
const CHECKOUT_ID_KEY = 'vmx_checkout_log_id';
const AEM_NETWORK_ORIGIN = 'https://main--vitamix--aemsites.aem.network';

/**
 * Valid `action` values. Mirrors the endpoint contract — the only required
 * property on the request body.
 * @typedef {'error'|'added-to-cart'|'removed-from-cart'|'cart-view'
 *   |'checkout-start'|'checkout-redirect-start'|'checkout-redirect-return'
 *   |'checkout-complete'|'checkout-failed'} LogAction
 */

/**
 * Resolves the operations-log URL for the current host. Computed lazily (not at
 * module load) so this module stays import-safe in non-browser test contexts.
 * @returns {string}
 */
function logUrl() {
  const hostname = window?.location?.hostname || '';
  const origin = hostname.includes('.vitamix.com') ? '' : AEM_NETWORK_ORIGIN;
  return `${origin}${OPERATIONS_LOG_PATH}`;
}

/**
 * Posts a single operations-log event. Fire-and-forget: never throws, never
 * blocks. Uses `keepalive` so the beacon survives navigation/redirects.
 * @param {LogAction} action
 * @param {Object} [data] - Additional, non-PII context to log.
 */
export function logOperation(action, data = {}) {
  try {
    const body = JSON.stringify({ action, ts: Date.now(), ...data });
    fetch(logUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => { /* swallow — logging must never surface to the user */ });
  } catch { /* never block the page */ }
}

/**
 * Returns the per-checkout correlation id, minting and persisting one on first
 * use. Attached to every `checkout-*` event so the group can be tied together
 * across the payment redirect (where `orderId` does not yet exist).
 * @returns {string}
 */
export function getCheckoutId() {
  try {
    let id = sessionStorage.getItem(CHECKOUT_ID_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(CHECKOUT_ID_KEY, id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

/**
 * Clears the checkout correlation id. Call after `checkout-complete` so the
 * next purchase starts a fresh group.
 */
export function clearCheckoutId() {
  try { sessionStorage.removeItem(CHECKOUT_ID_KEY); } catch { /* noop */ }
}

/** Top-level request-body keys safe to log (no PII / payment data). */
const SAFE_TOP_LEVEL = ['country', 'couponCode', 'couponSource', 'estimateToken', 'provider', 'paymentMethod', 'idempotencyKey'];

/**
 * Strips PII and payment data from a request body using an allowlist.
 * Keeps only fields useful for debugging (items, locale, shipping region,
 * coupon, shipping method, order tokens). Drops customer/name/email/phone,
 * street address, and all payment/card/fraud tokens.
 * @param {*} body - Request body (object or anything else).
 * @returns {Object|undefined}
 */
export function anonymize(body) {
  if (!body || typeof body !== 'object') return undefined;
  const out = {};
  SAFE_TOP_LEVEL.forEach((k) => {
    if (body[k] !== undefined) out[k] = body[k];
  });
  if (Array.isArray(body.items)) {
    out.items = body.items.map((it) => ({
      sku: it?.sku,
      path: it?.path,
      quantity: it?.quantity,
      price: it?.price,
    }));
  }
  // Shipping region only — never street address or recipient name.
  if (body.shipping && typeof body.shipping === 'object') {
    const { country, state, zip } = body.shipping;
    out.shipping = { country, state, zip };
  }
  // Shipping method identifier only.
  if (body.shippingMethod && typeof body.shippingMethod === 'object') {
    out.shippingMethod = { id: body.shippingMethod.id };
  }
  return out;
}

// Keep enough frames that the originating app frame (often buried below
// framework/await frames in async stacks) survives, but cap total size so a
// pathological stack can't bloat the payload.
const STACK_MAX_LINES = 30;
const STACK_MAX_CHARS = 4000;

/**
 * Trims an error stack: keeps the leading frames (where the originating call
 * site lives) and caps total length to keep payloads bounded.
 * @param {string} [stack]
 * @returns {string|undefined}
 */
function trimStack(stack) {
  if (!stack) return undefined;
  const trimmed = stack.split('\n').slice(0, STACK_MAX_LINES).join('\n');
  return trimmed.length > STACK_MAX_CHARS ? `${trimmed.slice(0, STACK_MAX_CHARS)}…` : trimmed;
}

/**
 * Logs a generic (non-API) error.
 * @param {string} scope - Where it happened, e.g. 'checkout-order' or 'global'.
 * @param {*} error - An Error or error-like value.
 * @param {Object} [extra] - Extra non-PII context.
 */
export function logError(scope, error, extra = {}) {
  logOperation('error', {
    scope,
    name: error?.name,
    message: error?.message || String(error),
    stack: trimStack(error?.stack),
    ...extra,
  });
}

/**
 * Logs a Commerce API error (4xx/5xx). The request body is anonymized before
 * logging.
 * @param {Object} info
 * @param {string} info.method - HTTP verb.
 * @param {string} info.path - API path.
 * @param {number} info.status - HTTP status code.
 * @param {*} info.responseBody - Parsed response body.
 * @param {*} info.requestBody - Request body (will be anonymized).
 */
export function logApiError({
  method, path, status, responseBody, requestBody,
}) {
  logOperation('error', {
    kind: 'api',
    method,
    path,
    status,
    responseBody,
    requestBody: anonymize(requestBody),
  });
}

/**
 * Logs a transport-level Commerce API failure — a rejected fetch (offline, DNS,
 * CORS, connection reset, timeout) or an unparseable response body. These never
 * produce an HTTP status, so they bypass `logApiError`. The request body is
 * anonymized before logging.
 * @param {Object} info
 * @param {string} info.method - HTTP verb.
 * @param {string} info.path - API path.
 * @param {*} info.error - The thrown error.
 * @param {*} info.requestBody - Request body (will be anonymized).
 */
export function logNetworkError({
  method, path, error, requestBody,
}) {
  logOperation('error', {
    kind: 'network',
    method,
    path,
    message: error?.message || String(error),
    requestBody: anonymize(requestBody),
  });
}
