import { debugLog, debugWarn } from './shared.js';

/** Max wait for Launch/AppMeasurement to finish sending a beacon before navigation. */
const BEACON_COMPLETE_TIMEOUT_MS = 2000;

/** @type {Array<() => void>} */
const pendingBeaconWaits = [];

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
export function waitForBeaconComplete() {
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
export function flushLaunchTrackers() {
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
export function sendCartLinkBeacon(eventName, productID) {
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
export function assignDigitalDataCart(cartData) {
  window.digitalData = window.digitalData || {};
  window.digitalData.cart = cartData;
  delete window.digitalData.product;
}

/**
 * Prepare digitalData and reset tracker state before a synchronous link beacon (s.tl).
 * @param {object} cartData digitalData.cart payload
 */
export function setDigitalDataCartForLinkBeacon(cartData) {
  assignDigitalDataCart(cartData);
  flushLaunchTrackers();
}

/**
 * @param {{ pageID: string, pageName: string }} pageInfo
 */
export function assignDigitalDataPageInfo(pageInfo) {
  window.digitalData = window.digitalData || {};
  window.digitalData.page = window.digitalData.page || {};
  window.digitalData.page.pageInfo = {
    ...window.digitalData.page.pageInfo,
    ...pageInfo,
  };
}

/**
 * Assign order-success transaction context to digitalData for Launch purchase rules.
 * @param {object} transaction
 */
export function assignDigitalDataTransaction(transaction) {
  window.digitalData = window.digitalData || {};
  delete window.digitalData.cart;
  delete window.digitalData.product;
  window.digitalData.page = window.digitalData.page || {};
  window.digitalData.page.pageInfo = {
    ...(window.digitalData.page.pageInfo || {}),
    pageName: transaction.pageName,
  };
  window.digitalData.transaction = {
    purchaseID: transaction.purchaseID,
    paymentMethod: transaction.paymentMethod,
    tax: transaction.tax,
    shippingRevenue: transaction.shippingRevenue,
    shippingDiscount: transaction.shippingDiscount,
    discountAmount: transaction.discountAmount,
    discountCode: transaction.discountCode,
    productShippingMethod: transaction.productShippingMethod,
    giftOption: transaction.giftOption,
    orderTotal: transaction.orderTotal,
    idmeGroup: transaction.idmeGroup,
    idmeSubGroup: transaction.idmeSubGroup,
    item: [{
      productInfo: { productString: transaction.productString },
    }],
  };
}

/**
 * @param {object} userData
 */
export function assignDigitalDataUser(userData) {
  window.digitalData = window.digitalData || {};
  window.digitalData.page = window.digitalData.page || {};
  window.digitalData.page.user = userData;
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
export async function triggerLaunchEvent(eventName, payload, { waitForBeacon = false } = {}) {
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
export async function pushProductEvent(eventName, productID, { waitForBeacon = false } = {}) {
  window.digitalData = window.digitalData || {};
  delete window.digitalData.cart;
  window.digitalData.product = [{
    productInfo: { productID },
  }];

  return triggerLaunchEvent(eventName, window.digitalData.product, { waitForBeacon });
}

/**
 * Push checkout cart context to digitalData and trigger a Launch direct-call rule.
 * @param {string} eventName Launch direct-call identifier (e.g. scCheckout)
 * @param {string} productID Adobe Analytics products string
 * @param {string} cartTotal Cart grand total
 * @param {{ waitForBeacon?: boolean }} [options]
 * @returns {Promise<boolean>} Whether the Launch rule was triggered
 */
export async function pushCartCheckoutEvent(
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
