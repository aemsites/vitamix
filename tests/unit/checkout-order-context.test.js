import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderJSON, getCheckoutContext } from '../../blocks/checkout/checkout-order.js';

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
  getItemsForAPI: () => [{
    sku: 'sku-1',
    path: '/products/sku-1',
    quantity: 1,
    price: { currency: 'USD', regular: '10.00' },
  }],
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
};

function buildOrder(values) {
  return buildOrderJSON(
    formData({ ...baseValues, ...values }),
    formWithBillingChoice('same'),
    cart,
    {},
    config,
  );
}

test('getCheckoutContext returns null when payment method is absent', () => {
  assert.equal(getCheckoutContext(''), null);
  assert.equal(getCheckoutContext(null), null);
});

test('getCheckoutContext returns standard checkout context for card payments', () => {
  assert.deepEqual(getCheckoutContext('chase'), {
    paymentMethod: 'chase',
    checkoutFlow: 'standard',
    entryPoint: 'checkout',
  });
});

test('getCheckoutContext returns express checkout context for checkout-page Apple Pay', () => {
  assert.deepEqual(getCheckoutContext('apple-pay'), {
    paymentMethod: 'apple-pay',
    checkoutFlow: 'express',
    entryPoint: 'checkout',
  });
});

test('buildOrderJSON includes checkout context for card checkout', () => {
  const order = buildOrder({ paymentMethod: 'chase' });

  assert.equal(order.paymentMethod, 'chase');
  assert.equal(order.checkoutFlow, 'standard');
  assert.equal(order.entryPoint, 'checkout');
});

test('buildOrderJSON includes checkout entry point for checkout-page Apple Pay', () => {
  const order = buildOrder({ paymentMethod: 'apple-pay' });

  assert.equal(order.paymentMethod, 'apple-pay');
  assert.equal(order.checkoutFlow, 'express');
  assert.equal(order.entryPoint, 'checkout');
});

test('buildOrderJSON omits checkout context when payment method is absent', () => {
  const order = buildOrder({ paymentMethod: '' });

  assert.equal(order.paymentMethod, undefined);
  assert.equal(order.checkoutFlow, undefined);
  assert.equal(order.entryPoint, undefined);
});
