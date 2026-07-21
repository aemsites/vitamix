import {
  debugLog,
  debugWarn,
  hasMarketingConsent,
  isCheckoutPage,
  shouldTrackCartLine,
  getStoreLocaleKey,
  normalizeCartItem,
  buildCheckoutProductLine,
  buildCheckoutProductId,
  formatAnalyticsMoney,
} from './shared.js';
import {
  assignDigitalDataPageInfo,
  flushLaunchTrackers,
  pushCartCheckoutEvent,
  triggerLaunchEvent,
  whenSatelliteReady,
} from './adobe-runtime.js';

/**
 * Build checkout analytics payload from normalized cart line items.
 * @param {Array<{ name: string, qty: number, unitPrice: number }>} items
 * @param {number|string|undefined} cartTotal
 * @returns {{ productID: string, cartTotal: string }|null}
 */
function buildCheckoutCartPayload(items, cartTotal) {
  if (!items.length) return null;

  const lines = items.map((item) => buildCheckoutProductLine(item.name, item.qty, item.unitPrice));
  const computedTotal = items.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0);
  const resolvedTotal = cartTotal ?? computedTotal;

  return {
    productID: buildCheckoutProductId(lines),
    cartTotal: formatAnalyticsMoney(resolvedTotal),
  };
}

/**
 * Checkout cart from edge localStorage (`cart:{locale}`).
 * @returns {{ productID: string, cartTotal: string }|null}
 */
export function getCheckoutCartData() {
  const raw = localStorage.getItem(`cart:${getStoreLocaleKey()}`);
  if (!raw) return null;

  try {
    const cart = JSON.parse(raw);
    const items = (cart.items || [])
      .filter((item) => shouldTrackCartLine(item, { excludeWarranty: true }))
      .map(normalizeCartItem)
      .filter(Boolean);

    const cartTotal = cart.totals?.grandTotal ?? cart.totals?.subtotal;

    return buildCheckoutCartPayload(items, cartTotal);
  } catch {
    return null;
  }
}

let scCheckoutFired = false;

/**
 * Fire the scCheckout event when checkout cart data is available.
 * @param {{ productID: string, cartTotal: string }} [cartData]
 * @returns {Promise<void>}
 */
export async function fireScCheckout(cartData = getCheckoutCartData()) {
  if (scCheckoutFired) return;

  if (!hasMarketingConsent()) {
    return;
  }

  if (!cartData?.productID) {
    debugWarn('Adobe Analytics scCheckout skipped: cart data not available');
    return;
  }

  if (!(await pushCartCheckoutEvent('scCheckout', cartData.productID, cartData.cartTotal))) {
    debugWarn('Adobe Analytics scCheckout skipped: Adobe Launch (_satellite) not available');
    return;
  }

  scCheckoutFired = true;
}

/**
 * Retry briefly so cart localStorage is populated after consent scripts load.
 * @param {number} [attempt]
 */
export function trackScCheckout(attempt = 0) {
  whenSatelliteReady(() => {
    const cartData = getCheckoutCartData();
    if (!cartData?.productID && attempt < 20) {
      setTimeout(() => trackScCheckout(attempt + 1), 250);
      return;
    }
    fireScCheckout(cartData);
  }, 'scCheckout');
}

/**
 * Adobe Commerce parity: payment-step page identifier for formStart after a new checkout
 * address is saved (setShippingInformation / saveNewAddress). EDS fires on address
 * section collapse but keeps the same pageID so the Launch formStart rule maps
 * variables correctly.
 * @param {string} [locale] Store locale key from URL path (e.g. us, ca)
 * @returns {{ pageID: string, pageName: string }}
 */
export function buildCheckoutPaymentPageInfo(locale = getStoreLocaleKey()) {
  const pageId = `vitamix:${locale}:sh:checkout:payment`;
  return { pageID: pageId, pageName: pageId };
}

let formStartFiredFor = new Set();
let checkoutShippingTrackingInstalled = false;

/**
 * Fire formStart when a new checkout address is saved (Adobe Commerce setShippingInformation
 * and saveNewAddress parity). Updates digitalData.page.pageInfo and triggers the
 * Launch formStart direct-call rule. Deduped per address type so shipping and billing
 * can each fire once.
 * @param {'shipping' | 'billing'} [addressType]
 * @returns {Promise<void>}
 */
export async function fireFormStart(addressType = 'shipping') {
  if (formStartFiredFor.has(addressType)) return;

  if (!hasMarketingConsent()) {
    return;
  }

  if (!isCheckoutPage()) {
    return;
  }

  const pageInfo = buildCheckoutPaymentPageInfo();
  assignDigitalDataPageInfo(pageInfo);
  flushLaunchTrackers();

  if (!(await triggerLaunchEvent('formStart', pageInfo))) {
    debugWarn('Adobe Analytics formStart skipped: Adobe Launch (_satellite) not available');
    return;
  }

  formStartFiredFor.add(addressType);
  debugLog(`Adobe Analytics formStart fired (${addressType} address)`, pageInfo);
}

/**
 * Handle checkout:shipping-address-validated.
 * @returns {void}
 */
export function handleShippingAddressValidated() {
  whenSatelliteReady(() => {
    fireFormStart('shipping');
  }, 'formStart');
}

/**
 * Handle checkout:billing-address-validated.
 * @returns {void}
 */
export function handleBillingAddressValidated() {
  whenSatelliteReady(() => {
    fireFormStart('billing');
  }, 'formStart');
}

/**
 * Listen for new checkout address saves (register early in consented.js).
 * @returns {void}
 */
export function trackCheckoutShipping() {
  if (checkoutShippingTrackingInstalled) {
    return;
  }
  checkoutShippingTrackingInstalled = true;

  document.addEventListener('checkout:shipping-address-validated', () => {
    handleShippingAddressValidated();
  });
  document.addEventListener('checkout:billing-address-validated', () => {
    handleBillingAddressValidated();
  });
}

/** Reset formStart dedupe state (for unit tests). */
export function resetFormStartState() {
  formStartFiredFor = new Set();
  checkoutShippingTrackingInstalled = false;
}
