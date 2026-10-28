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

/**
 * @param {'localStorage'|'sessionStorage'} type
 * @returns {boolean} false when accessing the store throws or it is missing.
 */
function probe(type) {
  try {
    return !!window[type];
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
 * Returns the requested Web Storage, or a page-view-scoped in-memory fallback
 * when the browser blocks access.
 * @param {'localStorage'|'sessionStorage'} [type]
 * @returns {Storage}
 */
export function getStorage(type = 'localStorage') {
  try {
    const store = window[type];
    if (store) return store;
  } catch (error) {
    reportBlocked(type, error);
  }
  return memoryStorage(type);
}

/**
 * Whether the requested Web Storage is usable (persists across page loads).
 * @param {'localStorage'|'sessionStorage'} [type]
 * @returns {boolean}
 */
export function isStorageAvailable(type = 'localStorage') {
  return probe(type);
}

/** Test-only: reset the once-per-page report flag and memory stores. */
export function resetSafeStorageForTests() {
  reported = false;
  memoryStores.clear();
}
