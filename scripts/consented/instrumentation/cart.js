import {
  debugLog,
  debugWarn,
  getProductName,
  hasMarketingConsent,
  shouldTrackCartLine,
  buildCartProductId,
  formatIsFirstCart,
} from './shared.js';
import {
  assignDigitalDataCart,
  configureAnalyticsTrackingServers,
  flushLaunchTrackers,
  getSatellite,
  sendCartLinkBeacon,
  setDigitalDataCartForLinkBeacon,
  triggerLaunchEvent,
  waitForBeaconComplete,
  whenSatelliteReady,
} from './adobe-runtime.js';

/**
 * Read the current cart lines for scView from the shared cart singleton.
 * Uses the already-instantiated window.cart when present, otherwise imports
 * the cart module (its constructor restores items from localStorage).
 * @returns {Promise<Array<{name: string, quantity?: number|string}>>}
 */
export async function getCartViewItems() {
  const cart = window.cart?.items ? window.cart : (await import('../../cart.js')).default;
  return (cart?.items || [])
    .filter(shouldTrackCartLine)
    .map((item) => ({ name: item.name, quantity: item.quantity }));
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
