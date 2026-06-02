import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateConfirmationTotal,
  normalizeTotalsDiscounts,
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
