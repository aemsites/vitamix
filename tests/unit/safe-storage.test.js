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

test('returns the real store when available', () => {
  assert.equal(getStorage(), realLocalStorage);
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
