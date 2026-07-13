import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLE_PAY_CART_CONTEXT,
  buildApplePayCartOrderPayload,
  buildApplePayCartPreviewPayload,
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

test('buildApplePayCartPreviewPayload includes cart context and partial shipping', () => {
  const payload = buildApplePayCartPreviewPayload(
    cart,
    'standard',
    'en-US',
    shippingContact,
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

test('buildApplePayCartPreviewPayload omits shipping when contact has no country', () => {
  const payload = buildApplePayCartPreviewPayload(cart, 'standard', 'en-US', null);

  assert.equal(payload.paymentMethod, 'apple-pay');
  assert.equal(payload.country, undefined);
  assert.equal(payload.shipping, undefined);
});

test('buildApplePayCartOrderPayload includes cart context and full address data', () => {
  const payload = buildApplePayCartOrderPayload({
    payment: { shippingContact: paymentContact },
    cart,
    shippingMethodId: 'standard',
    estimateToken: 'estimate-token',
    country: 'us',
    locale: 'en-US',
    customerEmail: 'account@example.com',
    customerTimezone: 'America/New_York',
  });

  assert.equal(payload.paymentMethod, 'apple-pay');
  assert.equal(payload.checkoutFlow, 'express');
  assert.equal(payload.entryPoint, 'cart');
  assert.equal(payload.customer.email, 'account@example.com');
  assert.equal(payload.customer.firstName, 'Jane');
  assert.equal(payload.customer.lastName, 'Doe');
  assert.deepEqual(payload.shippingMethod, { id: 'standard' });
  assert.equal(payload.estimateToken, 'estimate-token');
  assert.equal(payload.country, 'us');
  assert.equal(payload.locale, 'en-US');
  assert.equal(payload.customerTimezone, 'America/New_York');
  assert.deepEqual(payload.items, ITEMS);
  assert.deepEqual(payload.shipping, {
    name: 'Jane Doe',
    address1: '123 Main St',
    address2: 'Suite 4',
    city: 'Cleveland',
    state: 'OH',
    zip: '44101',
    country: 'us',
    phone: '(555) 123-4567',
    email: 'apple@example.com',
  });
  assert.deepEqual(payload.billing, payload.shipping);
});

test('Apple Pay cart preview and order payloads use matching context facts', () => {
  const preview = buildApplePayCartPreviewPayload(
    cart,
    'standard',
    'en-US',
    shippingContact,
  );
  const order = buildApplePayCartOrderPayload({
    payment: { shippingContact: paymentContact },
    cart,
    shippingMethodId: 'standard',
    estimateToken: 'estimate-token',
    country: 'us',
    locale: 'en-US',
    customerEmail: 'account@example.com',
  });

  assert.deepEqual(
    {
      paymentMethod: preview.paymentMethod,
      checkoutFlow: preview.checkoutFlow,
      entryPoint: preview.entryPoint,
    },
    APPLE_PAY_CART_CONTEXT,
  );
  assert.deepEqual(
    {
      paymentMethod: order.paymentMethod,
      checkoutFlow: order.checkoutFlow,
      entryPoint: order.entryPoint,
    },
    APPLE_PAY_CART_CONTEXT,
  );
});
