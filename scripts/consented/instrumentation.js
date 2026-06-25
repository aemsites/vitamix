export function isDebugMode() {
  return window.location.hostname === 'localhost'
    || window.location.search.includes('instrumentation=debug');
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
 * Product display name for Adobe Analytics productID (Magento parity: ;{name};;;;).
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
 * Launch keeps its tracker in AppMeasurement's s_c_il registry, not always window.s.
 */
export function configureAllAppMeasurementTrackers() {
  patchAppMeasurementFactory();
  configureAnalyticsTracker(window.s);
  if (!Array.isArray(window.s_c_il)) {
    return;
  }
  window.s_c_il.forEach((instance) => {
    if (instance && (instance.account || typeof instance.t === 'function')) {
      configureAnalyticsTracker(instance);
    }
  });
}

/**
 * Register doPlugins on known AppMeasurement tracker instances (window.s, s_c_il).
 */
export function configureAnalyticsTrackingServers() {
  configureAllAppMeasurementTrackers();
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
    } else if (isDebugMode()) {
      /* eslint-disable-next-line no-console */
      console.warn(`Adobe Analytics ${eventLabel} skipped: Adobe Launch (_satellite) not available`);
    }
  };
  check();
}

/**
 * Push product context to digitalData and trigger a Launch direct-call rule.
 * Launch owns variable mapping and beacon send (Adobe-recommended pattern).
 * @param {string} eventName Launch direct-call identifier (e.g. prodView, scAdd)
 * @param {string} productID Adobe Analytics products string
 * @param {{ waitForBeacon?: boolean }} [options]
 * @returns {Promise<boolean>} Whether the Launch rule was triggered
 */
async function pushProductEvent(eventName, productID, { waitForBeacon = false } = {}) {
  window.digitalData = window.digitalData || {};
  window.digitalData.product = [{
    productInfo: { productID },
  }];

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

  if (isDebugMode()) {
    /* eslint-disable-next-line no-console */
    console.log(`Adobe Analytics ${eventName} fired`, window.digitalData.product);
  }
  return true;
}

/**
 * Fire the prodView event after the product name is found on the PDP.
 * @returns {Promise<void>}
 */
export async function fireProdView() {
  const productName = `${getProductName()}`;
  if (!productName) {
    if (isDebugMode()) {
      /* eslint-disable-next-line no-console */
      console.warn('Adobe Analytics prodView skipped: product name not found on PDP');
    }
    return;
  }

  if (!(await pushProductEvent('prodView', buildProductId(productName))) && isDebugMode()) {
    /* eslint-disable-next-line no-console */
    console.warn('Adobe Analytics prodView skipped: Adobe Launch (_satellite) not available');
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
 * @returns {Promise<void>}
 */
export async function fireScAdd(productName = getProductName(), quantity = 1) {
  if (!hasMarketingConsent()) {
    return;
  }

  const name = `${productName || ''}`.trim();
  if (!name) {
    if (isDebugMode()) {
      /* eslint-disable-next-line no-console */
      console.warn('Adobe Analytics scAdd skipped: product name not found');
    }
    return;
  }

  if (!(await pushProductEvent('scAdd', buildCartProductId(name, quantity), { waitForBeacon: true }))
    && isDebugMode()) {
    /* eslint-disable-next-line no-console */
    console.warn('Adobe Analytics scAdd skipped: Adobe Launch (_satellite) not available');
  }
}

/**
 * Wait for Launch, then fire scAdd (used before cart redirect).
 * @param {string} [productName]
 * @param {number|string} [quantity]
 * @returns {Promise<void>}
 */
export function trackScAdd(productName = getProductName(), quantity = 1) {
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
      fireScAdd(productName, quantity).then(finish);
    }, 'scAdd');

    // Do not block cart redirect if Launch never becomes available.
    setTimeout(finish, 2000);
  });
}

/**
 * Initialize Adobe Analytics instrumentation (prodView on PDP).
 * @returns {void}
 */
export function initInstrumentation() {
  const debug = isDebugMode();
  if (debug) {
    /* eslint-disable-next-line no-console */
    console.log('Adobe Analytics instrumentation loaded');
  }

  if (isPdpPage()) {
    trackProdView();
  } else if (debug) {
    /* eslint-disable-next-line no-console */
    console.log('Adobe Analytics prodView skipped (not a PDP)');
  }
}
