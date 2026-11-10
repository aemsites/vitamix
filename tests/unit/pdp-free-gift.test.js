/**
 * Unit tests for the PDP free gift (GWP) visibility rules in blocks/pdp/options.js.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// blocks/video/video.js (imported via the gallery) reads matchMedia at load.
window.matchMedia = () => ({ matches: false, addEventListener() {} });
const { updateFreeGiftVisibility } = await import('../../blocks/pdp/options.js');
const { parseMinPrice, findFreeGift } = await import('../../blocks/pdp/pdp.js');

function giftContainer(minPrice) {
  const classes = new Set(['pdp-free-gift-container']);
  return {
    dataset: minPrice === undefined ? {} : { minPrice: String(minPrice) },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
  };
}

beforeEach(() => {
  delete window.selectedVariant;
  window.jsonLdData = { offers: [{ price: '199.95' }] };
});

test('free gift without a minimum shows with an Add to Cart button', () => {
  const gift = giftContainer();
  updateFreeGiftVisibility(gift, true);
  assert.equal(gift.classList.contains('hidden'), false);
});

test('free gift hides without an Add to Cart button', () => {
  const gift = giftContainer();
  updateFreeGiftVisibility(gift, false);
  assert.equal(gift.classList.contains('hidden'), true);
});

test('free gift hides when the product price is below the minimum', () => {
  const gift = giftContainer(299.95);
  updateFreeGiftVisibility(gift, true);
  assert.equal(gift.classList.contains('hidden'), true);
});

test('free gift shows when the product price equals the minimum', () => {
  window.jsonLdData = { offers: [{ price: '299.95' }] };
  const gift = giftContainer(299.95);
  updateFreeGiftVisibility(gift, true);
  assert.equal(gift.classList.contains('hidden'), false);
});

test('free gift follows the selected variant price', () => {
  window.jsonLdData = { offers: [{ price: '259.95' }, { price: '449.95' }] };
  const gift = giftContainer(299.95);

  window.selectedVariant = { price: { final: 449.95 } };
  updateFreeGiftVisibility(gift, true);
  assert.equal(gift.classList.contains('hidden'), false);

  window.selectedVariant = { price: { final: 259.95 } };
  updateFreeGiftVisibility(gift, true);
  assert.equal(gift.classList.contains('hidden'), true);
});

test('free gift shows when the product price is missing', () => {
  window.jsonLdData = { offers: [{}] };
  const gift = giftContainer(299.95);
  updateFreeGiftVisibility(gift, true);
  assert.equal(gift.classList.contains('hidden'), false);
});

test('parseMinPrice reads dot and comma decimals', () => {
  assert.equal(parseMinPrice('$299.95'), 299.95);
  assert.equal(parseMinPrice('$1,299.95'), 1299.95);
  assert.equal(parseMinPrice('$1,299'), 1299);
  assert.equal(parseMinPrice('299,95 $'), 299.95);
  assert.equal(parseMinPrice('1 299,95 $'), 1299.95);
  assert.equal(parseMinPrice('1.299,95 €'), 1299.95);
  assert.equal(parseMinPrice(''), null);
  assert.equal(parseMinPrice('n/a'), null);
  assert.equal(parseMinPrice(undefined), null);
});

const today = new Date('2026-11-09T12:00:00Z');
const row = (overrides) => ({
  startDate: null, endDate: null, minPrice: null, productSlugs: [], ...overrides,
});

test('findFreeGift skips a gift no variant reaches and falls through to the next row', () => {
  const gifts = [row({ label: 'high', minPrice: 299.95 }), row({ label: 'any' })];
  assert.equal(findFreeGift(gifts, { slug: 'nano', prices: [199.95, 199.95] }, today).label, 'any');
  assert.equal(findFreeGift(gifts, { slug: 'x5', prices: [749.95] }, today).label, 'high');
});

test('findFreeGift uses the most expensive variant', () => {
  const gifts = [row({ label: 'high', minPrice: 299.95 })];
  assert.equal(findFreeGift(gifts, { slug: 'tnc', prices: [299, 329, 648] }, today).label, 'high');
  assert.equal(findFreeGift(gifts, { slug: 'tnc', prices: [299, NaN] }, today), undefined);
});

test('findFreeGift checks dates and product slugs', () => {
  const past = row({ label: 'past', endDate: new Date('2026-11-01T00:00:00Z') });
  const future = row({ label: 'future', startDate: new Date('2026-12-01T00:00:00Z') });
  const e320 = row({ label: 'e320', productSlugs: ['e320'] });
  const gifts = [past, future, e320];
  assert.equal(findFreeGift(gifts, { slug: 'nano', prices: [199.95] }, today), undefined);
  assert.equal(findFreeGift(gifts, { slug: 'e320', prices: [0] }, today).label, 'e320');
});
