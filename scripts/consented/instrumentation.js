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
 * Shopping cart page detection via URL path.
 * @returns {boolean}
 */
export function isCartPage() {
  return /\/(?:order|checkout)\/cart\/?$/.test(window.location.pathname);
}

/**
 * Read the current cart lines for scView from the shared cart singleton.
 * Uses the already-instantiated window.cart when present, otherwise imports
 * the cart module (its constructor restores items from localStorage). Mirrors
 * the cart block's visible-line filter (excludes local.showInCart === false).
 * @returns {Promise<Array<{name: string, quantity?: number|string}>>}
 */
export async function getCartViewItems() {
  const cart = window.cart?.items ? window.cart : (await import('../cart.js')).default;
  return (cart?.items || [])
    .filter((item) => item.local?.showInCart !== false)
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
 * AppMeasurement tracker instances (window.s and Launch registry in s_c_il).
 * @returns {object[]}
 */
export function getAnalyticsTrackers() {
  const trackers = [];
  if (window.s && typeof window.s === 'object') {
    trackers.push(window.s);
  }
  if (Array.isArray(window.s_c_il)) {
    window.s_c_il.forEach((instance) => {
      if (instance && (instance.account || typeof instance.t === 'function')) {
        trackers.push(instance);
      }
    });
  }
  return trackers;
}

/**
 * Clear prior direct-call carry-over (e.g. prodView) so the next Launch rule
 * (scAdd, scView) sets its own events/products on a clean tracker.
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

/**
 * Send scRemove via AppMeasurement link tracking (s.tl b/ss beacon).
 * The Launch dev container has scView/scAdd rules but no scRemove direct-call
 * rule for EDS; Commerce sends this beacon from PHP inline script. EDS sends
 * it directly so removal is tracked without a Launch rule dependency.
 * @param {string} productID Comma-joined Adobe Analytics products string
 */
function sendScRemoveLinkBeacon(productID) {
  if (!productID) {
    return;
  }

  getAnalyticsTrackers().forEach((tracker) => {
    if (typeof tracker.tl !== 'function') {
      return;
    }
    resetTrackerForScAdd(tracker);
    tracker.linkTrackVars = 'events,products';
    tracker.linkTrackEvents = 'scRemove';
    tracker.events = 'scRemove';
    tracker.products = productID;
    tracker.tl(true, 'o', 'scRemove');
  });
}

/**
 * Send scAdd via AppMeasurement link tracking (s.tl b/ss beacon).
 * Synchronous — survives the Magento PDP redirect to the cart page.
 * @param {string} productID Adobe Analytics products string
 */
function sendScAddLinkBeacon(productID) {
  if (!productID) {
    return;
  }

  getAnalyticsTrackers().forEach((tracker) => {
    if (typeof tracker.tl !== 'function') {
      return;
    }
    resetTrackerForScAdd(tracker);
    tracker.linkTrackVars = 'events,products';
    tracker.linkTrackEvents = 'scAdd';
    tracker.events = 'scAdd';
    tracker.products = productID;
    tracker.tl(true, 'o', 'scAdd');
  });
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
  let attempts = 0;
  const check = () => {
    const satellite = getSatellite();
    if (satellite && typeof satellite.track === 'function') {
      callback();
      return;
    }
    attempts += 1;
    if (attempts < maxAttempts) {
      setTimeout(check, intervalMs);
    } else {
      debugWarn(`Adobe Analytics ${eventLabel} skipped: Adobe Launch (_satellite) not available`);
    }
  };
  check();
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

  // Re-apply smetrics on all tracker instances right before Launch sends the beacon.
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
  window.digitalData.product = [{
    productInfo: { productID },
  }];

  return triggerLaunchEvent(eventName, window.digitalData.product, { waitForBeacon });
}

/**
 * Push cart context to digitalData and trigger the scAdd Launch direct-call rule.
 * Mirrors Commerce: digitalData.cart.item[] + _satellite.track('scAdd').
 * @param {string} productID Adobe Analytics products string
 * @param {{ isFirstCart?: boolean, waitForBeacon?: boolean }} [options]
 * @returns {Promise<boolean>} Whether the Launch rule was triggered
 */
async function pushScAddEvent(productID, { isFirstCart = false, waitForBeacon = false } = {}) {
  window.digitalData = window.digitalData || {};
  // Mirror Commerce: reset cart scope before assigning scAdd payload.
  window.digitalData.cart = {};
  window.digitalData.cart = buildScAddCartData(productID, isFirstCart);
  delete window.digitalData.product;

  getAnalyticsTrackers().forEach(resetTrackerForScAdd);

  return triggerLaunchEvent('scAdd', window.digitalData.cart, { waitForBeacon });
}

/**
 * Push scAdd context and send a synchronous link beacon (Magento redirect path).
 * @param {string} productID Adobe Analytics products string
 * @param {{ isFirstCart?: boolean }} [options]
 * @returns {boolean} Whether a beacon was sent
 */
function pushScAddLinkEvent(productID, { isFirstCart = false } = {}) {
  window.digitalData = window.digitalData || {};
  window.digitalData.cart = {};
  window.digitalData.cart = buildScAddCartData(productID, isFirstCart);
  delete window.digitalData.product;

  getAnalyticsTrackers().forEach(resetTrackerForScAdd);
  configureAnalyticsTrackingServers();

  const satellite = getSatellite();
  if (satellite?.track) {
    satellite.track('scAdd');
  }

  sendScAddLinkBeacon(productID);
  debugLog('Adobe Analytics scAdd fired (link beacon)', window.digitalData.cart);
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
  window.digitalData = window.digitalData || {};
  window.digitalData.cart = {};
  window.digitalData.cart = buildScViewCartData(items, items.length === 1);
  delete window.digitalData.product;
  getAnalyticsTrackers().forEach(resetTrackerForScAdd);
  return triggerLaunchEvent('scView', window.digitalData.cart, { waitForBeacon });
}

/**
 * Push removed-item context to digitalData and trigger the scRemove Launch rule.
 * Mirrors Commerce: single item[] entry with comma-joined productID and
 * _satellite.track('scRemove').
 * @param {Array<{name: string, quantity?: number|string}>} items Removed cart lines
 * @param {{ waitForBeacon?: boolean }} [options]
 * @returns {Promise<boolean>} Whether the Launch rule was triggered
 */
async function pushScRemoveEvent(items, { waitForBeacon = false } = {}) {
  const cartData = buildScRemoveCartData(items);
  const productID = cartData.item[0]?.productInfo?.productID || '';

  window.digitalData = window.digitalData || {};
  // Mirror Commerce: reset cart scope before assigning the scRemove payload.
  window.digitalData.cart = {};
  window.digitalData.cart = cartData;
  delete window.digitalData.product;
  // eslint-disable-next-line no-console

  getAnalyticsTrackers().forEach(resetTrackerForScAdd);

  // Keep Launch direct-call for parity with Commerce (peripheral tags, if any).
  const satellite = getSatellite();
  const beaconComplete = waitForBeacon ? waitForBeaconComplete() : null;
  if (satellite?.track) {
    configureAnalyticsTrackingServers();
    satellite.track('scRemove');
  }

  // Launch container lacks an scRemove rule for EDS — send the b/ss beacon directly.
  sendScRemoveLinkBeacon(productID);

  if (beaconComplete) {
    await beaconComplete;
  }
  debugLog('Adobe Analytics scRemove fired', window.digitalData.cart);
  return Boolean(satellite?.track || productID);
}

/**
 * Fire the prodView event after the product name is found on the PDP.
 * @returns {Promise<void>}
 */
export async function fireProdView() {
  const productName = `${getProductName()}`;
  if (!productName) {
    debugWarn('Adobe Analytics prodView skipped: product name not found on PDP');
    return;
  }

  if (!(await pushProductEvent('prodView', buildProductId(productName)))) {
    debugWarn('Adobe Analytics prodView skipped: Adobe Launch (_satellite) not available');
  }
}

/**
 * Retry briefly so jsonLdData / PDP DOM are ready after consent scripts load.
 * @param {number} [attempt]
 */
export function trackProdView(attempt = 0) {
  whenSatelliteReady(() => {
    const productName = `${getProductName()}`;
    if (!productName && attempt < 10) {
      setTimeout(() => trackProdView(attempt + 1), 100);
      return;
    }
    fireProdView();
  }, 'prodView');
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

  if (!(await pushScAddEvent(buildCartProductId(name, quantity), {
    isFirstCart,
    waitForBeacon: true,
  }))) {
    debugWarn('Adobe Analytics scAdd skipped: Adobe Launch (_satellite) not available');
  }
}

/**
 * Wait for Launch, then fire scAdd (used before cart redirect).
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
    debugWarn('Adobe Analytics scRemove skipped: Adobe Launch (_satellite) not available');
  }
}

/** @type {Array<{name: string, quantity: number|string}>} */
let pendingScRemoveLines = [];
let scRemoveFlushQueued = false;
let cartChangeTrackingInstalled = false;

/**
 * Whether a cart line should be included in scAdd/scRemove analytics.
 * Matches the cart block's visible-line filter.
 * @param {{ name?: string, local?: object, custom?: object }} item
 * @returns {boolean}
 */
export function shouldTrackCartLine(item) {
  if (!item?.name) {
    return false;
  }
  if (item.local?.showInCart === false) {
    return false;
  }
  if (item.custom?.giftWithPurchase) {
    return false;
  }
  return true;
}

/** @deprecated Use shouldTrackCartLine */
export const shouldTrackScRemoveItem = shouldTrackCartLine;

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
 * @param {{ action?: string, item?: object, cart?: { itemCount?: number } }} detail
 * @returns {void}
 */
export function handleCartAddChange(detail) {
  const { action, item, cart } = detail || {};
  if (action !== 'add' || !shouldTrackCartLine(item)) {
    return;
  }

  const quantity = item.quantity ?? 1;
  const isFirstCart = cart?.itemCount === Number(quantity);
  trackScAdd(`${item.name}`.trim(), quantity, { isFirstCart });
}

/**
 * Handle analytics:cart-add from the Magento cart layer (redirect-safe path).
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
 * Track scAdd/scRemove via cart:change and scAdd via analytics:cart-add (Magento).
 * scAdd edge: cart:change action=add. scAdd Magento: analytics:cart-add after addToCart.
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

/** @deprecated Use trackCartChange */
export const trackScRemove = trackCartChange;

/**
 * Initialize Adobe Analytics instrumentation (prodView on PDP, scView on cart).
 * @returns {void}
 */
export function initInstrumentation() {
  debugLog('Adobe Analytics instrumentation loaded');
  if (isPdpPage()) {
    trackProdView();
  }
  if (isCartPage()) {
    trackScView();
  }
  trackCartChange();
}
