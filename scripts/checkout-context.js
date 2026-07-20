const CHECKOUT_ENTRY_POINTS = new Set(['cart', 'checkout', 'pdp']);

/**
 * Builds checkout facts shared by estimate, preview, and order payloads.
 * @param {string|null} paymentMethod
 * @param {'standard'|'express'} checkoutFlow
 * @param {'cart'|'checkout'|'pdp'} entryPoint
 * @returns {Object|null}
 */
export function createCheckoutContext(paymentMethod, checkoutFlow, entryPoint) {
  if (!paymentMethod) return null;
  if (!['standard', 'express'].includes(checkoutFlow)) {
    throw new Error(`Unsupported checkout flow: ${checkoutFlow}`);
  }
  if (!CHECKOUT_ENTRY_POINTS.has(entryPoint)) {
    throw new Error(`Unsupported checkout entry point: ${entryPoint}`);
  }
  return { paymentMethod, checkoutFlow, entryPoint };
}

/**
 * Context for a payment selected after the shopper completes checkout fields.
 * @param {string|null} paymentMethod
 * @returns {Object|null}
 */
export function getStandardCheckoutContext(paymentMethod) {
  return createCheckoutContext(paymentMethod, 'standard', 'checkout');
}

/**
 * Context for a wallet that collects checkout details without the full form.
 * @param {string} paymentMethod
 * @param {'cart'|'checkout'|'pdp'} entryPoint
 * @returns {Object}
 */
export function getExpressCheckoutContext(paymentMethod, entryPoint) {
  if (!paymentMethod) {
    throw new Error('Payment method is required for express checkout');
  }
  return createCheckoutContext(paymentMethod, 'express', entryPoint);
}
