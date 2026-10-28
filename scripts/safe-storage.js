/**
 * Guarded access to Web Storage.
 *
 * Reading `window.localStorage` / `window.sessionStorage` throws a
 * `SecurityError` when the browser blocks site data for the origin (Chrome
 * "Block all cookies", per-site data blocks, some WebView / enterprise
 * policies, or a sandboxed opaque-origin document). When that happens every
 * persistent client store is blocked, so there is no durable fallback: this
 * module degrades to an in-memory store that lives for the current page view
 * only. Modules that load on every page (cart, header) keep working instead of
 * throwing at import time.
 *
 * The first blocked access on a page view is reported once so its frequency
 * and affected clients can be monitored.
 */
import { sampleRUM } from './aem.js';
import { logError } from './operations-log.js';

/** @type {Map<string, Map<string, string>>} */
const memoryStores = new Map();
let reported = false;

/**
 * Minimal in-memory implementation of the Storage methods we use.
 * @param {string} type
 * @returns {Storage}
 */
function memoryStorage(type) {
  if (!memoryStores.has(type)) memoryStores.set(type, new Map());
  const store = memoryStores.get(type);
  return {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}

const PROBE_KEY = '__storage_probe__';

/** @type {Map<string, boolean>} Cached usability per storage type. */
const availability = new Map();

/**
 * Round-trips a value through the store. Some restricted contexts expose the
 * store but throw on use (e.g. `QuotaExceededError` on every write), so
 * property access alone isn't enough.
 * @param {'localStorage'|'sessionStorage'} type
 * @throws when the store is missing or any operation fails.
 */
function roundTrip(type) {
  const store = window[type];
  if (!store) throw new Error(`${type} is not available`);
  store.setItem(PROBE_KEY, PROBE_KEY);
  const ok = store.getItem(PROBE_KEY) === PROBE_KEY;
  store.removeItem(PROBE_KEY);
  if (!ok) throw new Error(`${type} did not retain a written value`);
}

/**
 * Non-caching, non-reporting usability check (for diagnostics).
 * @param {'localStorage'|'sessionStorage'} type
 * @returns {boolean}
 */
function probe(type) {
  try {
    roundTrip(type);
    return true;
  } catch {
    return false;
  }
}

function cookiesEnabled() {
  try {
    return navigator.cookieEnabled;
  } catch {
    return false;
  }
}

/**
 * Non-PII client environment details for diagnosing blocked storage.
 * @returns {Object}
 */
function clientSignals() {
  const signals = {};
  const safe = (key, fn) => {
    try { signals[key] = fn(); } catch { signals[key] = 'unavailable'; }
  };
  safe('userAgent', () => navigator.userAgent);
  safe('webdriver', () => navigator.webdriver);
  safe('uaBrands', () => navigator.userAgentData?.brands?.map((b) => `${b.brand}/${b.version}`).join(', '));
  safe('uaMobile', () => navigator.userAgentData?.mobile);
  safe('uaPlatform', () => navigator.userAgentData?.platform);
  safe('languages', () => navigator.languages?.join(','));
  safe('hardwareConcurrency', () => navigator.hardwareConcurrency);
  safe('deviceMemory', () => navigator.deviceMemory);
  safe('maxTouchPoints', () => navigator.maxTouchPoints);
  safe('pluginsLength', () => navigator.plugins?.length);
  safe('screen', () => `${window.screen?.width}x${window.screen?.height}`);
  safe('viewport', () => `${window.innerWidth}x${window.innerHeight}`);
  safe('visibility', () => document.visibilityState);
  safe('framed', () => window.top !== window.self);
  // `'null'` means a sandboxed / opaque-origin document, not a user setting.
  safe('origin', () => window.origin);
  safe('referrerOrigin', () => (document.referrer ? new URL(document.referrer).origin : ''));
  return signals;
}

/**
 * Reports a blocked store once per page view.
 * @param {'localStorage'|'sessionStorage'} type
 * @param {*} error
 */
function reportBlocked(type, error) {
  if (reported) return;
  reported = true;
  try {
    sampleRUM('error', { source: 'storage-blocked', target: type });
  } catch { /* never block the page */ }
  try {
    const client = clientSignals();
    const storage = {
      localStorage: probe('localStorage'),
      sessionStorage: probe('sessionStorage'),
      cookieEnabled: cookiesEnabled(),
    };
    logError('storage-blocked', error, {
      message: `${type} blocked (${error?.name || 'Error'}) webdriver=${client.webdriver} UA: ${client.userAgent}`,
      storageType: type,
      storage,
      client,
    });
  } catch { /* never block the page */ }
}

/**
 * @param {'localStorage'|'sessionStorage'} type
 * @param {*} error
 */
function markUnavailable(type, error) {
  availability.set(type, false);
  reportBlocked(type, error);
}

/**
 * Whether the requested Web Storage is usable (persists across page loads).
 * Checked once per page view, and flipped to false if a later operation fails.
 * @param {'localStorage'|'sessionStorage'} [type]
 * @returns {boolean}
 */
export function isStorageAvailable(type = 'localStorage') {
  if (!availability.has(type)) {
    try {
      roundTrip(type);
      availability.set(type, true);
    } catch (error) {
      markUnavailable(type, error);
    }
  }
  return availability.get(type);
}

/**
 * Returns a store backed by the requested Web Storage, falling back to a
 * page-view-scoped in-memory store when the browser blocks access or an
 * operation fails. Writes that fail land in memory, so the latest value is
 * still readable for the rest of the page view.
 * @param {'localStorage'|'sessionStorage'} [type]
 * @returns {Pick<Storage, 'getItem'|'setItem'|'removeItem'>}
 */
export function getStorage(type = 'localStorage') {
  const memory = memoryStorage(type);
  const run = (op, fallback) => {
    if (isStorageAvailable(type)) {
      try {
        return op(window[type]);
      } catch (error) {
        markUnavailable(type, error);
      }
    }
    return fallback(memory);
  };
  return {
    getItem: (key) => run((s) => s.getItem(key), (m) => m.getItem(key)),
    setItem: (key, value) => run((s) => s.setItem(key, value), (m) => m.setItem(key, value)),
    removeItem: (key) => run((s) => s.removeItem(key), (m) => m.removeItem(key)),
  };
}

/** Test-only: reset the once-per-page report flag and memory stores. */
export function resetSafeStorageForTests() {
  reported = false;
  memoryStores.clear();
  availability.clear();
}
