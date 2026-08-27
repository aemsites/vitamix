import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLE_PAY_CART_CONTEXT,
  buildApplePayExpressOrderPayload,
  buildApplePayExpressPreviewPayload,
  getApplePayExpressContext,
} from '../../scripts/payments/apple-pay-context.js';

const ITEMS = [{
  sku: 'sku-1',
  path: '/products/sku-1',
  quantity: 1,
  price: { currency: 'USD', regular: '10.00' },
}];

const cart = {
  getItemsForAPI: () => ITEMS,
};

const shippingContact = {
  countryCode: 'US',
  administrativeArea: 'MN',
  postalCode: '55441',
};

// Deliberately a *different* address than shippingContact (OH/44101 vs MN/55441)
// so tests can prove the order replays the previewed hash-relevant shipping
// rather than re-deriving it from the authorized payment contact.
const paymentContact = {
  givenName: 'Jane',
  familyName: 'Doe',
  addressLines: ['123 Main St', 'Suite 4'],
  locality: 'Cleveland',
  administrativeArea: 'OH',
  postalCode: '44101',
  countryCode: 'US',
  phoneNumber: '(555) 123-4567',
  emailAddress: 'apple@example.com',
};

test('APPLE_PAY_CART_CONTEXT identifies cart-origin Apple Pay express checkout', () => {
  assert.deepEqual(APPLE_PAY_CART_CONTEXT, {
    paymentMethod: 'apple-pay',
    checkoutFlow: 'express',
    entryPoint: 'cart',
  });
});

test('getApplePayExpressContext preserves the express button entry point', () => {
  assert.deepEqual(getApplePayExpressContext('checkout'), {
    paymentMethod: 'apple-pay',
    checkoutFlow: 'express',
    entryPoint: 'checkout',
  });
});

test('buildApplePayExpressPreviewPayload requires explicit context', () => {
  assert.throws(
    () => buildApplePayExpressPreviewPayload(cart, 'standard', 'en-US', shippingContact),
    /preview requires checkout context/,
  );
});

test('buildApplePayExpressOrderPayload requires the previewed estimate payload', () => {
  assert.throws(
    () => buildApplePayExpressOrderPayload({
      payment: { shippingContact: paymentContact },
      estimateToken: 'estimate-token',
      customerEmail: 'account@example.com',
    }),
    /previewed estimate payload/,
  );
});

test('buildApplePayExpressPreviewPayload includes cart context and partial shipping', () => {
  const payload = buildApplePayExpressPreviewPayload(
    cart,
    'standard',
    'en-US',
    shippingContact,
    APPLE_PAY_CART_CONTEXT,
  );

  assert.equal(payload.paymentMethod, 'apple-pay');
  assert.equal(payload.checkoutFlow, 'express');
  assert.equal(payload.entryPoint, 'cart');
  assert.deepEqual(payload.items, ITEMS);
  assert.deepEqual(payload.shippingMethod, { id: 'standard' });
  assert.equal(payload.locale, 'en-US');
  assert.equal(payload.country, 'us');
  assert.deepEqual(payload.shipping, {
    country: 'us',
    state: 'MN',
    zip: '55441',
  });
});

test('buildApplePayExpressPreviewPayload omits shipping when contact has no country', () => {
  const payload = buildApplePayExpressPreviewPayload(
    cart,
    'standard',
    'en-US',
    null,
    APPLE_PAY_CART_CONTEXT,
  );

  assert.equal(payload.paymentMethod, 'apple-pay');
  assert.equal(payload.country, undefined);
  assert.equal(payload.shipping, undefined);
});

test('buildApplePayExpressOrderPayload replays the previewed payload and overlays wallet identity', () => {
  const estimatePayload = buildApplePayExpressPreviewPayload(
    cart,
    'standard',
    'en-US',
    shippingContact,
    APPLE_PAY_CART_CONTEXT,
  );
  const payload = buildApplePayExpressOrderPayload({
    payment: { shippingContact: paymentContact },
    estimatePayload,
    estimateToken: 'estimate-token',
    customerEmail: 'account@example.com',
    customerTimezone: 'America/New_York',
  });

  // Replayed verbatim from the previewed payload (part of the token's hash).
  assert.equal(payload.paymentMethod, 'apple-pay');
  assert.equal(payload.checkoutFlow, 'express');
  assert.equal(payload.entryPoint, 'cart');
  assert.deepEqual(payload.items, ITEMS);
  assert.deepEqual(payload.shippingMethod, { id: 'standard' });
  assert.equal(payload.country, 'us');
  assert.equal(payload.locale, 'en-US');

  // Overlaid from the wallet + call.
  assert.equal(payload.customer.email, 'account@example.com');
  assert.equal(payload.customer.firstName, 'Jane');
  assert.equal(payload.customer.lastName, 'Doe');
  assert.equal(payload.estimateToken, 'estimate-token');
  assert.equal(payload.customerTimezone, 'America/New_York');

  // Shipping keeps the previewed hash-relevant fields (us/MN/55441), NOT the
  // payment contact's OH/44101, while layering the descriptive fields.
  assert.equal(payload.shipping.country, 'us');
  assert.equal(payload.shipping.state, 'MN');
  assert.equal(payload.shipping.zip, '55441');
  assert.equal(payload.shipping.name, 'Jane Doe');
  assert.equal(payload.shipping.address1, '123 Main St');
  assert.equal(payload.shipping.address2, 'Suite 4');
  assert.equal(payload.shipping.city, 'Cleveland');
  assert.equal(payload.shipping.email, 'apple@example.com');

  // Billing is not hash-relevant, so it carries the full wallet address.
  assert.equal(payload.billing.state, 'OH');
  assert.equal(payload.billing.zip, '44101');
});

test('buildApplePayExpressOrderPayload omits customerTimezone when not provided', () => {
  const estimatePayload = buildApplePayExpressPreviewPayload(
    cart,
    'standard',
    'en-US',
    shippingContact,
    APPLE_PAY_CART_CONTEXT,
  );
  const payload = buildApplePayExpressOrderPayload({
    payment: { shippingContact: paymentContact },
    estimatePayload,
    estimateToken: 'estimate-token',
    customerEmail: 'account@example.com',
  });

  assert.equal('customerTimezone' in payload, false);
});
