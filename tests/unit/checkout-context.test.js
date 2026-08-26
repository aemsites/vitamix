import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCheckoutContext,
  getExpressCheckoutContext,
  getStandardCheckoutContext,
  buildExpressOrderPayload,
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

describe('buildExpressOrderPayload', () => {
  // The payload a wallet sent to /orders/preview, i.e. exactly what the
  // estimate token's payloadHash was computed over.
  const estimatePayload = {
    items: [{ sku: '075861-04', selectedOptions: [{ id: 'color', value: 'Black' }] }],
    shippingMethod: { id: '267' },
    shipping: { country: 'ca', state: 'ON', zip: 'M5A 1E1' },
    country: 'ca',
    locale: 'en-US',
    paymentMethod: 'paypal',
    checkoutFlow: 'express',
    entryPoint: 'cart',
    couponCode: 'FFVITAMIXMAY26',
    couponSource: 'manual',
  };
  // The wallet-provided identity. Its shipping deliberately carries different
  // country/state/zip than the previewed payload to prove the hash-relevant
  // fields are taken from the preview, not the wallet.
  const identity = {
    customer: {
      firstName: 'Jane', lastName: 'Doe', email: 'account@example.com', phone: '',
    },
    shipping: {
      name: 'Jane Doe',
      address1: '123 Main St',
      city: 'Toronto',
      state: 'XX',
      zip: '99999',
      country: 'zz',
      email: 'wallet@example.com',
    },
    billing: { name: 'Jane Doe', address1: '123 Main St', city: 'Toronto' },
    estimateToken: 'tok-abc',
  };

  test('replays every estimate-relevant field from the previewed payload', () => {
    const body = buildExpressOrderPayload(estimatePayload, identity);
    assert.deepEqual(body.items, estimatePayload.items);
    assert.deepEqual(body.shippingMethod, { id: '267' });
    assert.equal(body.couponCode, 'FFVITAMIXMAY26');
    assert.equal(body.paymentMethod, 'paypal');
    assert.equal(body.checkoutFlow, 'express');
    assert.equal(body.entryPoint, 'cart');
    assert.equal(body.country, 'ca');
    assert.equal(body.locale, 'en-US');
  });

  test('overlays wallet identity and the estimate token', () => {
    const body = buildExpressOrderPayload(estimatePayload, identity);
    assert.deepEqual(body.customer, identity.customer);
    assert.deepEqual(body.billing, identity.billing);
    assert.equal(body.estimateToken, 'tok-abc');
  });

  test('keeps previewed shipping country/state/zip but layers descriptive fields', () => {
    const body = buildExpressOrderPayload(estimatePayload, identity);
    // hash-relevant fields come from the previewed payload...
    assert.equal(body.shipping.country, 'ca');
    assert.equal(body.shipping.state, 'ON');
    assert.equal(body.shipping.zip, 'M5A 1E1');
    // ...descriptive fields come from the wallet
    assert.equal(body.shipping.name, 'Jane Doe');
    assert.equal(body.shipping.address1, '123 Main St');
    assert.equal(body.shipping.email, 'wallet@example.com');
  });

  test('drops couponSource — preview-only, not hashed, rejected by the order schema', () => {
    // previewOrderDirect injects couponSource for auto/ID.me coupons; it must not
    // reach POST /orders (the Order schema rejects unknown properties) and it is
    // not part of the estimate token hash, so it is safe to omit.
    const body = buildExpressOrderPayload(estimatePayload, identity);
    assert.equal('couponSource' in body, false);
    assert.equal(body.couponCode, 'FFVITAMIXMAY26');
  });

  test('includes customerTimezone only when provided', () => {
    assert.equal('customerTimezone' in buildExpressOrderPayload(estimatePayload, identity), false);
    const withTz = buildExpressOrderPayload(
      estimatePayload,
      { ...identity, customerTimezone: 'America/Toronto' },
    );
    assert.equal(withTz.customerTimezone, 'America/Toronto');
  });

  test('does not mutate the previewed payload', () => {
    const snapshot = structuredClone(estimatePayload);
    buildExpressOrderPayload(estimatePayload, identity);
    assert.deepEqual(estimatePayload, snapshot);
  });

  test('throws when the previewed payload is missing', () => {
    assert.throws(
      () => buildExpressOrderPayload(undefined, identity),
      /previewed estimate payload/,
    );
  });
});
