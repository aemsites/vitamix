/**
 * Unit tests for scripts/commerce/price-correction.js and its wiring into
 * previewOrder (scripts/commerce-api.js).
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Cart } from '../../scripts/cart.js';
import { previewOrder } from '../../scripts/commerce-api.js';
import {
  getPriceCorrection, applyPriceCorrection, previewWithPriceSync, CONSISTENCY_MISMATCH,
} from '../../scripts/commerce/price-correction.js';
import { __resetScripts } from './mocks/scripts.mjs';

const mismatchBody = (details = {}) => ({
  code: CONSISTENCY_MISMATCH,
  message: 'bundle price sum mismatch: 899.95 vs 949.95',
  details: {
    field: 'bundle_price',
    sku: '001372-1093-VB',
    bundlePrice: '899.95',
    itemSum: '949.95',
    ...details,
  },
});

const bundleItem = (overrides = {}) => ({
  sku: '001372-1093-VB',
  quantity: 1,
  price: '899.95',
  name: '5200 Standard - Getting Started',
  path: '/us/en_us/products/5200-legacy-bundle',
  ...overrides,
});

beforeEach(() => {
  globalThis.__resetTestState();
  __resetScripts();
});

test('getPriceCorrection: extracts sku and itemSum from a bundle price mismatch', () => {
  assert.deepEqual(
    getPriceCorrection({ status: 400, body: mismatchBody() }),
    { sku: '001372-1093-VB', price: '949.95' },
  );
});

const itemMismatchBody = (actualPrice = { currency: 'CAD', regular: '549.95', final: '549.95' }) => ({
  code: CONSISTENCY_MISMATCH,
  message: "price mismatch for item: '076047'",
  details: { field: 'price', sku: '076047', actualPrice },
});

test('getPriceCorrection: extracts sku and actualPrice from an item price mismatch', () => {
  assert.deepEqual(
    getPriceCorrection({ status: 400, body: itemMismatchBody() }),
    { sku: '076047', price: '549.95', regularPrice: '549.95' },
  );
  assert.deepEqual(
    getPriceCorrection({ status: 400, body: itemMismatchBody({ currency: 'CAD', regular: '549.95', final: '499.95' }) }),
    { sku: '076047', price: '499.95', regularPrice: '549.95' },
  );
  assert.deepEqual(
    getPriceCorrection({ status: 400, body: itemMismatchBody({ currency: 'CAD', regular: '549.95' }) }),
    { sku: '076047', price: '549.95', regularPrice: '549.95' },
  );
  assert.deepEqual(
    getPriceCorrection({ status: 400, body: itemMismatchBody({ currency: 'CAD', final: '499.95' }) }),
    { sku: '076047', price: '499.95' },
  );
  assert.equal(getPriceCorrection({ status: 400, body: itemMismatchBody({}) }), null);
  assert.equal(getPriceCorrection({ status: 400, body: itemMismatchBody(null) }), null);
});

test('applyPriceCorrection: reprices a regular item from an item price mismatch', () => {
  const cart = new Cart();
  cart.addItem(bundleItem({ sku: '076047', price: '359.95' }));
  assert.equal(applyPriceCorrection({ status: 400, body: itemMismatchBody() }, cart), true);
  assert.equal(cart.items[0].price, '549.95');
});

test('applyPriceCorrection: a promotion ending returns the line to its regular price', () => {
  const cart = new Cart();
  cart.addItem(bundleItem({ sku: '076047', price: '499.95', local: { regularPrice: '549.95' } }));
  assert.equal(applyPriceCorrection({ status: 400, body: itemMismatchBody() }, cart), true);
  assert.equal(cart.items[0].price, '549.95');
  assert.equal(cart.items[0].local, undefined);
});

test('applyPriceCorrection: a promotional price sets the regular price', () => {
  const cart = new Cart();
  cart.addItem(bundleItem({ sku: '076047', price: '359.95' }));
  const body = itemMismatchBody({ currency: 'CAD', regular: '549.95', final: '499.95' });
  assert.equal(applyPriceCorrection({ status: 400, body }, cart), true);
  assert.equal(cart.items[0].price, '499.95');
  assert.equal(cart.items[0].local.regularPrice, '549.95');
});

test('getPriceCorrection: ignores other statuses, codes, fields, and bad sums', () => {
  assert.equal(getPriceCorrection({ status: 422, body: mismatchBody() }), null);
  assert.equal(getPriceCorrection({ status: 400, body: { ...mismatchBody(), code: 'OTHER' } }), null);
  assert.equal(getPriceCorrection({ status: 400, body: mismatchBody({ field: 'estimateToken' }) }), null);
  assert.equal(getPriceCorrection({ status: 400, body: mismatchBody({ itemSum: 'nope' }) }), null);
  assert.equal(getPriceCorrection({ status: 400, body: mismatchBody({ sku: undefined }) }), null);
  assert.equal(getPriceCorrection(new Error('network')), null);
  assert.equal(getPriceCorrection(undefined), null);
});

test('applyPriceCorrection: reprices the matching cart line', () => {
  const cart = new Cart();
  cart.addItem(bundleItem());
  cart.addItem(bundleItem({ sku: 'other', price: '10.00' }));
  assert.equal(applyPriceCorrection({ status: 400, body: mismatchBody() }, cart), true);
  assert.equal(cart.items[0].price, '949.95');
  assert.equal(cart.items[1].price, '10.00');
});

test('previewOrder: repriced cart on mismatch and still rethrows the error', async () => {
  window.cart.clear();
  window.cart.addItem(bundleItem());
  globalThis.__setFetchMock(async () => ({
    ok: false,
    status: 400,
    json: async () => mismatchBody(),
    headers: { get: () => null },
  }));
  await assert.rejects(
    previewOrder({ items: window.cart.getItemsForAPI() }),
    (err) => err.status === 400 && err.body.code === CONSISTENCY_MISMATCH,
  );
  assert.equal(window.cart.items[0].price, '949.95');
  assert.equal(window.cart.getItemsForAPI()[0].price.final, '949.95');
});

/** Fetch mock answering each call with the next queued [status, body]. */
function queueFetch(responses) {
  const bodies = [];
  globalThis.__setFetchMock(async (url, init) => {
    let status = 200;
    let body = {};
    if (String(url).endsWith('/orders/preview')) {
      bodies.push(JSON.parse(init.body));
      [status, body] = responses.shift();
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      headers: { get: () => null },
    };
  });
  return bodies;
}

test('previewWithPriceSync: retries once with a rebuilt body after a price sync', async () => {
  window.cart.clear();
  window.cart.addItem(bundleItem());
  const bodies = queueFetch([[400, mismatchBody()], [200, { estimateToken: 'tok' }]]);
  const result = await previewWithPriceSync(
    previewOrder,
    () => ({ items: window.cart.getItemsForAPI() }),
  );
  assert.equal(result.estimateToken, 'tok');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].items[0].price.final, '899.95');
  assert.equal(bodies[1].items[0].price.final, '949.95');
});

test('previewWithPriceSync: does not retry when the cart was not repriced', async () => {
  window.cart.clear();
  window.cart.addItem(bundleItem({ price: '949.95' }));
  const bodies = queueFetch([[400, mismatchBody()]]);
  await assert.rejects(previewWithPriceSync(
    previewOrder,
    () => ({ items: window.cart.getItemsForAPI() }),
  ));
  assert.equal(bodies.length, 1);
});

test('previewWithPriceSync: retries at most once', async () => {
  window.cart.clear();
  window.cart.addItem(bundleItem());
  const bodies = queueFetch([
    [400, mismatchBody()],
    [400, mismatchBody({ itemSum: '999.95' })],
  ]);
  await assert.rejects(previewWithPriceSync(
    previewOrder,
    () => ({ items: window.cart.getItemsForAPI() }),
  ));
  assert.equal(bodies.length, 2);
});

test('previewOrder: leaves the cart alone on unrelated errors', async () => {
  window.cart.clear();
  window.cart.addItem(bundleItem());
  globalThis.__setFetchMock(async () => ({
    ok: false,
    status: 400,
    json: async () => ({ code: 'VALIDATION', message: 'bad' }),
    headers: { get: () => null },
  }));
  await assert.rejects(previewOrder({ items: [] }));
  assert.equal(window.cart.items[0].price, '899.95');
});

const promoItem = (overrides = {}) => bundleItem({
  sku: '073494-04',
  price: '699.95',
  name: 'Ascent X4',
  path: '/us/en_us/products/ascent-x4',
  ...overrides,
});

const promoPreview = (amount, token = 'tok') => ({
  estimateToken: token,
  discounts: [{
    id: 'promo-1', source: 'promotion', type: 'product_price_override', amount,
  }],
  lineItems: [
    { sku: 'other', discounts: [] },
    { sku: '073494-04', discounts: [{ id: 'promo-1', amount }] },
  ],
});

test('previewOrder: reprices a line discounted by a promotion and previews again', async () => {
  window.cart.clear();
  window.cart.addItem(bundleItem({ sku: 'other', price: '10.00' }));
  window.cart.addItem(promoItem({ quantity: 2 }));
  const bodies = queueFetch([[200, promoPreview(100, 'first')], [200, promoPreview(0, 'second')]]);
  const orderBody = { items: window.cart.getItemsForAPI() };

  const result = await previewOrder(orderBody);

  assert.equal(result.estimateToken, 'second');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].items[1].price.final, '699.95');
  assert.equal(bodies[1].items[1].price.final, '649.95');
  assert.equal(bodies[1].items[0].price.final, '10.00');
  assert.deepEqual(orderBody.items, window.cart.getItemsForAPI());
  assert.equal(window.cart.items[1].price, '649.95');
  assert.equal(window.cart.items[1].local.regularPrice, '699.95');
  assert.equal(window.cart.items[0].local, undefined);
});

test('previewOrder: keeps a higher stored regular price when repricing', async () => {
  window.cart.clear();
  window.cart.addItem(bundleItem({ sku: 'other', price: '10.00' }));
  window.cart.addItem(promoItem({ price: '649.95', local: { regularPrice: '699.95' } }));
  queueFetch([[200, promoPreview(50)], [200, promoPreview(0)]]);

  await previewOrder({ items: window.cart.getItemsForAPI() });

  assert.equal(window.cart.items[1].price, '599.95');
  assert.equal(window.cart.items[1].local.regularPrice, '699.95');
});

test('previewOrder: does not preview again without a promotion discount', async () => {
  window.cart.clear();
  window.cart.addItem(bundleItem({ sku: 'other', price: '10.00' }));
  window.cart.addItem(promoItem({ price: '649.95' }));
  const bodies = queueFetch([[200, promoPreview(0)]]);

  await previewOrder({ items: window.cart.getItemsForAPI() });

  assert.equal(bodies.length, 1);
  assert.equal(window.cart.items[1].price, '649.95');
});

test('previewOrder: ignores non-promotion line discounts', async () => {
  window.cart.clear();
  window.cart.addItem(bundleItem({ sku: 'other', price: '10.00' }));
  window.cart.addItem(promoItem());
  const preview = promoPreview(50);
  preview.discounts[0].source = 'coupon';
  const bodies = queueFetch([[200, preview]]);

  await previewOrder({ items: window.cart.getItemsForAPI() });

  assert.equal(bodies.length, 1);
  assert.equal(window.cart.items[1].price, '699.95');
});
