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

/** Max wait for Launch/AppMeasurement to finish sending a beacon before navigation. */
const BEACON_COMPLETE_TIMEOUT_MS = 2000;

/** @type {Array<() => void>} */
const pendingBeaconWaits = [];

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
  return /\/order\/checkout\/?$/.test(window.location.pathname);
}

/**
 * Shopping cart page detection via URL path.
 * @returns {boolean}
 */
export function isCartPage() {
  return /\/(?:order|checkout)\/cart\/?$/.test(window.location.pathname);
}

/**
 * EDS order success page detection (`/order/complete`).
 * Skips cancelled/failed payment returns that carry a `reason` query param.
 * @returns {boolean}
 */
export function isOrderSuccessPage() {
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
function isWarrantySku(sku) {
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

/** Adobe Target conversion mbox for order confirmation. */
const TARGET_ORDER_CONFIRM_MBOX = 'orderConfirmPage';

/**
 * Read the current cart lines for scView from the shared cart singleton.
 * Uses the already-instantiated window.cart when present, otherwise imports
 * the cart module (its constructor restores items from localStorage).
 * @returns {Promise<Array<{name: string, quantity?: number|string}>>}
 */
export async function getCartViewItems() {
  const cart = window.cart?.items ? window.cart : (await import('../cart.js')).default;
  return (cart?.items || [])
    .filter(shouldTrackCartLine)
    .map((item) => ({ name: item.name, quantity: item.quantity }));
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
function formatAnalyticsQuantity(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return '0';
  return Math.round(num).toString();
}

/**
 * @param {number|string} value
 * @returns {string}
 */
function formatAnalyticsMoney(value) {
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
function buildCheckoutProductLine(name, qty, unitPrice) {
  const quantity = formatAnalyticsQuantity(qty);
  const lineTotal = formatAnalyticsMoney(Number(qty) * Number(unitPrice));
  return `;${name};${quantity};${lineTotal};;`;
}

/**
 * @param {string[]} lines
 * @returns {string}
 */
function buildCheckoutProductId(lines) {
  return lines.join(',');
}

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
 * @returns {string}
 */
function getStoreLocaleKey() {
  return window.location.pathname.split('/').filter(Boolean)[0] || 'us';
}

/**
 * @param {object} item
 * @returns {{ name: string, qty: number, unitPrice: number }|null}
 */
function normalizeCartItem(item) {
  const name = item.name || '';
  const qty = Number(item.quantity ?? 0);
  const unitPrice = Number(item.price?.final ?? item.price ?? 0);
  if (!name || qty <= 0) return null;
  return { name, qty, unitPrice };
}

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
    orderId, order, preview, cartItems,
  } = context;
  const displayItems = cartItems?.length ? cartItems : order?.items;
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

/**
 * Build the digitalData.cart object for the scAdd Launch rule.
 * @param {string} productID Adobe Analytics products string
 * @param {boolean} [isFirstCart]
 * @returns {object} digitalData.cart object for Launch scAdd rules
 */
export function buildScAddCartData(productID, isFirstCart = false) {
  return {
    item: [{
      productInfo: { productID },
      cartInfo: { isFirstCart: formatIsFirstCart(isFirstCart) },
    }],
  };
}

/**
 * Build the digitalData.cart object for the scView (shopping cart view) rule.
 * Mirrors Commerce: one item[] entry with a comma-joined Adobe Analytics products
 * string for all cart lines and cartInfo.isFirstCart for the Launch scView rule.
 * @param {Array<{name: string, quantity?: number|string}>} items Cart lines
 * @param {boolean} [isFirstCart] Whether the cart has a single line item
 * @returns {object} digitalData.cart object for the Launch scView rule
 */
export function buildScViewCartData(items = [], isFirstCart = false) {
  if (!items.length) {
    return { item: [] };
  }
  const productID = items
    .map(({ name, quantity }) => buildCartProductId(name, quantity))
    .join(',');
  return {
    item: [{
      productInfo: { productID },
      cartInfo: { isFirstCart: formatIsFirstCart(isFirstCart) },
    }],
  };
}

/**
 * Build the digitalData.cart object for the scRemove (remove from cart) rule.
 * Mirrors Commerce: one item[] entry with a comma-joined Adobe Analytics products
 * string for the removed line(s). Launch maps this to s.products for scRemove.
 * @param {Array<{name: string, quantity?: number|string}>} items Removed cart lines
 * @returns {object} digitalData.cart object for the Launch scRemove rule
 */
export function buildScRemoveCartData(items = []) {
  if (!items.length) {
    return { item: [] };
  }
  const productID = items
    .map(({ name, quantity }) => buildCartProductId(name, quantity))
    .join(',');
  return {
    item: [{
      productInfo: { productID },
    }],
  };
}

/**
 * Get the Satellite object from the window.
 * @returns {object} Satellite object
 */
export function getSatellite() {
  // eslint-disable-next-line no-underscore-dangle
  return window._satellite;
}

export function getAdobeTarget() {
  return window.adobe?.target;
}

const ANALYTICS_TRACKING_SERVER = 'metrics.vitamix.com';
const ANALYTICS_TRACKING_SERVER_SECURE = 'smetrics.vitamix.com';

function applyTrackingConfig(tracker) {
  if (!tracker || typeof tracker !== 'object') {
    return;
  }
  // Always use smetrics — AppMeasurement picks trackingServerSecure only when ssl=true.
  // Page protocol (http://localhost) must not downgrade beacons to http://metrics.
  tracker.trackingServer = ANALYTICS_TRACKING_SERVER;
  tracker.trackingServerSecure = ANALYTICS_TRACKING_SERVER_SECURE;
  tracker.ssl = true;
}

/**
 * Register s.doPlugins so tracking servers and ssl are set before each Launch beacon.
 * Chains with any existing doPlugins from Launch (set doPlugins only once per tracker).
 * @see https://experienceleague.adobe.com/en/docs/analytics/implementation/vars/functions/doplugins
 * @param {object} tracker
 */
function ensureDoPlugins(tracker) {
  if (!tracker || typeof tracker !== 'object') {
    return;
  }
  if (tracker.doPlugins?.vitamixEds === true) {
    return;
  }

  const previousDoPlugins = typeof tracker.doPlugins === 'function'
    ? tracker.doPlugins
    : null;

  function vitamixEdsDoPlugins() {
    if (typeof previousDoPlugins === 'function') {
      previousDoPlugins.call(this);
    }
    applyTrackingConfig(this);
  }
  vitamixEdsDoPlugins.vitamixEds = true;
  tracker.doPlugins = vitamixEdsDoPlugins;
}

function flushPendingBeaconWaits() {
  while (pendingBeaconWaits.length > 0) {
    const resolve = pendingBeaconWaits.shift();
    resolve();
  }
}

/**
 * Resolve when AppMeasurement finishes the in-flight beacon, or after timeout.
 * Launch rules may also call window.vitamixEdsAnalytics.notifyBeaconComplete().
 * @returns {Promise<void>}
 */
function waitForBeaconComplete() {
  return new Promise((resolve) => {
    pendingBeaconWaits.push(resolve);
    setTimeout(() => {
      const index = pendingBeaconWaits.indexOf(resolve);
      if (index >= 0) {
        pendingBeaconWaits.splice(index, 1);
        resolve();
      }
    }, BEACON_COMPLETE_TIMEOUT_MS);
  });
}

/**
 * Chain AppMeasurement post-send callbacks so navigation can wait for the beacon.
 * @param {object} tracker
 */
function ensureBeaconCallbackHooks(tracker) {
  if (!tracker || typeof tracker !== 'object' || tracker.vitamixBeaconHooks === true) {
    return;
  }

  const wrapCallback = (prop) => {
    const previous = tracker[prop];
    tracker[prop] = function wrappedBeaconCallback(...args) {
      if (typeof previous === 'function') {
        previous.apply(this, args);
      }
      flushPendingBeaconWaits();
    };
  };

  wrapCallback('callback');
  wrapCallback('linkTrackCallback');
  tracker.vitamixBeaconHooks = true;
}

function configureAnalyticsTracker(tracker = window.s) {
  if (!tracker || typeof tracker !== 'object') {
    return;
  }
  applyTrackingConfig(tracker);
  ensureDoPlugins(tracker);
  ensureBeaconCallbackHooks(tracker);
}

window.vitamixEdsAnalytics = window.vitamixEdsAnalytics || {};
window.vitamixEdsAnalytics.notifyBeaconComplete = flushPendingBeaconWaits;

/**
 * Wrap s_gi so Launch-created trackers get smetrics config before their first beacon.
 */
function patchAppMeasurementFactory() {
  if (typeof window.s_gi !== 'function' || window.s_gi.vitamixEdsPatched === true) {
    return;
  }
  const originalSgi = window.s_gi;
  function patchedSgi(account) {
    const tracker = originalSgi(account);
    configureAnalyticsTracker(tracker);
    return tracker;
  }
  patchedSgi.vitamixEdsPatched = true;
  window.s_gi = patchedSgi;
}

/**
 * Launch-owned AppMeasurement instance (prefer s_c_il over window.s stub).
 * @returns {object|null}
 */
export function getPrimaryAnalyticsTracker() {
  if (Array.isArray(window.s_c_il)) {
    for (let i = window.s_c_il.length - 1; i >= 0; i -= 1) {
      const instance = window.s_c_il[i];
      if (instance?.account && typeof instance.t === 'function') {
        return instance;
      }
    }
  }
  if (window.s && typeof window.s === 'object' && typeof window.s.t === 'function') {
    return window.s;
  }
  return null;
}

/**
 * AppMeasurement tracker instances (window.s and Launch registry in s_c_il).
 * @returns {object[]}
 */
export function getAnalyticsTrackers() {
  const trackers = [];
  const seen = new Set();
  const add = (tracker) => {
    if (tracker && typeof tracker === 'object' && !seen.has(tracker)) {
      seen.add(tracker);
      trackers.push(tracker);
    }
  };
  add(window.s);
  if (Array.isArray(window.s_c_il)) {
    window.s_c_il.forEach((instance) => {
      if (instance && (instance.account || typeof instance.t === 'function')) {
        add(instance);
      }
    });
  }
  return trackers;
}

/**
 * Clear prior Launch/AppMeasurement carry-over so each direct-call rule starts clean.
 * @param {object} tracker AppMeasurement tracker instance
 */
export function resetTrackerForScAdd(tracker) {
  if (!tracker || typeof tracker !== 'object') {
    return;
  }
  tracker.events = '';
  tracker.products = '';
  tracker.linkTrackVars = '';
  tracker.linkTrackEvents = '';
}

/** Reset Launch primary tracker before cart/checkout direct calls (not prodView). */
function flushLaunchTrackers() {
  const tracker = getPrimaryAnalyticsTracker();
  if (tracker) {
    resetTrackerForScAdd(tracker);
  }
}

/**
 * Send a cart event via AppMeasurement link tracking (s.tl b/ss beacon).
 * Uses the Launch primary tracker only — avoids duplicate hits when window.s
 * and s_c_il both exist.
 * @param {string} eventName Adobe Analytics event (e.g. scAdd, scRemove)
 * @param {string} productID Adobe Analytics products string
 */
function sendCartLinkBeacon(eventName, productID) {
  if (!productID || !eventName) {
    return;
  }

  const tracker = getPrimaryAnalyticsTracker();
  if (!tracker || typeof tracker.tl !== 'function') {
    return;
  }

  resetTrackerForScAdd(tracker);
  tracker.linkTrackVars = 'events,products';
  tracker.linkTrackEvents = eventName;
  tracker.events = eventName;
  tracker.products = productID;
  tracker.tl(true, 'o', eventName);
}

/**
 * Assign cart context to digitalData and clear prodView carry-over in digitalData.
 * AppMeasurement is flushed separately before cart/checkout direct calls only.
 * @param {object} cartData digitalData.cart payload
 */
function assignDigitalDataCart(cartData) {
  window.digitalData = window.digitalData || {};
  window.digitalData.cart = cartData;
  delete window.digitalData.product;
}

/**
 * Prepare digitalData and reset tracker state before a synchronous link beacon (s.tl).
 * @param {object} cartData digitalData.cart payload
 */
function setDigitalDataCartForLinkBeacon(cartData) {
  assignDigitalDataCart(cartData);
  flushLaunchTrackers();
}

/**
 * Launch keeps its tracker in AppMeasurement's s_c_il registry, not always window.s.
 */
export function configureAnalyticsTrackingServers() {
  patchAppMeasurementFactory();
  getAnalyticsTrackers().forEach(configureAnalyticsTracker);
}

/**
 * Launch loads AppMeasurement async after its container script resolves.
 * Poll until s_gi exists, then register doPlugins on late tracker instances.
 * @returns {Promise<void>}
 */
export function ensureAnalyticsTrackingConfigured() {
  return new Promise((resolve) => {
    let attempts = 0;
    const tick = () => {
      configureAnalyticsTrackingServers();
      attempts += 1;
      if (typeof window.s_gi === 'function' && attempts >= 3) {
        resolve();
        return;
      }
      if (attempts >= 100) {
        resolve();
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

/**
 * Poll until a readiness predicate passes, then run callback.
 * @param {() => boolean} isReady
 * @param {() => void} callback
 * @param {{
 *   eventLabel?: string,
 *   maxAttempts?: number,
 *   intervalMs?: number,
 *   skipMessage?: string,
 *   onSetup?: (run: () => void) => void,
 * }} [options]
 */
function whenReady(isReady, callback, {
  eventLabel = 'event',
  maxAttempts = 50,
  intervalMs = 100,
  skipMessage = 'skipped',
  onSetup,
} = {}) {
  let attempts = 0;
  let done = false;
  const run = () => {
    if (done) return;
    if (isReady()) {
      done = true;
      callback();
      return;
    }
    attempts += 1;
    if (attempts < maxAttempts) {
      setTimeout(run, intervalMs);
    } else {
      debugWarn(skipMessage || `${eventLabel} skipped`);
    }
  };
  onSetup?.(run);
  run();
}

/**
 * @param {() => void} callback
 * @param {string} [eventLabel]
 * @param {number} [maxAttempts]
 * @param {number} [intervalMs]
 */
export function whenSatelliteReady(
  callback,
  eventLabel = 'event',
  maxAttempts = 50,
  intervalMs = 100,
) {
  whenReady(
    () => {
      const satellite = getSatellite();
      return Boolean(satellite && typeof satellite.track === 'function');
    },
    callback,
    {
      eventLabel,
      maxAttempts,
      intervalMs,
      skipMessage: `Adobe Analytics ${eventLabel} skipped: Adobe Launch (_satellite) not available`,
    },
  );
}

/**
 * @param {() => void} callback
 * @param {string} [eventLabel]
 * @param {number} [maxAttempts]
 * @param {number} [intervalMs]
 */
export function whenTargetReady(
  callback,
  eventLabel = 'Target event',
  maxAttempts = 100,
  intervalMs = 100,
) {
  whenReady(
    () => {
      const target = getAdobeTarget();
      return Boolean(target && typeof target.trackEvent === 'function');
    },
    callback,
    {
      eventLabel,
      maxAttempts,
      intervalMs,
      skipMessage: `Adobe Target ${eventLabel} skipped: adobe.target.trackEvent not available`,
      onSetup: (run) => document.addEventListener('at-library-loaded', run, { once: true }),
    },
  );
}

/**
 * @param {string} eventName
 * @param {object} payload Logged debug payload
 * @param {{ waitForBeacon?: boolean }} [options]
 * @returns {Promise<boolean>}
 */
async function triggerLaunchEvent(eventName, payload, { waitForBeacon = false } = {}) {
  const satellite = getSatellite();
  if (!satellite?.track) {
    return false;
  }

  configureAnalyticsTrackingServers();
  const beaconComplete = waitForBeacon ? waitForBeaconComplete() : null;
  satellite.track(eventName);

  if (beaconComplete) {
    await beaconComplete;
  }
  debugLog(`Adobe Analytics ${eventName} fired`, payload);
  return true;
}

/**
 * Push product context to digitalData and trigger a Launch direct-call rule.
 * Launch owns variable mapping and beacon send (Adobe-recommended pattern).
 * @param {string} eventName Launch direct-call identifier (e.g. prodView)
 * @param {string} productID Adobe Analytics products string
 * @param {{ waitForBeacon?: boolean }} [options]
 * @returns {Promise<boolean>} Whether the Launch rule was triggered
 */
async function pushProductEvent(eventName, productID, { waitForBeacon = false } = {}) {
  window.digitalData = window.digitalData || {};
  delete window.digitalData.cart;
  window.digitalData.product = [{
    productInfo: { productID },
  }];

  return triggerLaunchEvent(eventName, window.digitalData.product, { waitForBeacon });
}

/** Dedupe window for repeat scAdd with the same product/qty (ms). */
const SCADD_DEDUPE_MS = 1500;

/**
 * @param {string} name
 * @param {number|string} quantity
 * @returns {boolean} Whether this scAdd should be skipped as a duplicate
 */
function isDuplicateScAdd(name, quantity) {
  const signature = `${name}|${quantity}`;
  const now = Date.now();
  const state = window.vitamixEdsAnalytics;
  if (state.scAddInFlight === signature) {
    return true;
  }
  if (
    state.lastScAddSignature === signature
    && now - (state.lastScAddAt || 0) < SCADD_DEDUPE_MS
  ) {
    return true;
  }
  state.scAddInFlight = signature;
  return false;
}

/**
 * @param {string} name
 * @param {number|string} quantity
 */
function markScAddComplete(name, quantity) {
  const signature = `${name}|${quantity}`;
  const state = window.vitamixEdsAnalytics;
  state.lastScAddSignature = signature;
  state.lastScAddAt = Date.now();
  if (state.scAddInFlight === signature) {
    state.scAddInFlight = null;
  }
}

/**
 * Push cart context to digitalData and trigger the scAdd Launch direct-call rule.
 * Mirrors Commerce: digitalData.cart.item[] + _satellite.track('scAdd').
 * @param {string} productID Adobe Analytics products string
 * @param {{ isFirstCart?: boolean, waitForBeacon?: boolean }} [options]
 * @returns {Promise<boolean>} Whether the Launch rule was triggered
 */
async function pushScAddEvent(productID, { isFirstCart = false, waitForBeacon = false } = {}) {
  assignDigitalDataCart(buildScAddCartData(productID, isFirstCart));
  flushLaunchTrackers();
  return triggerLaunchEvent('scAdd', window.digitalData.cart, { waitForBeacon });
}

/**
 * Push scAdd context and send a synchronous link beacon (Adobe Commerce redirect path).
 * Uses s.tl only — Launch scAdd rules would double-count if _satellite.track ran too.
 * @param {string} productID Adobe Analytics products string
 * @param {{ isFirstCart?: boolean }} [options]
 * @returns {boolean} Whether a beacon was sent
 */
function pushScAddLinkEvent(productID, { isFirstCart = false } = {}) {
  const productName = productID.replace(/^;([^;]*).*/, '$1').trim();
  const quantityMatch = productID.match(/^;[^;]*;([^;]*)/);
  const quantity = quantityMatch ? quantityMatch[1] : 1;
  if (productName && isDuplicateScAdd(productName, quantity)) {
    debugLog('Adobe Analytics scAdd deduped (link beacon)', { productName, quantity });
    return false;
  }

  setDigitalDataCartForLinkBeacon(buildScAddCartData(productID, isFirstCart));
  configureAnalyticsTrackingServers();
  sendCartLinkBeacon('scAdd', productID);
  debugLog('Adobe Analytics scAdd fired (link beacon)', window.digitalData.cart);
  if (productName) {
    markScAddComplete(productName, quantity);
  }
  return Boolean(productID);
}

/**
 * Push cart context to digitalData and trigger the scView Launch direct-call rule.
 * Mirrors Commerce: single item[] entry with comma-joined productID,
 * cartInfo.isFirstCart, and _satellite.track('scView').
 * @param {Array<{name: string, quantity?: number|string}>} items Cart lines
 * @param {{ waitForBeacon?: boolean }} [options]
 * @returns {Promise<boolean>} Whether the Launch rule was triggered
 */
async function pushScViewEvent(items, { waitForBeacon = false } = {}) {
  assignDigitalDataCart(buildScViewCartData(items, items.length === 1));
  flushLaunchTrackers();
  return triggerLaunchEvent('scView', window.digitalData.cart, { waitForBeacon });
}

/**
 * Push removed-item context to digitalData and send scRemove via s.tl.
 * Uses link beacon only — Launch scRemove rules would double-count if
 * @param {Array<{name: string, quantity?: number|string}>} items Removed cart lines
 * @param {{ waitForBeacon?: boolean }} [options]
 * @returns {Promise<boolean>} Whether the scRemove beacon was sent
 */
async function pushScRemoveEvent(items, { waitForBeacon = false } = {}) {
  const cartData = buildScRemoveCartData(items);
  const productID = cartData.item[0]?.productInfo?.productID || '';

  if (!productID) {
    return false;
  }

  assignDigitalDataCart(cartData);
  debugLog('Adobe Analytics scRemove payload', window.digitalData.cart.item);

  configureAnalyticsTrackingServers();
  const beaconComplete = waitForBeacon ? waitForBeaconComplete() : null;
  sendCartLinkBeacon('scRemove', productID);

  if (beaconComplete) {
    await beaconComplete;
  }
  debugLog('Adobe Analytics scRemove fired', window.digitalData.cart);
  return true;
}

/**
 * Push checkout cart context to digitalData and trigger a Launch direct-call rule.
 * @param {string} eventName Launch direct-call identifier (e.g. scCheckout)
 * @param {string} productID Adobe Analytics products string
 * @param {string} cartTotal Cart grand total
 * @param {{ waitForBeacon?: boolean }} [options]
 * @returns {Promise<boolean>} Whether the Launch rule was triggered
 */
async function pushCartCheckoutEvent(
  eventName,
  productID,
  cartTotal,
  { waitForBeacon = false } = {},
) {
  window.digitalData = window.digitalData || {};
  window.digitalData.cart = {
    item: [{
      productInfo: { productID },
      cartInfo: { cartTotal },
    }],
  };

  flushLaunchTrackers();
  return triggerLaunchEvent(eventName, window.digitalData.cart, { waitForBeacon });
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

let instrumentationInitialized = false;
let prodViewTrackScheduled = false;

/**
 * @param {string} name
 * @param {number|string} quantity
 */
function clearScAddInFlight(name, quantity) {
  const signature = `${name}|${quantity}`;
  if (window.vitamixEdsAnalytics.scAddInFlight === signature) {
    window.vitamixEdsAnalytics.scAddInFlight = null;
  }
}

/**
 * Fire the prodView event after the product name is found on the PDP.
 * @returns {Promise<void>}
 */
export async function fireProdView() {
  if (window.vitamixEdsAnalytics.prodViewFired) {
    return;
  }

  if (!hasMarketingConsent()) {
    return;
  }

  const productName = `${getProductName()}`;
  if (!productName) {
    debugWarn('Adobe Analytics prodView skipped: product name not found on PDP');
    return;
  }

  if (!(await pushProductEvent('prodView', buildProductId(productName)))) {
    debugWarn('Adobe Analytics prodView skipped: Adobe Launch (_satellite) not available');
    return;
  }

  window.vitamixEdsAnalytics.prodViewFired = true;
}

/**
 * Retry briefly so jsonLdData / PDP DOM are ready after consent scripts load.
 * Uses a single Launch readiness wait; only product-name polling retries.
 * @param {number} [attempt]
 */
export function trackProdView(attempt = 0) {
  const tryTrack = () => {
    const productName = `${getProductName()}`;
    if (!productName && attempt < 10) {
      setTimeout(() => trackProdView(attempt + 1), 100);
      return;
    }
    fireProdView();
  };

  if (attempt > 0) {
    tryTrack();
    return;
  }

  if (prodViewTrackScheduled || window.vitamixEdsAnalytics.prodViewFired) {
    return;
  }
  prodViewTrackScheduled = true;
  whenSatelliteReady(tryTrack, 'prodView');
}

/**
 * Fire the scAdd event after a successful add to cart.
 * @param {string} [productName]
 * @param {number|string} [quantity]
 * @param {{ isFirstCart?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function fireScAdd(
  productName = getProductName(),
  quantity = 1,
  { isFirstCart = false } = {},
) {
  if (!hasMarketingConsent()) {
    return;
  }

  const name = `${productName || ''}`.trim();
  if (!name) {
    debugWarn('Adobe Analytics scAdd skipped: product name not found');
    return;
  }

  if (isDuplicateScAdd(name, quantity)) {
    debugLog('Adobe Analytics scAdd deduped', { name, quantity });
    return;
  }

  try {
    if (!(await pushScAddEvent(buildCartProductId(name, quantity), {
      isFirstCart,
      waitForBeacon: true,
    }))) {
      clearScAddInFlight(name, quantity);
      debugWarn('Adobe Analytics scAdd skipped: Adobe Launch (_satellite) not available');
      return;
    }
    markScAddComplete(name, quantity);
  } catch (err) {
    clearScAddInFlight(name, quantity);
    throw err;
  }
}

/**
 * Wait for Launch, then fire scAdd via direct-call (edge cart:change path).
 * @param {string} [productName]
 * @param {number|string} [quantity]
 * @param {{ isFirstCart?: boolean }} [options]
 * @returns {Promise<void>}
 */
export function trackScAdd(
  productName = getProductName(),
  quantity = 1,
  { isFirstCart = false } = {},
) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    whenSatelliteReady(() => {
      fireScAdd(productName, quantity, { isFirstCart }).then(finish);
    }, 'scAdd');

    // Do not block cart redirect if Launch never becomes available.
    setTimeout(finish, 2000);
  });
}

/**
 * Fire the scView (shopping cart view) event for the current cart contents.
 * @param {Array<{name: string, quantity?: number|string}>} [items] Cart lines
 * @returns {Promise<void>}
 */
export async function fireScView(items = []) {
  if (!hasMarketingConsent()) {
    return;
  }

  const validItems = items
    .map((item) => ({ name: `${item?.name || ''}`.trim(), quantity: item?.quantity }))
    .filter((item) => item.name);
  if (validItems.length === 0) {
    debugWarn('Adobe Analytics scView skipped: no cart items with a product name');
    return;
  }

  if (!(await pushScViewEvent(validItems))) {
    debugWarn('Adobe Analytics scView skipped: Adobe Launch (_satellite) not available');
  }
}

/**
 * Wait for Launch, read the cart singleton, then fire scView on the cart page.
 * @returns {void}
 */
export function trackScView() {
  whenSatelliteReady(() => {
    getCartViewItems().then((items) => fireScView(items));
  }, 'scView');
}

/**
 * Fire the scRemove (remove from cart) event for one or more removed lines.
 * @param {Array<{name: string, quantity?: number|string}>} [items] Removed cart lines
 * @param {{ waitForBeacon?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function fireScRemove(items = [], { waitForBeacon = false } = {}) {
  if (!hasMarketingConsent()) {
    return;
  }

  const validItems = items
    .map((item) => ({ name: `${item?.name || ''}`.trim(), quantity: item?.quantity }))
    .filter((item) => item.name);
  if (validItems.length === 0) {
    debugWarn('Adobe Analytics scRemove skipped: no removed items with a product name');
    return;
  }

  if (!(await pushScRemoveEvent(validItems, { waitForBeacon }))) {
    debugWarn('Adobe Analytics scRemove skipped: AppMeasurement tracker not available');
  }
}

/** @type {Array<{name: string, quantity: number|string}>} */
let pendingScRemoveLines = [];
let scRemoveFlushQueued = false;
let cartChangeTrackingInstalled = false;

async function runScRemoveAndScView(removedLines) {
  await fireScRemove(removedLines, { waitForBeacon: true });
  const items = await getCartViewItems();
  if (items.length > 0) {
    await fireScView(items);
  }
}

function flushScRemoveBatch() {
  scRemoveFlushQueued = false;
  const removedLines = pendingScRemoveLines.splice(0);
  if (removedLines.length === 0) {
    return;
  }

  debugLog('Adobe Analytics scRemove batch', removedLines);

  if (getSatellite()?.track) {
    runScRemoveAndScView(removedLines);
    return;
  }

  whenSatelliteReady(() => {
    runScRemoveAndScView(removedLines);
  }, 'scRemove');
}

function queueScRemoveFlush() {
  if (scRemoveFlushQueued) {
    return;
  }
  scRemoveFlushQueued = true;
  queueMicrotask(flushScRemoveBatch);
}

/**
 * Handle a cart:change detail for scAdd tracking (edge add-to-cart path).
 * @param {{ action?: string, item?: object, cart?: { visibleItemCount?: number } }} detail
 * @returns {void}
 */
export function handleCartAddChange(detail) {
  const { action, item, cart } = detail || {};
  if (action !== 'add' || !shouldTrackCartLine(item)) {
    return;
  }

  const quantity = item.quantity ?? 1;
  const isFirstCart = cart?.visibleItemCount === Number(quantity);
  trackScAdd(`${item.name}`.trim(), quantity, { isFirstCart });
}

/**
 * Handle analytics:cart-add from the Adobe Commerce cart layer (redirect-safe path).
 * @param {{ name?: string, quantity?: number|string, isFirstCart?: boolean }} detail
 * @returns {void}
 */
export function handleAnalyticsCartAdd(detail) {
  if (!hasMarketingConsent()) {
    return;
  }

  const name = `${detail?.name || ''}`.trim();
  if (!name) {
    debugWarn('Adobe Analytics scAdd skipped: product name not found');
    return;
  }

  const quantity = Number(detail?.quantity) || 1;
  pushScAddLinkEvent(buildCartProductId(name, quantity), {
    isFirstCart: Boolean(detail?.isFirstCart),
  });
}

/**
 * Handle a cart:change detail for scRemove tracking.
 * Batches removals that happen in the same turn (e.g. linked add-ons).
 * @param {{ action?: string, item?: object }} detail cart:change event detail
 * @returns {void}
 */
export function handleCartRemoveChange(detail) {
  const { action, item } = detail || {};
  if (action !== 'remove' || !shouldTrackCartLine(item)) {
    return;
  }

  pendingScRemoveLines.push({
    name: `${item.name}`.trim(),
    quantity: item.quantity ?? 1,
  });
  queueScRemoveFlush();
}

/** Reset batched scRemove state (for unit tests). */
export function resetScRemoveBatchState() {
  pendingScRemoveLines = [];
  scRemoveFlushQueued = false;
}

/**
 * Track scAdd/scRemove via cart:change and scAdd via analytics:cart-add (Adobe Commerce).
 * scAdd edge: cart:change action=add. scAdd Adobe Commerce: analytics:cart-add after addToCart.
 * scRemove: cart:change action=remove.
 * @returns {void}
 */
export function trackCartChange() {
  if (cartChangeTrackingInstalled) {
    return;
  }
  cartChangeTrackingInstalled = true;

  document.addEventListener('cart:change', (ev) => {
    handleCartAddChange(ev.detail);
    handleCartRemoveChange(ev.detail);
  });
  document.addEventListener('analytics:cart-add', (ev) => {
    handleAnalyticsCartAdd(ev.detail);
  });
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

/**
 * @param {{ pageID: string, pageName: string }} pageInfo
 */
function assignDigitalDataPageInfo(pageInfo) {
  window.digitalData = window.digitalData || {};
  window.digitalData.page = window.digitalData.page || {};
  window.digitalData.page.pageInfo = {
    ...window.digitalData.page.pageInfo,
    ...pageInfo,
  };
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

/**
 * digitalData.page.pageInfo payload for a 404/no-route page (Adobe Commerce parity).
 * Mirrors Commerce: { errorCode, errorPage, technicalErrors }. Reads the code
 * the 404 template exposed on window.errorCode, falling back to '404'.
 * @returns {{ errorCode: string, errorPage: string, technicalErrors: string }}
 */
export function buildErrorPageInfo() {
  const errorCode = `${window.errorCode || '404'}`;
  return { errorCode, errorPage: 'errorPage', technicalErrors: errorCode };
}

let pageErrorFired = false;

/**
 * Fire Adobe Analytics pageError on a 404/no-route page (Adobe Commerce parity).
 * Sets digitalData.page.pageInfo (errorCode, errorPage, technicalErrors) and
 * triggers the Launch pageError direct-call rule. Deduped per page view.
 * @returns {Promise<void>}
 */
export async function firePageError() {
  if (pageErrorFired) return;

  if (!hasMarketingConsent()) {
    return;
  }

  if (!isErrorPage()) {
    return;
  }

  const pageInfo = buildErrorPageInfo();
  assignDigitalDataPageInfo(pageInfo);
  flushLaunchTrackers();

  if (!(await triggerLaunchEvent('pageError', window.digitalData.page.pageInfo))) {
    debugWarn('Adobe Analytics pageError skipped: Adobe Launch (_satellite) not available');
    return;
  }

  pageErrorFired = true;
  debugLog('Adobe Analytics pageError fired', window.digitalData.page.pageInfo);
}

/**
 * Wait for Launch, then fire pageError on a 404/no-route page.
 * @returns {void}
 */
export function trackPageError() {
  whenSatelliteReady(() => {
    firePageError();
  }, 'pageError');
}

/** Reset pageError state (for unit tests). */
export function resetPageErrorState() {
  pageErrorFired = false;
}

/**
 * SHA-256 hex digest of the given input, used to derive a pseudonymous user id
 * from the email (avoids putting raw PII into the analytics data layer).
 * @param {string} input
 * @returns {Promise<string>} Lowercase hex digest, or '' if hashing is unavailable
 */
export async function sha256Hex(input) {
  const subtle = window.crypto?.subtle;
  if (!subtle || !input) return '';
  try {
    const bytes = new TextEncoder().encode(input);
    const digest = await subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return '';
  }
}

/**
 * digitalData.page.user payload for a successful login (Adobe Commerce parity).
 * @param {string} userId Pseudonymous user id (hashed email)
 * @returns {{ userID: string, status: string, globalID: string }}
 */
export function buildLoginUserData(userId) {
  return { userID: userId, status: 'success', globalID: userId };
}

function assignDigitalDataUser(userData) {
  window.digitalData = window.digitalData || {};
  window.digitalData.page = window.digitalData.page || {};
  window.digitalData.page.user = userData;
}

let loginStartFired = false;
let logoutFired = false;

/**
 * Fire login analytics after a successful edge OTP login (Adobe Commerce parity).
 * Sets digitalData.page.user with a hashed user id, then fires formStart and
 * loginStart. Deduped so repeat/cross-tab auth events don't re-fire.
 * @param {string} email The authenticated user's email
 * @returns {Promise<void>}
 */
export async function fireLoginStart(email) {
  if (loginStartFired) return;

  if (!hasMarketingConsent()) {
    return;
  }

  const trimmedEmail = `${email || ''}`.trim().toLowerCase();
  if (!trimmedEmail) {
    return;
  }

  const userId = await sha256Hex(trimmedEmail);
  assignDigitalDataUser(buildLoginUserData(userId));
  flushLaunchTrackers();

  if (!(await triggerLaunchEvent('formStart', window.digitalData.page.user))) {
    debugWarn('Adobe Analytics login formStart skipped: Adobe Launch (_satellite) not available');
    return;
  }

  if (!(await triggerLaunchEvent('loginStart', window.digitalData.page.user))) {
    debugWarn('Adobe Analytics loginStart skipped: Adobe Launch (_satellite) not available');
    return;
  }

  loginStartFired = true;
  debugLog('Adobe Analytics loginStart fired', window.digitalData.page.user);
}

/**
 * Fire logout analytics after a successful sign-out (Adobe Commerce parity).
 * Mirrors Commerce: _satellite.track('loggedOut'). Deduped so repeat/cross-tab
 * auth events don't re-fire within the same page view.
 * @returns {Promise<void>}
 */
export async function fireLoggedOut() {
  if (logoutFired) return;

  if (!hasMarketingConsent()) {
    return;
  }

  flushLaunchTrackers();

  if (!(await triggerLaunchEvent('loggedOut', window.digitalData?.page?.user))) {
    debugWarn('Adobe Analytics loggedOut skipped: Adobe Launch (_satellite) not available');
    return;
  }

  logoutFired = true;
  debugLog('Adobe Analytics loggedOut fired');
}

/**
 * Handle commerce:auth-state-changed. Fires login analytics on a fresh login and
 * logout analytics on sign-out, resetting the opposite dedupe flag so the next
 * transition is tracked again.
 * @param {{ loggedIn?: boolean, email?: string }} detail
 * @returns {void}
 */
export function handleAuthStateChanged(detail) {
  const { loggedIn, email } = detail || {};
  if (!loggedIn) {
    loginStartFired = false;
    whenSatelliteReady(() => {
      fireLoggedOut();
    }, 'loggedOut');
    return;
  }
  logoutFired = false;
  whenSatelliteReady(() => {
    fireLoginStart(email);
  }, 'loginStart');
}

let loginTrackingInstalled = false;

/**
 * Listen for edge OTP login state changes (register early in consented.js).
 * @returns {void}
 */
export function trackLogin() {
  if (loginTrackingInstalled) {
    return;
  }
  loginTrackingInstalled = true;

  document.addEventListener('commerce:auth-state-changed', (ev) => {
    handleAuthStateChanged(ev.detail);
  });
}

/** Reset login analytics state (for unit tests). */
export function resetLoginState() {
  loginStartFired = false;
  logoutFired = false;
  loginTrackingInstalled = false;
}

let orderConfirmTargetFired = false;

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

/**
 * Initialize page-level Adobe Analytics (prodView on PDP, scView on cart, scCheckout,
 * pageError on 404) and Adobe Target
 * orderConfirmPage on order success. Cart mutation listeners are registered early via
 * trackCartChange() in consented.js.
 * @returns {void}
 */
export function initInstrumentation() {
  if (instrumentationInitialized || window.vitamixEdsAnalytics.instrumentationInitialized) {
    return;
  }
  instrumentationInitialized = true;
  window.vitamixEdsAnalytics.instrumentationInitialized = true;

  debugLog('Adobe Analytics instrumentation loaded');
  if (isPdpPage()) {
    trackProdView();
  }
  if (isCartPage()) {
    trackScView();
  }
  if (isCheckoutPage()) {
    trackScCheckout();
  }
  if (isErrorPage()) {
    trackPageError();
  }
  if (isOrderSuccessPage()) {
    trackOrderConfirmTarget();
  }
}
