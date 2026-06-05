/**
 * Unit tests for scripts/operations-log.js.
 *
 * Run with `npm run test:unit`. Uses the shared fetch mock and Web Storage
 * shims from setup.mjs. `window.location` is set per-test for origin checks.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  logOperation, getCheckoutId, clearCheckoutId, anonymize, logApiError, logNetworkError,
} from '../../scripts/operations-log.js';

const PATH = '/us/en_us/products/operations-log';

let lastUrl;
let lastInit;

function captureFetch() {
  globalThis.__setFetchMock(async (url, init) => {
    lastUrl = url;
    lastInit = init;
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

function setHostname(hostname) {
  globalThis.window.location = { hostname };
}

beforeEach(() => {
  lastUrl = undefined;
  lastInit = undefined;
  globalThis.__resetTestState();
  delete globalThis.window.IS_TEST_MODE;
  setHostname('main--vitamix--aemsites.aem.network');
});

// --- origin selection -------------------------------------------------------

test('logOperation: posts to AEM network origin off vitamix.com', () => {
  captureFetch();
  setHostname('main--vitamix--aemsites.aem.network');
  logOperation('cart-view');
  assert.equal(lastUrl, `https://main--vitamix--aemsites.aem.network${PATH}`);
});

test('logOperation: posts same-origin (relative) on .vitamix.com hosts', () => {
  captureFetch();
  setHostname('www.vitamix.com');
  logOperation('cart-view');
  assert.equal(lastUrl, PATH);
});

// --- request shape ----------------------------------------------------------

test('logOperation: includes action, timestamp, and extra data', () => {
  captureFetch();
  logOperation('added-to-cart', { sku: 'abc', quantity: 2 });
  const body = JSON.parse(lastInit.body);
  assert.equal(body.action, 'added-to-cart');
  assert.equal(body.sku, 'abc');
  assert.equal(body.quantity, 2);
  assert.equal(typeof body.ts, 'number');
  assert.equal(lastInit.method, 'POST');
  assert.equal(lastInit.keepalive, true);
});

// --- test mode --------------------------------------------------------------

test('logOperation: skips network calls when window.IS_TEST_MODE is true', () => {
  captureFetch();
  globalThis.window.IS_TEST_MODE = true;
  logOperation('checkout-start');
  assert.equal(lastUrl, undefined);
  assert.equal(lastInit, undefined);
});

// --- never throws -----------------------------------------------------------

test('logOperation: swallows fetch rejections (never throws)', () => {
  globalThis.__setFetchMock(async () => { throw new Error('network down'); });
  assert.doesNotThrow(() => logOperation('error'));
});

test('logOperation: swallows non-serializable payloads (never throws)', () => {
  captureFetch();
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => logOperation('error', circular));
});

// --- checkout id ------------------------------------------------------------

test('getCheckoutId: mints once and is stable across calls', () => {
  const first = getCheckoutId();
  const second = getCheckoutId();
  assert.equal(first, second);
  assert.ok(first);
});

test('clearCheckoutId: next call mints a fresh id', () => {
  const first = getCheckoutId();
  clearCheckoutId();
  const second = getCheckoutId();
  assert.notEqual(first, second);
});

// --- anonymize --------------------------------------------------------------

test('anonymize: strips PII and payment fields, keeps debug fields', () => {
  const result = anonymize({
    country: 'us',
    couponCode: 'SAVE10',
    estimateToken: 'tok-123',
    customer: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
    shipping: {
      country: 'us', state: 'CA', zip: '94016', street: '1 Main St', name: 'Jane Doe',
    },
    shippingMethod: { id: 'ground', rate: '9.99', label: 'Ground' },
    payment: { cardNumber: '4111111111111111' },
    fraudToken: 'ft-xyz',
    items: [{
      sku: 's1', path: '/p', quantity: 1, price: { value: 10 }, secret: 'x',
    }],
  });
  assert.deepEqual(result, {
    country: 'us',
    couponCode: 'SAVE10',
    estimateToken: 'tok-123',
    shipping: { country: 'us', state: 'CA', zip: '94016' },
    shippingMethod: { id: 'ground' },
    items: [{
      sku: 's1', path: '/p', quantity: 1, price: { value: 10 },
    }],
  });
});

test('anonymize: returns undefined for non-objects', () => {
  assert.equal(anonymize(null), undefined);
  assert.equal(anonymize('string'), undefined);
});

// --- logApiError ------------------------------------------------------------

test('logApiError: logs error action with anonymized request body', () => {
  captureFetch();
  logApiError({
    method: 'POST',
    path: '/orders',
    status: 422,
    responseBody: { message: 'bad' },
    requestBody: { country: 'us', customer: { email: 'jane@example.com' } },
  });
  const body = JSON.parse(lastInit.body);
  assert.equal(body.action, 'error');
  assert.equal(body.kind, 'api');
  assert.equal(body.status, 422);
  assert.deepEqual(body.responseBody, { message: 'bad' });
  assert.deepEqual(body.requestBody, { country: 'us' });
  assert.equal(body.requestBody.customer, undefined);
});

// --- logNetworkError --------------------------------------------------------

test('logNetworkError: logs error action with kind network and anonymized body', () => {
  captureFetch();
  logNetworkError({
    method: 'POST',
    path: '/orders',
    error: new TypeError('Failed to fetch'),
    requestBody: { country: 'us', shipping: { state: 'CA', street: '1 Main St' } },
  });
  const body = JSON.parse(lastInit.body);
  assert.equal(body.action, 'error');
  assert.equal(body.kind, 'network');
  assert.equal(body.path, '/orders');
  assert.equal(body.message, 'Failed to fetch');
  // undefined keys (country/zip) are dropped by JSON serialization.
  assert.deepEqual(body.requestBody, { country: 'us', shipping: { state: 'CA' } });
});
