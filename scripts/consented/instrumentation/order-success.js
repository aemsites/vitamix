import {
  debugLog,
  debugWarn,
  hasMarketingConsent,
  isOrderSuccessPage,
  parseStorageJson,
  getStoreLocaleKey,
  formatAnalyticsMoney,
  buildCheckoutProductLine,
  buildCheckoutProductId,
  shouldTrackPurchaseLine,
  normalizePurchaseLineItem,
} from './shared.js';
import {
  assignDigitalDataTransaction,
  configureAnalyticsTrackingServers,
  getAdobeTarget,
  getPrimaryAnalyticsTracker,
  getSatellite,
  resetTrackerForScAdd,
  waitForBeaconComplete,
  whenSatelliteReady,
  whenTargetReady,
} from './adobe-runtime.js';

/** Adobe Target conversion mbox for order confirmation. */
export const TARGET_ORDER_CONFIRM_MBOX = 'orderConfirmPage';

/** Launch direct-call rule for order confirmation (Magento parity). */
export const LAUNCH_PURCHASE_EVENT = 'purchase';

/**
 * Order confirmation total for Target params (mirrors order-complete.js).
 * @param {{ subtotal?: number, tax?: number, shippingRate?: number, discounts?: object[] }} params
 * @returns {number}
 */
function calculateOrderSuccessTotal({
  subtotal = 0,
  tax = 0,
  shippingRate = 0,
  discounts = [],
} = {}) {
  const hasFreeShipping = discounts.some((discount) => discount?.freeShipping);
  const shippingAmount = hasFreeShipping ? 0 : (parseFloat(shippingRate) || 0);
  const discountAmount = discounts
    .filter((discount) => Math.abs(parseFloat(discount?.amount)) > 0)
    .reduce((sum, discount) => sum + (Math.abs(parseFloat(discount.amount)) || 0), 0);

  return Math.round(Math.max(0, subtotal - discountAmount + shippingAmount + tax) * 100) / 100;
}

/**
 * Reads checkout confirmation data written before the payment redirect.
 * @returns {object|null}
 */
export function readOrderSuccessContext() {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('orderId') || params.get('id');
  if (!orderId || params.get('reason')) return null;

  const order = parseStorageJson(sessionStorage.getItem('checkout_order'));
  const cacheMatches = !!order?.id && order.id === orderId;

  return {
    orderId,
    order: cacheMatches ? order : null,
    preview: cacheMatches ? parseStorageJson(sessionStorage.getItem('checkout_preview')) : null,
    cartItems: cacheMatches ? parseStorageJson(sessionStorage.getItem('checkout_cart_items')) : null,
    couponCode: sessionStorage.getItem('checkout_coupon_code') || '',
  };
}

/**
 * Comma-separated SKUs for Adobe Target order confirmation.
 * Mirrors Adobe Commerce `getAllVisibleItems()` + `getPurchasedProductIdsString()`.
 * @param {object[]} items Order or cart line items with `sku`
 * @returns {string}
 */
export function buildPurchasedProductIdsString(items = []) {
  return items
    .map((item) => String(item.sku || '').trim())
    .filter(Boolean)
    .join(',');
}

/**
 * Order total and line items from the checkout session snapshot.
 * @param {ReturnType<typeof readOrderSuccessContext>} context
 * @returns {{ displayItems: object[], orderTotal: number }|null}
 */
function getOrderSuccessOrderSummary(context) {
  if (!context?.orderId) return null;

  const {
    orderId, order, preview, cartItems, displayItems: explicitDisplayItems,
  } = context;
  let displayItems = explicitDisplayItems;
  if (!displayItems?.length) {
    displayItems = cartItems?.length ? cartItems : order?.items;
  }
  if (!displayItems?.length) return null;

  const est = order?.estimates;
  const discounts = est ? (est.discounts || []) : (preview?.discounts || []);
  const shippingMethod = est ? (est.shippingMethod || {}) : (preview?.shippingMethod || {});
  const tax = parseFloat(est ? (est.tax?.amount || 0) : (preview?.taxAmount || 0));
  const subtotal = est
    ? order.items?.reduce(
      (acc, item) => acc + (parseFloat(item.price?.final || item.price || 0) * item.quantity),
      0,
    ) ?? 0
    : parseFloat(preview?.subtotal || 0);
  const shippingRate = parseFloat(shippingMethod.rate || 0);
  const orderTotal = calculateOrderSuccessTotal({
    subtotal,
    tax,
    shippingRate,
    discounts,
  });

  return {
    displayItems,
    orderId: String(order?.friendlyId || order?.number || order?.orderNumber || orderId),
    orderTotal,
  };
}

/**
 * Adobe Target order-confirmation params from sessionStorage checkout snapshot.
 * @param {ReturnType<typeof readOrderSuccessContext>} [context]
 * @returns {{ orderId: string, orderTotal: string, productPurchasedId: string }|null}
 */
export function getOrderConfirmTargetParams(context = readOrderSuccessContext()) {
  const summary = getOrderSuccessOrderSummary(context);
  if (!summary) return null;

  const purchasedItems = context.order?.items?.length
    ? context.order.items
    : summary.displayItems;
  const productPurchasedId = buildPurchasedProductIdsString(purchasedItems);
  if (!productPurchasedId) return null;

  return {
    orderId: summary.orderId,
    orderTotal: formatAnalyticsMoney(summary.orderTotal),
    productPurchasedId,
  };
}

/**
 * Adobe Analytics page name for checkout success.
 * @param {string} [localeKey]
 * @returns {string}
 */
export function buildOrderSuccessPageName(localeKey = getStoreLocaleKey()) {
  return `vitamix:${localeKey}:hh:checkout|onepage|success|`;
}

/**
 * Builds the Adobe Analytics products string for purchase (productString).
 * @param {object[]} items
 * @returns {string}
 */
export function buildOrderSuccessProductString(items = []) {
  const lines = items
    .filter(shouldTrackPurchaseLine)
    .map(normalizePurchaseLineItem)
    .filter(Boolean)
    .map((item) => buildCheckoutProductLine(item.name, item.qty, item.unitPrice));
  return buildCheckoutProductId(lines);
}

/**
 * Transaction payload for the purchase Launch direct-call from checkout snapshot.
 * @param {{
 *   orderId?: string,
 *   order?: object|null,
 *   preview?: object|null,
 *   cartItems?: object[]|null,
 *   displayItems?: object[]|null,
 *   couponCode?: string,
 * }} context
 * @returns {object|null}
 */
export function buildPurchaseTransactionData(context) {
  const summary = getOrderSuccessOrderSummary(context);
  if (!summary) return null;

  const {
    order, preview, couponCode = '',
  } = context;
  const productString = buildOrderSuccessProductString(summary.displayItems);
  if (!productString) return null;

  const est = order?.estimates;
  const discounts = est ? (est.discounts || []) : (preview?.discounts || []);
  const shippingMethod = est ? (est.shippingMethod || {}) : (preview?.shippingMethod || {});
  const tax = parseFloat(est ? (est.tax?.amount || 0) : (preview?.taxAmount || 0));
  const shippingRate = parseFloat(shippingMethod.rate || 0);
  const hasFreeShipping = discounts.some((discount) => discount?.freeShipping);
  const discountAmount = discounts.reduce(
    (sum, discount) => sum + (Math.abs(parseFloat(discount.amount)) || 0),
    0,
  );

  return {
    pageName: buildOrderSuccessPageName(),
    purchaseID: summary.orderId,
    paymentMethod: String(order?.paymentMethod || ''),
    tax: formatAnalyticsMoney(tax),
    shippingRevenue: formatAnalyticsMoney(hasFreeShipping ? 0 : shippingRate),
    shippingDiscount: formatAnalyticsMoney(hasFreeShipping && shippingRate > 0 ? shippingRate : 0),
    discountAmount: formatAnalyticsMoney(discountAmount),
    discountCode: couponCode || order?.couponCode || '',
    productShippingMethod: String(shippingMethod.id || order?.shippingMethod?.id || ''),
    giftOption: String(order?.giftMessage || ''),
    orderTotal: formatAnalyticsMoney(summary.orderTotal),
    idmeGroup: String(order?.idmeGroup || order?.custom?.idmeGroup || ''),
    idmeSubGroup: String(order?.idmeSubGroup || order?.custom?.idmeSubGroup || ''),
    productString,
  };
}

/**
 * Transaction payload from sessionStorage checkout snapshot (URL orderId).
 * @returns {object|null}
 */
export function getPurchaseTransactionData() {
  return buildPurchaseTransactionData(readOrderSuccessContext());
}

/**
 * Send purchase via AppMeasurement when Launch has no purchase direct-call rule.
 * @param {ReturnType<typeof buildPurchaseTransactionData>} transaction
 * @returns {boolean}
 */
function sendPurchaseAppMeasurementBeacon(transaction) {
  const tracker = getPrimaryAnalyticsTracker();
  if (!tracker || typeof tracker.t !== 'function') {
    return false;
  }

  configureAnalyticsTrackingServers();
  resetTrackerForScAdd(tracker);

  tracker.pageName = transaction.pageName;
  tracker.purchaseID = transaction.purchaseID;
  tracker.products = transaction.productString;
  tracker.events = transaction.orderTotal
    ? `purchase,event32=${transaction.orderTotal}`
    : 'purchase';
  tracker.t();
  return true;
}

/**
 * Push transaction context to digitalData and trigger the purchase Launch direct-call rule.
 * Mirrors Commerce: digitalData.transaction + _satellite.track('purchase').
 * @param {ReturnType<typeof getPurchaseTransactionData>} transaction
 * @param {{ waitForBeacon?: boolean }} [options]
 * @returns {Promise<boolean>} Whether the Launch rule was triggered
 */
async function pushPurchaseEvent(transaction, { waitForBeacon = false } = {}) {
  assignDigitalDataTransaction(transaction);
  configureAnalyticsTrackingServers();

  const satellite = getSatellite();
  if (!satellite?.track) {
    return false;
  }

  const tracker = getPrimaryAnalyticsTracker();
  let launchPurchaseSent = false;
  let restoreTrackerT = null;

  if (tracker && typeof tracker.t === 'function') {
    const originalT = tracker.t;
    tracker.t = function wrappedPurchaseT(...args) {
      if (String(this.events || '').includes('purchase')) {
        launchPurchaseSent = true;
      }
      return originalT.apply(this, args);
    };
    restoreTrackerT = () => {
      tracker.t = originalT;
    };
  }

  const beaconComplete = waitForBeacon ? waitForBeaconComplete() : null;
  satellite.track(LAUNCH_PURCHASE_EVENT);

  // Give async Launch rules a moment to invoke AppMeasurement.
  await new Promise((resolve) => {
    setTimeout(resolve, 750);
  });
  restoreTrackerT?.();

  if (!launchPurchaseSent) {
    debugWarn(
      'Adobe Analytics purchase: Launch did not send a purchase beacon; using AppMeasurement fallback',
    );
    if (!sendPurchaseAppMeasurementBeacon(transaction)) {
      if (beaconComplete) {
        await beaconComplete;
      }
      return false;
    }
  }

  if (beaconComplete) {
    await beaconComplete;
  }
  debugLog(`Adobe Analytics ${LAUNCH_PURCHASE_EVENT} fired`, window.digitalData.transaction);
  return true;
}

/**
 * Fire Adobe Target order-confirmation conversion.
 * @param {{ orderId: string, orderTotal: string, productPurchasedId: string }} params
 * @returns {boolean} Whether trackEvent was invoked
 */
function trackOrderConfirmPage(params) {
  const target = getAdobeTarget();
  if (!target?.trackEvent) {
    return false;
  }

  target.trackEvent({
    mbox: TARGET_ORDER_CONFIRM_MBOX,
    params,
  });
  debugLog(`Adobe Target ${TARGET_ORDER_CONFIRM_MBOX} fired`, params);
  return true;
}

let orderConfirmTargetFired = false;
let purchaseFired = false;
let orderPurchaseTrackingRegistered = false;

/**
 * Fire the purchase event when confirmation transaction data is available.
 * @param {ReturnType<typeof getPurchaseTransactionData>} [transaction]
 * @returns {Promise<void>}
 */
export async function firePurchase(transaction = getPurchaseTransactionData()) {
  if (purchaseFired) return;

  if (!hasMarketingConsent()) {
    return;
  }

  if (!transaction?.productString) {
    debugWarn('Adobe Analytics purchase skipped: order data not available', transaction);
    return;
  }

  debugLog('Adobe Analytics purchase payload', transaction);
  if (!(await pushPurchaseEvent(transaction, { waitForBeacon: true }))) {
    debugWarn('Adobe Analytics purchase skipped: Adobe Launch (_satellite) not available');
    return;
  }

  purchaseFired = true;
}

/**
 * Fire purchase once order-complete has resolved the confirmed order payload.
 * @param {object} context Analytics context from order-complete
 * @param {number} [attempt]
 */
function trackPurchaseFromContext(context, attempt = 0) {
  const transaction = buildPurchaseTransactionData(context);
  if (!transaction?.productString) {
    if (attempt < 40) {
      setTimeout(() => trackPurchaseFromContext(context, attempt + 1), 250);
      return;
    }
    debugWarn('Adobe Analytics purchase skipped: order data not available', context);
    return;
  }

  whenSatelliteReady(() => {
    firePurchase(transaction);
  }, LAUNCH_PURCHASE_EVENT);
}

/**
 * Listen for order-complete confirmation before firing purchase.
 * Purchase must run after the page has authoritative order/line-item data,
 * not on the initial Launch page-view beacon.
 */
export function registerOrderPurchaseTracking() {
  if (orderPurchaseTrackingRegistered || !isOrderSuccessPage()) {
    return;
  }
  orderPurchaseTrackingRegistered = true;

  document.addEventListener('order:confirmed', (event) => {
    trackPurchaseFromContext(event.detail);
  }, { once: true });

  const pendingContext = window.vitamixEdsAnalytics?.orderConfirmedContext;
  if (pendingContext) {
    trackPurchaseFromContext(pendingContext);
  }
}

if (typeof window !== 'undefined' && window.location) {
  registerOrderPurchaseTracking();
}

/**
 * Retry briefly so checkout sessionStorage is available after consent scripts load.
 * @param {number} [attempt]
 */
export function trackPurchase(attempt = 0) {
  whenSatelliteReady(() => {
    const transaction = getPurchaseTransactionData();
    if (!transaction?.productString && attempt < 20) {
      setTimeout(() => trackPurchase(attempt + 1), 250);
      return;
    }
    firePurchase(transaction);
  }, LAUNCH_PURCHASE_EVENT);
}

/**
 * Fire Adobe Target orderConfirmPage when confirmation params are available.
 * @param {ReturnType<typeof getOrderConfirmTargetParams>} [params]
 * @returns {void}
 */
export function fireOrderConfirmTarget(params = getOrderConfirmTargetParams()) {
  if (orderConfirmTargetFired) return;

  if (!hasMarketingConsent()) {
    return;
  }

  if (!params?.productPurchasedId) {
    debugWarn(`Adobe Target ${TARGET_ORDER_CONFIRM_MBOX} skipped: order data not available`);
    return;
  }

  if (!trackOrderConfirmPage(params)) {
    debugWarn(`Adobe Target ${TARGET_ORDER_CONFIRM_MBOX} skipped: adobe.target.trackEvent not available`);
    return;
  }

  orderConfirmTargetFired = true;
}

/**
 * Retry briefly so checkout sessionStorage and at.js are available after consent scripts load.
 * @param {number} [attempt]
 */
export function trackOrderConfirmTarget(attempt = 0) {
  whenTargetReady(() => {
    const params = getOrderConfirmTargetParams();
    if (!params?.productPurchasedId && attempt < 20) {
      setTimeout(() => trackOrderConfirmTarget(attempt + 1), 250);
      return;
    }
    fireOrderConfirmTarget(params);
  }, TARGET_ORDER_CONFIRM_MBOX);
}
