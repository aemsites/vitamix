import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderJSON } from '../../blocks/checkout/checkout-order.js';

const originalDateTimeFormat = Intl.DateTimeFormat;

afterEach(() => {
  Intl.DateTimeFormat = originalDateTimeFormat;
});

function mockTimeZone(timeZone) {
  Intl.DateTimeFormat = () => ({
    resolvedOptions: () => ({ timeZone }),
  });
}

function formData(values) {
  return {
    get(name) {
      return values[name] ?? '';
    },
  };
}

function formWithBillingChoice(value = 'same') {
  return {
    querySelector(selector) {
      if (selector === '[name="billing-choice"]:checked') return { value };
      return null;
    },
  };
}

const config = {
  getLocale: () => 'us',
  getLanguage: () => 'en_us',
};

const cart = {
  getItemsForAPI: () => [{ sku: 'sku-1', path: '/products/sku-1', quantity: 1, price: { currency: 'USD', regular: '10.00' } }],
};

const baseValues = {
  email: 'jane@example.com',
  'shipping-firstname': 'Jane',
  'shipping-lastname': 'Doe',
  'shipping-street-0': '123 Main St',
  'shipping-street-1': '',
  'shipping-city': 'Cleveland',
  'shipping-state': 'OH',
  'shipping-zip': '44101',
  'shipping-telephone': '(555) 123-4567',
  paymentMethod: 'chase',
};

test('buildOrderJSON includes customerTimezone when browser reports one', () => {
  mockTimeZone('America/New_York');

  const order = buildOrderJSON(
    formData(baseValues),
    formWithBillingChoice('same'),
    cart,
    {},
    config,
  );

  assert.equal(order.customerTimezone, 'America/New_York');
});

test('buildOrderJSON omits customerTimezone when timezone capture fails', () => {
  Intl.DateTimeFormat = () => {
    throw new Error('unsupported');
  };

  const order = buildOrderJSON(
    formData(baseValues),
    formWithBillingChoice('same'),
    cart,
    {},
    config,
  );

  assert.equal(order.customerTimezone, undefined);
});
