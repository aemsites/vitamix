import { getExpressCheckoutContext } from '../checkout-context.js';

/**
 * Builds PayPal express context for the page where the button is rendered.
 * @param {'cart'|'checkout'|'pdp'} entryPoint
 * @returns {Object}
 */
export function getPayPalExpressContext(entryPoint) {
  return getExpressCheckoutContext('paypal', entryPoint);
}

/**
 * Adds authoritative PayPal express facts to a preview or order payload.
 * @param {Object} payload
 * @param {'cart'|'checkout'|'pdp'} entryPoint
 * @returns {Object}
 */
export function withPayPalExpressContext(payload, entryPoint) {
  return {
    ...payload,
    ...getPayPalExpressContext(entryPoint),
  };
}

/**
 * Ensures checkout PayPal has a signed estimate token before order creation.
 * @param {Object} callbacks
 * @returns {Promise<boolean>}
 */
export default async function ensureCheckoutPreviewToken(callbacks) {
  if (callbacks.getState().currentEstimateToken) return true;
  await callbacks.updatePreview();
  return Boolean(callbacks.getState().currentEstimateToken);
}
