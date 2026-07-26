/**
 * Pure helpers for the PayPal order-review flow (express routing + confirm
 * retry semantics). Kept dependency-free so the routing decisions can be unit
 * tested without loading the PayPal SDK integration or the checkout graph.
 */

/**
 * Whether the storefront should route the express (SDK) flow through the
 * order-review page. Surfaced (non-secret) on window.CommerceConfig.paypal like
 * clientId. When true, the SDK renders a "Continue" button (commit:false) and
 * onApprove hands off to the review page instead of finalizing inline.
 *
 * @returns {boolean}
 */
export function isExpressReviewEnabled() {
  return !!window.CommerceConfig?.paypal?.orderReview?.express;
}

/**
 * Maps an express `initiate` result to the storefront routing outcome.
 *  - `action: 'review'` (review mode) → route to the order-review page.
 *  - `status: 'completed'` (review off) → finalize inline (today's behavior).
 *  - anything else → authoritative decline; surface a failure.
 *
 * @param {{ action?: string, status?: string }} [result]
 * @returns {'review'|'completed'|'failed'}
 */
export function resolveExpressOutcome(result = {}) {
  if (result.action === 'review') return 'review';
  if (result.status === 'completed') return 'completed';
  return 'failed';
}

/**
 * Whether an express `initiate` error is a transient, retryable failure. A
 * PayPal outage during review-mode validation leaves the order `pending` and
 * the API returns a retryable 502; the confirm path returns a retryable 503.
 * These must be retried against the SAME order/idempotencyKey rather than
 * collapsed into a generic decline, so an approved checkout stays recoverable.
 *
 * @param {{ status?: number, body?: { retryable?: boolean } }} err
 * @returns {boolean}
 */
export function isRetryableInitiateError(err) {
  if (!err) return false;
  if (err.body?.retryable === true) return true;
  return err.status === 502 || err.status === 503;
}

/**
 * Runs `fn`, retrying with exponential backoff while it throws a retryable
 * error. Retries reuse whatever `fn` closes over (the same order and
 * idempotencyKey), so a replay is idempotent server-side.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ retries?: number, baseDelay?: number,
 *   isRetryable?: (err: any) => boolean }} [opts]
 * @returns {Promise<T>}
 */
export async function withInitiateRetry(fn, opts = {}) {
  const { retries = 2, baseDelay = 400, isRetryable = isRetryableInitiateError } = opts;
  for (let attempt = 0; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, baseDelay * 2 ** attempt); });
    }
  }
}
