/**
 * Unit tests for scripts/gift-with-purchase.js.
 *
 * Rules come from the non-prod localStorage stub; product pages are served by
 * the fetch mock and parsed by a minimal DOMParser stand-in.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import cart from '../../scripts/cart.js';
import { ensurePriceRulesLoaded, evaluateGWP } from '../../scripts/gift-with-purchase.js';

globalThis.location = { hostname: 'localhost', origin: 'http://localhost' };

globalThis.DOMParser = class DOMParser {
  // eslint-disable-next-line class-methods-use-this
  parseFromString(html) {
    return { querySelectorAll: () => [{ textContent: html }] };
  }
};

const GIFT_PATH = '/us/en_us/products/gift';
const PROMOTION = {
  id: 'gwp-1',
  name: 'Free Gift Promo',
  country: 'us',
  conditions: { minimumSubtotal: 100 },
  rules: [{ path: GIFT_PATH, price: '0' }],
};

const paidItem = {
  sku: 'paid', path: '/us/en_us/products/paid', name: 'Paid', price: '150.00', quantity: 1,
};
const giftItem = (custom = {}) => ({
  sku: 'gift-sku',
  path: GIFT_PATH,
  name: 'Gift',
  price: '0',
  quantity: 1,
  custom: { giftWithPurchase: true, promotionId: PROMOTION.id, ...custom },
});

async function run(promotions = [PROMOTION]) {
  localStorage.setItem('vitamix.priceRules.stub', JSON.stringify({ promotions }));
  await ensurePriceRulesLoaded();
  await evaluateGWP();
}

const gifts = () => cart.items.filter((i) => i.custom?.giftWithPurchase);

beforeEach(() => {
  globalThis.__resetTestState();
  cart.clear();
  globalThis.__setFetchMock(async () => ({
    ok: true,
    text: async () => JSON.stringify({ '@type': 'Product', sku: 'gift-sku', name: 'Gift' }),
  }));
});

test('adds a qualifying gift with the promotion id and name', async () => {
  cart.addItem(paidItem);
  await run();
  assert.deepEqual(gifts().map((i) => i.custom), [{
    giftWithPurchase: true, promotionId: PROMOTION.id, promotionName: PROMOTION.name,
  }]);
});

test('adds the promotion name to a gift already in the cart without one', async () => {
  cart.addItem(paidItem);
  cart.addItem(giftItem(), { allowSeparateEntry: true });
  await run();
  assert.equal(gifts().length, 1);
  assert.equal(gifts()[0].custom.promotionName, PROMOTION.name);
  const stored = JSON.parse(localStorage.getItem('cart:us')).items;
  assert.equal(stored.find((i) => i.custom?.giftWithPurchase).custom.promotionName, PROMOTION.name);
});

test('updates a stale promotion name on a gift line', async () => {
  cart.addItem(paidItem);
  cart.addItem(giftItem({ promotionName: 'Old Name' }), { allowSeparateEntry: true });
  await run();
  assert.equal(gifts()[0].custom.promotionName, PROMOTION.name);
});

test('leaves a gift line with the current name untouched', async () => {
  cart.addItem(paidItem);
  cart.addItem(giftItem({ promotionName: PROMOTION.name }), { allowSeparateEntry: true });
  globalThis.__events.length = 0;
  await run();
  assert.equal(globalThis.__events.filter((e) => e.detail.action === 'custom').length, 0);
  assert.equal(gifts().length, 1);
});

test('does not touch a paid copy of the gift SKU', async () => {
  cart.addItem(paidItem);
  cart.addItem({ ...giftItem(), price: '20.00', custom: undefined });
  cart.addItem(giftItem(), { allowSeparateEntry: true });
  await run();
  const paidCopy = cart.items.find((i) => i.sku === 'gift-sku' && !i.custom?.giftWithPurchase);
  assert.equal(paidCopy.custom, undefined);
  assert.equal(gifts()[0].custom.promotionName, PROMOTION.name);
});

test('removes a gift whose promotion no longer applies', async () => {
  cart.addItem({ ...paidItem, price: '50.00' });
  cart.addItem(giftItem({ promotionName: PROMOTION.name }), { allowSeparateEntry: true });
  await run();
  assert.equal(gifts().length, 0);
});

const commercialItem = {
  ...paidItem,
  sku: 'commercial',
  path: '/us/en_us/products/commercial/vita-prep',
  custom: { isCommercial: true },
};

test('does not add a gift to a commercial cart that meets the minimum subtotal', async () => {
  cart.addItem(commercialItem);
  await run();
  assert.equal(gifts().length, 0);
});

test('does not add a gift to a cart that mixes commercial and household items', async () => {
  cart.addItem(paidItem);
  cart.addItem(commercialItem);
  await run();
  assert.equal(gifts().length, 0);
});

test('removes an existing gift when a commercial item is in the cart', async () => {
  cart.addItem(paidItem);
  cart.addItem(giftItem({ promotionName: PROMOTION.name }), { allowSeparateEntry: true });
  cart.addItem(commercialItem);
  await run();
  assert.equal(gifts().length, 0);
  assert.deepEqual(cart.items.map((i) => i.sku).sort(), ['commercial', 'paid']);
});

test('removes a gift from a commercial cart even when no rules are loaded', async () => {
  // A fresh module instance has no rules payload (e.g. the price-rules fetch failed).
  const fresh = await import('../../scripts/gift-with-purchase.js?no-rules');
  cart.addItem(commercialItem);
  cart.addItem(giftItem(), { allowSeparateEntry: true });
  await fresh.evaluateGWP();
  assert.equal(gifts().length, 0);
});

test('leaves a household cart alone when no rules are loaded', async () => {
  const fresh = await import('../../scripts/gift-with-purchase.js?no-rules-household');
  cart.addItem(paidItem);
  cart.addItem(giftItem(), { allowSeparateEntry: true });
  await fresh.evaluateGWP();
  assert.equal(gifts().length, 1);
});

test('still adds a gift when items are explicitly not commercial', async () => {
  cart.addItem({ ...paidItem, custom: { isCommercial: false } });
  await run();
  assert.equal(gifts().length, 1);
});
