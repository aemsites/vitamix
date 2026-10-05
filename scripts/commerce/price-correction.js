import { logOperation } from '../operations-log.js';

export const CONSISTENCY_MISMATCH = 'ADOBE_COMMERCE_CONSISTENCY_MISMATCH';

/**
 * Returns the price update carried by a price mismatch error, or null:
 * - `price`: `details.actualPrice` (`final`, else `regular`) for `details.sku`
 * - `bundle_price`: `details.itemSum` for `details.sku`
 *
 * @param {Object} err - CommerceApiError
 * @returns {{ sku: string, price: string }|null}
 */
export function getPriceCorrection(err) {
  const body = err?.body;
  if (err?.status !== 400 || body?.code !== CONSISTENCY_MISMATCH) return null;
  const {
    field, sku, itemSum, actualPrice,
  } = body.details || {};
  if (!sku) return null;
  let next;
  if (field === 'bundle_price') next = itemSum;
  else if (field === 'price') next = actualPrice?.final ?? actualPrice?.regular;
  else return null;
  const price = parseFloat(next);
  if (!Number.isFinite(price) || price < 0) return null;
  return { sku, price: price.toFixed(2) };
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
  const from = cart.items?.find((i) => i.sku === correction.sku)?.price;
  const changed = cart.updateItemPrice(correction.sku, correction.price);
  if (changed) {
    logOperation('cart-price-corrected', { sku: correction.sku, from, to: correction.price });
  }
  return changed;
}
