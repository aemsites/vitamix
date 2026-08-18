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

export default resolvePaymentFailureMessage;
