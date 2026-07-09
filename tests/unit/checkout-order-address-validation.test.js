import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderJSON } from '../../blocks/checkout/checkout-order.js';

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

test('buildOrderJSON serializes explicit unvalidated shipping address', () => {
  const order = buildOrderJSON(
    formData(baseValues),
    formWithBillingChoice('same'),
    cart,
    { shippingAddressIsValidated: false },
    config,
  );

  assert.equal(order.shipping.isValidated, false);
  assert.equal(order.billing.isValidated, false);
});

test('buildOrderJSON defaults missing shipping validation state to true', () => {
  const order = buildOrderJSON(
    formData(baseValues),
    formWithBillingChoice('same'),
    cart,
    {},
    config,
  );

  assert.equal(order.shipping.isValidated, true);
  assert.equal(order.billing.isValidated, true);
});

test('buildOrderJSON serializes different billing validation state when present', () => {
  const order = buildOrderJSON(
    formData({
      ...baseValues,
      'billing-firstname': 'John',
      'billing-lastname': 'Doe',
      'billing-street-0': '456 Billing Rd',
      'billing-city': 'Columbus',
      'billing-state': 'OH',
      'billing-zip': '43004',
    }),
    formWithBillingChoice('different'),
    cart,
    { shippingAddressIsValidated: true, billingAddressIsValidated: false },
    config,
  );

  assert.equal(order.shipping.isValidated, true);
  assert.equal(order.billing.isValidated, false);
  assert.equal(order.billing.address1, '456 Billing Rd');
});

test('buildOrderJSON omits different billing validation state until billing validation runs', () => {
  const order = buildOrderJSON(
    formData({
      ...baseValues,
      'billing-firstname': 'John',
      'billing-lastname': 'Doe',
      'billing-street-0': '456 Billing Rd',
      'billing-city': 'Columbus',
      'billing-state': 'OH',
      'billing-zip': '43004',
    }),
    formWithBillingChoice('different'),
    cart,
    { shippingAddressIsValidated: true },
    config,
  );

  assert.equal(order.shipping.isValidated, true);
  assert.equal(order.billing.isValidated, undefined);
});
