/**
 * Unit-test setup. Loaded via `node --import=./tests/unit/setup.mjs` before any
 * test module runs. Responsibilities:
 *
 *   1. Register the ESM loader (loader.mjs) so imports of commerce-config.js
 *      resolve to the test mock.
 *   2. Install browser-shaped globals (localStorage, document, window,
 *      CustomEvent) that the modules under test depend on.
 *   3. Expose `globalThis.__events` (dispatch log) and `globalThis.__resetTestState`
 *      (per-test isolation helper) for use in test files.
 */
import { register } from 'node:module';

register('./loader.mjs', import.meta.url);

// Import the mock by its real path so we can reset overrides between tests.
// The loader redirects `commerce-config.js` imports to this same URL, so
// production code under test sees the same module instance.
const { __resetConfig } = await import('./mocks/commerce-config.mjs');

// localStorage — in-memory Map with the Web Storage API surface cart.js uses.
const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
  clear() { storage.clear(); },
};

// document.cookie — minimal jar that supports `key=value; attr=...; attr=...`.
// Only the first segment (the actual key/value pair) is recorded; attributes
// like expires/path are ignored in tests.
const cookies = new Map();
globalThis.document = {
  get cookie() {
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  },
  set cookie(value) {
    const [pair] = value.split(';');
    const eq = pair.indexOf('=');
    if (eq === -1) return;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) cookies.set(k, v);
  },
  dispatchEvent(event) {
    globalThis.__events.push(event);
    return true;
  },
};

// window — cart.js does `window.cart = new Cart()` on module load.
globalThis.window = globalThis;

// CustomEvent — cart.js dispatches `new CustomEvent('cart:change', { detail })`.
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

// Event log + per-test reset hook.
globalThis.__events = [];
globalThis.__resetTestState = () => {
  storage.clear();
  cookies.clear();
  globalThis.__events.length = 0;
  __resetConfig();
};
