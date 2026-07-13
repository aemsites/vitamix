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
