/**
 * Unit tests for scripts/gift-with-purchase.js.
 *
 * Rules come from the non-prod localStorage stub; product pages are served by
 * the fetch mock and parsed by a minimal DOMParser stand-in.
 */
import {
  test, beforeEach, afterEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';
import cart from '../../scripts/cart.js';
import { previewOrder } from '../../scripts/commerce-api.js';
import {
  ensurePriceRulesLoaded, evaluateGWP, conditionsMet, reconcileWithServer, ensureGWPReconciled,
} from '../../scripts/gift-with-purchase.js';
import { __resetScripts } from './mocks/scripts.mjs';

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

// A fresh stub per test keeps cached server answers from leaking across tests.
let stubId = 0;

async function loadRules(promotions = [PROMOTION], serverCheck = true) {
  stubId += 1;
  localStorage.setItem('vitamix.priceRules.stub', JSON.stringify({ promotions, stubId, serverCheck }));
  await ensurePriceRulesLoaded();
}

async function run(promotions = [PROMOTION]) {
  await loadRules(promotions);
  await evaluateGWP();
}

const gifts = () => cart.items.filter((i) => i.custom?.giftWithPurchase);

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
  headers: { get: () => null },
});

/** Product data served at `${path}.json`, keyed by path. */
let productJson;
/** JSON-LD Product served on product pages, keyed by path (default: the gift). */
let pages;
/** Answer to POST /estimate/price: a body, or a function of the request body. */
let estimate;
/** Answer to POST /orders/preview: a function of the request body. */
let preview;
let calls;
/** Pending responses keyed by URL. */
let holds;

beforeEach(() => {
  globalThis.__resetTestState();
  __resetScripts();
  mock.timers.enable({ apis: ['setTimeout'] });
  cart.clear();
  productJson = {};
  pages = {};
  estimate = { freeItems: [] };
  preview = () => json({ estimateToken: 'tok' });
  calls = [];
  holds = {};
  globalThis.__setFetchMock(async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), body });
    if (holds[String(url)]) return holds[String(url)];
    if (String(url).endsWith('/estimate/price')) {
      const answer = typeof estimate === 'function' ? estimate(body) : estimate;
      return answer instanceof Error ? Promise.reject(answer) : json(answer);
    }
    if (String(url).endsWith('/orders/preview')) return preview(body);
    if (String(url).endsWith('.json')) {
      const product = productJson[String(url).slice(0, -5)];
      return product ? json(product) : json({}, 404);
    }
    return {
      ok: true,
      text: async () => JSON.stringify(pages[String(url)]
        || { '@type': 'Product', sku: 'gift-sku', name: 'Gift' }),
    };
  });
});

afterEach(() => {
  mock.timers.reset();
});

const estimateCalls = () => calls.filter((c) => c.url.endsWith('/estimate/price'));
const jsonCalls = (path) => calls.filter((c) => c.url === `${path}.json`);
const grant = (promotion = PROMOTION) => ({
  freeItems: [{
    path: GIFT_PATH, ruleId: promotion.id, quantity: 1, minimumSubtotal: 100,
  }],
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

test('promotion with a non-minimumSubtotal condition only is evaluated', async () => {
  cart.addItem(paidItem);
  await run([{ ...PROMOTION, conditions: { includedProducts: [paidItem.path] } }]);
  assert.equal(gifts().length, 1);
});

test('promotion with an unknown condition key is skipped', async () => {
  cart.addItem(paidItem);
  await run([{ ...PROMOTION, conditions: { minimumSubtotal: 100, requiredProducts: ['/x'] } }]);
  assert.equal(gifts().length, 0);
});

test('disabled rules are not applied', async () => {
  cart.addItem(paidItem);
  await run([{ ...PROMOTION, rules: [{ path: GIFT_PATH, price: '0', enabled: false }] }]);
  assert.equal(gifts().length, 0);
});

// --- conditionsMet ----------------------------------------------------------

const line = (path, price, extra = {}) => ({
  sku: path.split('/').pop(), path, price: String(price), quantity: 1, ...extra,
});
const BLENDER = line('/p/blender', 400, { local: { categories: ['blenders'] } });
const ACCESSORY = line('/p/tamper', 50, { local: { categories: ['accessories'] } });
const COMMERCIAL = line('/p/quiet-one', 1200, { local: { categories: ['commercial', 'blenders'] } });
const UNKNOWN = line('/p/unknown', 200);
const GIFT_LINE = line('/p/gift', 0, { custom: { giftWithPurchase: true }, local: { categories: ['commercial'] } });

test('conditionsMet: minimumSubtotal only', () => {
  assert.equal(conditionsMet({ minimumSubtotal: 100 }, [BLENDER]), true);
  assert.equal(conditionsMet({ minimumSubtotal: 500 }, [BLENDER]), false);
  assert.equal(conditionsMet({ minimumSubtotal: 450 }, [BLENDER, ACCESSORY]), true);
});

test('conditionsMet: needs at least one paid line, even with no minimum', () => {
  assert.equal(conditionsMet({ minimumSubtotal: 0 }, []), false);
  assert.equal(conditionsMet({ minimumSubtotal: 0 }, [GIFT_LINE]), false);
  assert.equal(conditionsMet({ minimumSubtotal: 0 }, [line('/p/free', 0)]), false);
});

test('conditionsMet: gift and $0 lines never count or disqualify', () => {
  const gift = { ...GIFT_LINE, price: '500' };
  assert.equal(conditionsMet({ minimumSubtotal: 500 }, [BLENDER, gift]), false);
  assert.equal(conditionsMet({ disqualifyingCategories: ['commercial'] }, [BLENDER, GIFT_LINE]), true);
  assert.equal(conditionsMet({ disqualifyingProducts: ['/p/free'] }, [BLENDER, line('/p/free', 0)]), true);
});

test('conditionsMet: includedProducts alone means the cart contains one', () => {
  assert.equal(conditionsMet({ includedProducts: ['/p/blender'] }, [BLENDER]), true);
  assert.equal(conditionsMet({ includedProducts: ['/p/blender'] }, [ACCESSORY]), false);
  assert.equal(conditionsMet({ includedProducts: [{ path: '/p/blender', sku: 'other' }] }, [BLENDER]), false);
  assert.equal(conditionsMet({ includedProducts: [{ path: '/p/blender', sku: 'blender' }] }, [BLENDER]), true);
});

test('conditionsMet: threshold counts in-scope lines only', () => {
  const conditions = { minimumSubtotal: 420, includedCategories: ['blenders'] };
  assert.equal(conditionsMet(conditions, [BLENDER, ACCESSORY]), false);
  assert.equal(conditionsMet({ ...conditions, minimumSubtotal: 400 }, [BLENDER, ACCESSORY]), true);
  assert.equal(conditionsMet({ minimumSubtotal: 420, excludedProducts: ['/p/tamper'] }, [BLENDER, ACCESSORY]), false);
  assert.equal(conditionsMet({ minimumSubtotal: 420, excludedCategories: ['accessories'] }, [BLENDER, ACCESSORY]), false);
  assert.equal(conditionsMet({ minimumSubtotal: 420, excludedCategories: ['other'] }, [BLENDER, ACCESSORY]), true);
});

test('conditionsMet: scope precedence', () => {
  // product exclude beats product include
  assert.equal(conditionsMet({ includedProducts: ['/p/blender'], excludedProducts: ['/p/blender'] }, [BLENDER]), false);
  // product include beats category exclude
  assert.equal(conditionsMet({ includedProducts: ['/p/blender'], excludedCategories: ['blenders'] }, [BLENDER]), true);
  // category exclude beats category include
  assert.equal(conditionsMet({ includedCategories: ['blenders'], excludedCategories: ['commercial'] }, [COMMERCIAL]), false);
  // with an include list, unmatched lines are out of scope
  assert.equal(conditionsMet({ includedCategories: ['blenders'] }, [ACCESSORY]), false);
  assert.equal(conditionsMet({ includedProducts: ['/p/blender'], includedCategories: ['accessories'] }, [ACCESSORY]), true);
});

test('conditionsMet: unknown categories put the line out of category scope', () => {
  assert.equal(conditionsMet({ excludedCategories: ['commercial'] }, [UNKNOWN]), false);
  assert.equal(conditionsMet({ includedCategories: ['blenders'] }, [UNKNOWN]), false);
  assert.equal(conditionsMet({ includedProducts: ['/p/unknown'], includedCategories: ['blenders'] }, [UNKNOWN]), true);
  assert.equal(conditionsMet({ minimumSubtotal: 100 }, [UNKNOWN]), true);
});

test('conditionsMet: disqualifiers beat everything', () => {
  const conditions = { includedProducts: ['/p/quiet-one'], disqualifyingCategories: ['commercial'] };
  assert.equal(conditionsMet(conditions, [COMMERCIAL]), false);
  assert.equal(conditionsMet({ disqualifyingProducts: ['/p/tamper'] }, [BLENDER, ACCESSORY]), false);
  assert.equal(conditionsMet({ disqualifyingProducts: [{ path: '/p/tamper', sku: 'x' }] }, [BLENDER, ACCESSORY]), true);
  assert.equal(conditionsMet({ disqualifyingCategories: ['commercial'] }, [BLENDER, COMMERCIAL]), false);
  assert.equal(conditionsMet({ disqualifyingCategories: ['commercial'] }, [BLENDER, ACCESSORY]), true);
});

test('conditionsMet: unknown categories fail closed for category disqualifiers', () => {
  assert.equal(conditionsMet({ disqualifyingCategories: ['commercial'] }, [BLENDER, UNKNOWN]), false);
  assert.equal(conditionsMet({ disqualifyingProducts: ['/p/x'] }, [BLENDER, UNKNOWN]), true);
});

test('conditionsMet: unknown condition key fails closed', () => {
  assert.equal(conditionsMet({ minimumSubtotal: 0, requiredCategories: ['blenders'] }, [BLENDER]), false);
});

// --- line categories ----------------------------------------------------------

const COMMERCIAL_PROMO = {
  ...PROMOTION,
  conditions: { minimumSubtotal: 100, disqualifyingCategories: ['commercial'] },
};

test('a commercial line in the cart blocks the gift', async () => {
  cart.addItem({ ...paidItem, local: { categories: ['commercial'] } });
  await run([COMMERCIAL_PROMO]);
  assert.equal(gifts().length, 0);
});

test('a home blender over the threshold gets the gift', async () => {
  cart.addItem({ ...paidItem, local: { categories: ['blenders'] } });
  await run([COMMERCIAL_PROMO]);
  assert.equal(gifts().length, 1);
  assert.equal(jsonCalls(paidItem.path).length, 0);
});

test('categories for a restored line are fetched once from the product json', async () => {
  const item = { ...paidItem, sku: 'restored', path: '/us/en_us/products/restored' };
  productJson[item.path] = { sku: 'restored', custom: { categories: [{ url_key: 'commercial', name: 'Commercial' }] } };
  cart.addItem(item);
  await run([COMMERCIAL_PROMO]);
  assert.equal(gifts().length, 0);
  await evaluateGWP();
  assert.equal(jsonCalls(item.path).length, 1);
});

test('categories fall back to the product page JSON-LD', async () => {
  const item = { ...paidItem, sku: 'ld-only', path: '/us/en_us/products/ld-only' };
  pages[item.path] = {
    '@type': 'Product', sku: 'ld-only', custom: { categories: [{ url_key: 'blenders' }] },
  };
  cart.addItem(item);
  await run([COMMERCIAL_PROMO]);
  assert.equal(gifts().length, 1);
  assert.equal(jsonCalls(item.path).length, 1);
});

test('product data without categories or custom leaves categories unknown', async () => {
  const item = { ...paidItem, sku: 'no-custom', path: '/us/en_us/products/no-custom' };
  pages[item.path] = { '@type': 'Product', sku: 'no-custom' };
  cart.addItem(item);
  await run([COMMERCIAL_PROMO]);
  assert.equal(gifts().length, 0);
});

test('categories are not fetched without category conditions', async () => {
  const item = { ...paidItem, sku: 'nocat', path: '/us/en_us/products/nocat' };
  cart.addItem(item);
  await run();
  assert.equal(jsonCalls(item.path).length, 0);
});

test('local categories do not block a cart merge and are not sent to the API', () => {
  cart.addItem({ ...paidItem, local: { categories: ['blenders'] } });
  cart.addItem({ ...paidItem, local: { categories: ['blenders'] } });
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 2);
  assert.equal('local' in cart.getItemsForAPI()[0], false);
});

// --- server reconciliation ---------------------------------------------------

test('the server check is debounced after an evaluation', async () => {
  cart.addItem(paidItem);
  await run();
  await evaluateGWP();
  assert.equal(estimateCalls().length, 0);
  mock.timers.tick(500);
  await reconcileWithServer();
  assert.equal(estimateCalls().length, 1);
  const [{ body }] = estimateCalls();
  assert.equal(body.country, 'us');
  assert.equal(body.couponCode, undefined);
  assert.deepEqual(body.items.map((i) => i.sku), ['paid']);
});

test('no server check without paid lines or conditional promotions', async () => {
  cart.addItem(paidItem);
  await run([{ ...PROMOTION, conditions: undefined }]);
  mock.timers.tick(500);
  await reconcileWithServer();
  await evaluateGWP();
  assert.equal(estimateCalls().length, 0);
});

test('a server denial removes the gift and it is not re-added', async () => {
  cart.addItem(paidItem);
  await run();
  assert.equal(gifts().length, 1);
  estimate = { freeItems: [] };
  await reconcileWithServer();
  assert.equal(gifts().length, 0);
  await evaluateGWP();
  assert.equal(gifts().length, 0);
  mock.timers.tick(500);
  assert.equal(estimateCalls().length, 1);
});

test('a server grant adds the gift the client did not', async () => {
  cart.addItem({ ...paidItem, local: { categories: ['commercial'] } });
  await run([COMMERCIAL_PROMO]);
  assert.equal(gifts().length, 0);
  estimate = grant();
  await reconcileWithServer();
  assert.deepEqual(gifts().map((i) => i.custom.promotionId), [PROMOTION.id]);
});

test('a server result for a different cart is ignored', async () => {
  cart.addItem(paidItem);
  await run();
  estimate = { freeItems: [] };
  await reconcileWithServer();
  assert.equal(gifts().length, 0);
  cart.updateItem(paidItem.sku, 2);
  await evaluateGWP();
  assert.equal(gifts().length, 1);
});

test('an estimate failure keeps the client result', async () => {
  cart.addItem(paidItem);
  await run();
  estimate = new Error('network');
  await reconcileWithServer();
  assert.equal(gifts().length, 1);
  await evaluateGWP();
  assert.equal(gifts().length, 1);
});

// --- order preview -------------------------------------------------------------

const previewCalls = () => calls.filter((c) => c.url.endsWith('/orders/preview'));
const giftsIn = (items) => items.filter((i) => i.custom?.giftWithPurchase);

test('preview waits for the server check and sends the reconciled items', async () => {
  cart.addItem(paidItem);
  await run();
  assert.equal(gifts().length, 1);
  estimate = { freeItems: [] };
  const body = { items: cart.getItemsForAPI() };
  await previewOrder(body);
  assert.equal(estimateCalls().length, 1);
  assert.equal(giftsIn(previewCalls()[0].body.items).length, 0);
  assert.equal(giftsIn(body.items).length, 0);
});

test('preview leaves items it did not take from the cart alone', async () => {
  cart.addItem(paidItem);
  await run();
  estimate = { freeItems: [] };
  const items = [...cart.getItemsForAPI(), { sku: 'other', path: '/p/other', quantity: 1 }];
  await previewOrder({ items });
  assert.equal(giftsIn(previewCalls()[0].body.items).length, 1);
});

test('a rejected free gift triggers one server check and one retry', async () => {
  cart.addItem(paidItem);
  await run();
  estimate = grant();
  await reconcileWithServer();
  assert.equal(gifts().length, 1);
  estimate = { freeItems: [] };
  preview = (body) => (giftsIn(body.items).length
    ? json({ code: 'unprocessable', details: { rule: 'unauthorized_free_item' } }, 422)
    : json({ estimateToken: 'tok' }));
  const result = await previewOrder({ items: cart.getItemsForAPI() });
  assert.equal(result.estimateToken, 'tok');
  assert.equal(previewCalls().length, 2);
  assert.equal(estimateCalls().length, 2);
  assert.equal(gifts().length, 0);
});

test('a rejected free gift is not retried when the server check changes nothing', async () => {
  cart.addItem(paidItem);
  await run();
  estimate = grant();
  preview = () => json({ code: 'unprocessable', details: { rule: 'unauthorized_free_item' } }, 422);
  await assert.rejects(previewOrder({ items: cart.getItemsForAPI() }), (err) => err.status === 422);
  assert.equal(previewCalls().length, 1);
});

test('a server result is reused from session storage for the same rules and cart', async () => {
  cart.addItem(paidItem);
  await run();
  const raw = localStorage.getItem('vitamix.priceRules.stub');
  estimate = { freeItems: [] };
  await reconcileWithServer();
  assert.equal(gifts().length, 0);
  // Same rules content in a new payload object, as on the next page view.
  localStorage.setItem('vitamix.priceRules.stub', JSON.stringify({ promotions: [], serverCheck: true }));
  await ensurePriceRulesLoaded();
  localStorage.setItem('vitamix.priceRules.stub', raw);
  await ensurePriceRulesLoaded();
  await evaluateGWP();
  mock.timers.tick(500);
  assert.equal(gifts().length, 0);
  assert.equal(estimateCalls().length, 1);
});

test('a stub without serverCheck skips the server check', async () => {
  cart.addItem(paidItem);
  await loadRules([PROMOTION], false);
  await evaluateGWP();
  mock.timers.tick(500);
  await reconcileWithServer();
  await previewOrder({ items: cart.getItemsForAPI() });
  assert.equal(estimateCalls().length, 0);
  assert.equal(gifts().length, 1);
});

// --- review follow-ups ----------------------------------------------------------

const setNow = (iso) => localStorage.setItem('vitamix.now', iso);

test('a cached grant does not outlive the promotion end', async () => {
  const promotion = {
    ...PROMOTION,
    id: 'ends',
    rules: [{ path: GIFT_PATH, price: '0', end: '2030-01-02T00:00:00Z' }],
  };
  setNow('2030-01-01T00:00:00Z');
  cart.addItem(paidItem);
  await run([promotion]);
  estimate = grant(promotion);
  await reconcileWithServer();
  assert.equal(gifts().length, 1);
  setNow('2030-01-03T00:00:00Z');
  await evaluateGWP();
  assert.equal(gifts().length, 0);
  const body = { items: cart.getItemsForAPI() };
  await previewOrder(body);
  assert.equal(previewCalls().length, 1);
  assert.equal(giftsIn(previewCalls()[0].body.items).length, 0);
});

test('a promotion that starts forces a new server check', async () => {
  const other = { ...PROMOTION, id: 'other', rules: [{ path: '/p/other-gift', price: '0' }] };
  const later = {
    ...PROMOTION,
    id: 'later',
    rules: [{ path: GIFT_PATH, price: '0', start: '2030-01-02T00:00:00Z' }],
  };
  setNow('2030-01-01T00:00:00Z');
  cart.addItem(paidItem);
  await run([other, later]);
  estimate = { freeItems: [] };
  await reconcileWithServer();
  assert.equal(gifts().length, 0);
  setNow('2030-01-03T00:00:00Z');
  estimate = grant(later);
  await evaluateGWP();
  assert.ok(gifts().some((i) => i.custom.promotionId === 'later'));
  mock.timers.tick(500);
  await reconcileWithServer();
  assert.equal(estimateCalls().length, 2);
  assert.deepEqual(gifts().map((i) => i.custom.promotionId), ['later']);
});

test('a failed check is retried once before a preview', async () => {
  cart.addItem({ ...paidItem, local: { categories: ['commercial'] } });
  await run([COMMERCIAL_PROMO]);
  estimate = new Error('network');
  await reconcileWithServer();
  assert.equal(gifts().length, 0);
  estimate = grant();
  const body = { items: cart.getItemsForAPI() };
  await previewOrder(body);
  assert.equal(estimateCalls().length, 2);
  assert.equal(giftsIn(previewCalls()[0].body.items).length, 1);
});

test('gift changes made while settling a preview are tagged in cart:change', async () => {
  cart.addItem(paidItem);
  await run();
  const added = globalThis.__events.filter((e) => e.detail?.action === 'add' && e.detail.item.custom?.giftWithPurchase);
  assert.equal(added.length, 1);
  assert.equal(added[0].detail.source, undefined);
  estimate = { freeItems: [] };
  globalThis.__events.length = 0;
  await previewOrder({ items: cart.getItemsForAPI() });
  const removed = globalThis.__events.filter((e) => e.detail?.action === 'remove');
  assert.equal(removed.length, 1);
  assert.equal(removed[0].detail.source, 'gwp-preview');
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

test('a commercial cart gets no gift even when the server grants one', async () => {
  cart.addItem(paidItem);
  cart.addItem(commercialItem);
  estimate = grant();
  await run();
  mock.timers.tick(500);
  await reconcileWithServer();
  await previewOrder({ items: cart.getItemsForAPI() });
  assert.equal(gifts().length, 0);
  assert.equal(estimateCalls().length, 0);
});

test('the server check has a timeout', async () => {
  cart.addItem(paidItem);
  await run();
  let init;
  globalThis.__setFetchMock(async (url, i) => {
    init = i;
    return json({ freeItems: [] });
  });
  await reconcileWithServer();
  assert.ok(init.signal instanceof AbortSignal);
});

test('overlapping previews: a late rejection is repaired after another preview removed the gift', async () => {
  cart.addItem(paidItem);
  await run();
  estimate = grant();
  await reconcileWithServer();
  assert.equal(gifts().length, 1);

  const rejection = () => json({ code: 'unprocessable', details: { rule: 'unauthorized_free_item' } }, 422);
  let releaseB;
  const heldB = new Promise((resolve) => { releaseB = resolve; });
  let n = 0;
  preview = (body) => {
    n += 1;
    if (!giftsIn(body.items).length) return json({ estimateToken: `tok-${n}` });
    // The second request with a gift (preview B) answers only after A has retried.
    return n === 2 ? heldB.then(rejection) : rejection();
  };

  const bodyA = { items: cart.getItemsForAPI() };
  const bodyB = { items: cart.getItemsForAPI() };
  estimate = { freeItems: [] };
  const a = previewOrder(bodyA);
  const b = previewOrder(bodyB);
  // Let A finish (422, forced denial, retry) before B's rejection arrives.
  const resultA = await a;
  releaseB();
  const resultB = await b;

  assert.ok(resultA.estimateToken);
  assert.ok(resultB.estimateToken);
  assert.equal(giftsIn(bodyA.items).length, 0);
  assert.equal(giftsIn(bodyB.items).length, 0);
  assert.equal(gifts().length, 0);
});

test('a stalled lookup does not hold gift settlement past the deadline', async () => {
  mock.timers.reset();
  const item = { ...paidItem, sku: 'stall', path: '/us/en_us/products/stall' };
  cart.addItem(item);
  await loadRules([COMMERCIAL_PROMO]);
  let release;
  holds[`${item.path}.json`] = new Promise((resolve) => { release = resolve; });
  await ensureGWPReconciled({ timeoutMs: 20 });
  assert.equal(jsonCalls(item.path).length, 1);
  // Changes after the deadline are not tagged as part of a preview.
  globalThis.__events.length = 0;
  release(json({ sku: 'stall', custom: { categories: [] } }));
  await evaluateGWP();
  const added = globalThis.__events.filter((e) => e.detail?.action === 'add');
  assert.equal(added.length, 1);
  assert.equal(added[0].detail.source, undefined);
});

test('an in-memory server answer expires after the TTL', async () => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  cart.addItem(paidItem);
  await run();
  estimate = { freeItems: [] };
  await reconcileWithServer();
  assert.equal(gifts().length, 0);
  mock.timers.tick(16 * 60 * 1000);
  estimate = grant();
  await previewOrder({ items: cart.getItemsForAPI() });
  assert.equal(estimateCalls().length, 2);
  assert.equal(gifts().length, 1);
});

test('an estimate with a malformed freeItems counts as a failed check', async () => {
  cart.addItem(paidItem);
  await run();
  estimate = { freeItems: 'none' };
  await reconcileWithServer();
  assert.equal(gifts().length, 1);
});

test('an estimate without freeItems denies the gift', async () => {
  cart.addItem(paidItem);
  await run();
  estimate = { subtotal: 150 };
  await reconcileWithServer();
  assert.equal(gifts().length, 0);
});

test('a paid warranty line with empty product categories does not block the gift', async () => {
  const warranty = {
    sku: 'warranty-3yr',
    path: '/us/en_us/products/warranty-3yr',
    price: '25.00',
    quantity: 1,
    custom: { linkedTo: 'paid' },
    local: { showInCart: false },
  };
  productJson[warranty.path] = { sku: 'warranty-3yr', custom: { categories: [] } };
  cart.addItem({ ...paidItem, local: { categories: ['blenders'] } });
  cart.addItem(warranty);
  await run([COMMERCIAL_PROMO]);
  assert.equal(gifts().length, 1);
  assert.equal(jsonCalls(warranty.path).length, 1);
});
