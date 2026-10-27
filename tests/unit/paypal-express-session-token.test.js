/**
 * Unit tests for the PayPal Express session capability (HCA-01) in
 * scripts/payments/paypal.js.
 *
 * The Commerce API returns a `sessionToken` from the PayPal session create call
 * and requires it on later session PATCH/GET calls (as `x-paypal-session`) and on
 * PayPal Express payment initiation (as `paypalSessionToken`). These tests drive
 * the real button callbacks against the unit-test fetch mock.
 *
 * Run with `npm run test:unit`.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import paypal from '../../scripts/payments/paypal.js';

const ITEMS = [{ sku: 'sku-1', quantity: 1, price: { final: '10.00' } }];
const METHODS = [{
  id: 'std', label: 'Standard', total: '10.00', taxAmount: '0.00', rate: '0.00',
}];

let buttonConfig;
let requests;

function installPayPalSdk() {
  buttonConfig = undefined;
  globalThis.window.paypal = {
    FUNDING: { PAYPAL: 'paypal', PAYLATER: 'paylater' },
    Buttons: (cfg) => {
      buttonConfig ??= cfg;
      return { render: () => {}, isEligible: () => false };
    },
  };
  globalThis.document.createElement = () => ({ className: '' });
}

function mockApi(createBody) {
  requests = [];
  globalThis.__setFetchMock(async (url, init) => {
    requests.push({ url, init });
    let body = { ok: true };
    if (init.method === 'POST' && url.endsWith('/payments/paypal/session')) body = createBody;
    if (init.method === 'PATCH') body = { shippingMethods: METHODS, subtotal: '10.00' };
    if (init.method === 'GET' && url.includes('/payments/paypal/session/')) {
      body = {
        payer: { email: 'buyer@example.com', firstName: 'B', lastName: 'C' },
        shippingAddress: {
          address1: '1 Main', city: 'LA', state: 'CA', zip: '90210', country: 'us',
        },
        selectedOptionId: 'std',
      };
    }
    return {
      ok: true, status: 200, json: async () => body, headers: { get: () => null },
    };
  });
}

function makeCallbacks(state) {
  const calls = { initiate: [], completed: [], errors: [] };
  const callbacks = {
    expressEntryPoint: 'cart',
    getConfig: () => ({
      getLocale: () => 'us',
      getLanguage: () => 'en-US',
      currency: 'USD',
      getOrderPath: () => '/us/en_us/checkout/review',
    }),
    getCart: () => ({ getItemsForAPI: () => ITEMS }),
    getState: () => state,
    previewOrderDirect: async (payload) => {
      state.currentEstimatePayload = payload;
      return { estimateToken: 'est-1' };
    },
    createOrder: async () => ({ order: { id: 'order-1' } }),
    initiatePayment: async (...args) => {
      calls.initiate.push(args);
      return { status: 'completed', action: 'complete' };
    },
    onComplete: (order) => calls.completed.push(order),
    saveCheckoutSession: () => {},
    showError: (msg) => calls.errors.push(msg),
    strings: {},
  };
  return { callbacks, calls };
}

async function runExpressFlow(createBody) {
  mockApi(createBody);
  const state = {};
  const { callbacks, calls } = makeCallbacks(state);
  paypal.renderExpressButton({ appendChild: () => {} }, callbacks);
  const actions = { reject: () => 'rejected' };
  const paypalOrderId = await buttonConfig.createOrder();
  const addressResult = await buttonConfig.onShippingAddressChange({
    shippingAddress: { countryCode: 'US', state: 'CA', postalCode: '90210' },
    errors: { ADDRESS_ERROR: 'ADDRESS_ERROR' },
  }, actions);
  await buttonConfig.onShippingOptionsChange({
    selectedShippingOption: { id: 'std' },
    errors: { METHOD_UNAVAILABLE: 'METHOD_UNAVAILABLE' },
  }, actions);
  await buttonConfig.onApprove();
  return {
    state, calls, paypalOrderId, addressResult,
  };
}

beforeEach(() => {
  globalThis.__resetTestState();
  installPayPalSdk();
});

test('stores the capability from create and sends it on every session call and initiation', async () => {
  const {
    state, calls, paypalOrderId, addressResult,
  } = await runExpressFlow({ paypalOrderId: 'PP-1', sessionToken: 'cap-1' });

  assert.equal(paypalOrderId, 'PP-1');
  assert.equal(state.paypalSessionToken, 'cap-1');
  assert.equal(addressResult, undefined, 'address step not rejected');

  const sessionCalls = requests.filter((r) => r.url.includes('/payments/paypal/session/'));
  assert.deepEqual(sessionCalls.map((r) => r.init.method), ['PATCH', 'PATCH', 'GET']);
  sessionCalls.forEach((r) => {
    assert.equal(r.init.headers['x-paypal-session'], 'cap-1', `${r.init.method} ${r.url}`);
    assert.ok(!r.url.includes('cap-1'), 'token never in the URL');
  });

  assert.equal(calls.errors.length, 0, calls.errors.join('; '));
  assert.equal(calls.initiate.length, 1);
  const [orderId, , , provider, method, extra] = calls.initiate[0];
  assert.equal(orderId, 'order-1');
  assert.equal(provider, 'paypal-express');
  assert.equal(method, 'paypal');
  assert.deepEqual(extra, { paypalOrderId: 'PP-1', paypalSessionToken: 'cap-1' });
  assert.equal(calls.completed.length, 1);
});

test('sends no capability when the API did not return one (pre-upgrade API)', async () => {
  const { state, calls } = await runExpressFlow({ paypalOrderId: 'PP-2' });

  assert.equal(state.paypalSessionToken, undefined);
  const sessionCalls = requests.filter((r) => r.url.includes('/payments/paypal/session/'));
  assert.equal(sessionCalls.length, 3);
  sessionCalls.forEach((r) => {
    assert.equal('x-paypal-session' in r.init.headers, false, `${r.init.method} ${r.url}`);
  });
  assert.equal(calls.errors.length, 0, calls.errors.join('; '));
  const extra = calls.initiate[0][5];
  assert.deepEqual(extra, { paypalOrderId: 'PP-2' });
});

test('a new createOrder replaces the previous capability', async () => {
  mockApi({ paypalOrderId: 'PP-A', sessionToken: 'cap-a' });
  const state = {};
  const { callbacks } = makeCallbacks(state);
  paypal.renderExpressButton({ appendChild: () => {} }, callbacks);
  await buttonConfig.createOrder();
  assert.equal(state.paypalSessionToken, 'cap-a');

  mockApi({ paypalOrderId: 'PP-B' });
  await buttonConfig.createOrder();
  assert.equal(state.paypalSessionId, 'PP-B');
  assert.equal(state.paypalSessionToken, undefined, 'no stale token from the previous order');
});
