/**
 * Unit tests for scripts/safe-storage.js and the cart's behaviour when the
 * browser blocks Web Storage (SecurityError on `window.localStorage`).
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getStorage, isStorageAvailable, resetSafeStorageForTests,
} from '../../scripts/safe-storage.js';
import { Cart } from '../../scripts/cart.js';
import { __rumCalls } from './mocks/aem.mjs';

const realLocalStorage = globalThis.localStorage;
let opsLogBodies;

function blockLocalStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      const err = new Error("Failed to read the 'localStorage' property from 'Window': Access is denied for this document.");
      err.name = 'SecurityError';
      throw err;
    },
  });
}

beforeEach(() => {
  globalThis.__resetTestState();
  resetSafeStorageForTests();
  __rumCalls.length = 0;
  opsLogBodies = [];
  globalThis.window.location = { hostname: 'www.vitamix.com', origin: 'https://www.vitamix.com', pathname: '/us/en_us/recipes/x' };
  globalThis.__setFetchMock(async (url, init) => {
    opsLogBodies.push(JSON.parse(init.body));
    return { ok: true };
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, writable: true, value: realLocalStorage,
  });
});

function quotaError() {
  const err = new Error('The quota has been exceeded.');
  err.name = 'QuotaExceededError';
  return err;
}

/** Readable `localStorage` property whose writes throw (some private modes). */
function installThrowingWrites({ failAfter = 0 } = {}) {
  const data = new Map();
  let writes = 0;
  const store = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      writes += 1;
      if (writes > failAfter) throw quotaError();
      data.set(k, String(v));
    },
    removeItem: (k) => { data.delete(k); },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, writable: true, value: store,
  });
  return data;
}

test('uses the real store when available', () => {
  getStorage().setItem('k', 'v');
  assert.equal(realLocalStorage.getItem('k'), 'v');
  assert.equal(realLocalStorage.getItem('__storage_probe__'), null);
  assert.equal(isStorageAvailable(), true);
  assert.equal(__rumCalls.length, 0);
  assert.equal(opsLogBodies.length, 0);
});

test('falls back to memory and reports once when blocked', () => {
  blockLocalStorage();
  assert.equal(isStorageAvailable(), false);

  const store = getStorage();
  store.setItem('k', 'v');
  assert.equal(getStorage().getItem('k'), 'v');

  assert.deepEqual(__rumCalls, [['error', { source: 'storage-blocked', target: 'localStorage' }]]);
  assert.equal(opsLogBodies.length, 1);
  const [body] = opsLogBodies;
  assert.equal(body.action, 'error');
  assert.equal(body.scope, 'storage-blocked');
  assert.equal(body.name, 'SecurityError');
  assert.equal(body.storageType, 'localStorage');
  assert.equal(body.storage.localStorage, false);
  assert.equal(body.client.userAgent, navigator.userAgent);
  assert.match(body.message, /localStorage blocked \(SecurityError\).*UA: /);
});

test('Cart constructs and works in memory when storage is blocked', () => {
  blockLocalStorage();
  const cart = new Cart();
  assert.equal(cart.isPersistent, false);
  cart.addItem({ sku: 'foo', quantity: 2, price: '10.00', name: 'Foo' });
  assert.equal(cart.itemCount, 2);
  cart.flush();
  assert.equal(cart.itemCount, 2);
});

test('treats a readable store whose writes throw as unavailable', () => {
  installThrowingWrites();
  assert.equal(isStorageAvailable(), false);
  const cart = new Cart();
  cart.addItem({ sku: 'foo', quantity: 1, price: '10.00', name: 'Foo' });
  assert.equal(cart.itemCount, 1);
  assert.equal(opsLogBodies.length, 1);
  assert.equal(opsLogBodies[0].name, 'QuotaExceededError');
});

test('falls back to memory when a write fails after the probe passes', () => {
  // probe write succeeds; the cart's writes then fail
  const data = installThrowingWrites({ failAfter: 1 });
  assert.equal(isStorageAvailable(), true);
  const cart = new Cart();
  cart.addItem({ sku: 'foo', quantity: 3, price: '10.00', name: 'Foo' });
  assert.equal(isStorageAvailable(), false);
  assert.equal(cart.itemCount, 3);
  assert.equal(data.has('cart:us'), false);
  // the latest value is still readable for the rest of the page view
  assert.equal(JSON.parse(getStorage().getItem('cart:us')).items[0].quantity, 3);
  assert.equal(opsLogBodies.length, 1);
});
