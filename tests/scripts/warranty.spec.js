import { test, expect } from '@playwright/test';
import {
  getCartItemKey,
  getItemUnitPrice,
  getWarrantyPrice,
  selectedOptionsWithWarranty,
} from '../../scripts/commerce/warranty.js';

test.describe('warranty helpers', () => {
  test('getWarrantyPrice parses finalPrice', () => {
    expect(getWarrantyPrice({ finalPrice: '75.00' })).toBe(75);
    expect(getWarrantyPrice({ finalPrice: 0 })).toBe(0);
    expect(getWarrantyPrice(null)).toBe(0);
  });

  test('getCartItemKey includes warranty uid', () => {
    expect(getCartItemKey({ sku: 'ABC' })).toBe('ABC');
    expect(getCartItemKey({ sku: 'ABC', selectedWarranty: { uid: 'w1' } })).toBe('ABC::w1');
  });

  test('getItemUnitPrice adds base and warranty', () => {
    const item = {
      basePrice: 400,
      selectedWarranty: { finalPrice: '75' },
    };
    expect(getItemUnitPrice(item)).toBe(475);
  });

  test('selectedOptionsWithWarranty swaps warranty uid', () => {
    const warrantyOptions = [{ uid: 'w1' }, { uid: 'w2' }];
    const result = selectedOptionsWithWarranty(
      ['variant-uid', 'w1'],
      warrantyOptions,
      { uid: 'w2' },
    );
    expect(result).toEqual(['variant-uid', 'w2']);
  });
});
