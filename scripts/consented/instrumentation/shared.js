export function isDebugMode() {
  return window.location.hostname === 'localhost'
    || window.location.search.includes('instrumentation=debug');
}

export function debugLog(...args) {
  // eslint-disable-next-line no-console
  if (isDebugMode()) console.log(...args);
}
export function debugWarn(...args) {
  // eslint-disable-next-line no-console
  if (isDebugMode()) console.warn(...args);
}

/**
 * Whether marketing/analytics scripts may run (Cookiebot consent or martech=on).
 * Mirrors scripts/scripts.js loadDelayed consent gating for consented.js.
 * @returns {boolean}
 */
export function hasMarketingConsent() {
  if (document.body.classList.contains('consented')) {
    return true;
  }
  return window.Cookiebot?.consented === true;
}

const PROD_HOSTS = new Set(['vitamix.com', 'www.vitamix.com']);

window.vitamixEdsAnalytics = window.vitamixEdsAnalytics || {};

/**
 * Adobe Analytics report suite suffix (vitamix{env}).
 * EDS preview/local hosts use dev; vitamix.com uses prod.
 * @returns {'dev' | 'prod'}
 */
export function getDeploymentEnv() {
  return PROD_HOSTS.has(window.location.hostname) ? 'prod' : 'dev';
}

/**
 * PDP detection via product SKU meta tag.
 * @returns {boolean}
 */
export function isPdpPage() {
  return !!document.querySelector('meta[name="sku"]');
}

/**
 * EDS checkout page detection (`/order/checkout`).
 * @returns {boolean}
 */
export function isCheckoutPage() {
  if (!window.location?.pathname) return false;
  return /\/order\/checkout\/?$/.test(window.location.pathname);
}

/**
 * Shopping cart page detection via URL path.
 * @returns {boolean}
 */
export function isCartPage() {
  if (!window.location?.pathname) return false;
  return /\/(?:order|checkout)\/cart\/?$/.test(window.location.pathname);
}

/**
 * EDS order success page detection (`/order/complete`).
 * Skips cancelled/failed payment returns that carry a `reason` query param.
 * @returns {boolean}
 */
export function isOrderSuccessPage() {
  if (!window.location?.pathname) return false;
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  if (params.get('reason')) return false;
  const orderId = params.get('orderId') || params.get('id');
  if (!orderId) return false;
  return /\/order\/complete\/?$/.test(pathname);
}

/**
 * 404 / no-route page detection. The EDS error template sets
 * `window.isErrorPage` and renders a `main.error` wrapper (see 404.html).
 * @returns {boolean}
 */
export function isErrorPage() {
  if (window.isErrorPage === true) return true;
  return typeof document.querySelector === 'function'
    && !!document.querySelector('main.error');
}

/**
 * @param {string} sku
 * @returns {boolean}
 */
export function isWarrantySku(sku) {
  return sku.toLowerCase().includes('warranty');
}

/**
 * Whether a cart line should be included in analytics events.
 * Matches the cart block's visible-line filter; checkout can exclude warranties.
 * @param {{ name?: string, sku?: string, local?: object, custom?: object }} item
 * @param {{ excludeWarranty?: boolean }} [options]
 * @returns {boolean}
 */
export function shouldTrackCartLine(item, { excludeWarranty = false } = {}) {
  if (!item?.name) {
    return false;
  }
  if (item.local?.showInCart === false) {
    return false;
  }
  if (item.custom?.giftWithPurchase) {
    return false;
  }
  if (excludeWarranty && isWarrantySku(item.sku || '')) {
    return false;
  }
  return true;
}

/**
 * Product display name for Adobe Analytics productID.
 * The product name is used to build the Adobe Analytics productID.
 * @returns {string}
 */
export function getProductName() {
  if (window.jsonLdData?.name) {
    return window.jsonLdData.name;
  }
  const jsonLd = document.head.querySelector('script[type="application/ld+json"]');
  if (jsonLd?.textContent) {
    try {
      const data = JSON.parse(jsonLd.textContent);
      if (data?.name) return data.name;
    } catch {
      // ignore error parsing JSON-LD.
    }
  }
  return document.querySelector('.pdp h1')?.textContent?.trim() || '';
}

/**
 * @param {string} productName
 * @returns {string}
 */
export function buildProductId(productName) {
  return `;${productName};;;;`;
}

/**
 * @param {number|string} value
 * @returns {string}
 */
export function formatAnalyticsQuantity(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return '0';
  return Math.round(num).toString();
}

/**
 * @param {number|string} value
 * @returns {string}
 */
export function formatAnalyticsMoney(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return '0.00';
  return num.toFixed(2);
}

/**
 * Adobe Analytics checkout products string segment: ;{name};{qty};{lineTotal};;
 * @param {string} name
 * @param {number|string} qty
 * @param {number|string} unitPrice
 * @returns {string}
 */
export function buildCheckoutProductLine(name, qty, unitPrice) {
  const quantity = formatAnalyticsQuantity(qty);
  const lineTotal = formatAnalyticsMoney(Number(qty) * Number(unitPrice));
  return `;${name};${quantity};${lineTotal};;`;
}

/**
 * @param {string[]} lines
 * @returns {string}
 */
export function buildCheckoutProductId(lines) {
  return lines.join(',');
}

/**
 * @returns {string}
 */
export function getStoreLocaleKey() {
  if (!window.location?.pathname) return 'us';
  return window.location.pathname.split('/').filter(Boolean)[0] || 'us';
}

/**
 * @param {object} item
 * @returns {{ name: string, qty: number, unitPrice: number }|null}
 */
export function normalizeCartItem(item) {
  const name = item.name || '';
  const qty = Number(item.quantity ?? 0);
  const unitPrice = Number(item.price?.final ?? item.price ?? 0);
  if (!name || qty <= 0) return null;
  return { name, qty, unitPrice };
}

/**
 * @param {object} item
 * @returns {{ name: string, qty: number, unitPrice: number }|null}
 */
export function normalizePurchaseLineItem(item) {
  const name = `${item?.name || item?.productName || item?.title || item?.sku || ''}`.trim();
  const qty = Number(item.quantity ?? 0);
  const unitPrice = Number(item.price?.final ?? item.price ?? 0);
  if (!name || qty <= 0) return null;
  return { name, qty, unitPrice };
}

/**
 * Purchase lines mirror order-complete display rules (name fallback to SKU).
 * @param {object} item
 * @returns {boolean}
 */
export function shouldTrackPurchaseLine(item) {
  const name = `${item?.name || item?.sku || ''}`.trim();
  if (!name) return false;
  if (item.local?.showInCart === false) return false;
  if (item.custom?.giftWithPurchase) return false;
  if (isWarrantySku(item.sku || '')) return false;
  return true;
}

/**
 * @param {string|null} raw
 * @returns {object|null}
 */
export function parseStorageJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Adobe Analytics products string for scAdd (includes quantity).
 * @param {string} productName
 * @param {number|string} [quantity]
 * @returns {string}
 */
export function buildCartProductId(productName, quantity = 1) {
  const qty = Number(quantity) || 1;
  return `;${productName};${qty};;;`;
}

/**
 * Check if the cart item added is the first item in the cart.
 * @param {boolean} isFirstCart
 * @returns {'Yes' | 'No'}
 */
export function formatIsFirstCart(isFirstCart) {
  return isFirstCart ? 'Yes' : 'No';
}
