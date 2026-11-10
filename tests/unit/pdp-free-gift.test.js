/**
 * Unit tests for the PDP free gift (GWP) visibility rules in blocks/pdp/options.js.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// blocks/video/video.js (imported via the gallery) reads matchMedia at load.
window.matchMedia = () => ({ matches: false, addEventListener() {} });
const { updateFreeGiftVisibility } = await import('../../blocks/pdp/options.js');

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
