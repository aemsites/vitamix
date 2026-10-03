import { logOperation } from '../operations-log.js';

export const CONSISTENCY_MISMATCH = 'ADOBE_COMMERCE_CONSISTENCY_MISMATCH';

/**
 * Returns the price update carried by a bundle price mismatch error
 * (`details.itemSum` for `details.sku`), or null.
 *
 * @param {Object} err - CommerceApiError
 * @returns {{ sku: string, price: string, previousPrice?: string }|null}
 */
export function getPriceCorrection(err) {
  const body = err?.body;
  if (err?.status !== 400 || body?.code !== CONSISTENCY_MISMATCH) return null;
  const {
    field, sku, bundlePrice, itemSum,
  } = body.details || {};
  if (field !== 'bundle_price' || !sku) return null;
  const price = parseFloat(itemSum);
  if (!Number.isFinite(price) || price < 0) return null;
  return { sku, price: price.toFixed(2), previousPrice: bundlePrice };
}

/**
 * Applies the price update from a preview error to the cart.
 *
 * @param {Object} err - CommerceApiError
 * @param {Object} [cart=window.cart]
 * @returns {boolean} true when the cart was repriced
 */
export function applyPriceCorrection(err, cart = window.cart) {
  const correction = getPriceCorrection(err);
  if (!correction || typeof cart?.updateItemPrice !== 'function') return false;
  const changed = cart.updateItemPrice(correction.sku, correction.price);
  if (changed) {
    logOperation('cart-price-corrected', {
      sku: correction.sku,
      from: correction.previousPrice,
      to: correction.price,
    });
  }
  return changed;
}
