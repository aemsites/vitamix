/**
 * Resolve customer-facing copy for a payment outcome.
 *
 * The API no longer exposes the raw decline reason. A failed order carries a
 * neutral bucket (`order.payment.checkoutFailure`, also returned inline by the
 * synchronous payment endpoints): `contact_support` for a terminal failure the
 * buyer cannot fix here, or `retry` for an authorization-stage decline they can
 * try again. A buyer cancellation is signalled separately via the redirect URL
 * (`reason=customer_cancelled`).
 *
 * @param {{ reason?: string, checkoutFailure?: string }} outcome payment outcome
 * @param {{ customerCancelled: string, contactSupport: string, retry: string }} messages
 *   localized messages
 * @returns {string} customer-facing payment message
 */
function resolvePaymentFailureMessage(outcome, messages) {
  const { reason, checkoutFailure } = outcome || {};
  if (reason === 'customer_cancelled') return messages.customerCancelled;
  if (checkoutFailure === 'retry') return messages.retry;
  // contact_support is the safe default for any terminal or unmapped failure,
  // mirroring the API's classifyCheckoutFailure default.
  return messages.contactSupport;
}

/**
 * Resolve the neutral checkoutFailure bucket for a cancelled or failed order.
 *
 * A buyer cancellation (reason=customer_cancelled) or missing context (no orderId or
 * no email) skips the order lookup and returns ''. Any lookup failure also falls
 * through to '' so the caller applies the safe contact_support default. `getOrder` is
 * injected so this stays dependency-free and unit-testable.
 *
 * @param {{ reason?: string, orderId?: string, email?: string,
 *   getOrder: (email: string, orderId: string) => Promise<{ order?: any }> }} opts
 * @returns {Promise<string>} the checkoutFailure bucket, or '' when unavailable
 */
export async function resolveCheckoutFailure({
  reason, orderId, email, getOrder,
}) {
  if (reason === 'customer_cancelled' || !orderId || !email) return '';
  try {
    const { order } = await getOrder(email, orderId);
    return order?.payment?.checkoutFailure || '';
  } catch {
    return '';
  }
}

export default resolvePaymentFailureMessage;
