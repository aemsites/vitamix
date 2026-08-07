/**
 * Resolve customer-facing copy for a payment cancellation reason.
 *
 * @param {string} reason machine-readable cancellation reason
 * @param {{ customerCancelled: string, fraudDeclined: string, declined: string,
 *   paymentFailed: string }} messages localized messages
 * @returns {string} customer-facing payment message
 */
function resolvePaymentFailureMessage(reason, messages) {
  if (reason === 'customer_cancelled') return messages.customerCancelled;
  if (reason === 'fraud_declined') return messages.fraudDeclined;
  if (reason === 'declined') return messages.declined;
  return messages.paymentFailed;
}

export default resolvePaymentFailureMessage;
