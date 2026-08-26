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

/**
 * Builds a wallet express order body by replaying the exact payload that minted
 * the estimate token and overlaying only the wallet-provided identity and the
 * token itself.
 *
 * The estimate token's `payloadHash` covers every estimate-relevant field
 * (items + `selectedOptions`, `shippingMethod`, shipping country/state/zip,
 * `couponCode`, and the checkout context). Rebuilding the order body from the
 * wallet response risks dropping one of them — that is exactly how `couponCode`
 * was lost, producing `ADOBE_COMMERCE_CONSISTENCY_MISMATCH` on `estimateToken`.
 * Spreading `estimatePayload` makes the order match the token by construction:
 * the wallet contributes only `customer`, `billing`, the full shipping address,
 * and `estimateToken`.
 *
 * The hash-relevant shipping fields (country/state/zip) are kept exactly as
 * previewed; the wallet's descriptive shipping fields (name/street/city/email)
 * are layered underneath so they can never override the hashed values.
 *
 * @param {Object} estimatePayload - the payload sent to `/orders/preview`
 * @param {Object} identity
 * @param {Object} identity.customer
 * @param {Object} identity.shipping - full shipping address from the wallet
 * @param {Object} identity.billing
 * @param {string} identity.estimateToken
 * @param {string} [identity.customerTimezone]
 * @returns {Object} order body consistent with the estimate token
 */
export function buildExpressOrderPayload(estimatePayload, identity) {
  if (!estimatePayload) {
    throw new Error('express order requires the previewed estimate payload');
  }
  const {
    customer, shipping, billing, estimateToken, customerTimezone,
  } = identity;
  // `couponSource` is a preview-only hint: it shapes the estimate and is
  // accepted by the preview schema, but it is NOT part of the estimate token's
  // hash and is NOT a valid field on the order schema (which rejects unknown
  // properties). Drop it so replaying the previewed payload yields a valid order
  // body. `couponCode` is kept (it is hashed and is a valid order field).
  const { couponSource, ...orderFields } = estimatePayload;
  return {
    ...orderFields,
    customer,
    // Keep the hash-relevant shipping fields (country/state/zip) exactly as
    // previewed; layer the wallet's descriptive fields underneath.
    shipping: { ...shipping, ...orderFields.shipping },
    billing,
    estimateToken,
    ...(customerTimezone ? { customerTimezone } : {}),
  };
}
