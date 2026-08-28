import { getStoreLocaleKey, debugWarn } from './shared.js';
import { getConfig } from '../../commerce-config.js';

/**
 * Get the currency code from the commerce config.
 * @returns {string}
 */
function getCurrencyCode() {
  const config = getConfig();
  return typeof config.currency === 'function' ? config.currency(config.getLocale()) : config.currency;
}

/**
 * Prepare cart data for Facebook Pixel InitiateCheckout event from localStorage.
 * @returns {{ content_ids: string[], num_items: number, value: number, currency: string } | []}
 */
export function getCartItemsForFbq() {
  const rawcartData = localStorage.getItem(`cart:${getStoreLocaleKey()}`);
  if (!rawcartData) return [];

  try {
    const cartData = JSON.parse(rawcartData);
    const contentIds = cartData.items.map((item) => item.parentSku);
    const numItems = cartData.items.reduce((sum, item) => sum + item.quantity, 0);
    const total = Number(cartData.items.reduce(
      (sum, item) => sum + (parseFloat(item.price) * item.quantity),
      0,
    ));
    const value = Number(total.toFixed(2));
    const currency = getCurrencyCode();
    return {
      content_ids: contentIds,
      num_items: numItems,
      value,
      currency,
    };
  } catch {
    return [];
  }
}

/**
 * prepare product data for Facebook Pixel AddToCart event
 * @returns {{ productIds: string[], productGroup: string, productPrice: string }}
 */
export function getProductData() {
  try {
    const parentProductId = window.jsonLdData?.sku || '';
    const variantProductId = window.selectedVariant?.sku || '';
    const productPrice = window.selectedVariant?.price?.final || '';

    const productIds = variantProductId
      ? [parentProductId, variantProductId].filter(Boolean)
      : [parentProductId].filter(Boolean);

    return {
      productIds,
      productGroup: variantProductId ? 'product-group' : 'product',
      productPrice,
    };
  } catch (error) {
    debugWarn('Error building product data for Facebook Pixel AddToCart event', error);
    return {
      productIds: [],
      productGroup: 'product',
      productPrice: '',
    };
  }
}
