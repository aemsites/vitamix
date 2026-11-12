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
  sessionStorage.setItem('vitamix.simulateDate', '2030-06-01T00:00:00.000Z');
  assert.equal(paypal.supportsExpress, false);
  assert.deepEqual(expressProviders(), ['apple-pay']);
  assert.deepEqual(getActiveProviders([applePayLike, paypal]).map((p) => p.id), ['apple-pay', 'paypal']);
  assert.equal(typeof paypal.renderCheckoutButton, 'function');
});

test('PayPal express is unchanged on production hosts', () => {
  setLocation('www.vitamix.com');
  sessionStorage.setItem('vitamix.simulateDate', '2030-06-01T00:00:00.000Z');
  localStorage.setItem('vitamix.now', '2030-06-01T00:00:00.000Z');
  assert.equal(paypal.supportsExpress, true);
  assert.deepEqual(expressProviders(), ['apple-pay', 'paypal']);
});
