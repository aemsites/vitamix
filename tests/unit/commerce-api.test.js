/**
 * Unit tests for scripts/commerce-api.js — getOrder and estimateShipping functions.
 *
 * Run with `npm run test:unit`. The setup file installs the fetch mock and
 * browser globals (sessionStorage) that commerce-api.js depends on.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getOrder, estimateShipping } from '../../scripts/commerce-api.js';

const API_ORIGIN = 'https://api.test.com/test-org/sites/test-site';

/** Captured details from the most recent fetch() call. */
let lastUrl;
let lastInit;

/**
 * Installs a fetch mock that returns the given status and body.
 * Captures url/init for assertion.
 */
function mockFetch(status, body) {
  globalThis.__setFetchMock(async (url, init) => {
    lastUrl = url;
    lastInit = init;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      headers: { get: () => null },
    };
  });
}

beforeEach(() => {
  lastUrl = undefined;
  lastInit = undefined;
  globalThis.__resetTestState();
});

// --- URL construction -------------------------------------------------------

test('getOrder: builds the correct URL from email and orderId', async () => {
  mockFetch(200, { order: { id: 'ord-1' } });
  await getOrder('user@example.com', 'ord-1');
  assert.equal(lastUrl, `${API_ORIGIN}/customers/user@example.com/orders/ord-1`);
});

test('getOrder: does not percent-encode @ in email', async () => {
  mockFetch(200, { order: {} });
  await getOrder('buyer@test.com', 'ord-2');
  assert.ok(lastUrl.includes('buyer@test.com'), 'URL should contain raw @ character');
  assert.ok(!lastUrl.includes('buyer%40test.com'), '@ must not be encoded as %40');
});

// --- HTTP method ------------------------------------------------------------

test('getOrder: uses GET method', async () => {
  mockFetch(200, { order: {} });
  await getOrder('user@example.com', 'ord-3');
  assert.equal(lastInit.method, 'GET');
});

// --- Response handling ------------------------------------------------------

test('getOrder: returns the full { order } payload on success', async () => {
  const order = {
    id: 'ord-abc',
    friendlyId: 'XYZ123',
    state: 'completed',
    customer: { email: 'user@example.com' },
  };
  mockFetch(200, { order });
  const result = await getOrder('user@example.com', 'ord-abc');
  assert.deepEqual(result, { order });
});

// --- Authentication ---------------------------------------------------------

test('getOrder: attaches Bearer token from sessionStorage when present', async () => {
  sessionStorage.setItem('auth_token', 'test-jwt');
  mockFetch(200, { order: {} });
  await getOrder('user@example.com', 'ord-4');
  assert.equal(lastInit.headers.Authorization, 'Bearer test-jwt');
});

test('getOrder: omits Authorization header when no token in sessionStorage', async () => {
  mockFetch(200, { order: {} });
  await getOrder('user@example.com', 'ord-5');
  assert.equal(lastInit.headers.Authorization, undefined);
});

// --- Error handling ---------------------------------------------------------

test('getOrder: throws with status 404 when order is not found', async () => {
  mockFetch(404, { message: 'Not found' });
  await assert.rejects(
    () => getOrder('user@example.com', 'missing'),
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test('getOrder: throws with status 404 when email does not match order', async () => {
  mockFetch(404, { message: 'Not found' });
  await assert.rejects(
    () => getOrder('wrong@example.com', 'ord-6'),
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test('getOrder: throws with status 500 on server error', async () => {
  mockFetch(500, { message: 'Internal Server Error' });
  await assert.rejects(
    () => getOrder('user@example.com', 'ord-7'),
    (err) => {
      assert.equal(err.status, 500);
      return true;
    },
  );
});

// --- estimateShipping -------------------------------------------------------

test('estimateShipping: omits couponCode when not provided', async () => {
  mockFetch(200, { rates: [] });
  await estimateShipping('us', 'CA', []);
  const body = JSON.parse(lastInit.body);
  assert.ok(!Object.prototype.hasOwnProperty.call(body, 'couponCode'), 'couponCode should be absent');
});

test('estimateShipping: includes couponCode in request body when provided', async () => {
  mockFetch(200, { rates: [] });
  await estimateShipping('us', 'CA', [], 'FREESHIP');
  const body = JSON.parse(lastInit.body);
  assert.equal(body.couponCode, 'FREESHIP');
});

test('estimateShipping: sends correct country, shipping, and items', async () => {
  const items = [{ sku: 'abc', quantity: 1, price: { final: '50.00' } }];
  mockFetch(200, { rates: [] });
  await estimateShipping('ca', 'ON', items);
  const body = JSON.parse(lastInit.body);
  assert.equal(body.country, 'ca');
  assert.deepEqual(body.shipping, { country: 'ca', state: 'ON' });
  assert.deepEqual(body.items, items);
});

test('estimateShipping: returns rates array from response', async () => {
  const rates = [
    { id: '1', type: 'standard', rate: '0.00', label: 'Standard' },
    { id: '2', type: 'priority', rate: '25.00', label: 'Priority' },
  ];
  mockFetch(200, { rates });
  const result = await estimateShipping('us', 'NY', []);
  assert.deepEqual(result.rates, rates);
});
