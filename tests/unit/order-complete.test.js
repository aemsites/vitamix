import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateConfirmationTotal,
  normalizeTotalsDiscounts,
  cachedOrderMatches,
  resolveConfirmationOrder,
} from '../../blocks/order-complete/order-complete.js';

beforeEach(() => {
  globalThis.__resetTestState();
});

describe('calculateConfirmationTotal', () => {
  test('subtracts coupon amount when the same discount also grants free shipping', () => {
    assert.equal(calculateConfirmationTotal({
      subtotal: 379.95,
      tax: 33.72,
      shippingRate: 9.95,
      discounts: [{ name: '25% off total order + Free Shipping', amount: 94.99, freeShipping: true }],
    }), 318.68);
  });

  test('includes paid shipping when no free-shipping discount applies', () => {
    assert.equal(calculateConfirmationTotal({
      subtotal: 100,
      tax: 8,
      shippingRate: 10,
      discounts: [{ name: 'SAVE20', amount: 20 }],
    }), 98);
  });
});

describe('cachedOrderMatches', () => {
  test('matches when cached order id equals the URL orderId', () => {
    assert.equal(cachedOrderMatches({ id: 'order-1' }, 'order-1'), true);
  });

  test('does not match a different orderId', () => {
    assert.equal(cachedOrderMatches({ id: 'order-1' }, 'order-2'), false);
  });

  test('does not match when cached order or id is missing', () => {
    assert.equal(cachedOrderMatches(null, 'order-1'), false);
    assert.equal(cachedOrderMatches({ id: 'order-1' }, undefined), false);
    assert.equal(cachedOrderMatches({}, 'order-1'), false);
  });
});

describe('resolveConfirmationOrder', () => {
  test('renders the API order when present (authoritative)', () => {
    const apiOrder = { id: 'order-1' };
    assert.deepEqual(
      resolveConfirmationOrder({ apiOrder, cachedOrder: { id: 'order-1' }, cacheMatches: true }),
      { order: apiOrder, redirect: false },
    );
  });

  test('redirects on a 404 without falling back to cache', () => {
    assert.deepEqual(
      resolveConfirmationOrder({
        apiOrder: null,
        apiError: { status: 404 },
        cachedOrder: { id: 'order-1' },
        cacheMatches: true,
      }),
      { order: null, redirect: true },
    );
  });

  test('redirects on a 403 (not ours) without falling back to cache', () => {
    assert.deepEqual(
      resolveConfirmationOrder({
        apiOrder: null,
        apiError: { status: 403 },
        cachedOrder: { id: 'order-1' },
        cacheMatches: true,
      }),
      { order: null, redirect: true },
    );
  });

  test('falls back to a matching cached order on a transient error', () => {
    const cachedOrder = { id: 'order-1' };
    assert.deepEqual(
      resolveConfirmationOrder({
        apiOrder: null,
        apiError: { status: 503 },
        cachedOrder,
        cacheMatches: true,
      }),
      { order: cachedOrder, redirect: false },
    );
  });

  test('falls back to the cached order when the API was not called (no email)', () => {
    const cachedOrder = { id: 'order-1' };
    assert.deepEqual(
      resolveConfirmationOrder({
        apiOrder: null,
        apiError: null,
        cachedOrder,
        cacheMatches: true,
      }),
      { order: cachedOrder, redirect: false },
    );
  });

  test('redirects on a transient error when the cache does not match', () => {
    assert.deepEqual(
      resolveConfirmationOrder({
        apiOrder: null,
        apiError: { status: 503 },
        cachedOrder: { id: 'other-order' },
        cacheMatches: false,
      }),
      { order: null, redirect: true },
    );
  });

  test('redirects when there is no API order and no usable cache', () => {
    assert.deepEqual(
      resolveConfirmationOrder({
        apiOrder: null,
        apiError: null,
        cachedOrder: null,
        cacheMatches: false,
      }),
      { order: null, redirect: true },
    );
  });
});

describe('normalizeTotalsDiscounts', () => {
  test('omits free-shipping-only discounts from discount rows', () => {
    const discounts = [
      { name: 'Free shipping coupon', freeShipping: true },
      { name: 'Automatic free shipping', freeShipping: true },
      { name: 'SAVE10', amount: 10 },
    ];

    assert.deepEqual(normalizeTotalsDiscounts(discounts), [discounts[2]]);
  });

  test('keeps coupon amount when the same discount also grants free shipping', () => {
    const discounts = [
      { name: '25% off total order + Free Shipping', amount: 94.99, freeShipping: true },
    ];

    assert.deepEqual(normalizeTotalsDiscounts(discounts), discounts);
  });

  test('keeps non-free-shipping discounts unchanged', () => {
    const discounts = [
      { name: 'SAVE10', amount: 10 },
      { name: 'VIP', amount: 5 },
    ];

    assert.deepEqual(normalizeTotalsDiscounts(discounts), discounts);
  });
});
