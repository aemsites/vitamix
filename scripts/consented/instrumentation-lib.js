export function isDebugMode() {
  return window.location.hostname === 'localhost'
    || window.location.search.includes('instrumentation=debug');
}

const PROD_HOSTS = new Set(['vitamix.com', 'www.vitamix.com']);

/**
 * Adobe Analytics report suite suffix (vitamix{env}).
 * EDS preview/local hosts use dev; vitamix.com uses prod.
 * @returns {'dev' | 'prod'}
 */
export function getDeploymentEnv() {
  return PROD_HOSTS.has(window.location.hostname) ? 'prod' : 'dev';
}

/**
 * PDP detection aligned with scripts/scripts.js (meta sku, .pdp block, pdp-template body class).
 * @returns {boolean}
 */
export function isPdpPage() {
  return document.body.classList.contains('pdp-template')
    || !!document.querySelector('.pdp')
    || !!document.querySelector('meta[name="sku"]');
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

export function getSatellite() {
  // eslint-disable-next-line no-underscore-dangle
  return window._satellite;
}

const ANALYTICS_TRACKING_SERVER = 'metrics.vitamix.com';
const ANALYTICS_TRACKING_SERVER_SECURE = 'smetrics.vitamix.com';

function shouldForceSecureAnalytics() {
  // AppMeasurement only uses smetrics when ssl=true. On localhost (http) ssl stays
  // false and beacons go to http://metrics — force secure on EDS/dev hosts.
  return getDeploymentEnv() === 'dev' || window.location.protocol === 'https:';
}

function applyTrackingConfig(tracker) {
  if (!tracker || typeof tracker !== 'object') {
    return;
  }
  tracker.trackingServer = ANALYTICS_TRACKING_SERVER;
  tracker.trackingServerSecure = ANALYTICS_TRACKING_SERVER_SECURE;
  if (shouldForceSecureAnalytics()) {
    tracker.ssl = true;
  }
}

function patchTrackerHostResolution(tracker) {
  if (!tracker || tracker.vitamixEdsIbPatched) {
    return;
  }
  tracker.vitamixEdsIbPatched = true;

  const originalIb = typeof tracker.ib === 'function' ? tracker.ib.bind(tracker) : null;
  tracker.ib = () => {
    applyTrackingConfig(tracker);
    if (shouldForceSecureAnalytics()) {
      tracker.ssl = true;
      return ANALYTICS_TRACKING_SERVER_SECURE;
    }
    return originalIb ? originalIb() : ANALYTICS_TRACKING_SERVER;
  };
}

function patchTrackerSendMethods(tracker) {
  if (!tracker || tracker.vitamixEdsSendPatched) {
    return;
  }
  tracker.vitamixEdsSendPatched = true;

  ['t', 'tl'].forEach((method) => {
    if (typeof tracker[method] !== 'function') {
      return;
    }
    const original = tracker[method].bind(tracker);
    tracker[method] = (...args) => {
      applyTrackingConfig(tracker);
      return original(...args);
    };
  });
}

/**
 * AppMeasurement picks smetrics only when ssl=true AND trackingServerSecure is set.
 * @param {object} [tracker]
 */
export function configureAnalyticsTracker(tracker = window.s) {
  applyTrackingConfig(tracker);
  patchTrackerHostResolution(tracker);
  patchTrackerSendMethods(tracker);
}

/**
 * Launch keeps its tracker in AppMeasurement's s_c_il registry, not always window.s.
 */
export function patchAllAppMeasurementTrackers() {
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

/** @deprecated use configureAnalyticsTracker */
export function applyAnalyticsTrackingServers(tracker) {
  configureAnalyticsTracker(tracker);
}

function wrapSgi(fn) {
  if (typeof fn !== 'function' || fn.vitamixEdsTrackingWrapped) {
    return fn;
  }
  const wrapped = (...args) => {
    const tracker = fn(...args);
    configureAnalyticsTracker(tracker);
    return tracker;
  };
  wrapped.vitamixEdsTrackingWrapped = true;
  return wrapped;
}

function hookSgiProperty() {
  if (window.vitamixEdsSgiHooked) {
    return;
  }
  window.vitamixEdsSgiHooked = true;

  let storedSgi = typeof window.s_gi === 'function' ? wrapSgi(window.s_gi) : undefined;

  Object.defineProperty(window, 's_gi', {
    configurable: true,
    enumerable: true,
    get() {
      return storedSgi;
    },
    set(fn) {
      storedSgi = wrapSgi(fn);
    },
  });
}

function rewrapSgi() {
  if (typeof window.s_gi !== 'function' || window.s_gi.vitamixEdsTrackingWrapped) {
    return;
  }
  try {
    // AppMeasurement replaces our property hook with a plain function when it loads.
    window.s_gi = wrapSgi(window.s_gi);
  } catch {
    // ignore if s_gi cannot be reassigned
  }
}

function patchSatelliteTrack() {
  const satellite = getSatellite();
  if (!satellite?.track || satellite.track.vitamixEdsTrackPatched) {
    return;
  }

  const original = satellite.track.bind(satellite);
  satellite.track = (identifier, detail) => {
    rewrapSgi();
    patchAllAppMeasurementTrackers();
    return original(identifier, detail);
  };
  satellite.track.vitamixEdsTrackPatched = true;
}

/**
 * Re-apply after each analytics script load — AppMeasurement overwrites s_gi.
 */
export function installAnalyticsTrackingServers() {
  hookSgiProperty();
  rewrapSgi();
  patchAllAppMeasurementTrackers();
  patchSatelliteTrack();
}

/**
 * Launch loads AppMeasurement async after its container script resolves.
 * Poll until s_gi exists, then keep patching briefly for late tracker init.
 * @returns {Promise<void>}
 */
export function ensureAnalyticsTrackingPatched() {
  return new Promise((resolve) => {
    let attempts = 0;
    const tick = () => {
      installAnalyticsTrackingServers();
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
 * Launch prodView rule only runs setVariables (no sendBeacon). Commerce relies on
 * variables being on the tracker before the page-view beacon, or an explicit send.
 * @returns {object|undefined}
 */
export function getAnalyticsTracker() {
  const account = `vitamix${getDeploymentEnv()}`;
  if (typeof window.s_gi === 'function') {
    return window.s_gi(account);
  }
  if (Array.isArray(window.s_c_il)) {
    return window.s_c_il.find((instance) => instance?.account === account
      || (typeof instance?.account === 'string' && instance.account.includes(account)));
  }
  return window.s;
}

/**
 * Send prodView link beacon after Launch setVariables completes.
 */
export function sendProdViewBeacon() {
  const tracker = getAnalyticsTracker();
  configureAnalyticsTracker(tracker);
  if (tracker && typeof tracker.tl === 'function' && tracker.events) {
    tracker.tl('true', 'o', 'prodView');
    if (isDebugMode()) {
      /* eslint-disable-next-line no-console */
      console.log('Adobe Analytics prodView beacon sent', {
        events: tracker.events,
        products: tracker.products,
      });
    }
  } else if (isDebugMode()) {
    /* eslint-disable-next-line no-console */
    console.warn('Adobe Analytics prodView beacon skipped: tracker events not set', tracker);
  }
}

/**
 * @param {() => void} callback
 * @param {number} [maxAttempts]
 * @param {number} [intervalMs]
 */
export function whenSatelliteReady(callback, maxAttempts = 50, intervalMs = 100) {
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
      console.warn('Adobe Analytics prodView skipped: Adobe Launch (_satellite) not available');
    }
  };
  check();
}

/**
 * Schedule the prodView beacon to be sent after the Launch setVariables completes.
 * @param {number} [attempt]
 * @returns {void}
 */
function scheduleProdViewBeacon(attempt = 0) {
  const tracker = getAnalyticsTracker();
  if (tracker?.events && typeof tracker.tl === 'function') {
    sendProdViewBeacon();
    return;
  }
  if (attempt < 25) {
    setTimeout(() => scheduleProdViewBeacon(attempt + 1), 100);
  } else if (isDebugMode()) {
    /* eslint-disable-next-line no-console */
    console.warn('Adobe Analytics prodView beacon timed out waiting for Launch setVariables');
  }
}

/**
 * Fire the prodView event after the product name is found on the PDP.
 * @returns {void}
 */
export function fireProdView() {
  const productName = `${getProductName()}`;
  if (!productName) {
    if (isDebugMode()) {
      /* eslint-disable-next-line no-console */
      console.warn('Adobe Analytics prodView skipped: product name not found on PDP');
    }
    return;
  }

  window.digitalData = window.digitalData || {};
  window.digitalData.product = [{
    productInfo: {
      productID: buildProductId(productName),
    },
  }];
  installAnalyticsTrackingServers();
  patchAllAppMeasurementTrackers();
  getSatellite().track('prodView');
  scheduleProdViewBeacon();

  if (isDebugMode()) {
    /* eslint-disable-next-line no-console */
    console.log('Adobe Analytics prodView fired', window.digitalData.product);
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
  });
}

/**
 * Initialize the instrumentation library.
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
