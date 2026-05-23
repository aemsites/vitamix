/**
 * Unit tests for blocks/pdp/add-to-cart.js helpers.
 *
 * Run with `npm run test:unit`. The setup file registers mocks for aem.js and
 * scripts.js so this module can be imported without browser bootstrap.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCartPrice, isVariantAvailableForSale, computeAllowedQty } from '../../blocks/pdp/add-to-cart.js';
import { __setMetadata, __resetMetadata } from './mocks/aem.mjs';
import { __setOutOfStockSkus, __resetScripts } from './mocks/scripts.mjs';

beforeEach(() => {
  __resetMetadata();
  __resetScripts();
});

test('normalizeCartPrice: numeric string from an offer', () => {
  assert.equal(normalizeCartPrice('249.95'), '249.95');
});

test('normalizeCartPrice: number is stringified losslessly', () => {
  assert.equal(normalizeCartPrice(249.95), '249.95');
});

test('normalizeCartPrice: Product Bus price object uses final', () => {
  assert.equal(
    normalizeCartPrice({ currency: 'USD', regular: '299.95', final: '249.95' }),
    '249.95',
  );
});

test('normalizeCartPrice: falls back to regular when final is missing', () => {
  assert.equal(
    normalizeCartPrice({ currency: 'USD', regular: '299.95' }),
    '299.95',
  );
});

test('normalizeCartPrice: regression for simple-product NaN bug', () => {
  // Simple products' JSON-LD offer carries a numeric-string `price`. The cart
  // line item used to receive `undefined` (parent fallback had no `price` and
  // we weren't reading offers[0].price), serialize as null in localStorage,
  // and render as "$NaN". After the fix the offer's string price flows in.
  const offerPrice = '249.95';
  const normalized = normalizeCartPrice(offerPrice);
  assert.equal(normalized, '249.95');
  assert.equal(parseFloat(normalized) * 2, 499.9);
});

test('normalizeCartPrice: null stringifies to "null"', () => {
  assert.equal(normalizeCartPrice(null), 'null');
});

test('normalizeCartPrice: undefined stringifies to "undefined"', () => {
  assert.equal(normalizeCartPrice(undefined), 'undefined');
});

// --- isVariantAvailableForSale ---------------------------------------------

const inStockVariant = (overrides = {}) => ({
  sku: 'SKU-1',
  custom: { managedStock: '1', addToCart: 'Yes', ...overrides },
});

test('isVariantAvailableForSale: false when page metadata disables add-to-cart', () => {
  __setMetadata({ addToCart: 'No' });
  assert.equal(isVariantAvailableForSale(inStockVariant()), false);
});

test('isVariantAvailableForSale: false when variant.custom.addToCart is "No"', () => {
  assert.equal(
    isVariantAvailableForSale(inStockVariant({ addToCart: 'No' })),
    false,
  );
});

test('isVariantAvailableForSale: true when managedStock is "0" (stock not tracked)', () => {
  // managedStock "0" means stock is not managed — variant is always purchasable,
  // even if the out-of-stock list happens to include the SKU.
  __setOutOfStockSkus(['SKU-1']);
  assert.equal(
    isVariantAvailableForSale(inStockVariant({ managedStock: '0' })),
    true,
  );
});

test('isVariantAvailableForSale: true when managed stock and SKU is in stock', () => {
  __setOutOfStockSkus([]);
  assert.equal(isVariantAvailableForSale(inStockVariant()), true);
});

test('isVariantAvailableForSale: false when managed stock and SKU is out of stock', () => {
  __setOutOfStockSkus(['SKU-1']);
  assert.equal(isVariantAvailableForSale(inStockVariant()), false);
});

test('isVariantAvailableForSale: page metadata gate wins over variant flags', () => {
  // Even a fully-available variant must be blocked if the page disables ATC.
  __setMetadata({ addToCart: 'No' });
  __setOutOfStockSkus([]);
  assert.equal(
    isVariantAvailableForSale(inStockVariant({ managedStock: '0' })),
    false,
  );
});

// --- computeAllowedQty -------------------------------------------------------

test('computeAllowedQty: full quantity allowed when cart is empty', () => {
  assert.equal(computeAllowedQty(3, 0, 3), 3);
});

test('computeAllowedQty: zero allowed when already at max', () => {
  assert.equal(computeAllowedQty(3, 3, 3), 0);
});

test('computeAllowedQty: partial quantity allowed when cart is partially full', () => {
  assert.equal(computeAllowedQty(3, 1, 3), 2);
});

test('computeAllowedQty: normal single-unit add', () => {
  assert.equal(computeAllowedQty(1, 0, 3), 1);
});

test('computeAllowedQty: clamps to zero, not negative, when existing exceeds max', () => {
  assert.equal(computeAllowedQty(1, 4, 3), 0);
});
