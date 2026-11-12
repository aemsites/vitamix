/**
 * PayPal express is not offered while a date is simulated: its session callbacks
 * price the order at the real time. The standard PayPal checkout stays.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import paypal from '../../scripts/payments/paypal.js';
import { getActiveProviders } from '../../blocks/checkout/checkout-payment.js';

const applePayLike = { id: 'apple-pay', supportsExpress: true };

function setLocation(hostname) {
  globalThis.location = { hostname, search: '' };
}

const expressProviders = () => getActiveProviders([applePayLike, paypal])
  .filter((p) => p.supportsExpress)
  .map((p) => p.id);

beforeEach(() => {
  globalThis.__resetTestState();
  setLocation('main--site--org.aem.page');
});

test('PayPal express is rendered without a simulated date', () => {
  assert.equal(paypal.supportsExpress, true);
  assert.deepEqual(expressProviders(), ['apple-pay', 'paypal']);
});

test('PayPal express is not rendered while a date is simulated', () => {
  localStorage.setItem('vitamix.now', '2030-06-01T00:00:00.000Z');
  assert.equal(paypal.supportsExpress, false);
  assert.deepEqual(expressProviders(), ['apple-pay']);
  assert.deepEqual(getActiveProviders([applePayLike, paypal]).map((p) => p.id), ['apple-pay', 'paypal']);
  assert.equal(typeof paypal.renderCheckoutButton, 'function');
});

test('PayPal express is unchanged on production hosts', () => {
  setLocation('www.vitamix.com');
  localStorage.setItem('vitamix.now', '2030-06-01T00:00:00.000Z');
  localStorage.setItem('vitamix.now', '2030-06-01T00:00:00.000Z');
  assert.equal(paypal.supportsExpress, true);
  assert.deepEqual(expressProviders(), ['apple-pay', 'paypal']);
});

test('an express button mounted before simulation starts does not create a PayPal session', async () => {
  let buttonConfig;
  globalThis.window.paypal = {
    FUNDING: { PAYPAL: 'paypal', PAYLATER: 'paylater' },
    Buttons: (cfg) => {
      buttonConfig ??= cfg;
      return { render: () => {}, isEligible: () => false };
    },
  };
  const originalCreateElement = globalThis.document.createElement;
  globalThis.document.createElement = () => ({ className: '' });
  const requests = [];
  globalThis.__setFetchMock(async (url) => {
    requests.push(url);
    return {
      ok: true, status: 200, json: async () => ({ paypalOrderId: 'pp-1' }), headers: { get: () => null },
    };
  });
  try {
    paypal.renderExpressButton({ appendChild: () => {} }, {
      expressEntryPoint: 'cart',
      getConfig: () => ({ getLocale: () => 'us', getLanguage: () => 'en-US', currency: 'USD' }),
      getCart: () => ({ getItemsForAPI: () => [] }),
      getState: () => ({}),
    });
    localStorage.setItem('vitamix.now', '2030-06-01T00:00:00.000Z');
    await assert.rejects(buttonConfig.createOrder(), /simulated date/);
    assert.deepEqual(requests, []);
  } finally {
    globalThis.document.createElement = originalCreateElement;
    delete globalThis.window.paypal;
  }
});
