import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCheckoutContext,
  getExpressCheckoutContext,
  getStandardCheckoutContext,
} from '../../scripts/checkout-context.js';

test('getStandardCheckoutContext describes form-based checkout', () => {
  assert.deepEqual(getStandardCheckoutContext('apple-pay'), {
    paymentMethod: 'apple-pay',
    checkoutFlow: 'standard',
    entryPoint: 'checkout',
  });
  assert.equal(getStandardCheckoutContext(null), null);
});

test('getExpressCheckoutContext preserves the launch entry point', () => {
  assert.deepEqual(getExpressCheckoutContext('apple-pay', 'cart'), {
    paymentMethod: 'apple-pay',
    checkoutFlow: 'express',
    entryPoint: 'cart',
  });
  assert.deepEqual(getExpressCheckoutContext('apple-pay', 'checkout'), {
    paymentMethod: 'apple-pay',
    checkoutFlow: 'express',
    entryPoint: 'checkout',
  });
});

test('getExpressCheckoutContext requires a payment method', () => {
  assert.throws(
    () => getExpressCheckoutContext(null, 'cart'),
    /Payment method is required/,
  );
});

test('createCheckoutContext rejects unsupported context facts', () => {
  assert.throws(
    () => createCheckoutContext('apple-pay', 'accelerated', 'cart'),
    /Unsupported checkout flow/,
  );
  assert.throws(
    () => createCheckoutContext('apple-pay', 'express', 'unknown'),
    /Unsupported checkout entry point/,
  );
});
