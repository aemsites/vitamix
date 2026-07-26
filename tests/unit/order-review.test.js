import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveConfirmResult,
  resolveReviewTotals,
  newIdempotencyKey,
  createConfirmHandler,
  createCancelHandler,
  createAbandonmentHandler,
} from '../../blocks/order-review/order-review.js';

beforeEach(() => {
  globalThis.__resetTestState();
});

describe('resolveConfirmResult', () => {
  test('completed → route to the order-complete page', () => {
    assert.deepEqual(resolveConfirmResult({ status: 'completed' }), { action: 'complete' });
  });

  test('pending → route to the processing/complete state', () => {
    assert.deepEqual(resolveConfirmResult({ status: 'pending' }), { action: 'processing' });
  });

  test('failed → stay on the review page', () => {
    assert.deepEqual(resolveConfirmResult({ status: 'failed', reason: 'declined' }), { action: 'failed' });
  });

  test('unknown / missing status → treated as failed (never route away)', () => {
    assert.deepEqual(resolveConfirmResult({}), { action: 'failed' });
    assert.deepEqual(resolveConfirmResult(), { action: 'failed' });
  });
});

describe('resolveReviewTotals', () => {
  test('derives totals from API estimates (subtotal from items)', () => {
    const order = {
      items: [
        { price: { final: 148 }, quantity: 1 },
        { price: { final: 62 }, quantity: 2 },
      ],
      estimates: {
        shippingMethod: { label: 'Express', rate: 12 },
        discounts: [{ name: 'WELCOME', amount: 25 }],
        tax: { amount: 33.78 },
      },
    };
    const totals = resolveReviewTotals(order, null);
    assert.equal(totals.subtotal, 272); // 148 + 62*2
    assert.equal(totals.tax, 33.78);
    assert.equal(totals.shippingMethod.label, 'Express');
    // 272 - 25 + 12 + 33.78
    assert.equal(totals.total, 292.78);
  });

  test('falls back to the sessionStorage preview when estimates are absent', () => {
    const preview = {
      subtotal: '100',
      shippingMethod: { label: 'Standard', rate: 0 },
      discounts: [],
      taxAmount: '8',
    };
    const totals = resolveReviewTotals({ items: [] }, preview);
    assert.equal(totals.subtotal, 100);
    assert.equal(totals.tax, 8);
    assert.equal(totals.total, 108);
  });

  test('zeroes shipping when a free-shipping discount applies', () => {
    const order = {
      items: [{ price: { final: 50 }, quantity: 1 }],
      estimates: {
        shippingMethod: { label: 'Standard', rate: 9.95 },
        discounts: [{ name: 'FREESHIP', amount: 0, freeShipping: true }],
        tax: { amount: 4 },
      },
    };
    const totals = resolveReviewTotals(order, null);
    assert.equal(totals.total, 54); // 50 + 0 shipping + 4 tax
  });
});

describe('newIdempotencyKey', () => {
  test('returns a non-empty string and a fresh value each call', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    assert.equal(typeof a, 'string');
    assert.ok(a.length > 0);
    assert.notEqual(a, b);
  });
});

describe('createConfirmHandler', () => {
  test('confirms with orderId + a fresh key and routes on completed', async () => {
    const calls = [];
    let routedTo = null;
    let errored = null;
    const busy = [];
    const handler = createConfirmHandler({
      orderId: 'order-1',
      confirm: async (orderId, key) => { calls.push([orderId, key]); return { status: 'completed' }; },
      routeTo: (action) => { routedTo = action; },
      onError: (msg) => { errored = msg; },
      setBusy: (b) => busy.push(b),
      errorMessage: 'oops',
      newKey: () => 'key-123',
    });

    await handler();

    assert.deepEqual(calls, [['order-1', 'key-123']]);
    assert.equal(routedTo, 'complete');
    assert.equal(errored, null);
    assert.deepEqual(busy, [true]); // stays busy while navigating
  });

  test('routes on pending', async () => {
    let routedTo = null;
    const handler = createConfirmHandler({
      orderId: 'o',
      confirm: async () => ({ status: 'pending' }),
      routeTo: (action) => { routedTo = action; },
      onError: () => {},
      errorMessage: 'oops',
    });
    await handler();
    assert.equal(routedTo, 'processing');
  });

  test('surfaces failure and clears busy without routing', async () => {
    let routedTo = null;
    let errored = null;
    const busy = [];
    const handler = createConfirmHandler({
      orderId: 'o',
      confirm: async () => ({ status: 'failed', reason: 'card declined' }),
      routeTo: (action) => { routedTo = action; },
      onError: (msg) => { errored = msg; },
      setBusy: (b) => busy.push(b),
      errorMessage: 'fallback message',
    });
    await handler();
    assert.equal(routedTo, null);
    assert.equal(errored, 'card declined');
    assert.deepEqual(busy, [true, false]);
  });

  test('uses the fallback error message when the API throws', async () => {
    let routedTo = null;
    let errored = null;
    const handler = createConfirmHandler({
      orderId: 'o',
      confirm: async () => { throw new Error('network'); },
      routeTo: (action) => { routedTo = action; },
      onError: (msg) => { errored = msg; },
      errorMessage: 'fallback message',
    });
    await handler();
    assert.equal(routedTo, null);
    assert.equal(errored, 'fallback message');
  });
});

describe('createCancelHandler', () => {
  test('cancels with orderId + a fresh key, then returns to the cart', async () => {
    const calls = [];
    let routed = false;
    const handler = createCancelHandler({
      orderId: 'order-9',
      cancel: async (orderId, key) => { calls.push([orderId, key]); return { status: 'cancelled' }; },
      routeToCart: () => { routed = true; },
      newKey: () => 'ck-1',
    });
    await handler();
    assert.deepEqual(calls, [['order-9', 'ck-1']]);
    assert.equal(routed, true);
  });

  test('returns to the cart even when the cancel call fails (best-effort)', async () => {
    let routed = false;
    const handler = createCancelHandler({
      orderId: 'order-9',
      cancel: async () => { throw new Error('boom'); },
      routeToCart: () => { routed = true; },
    });
    await handler();
    assert.equal(routed, true);
  });
});

describe('createAbandonmentHandler', () => {
  test('sends the cancel when the page has not been finalized', () => {
    let sent = 0;
    const handler = createAbandonmentHandler({
      isFinalized: () => false,
      sendCancel: () => { sent += 1; },
    });
    handler();
    assert.equal(sent, 1);
  });

  test('does not send the cancel once finalized (completed or explicitly cancelled)', () => {
    let sent = 0;
    const handler = createAbandonmentHandler({
      isFinalized: () => true,
      sendCancel: () => { sent += 1; },
    });
    handler();
    assert.equal(sent, 0);
  });
});
