import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveConfirmResult,
  resolveReviewTotals,
  newIdempotencyKey,
  createConfirmHandler,
  createCancelHandler,
  createAbandonmentHandler,
  isOrderNotConfirmable,
  resolveLineItem,
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
    assert.deepEqual(resolveConfirmResult({ status: 'failed' }), { action: 'failed' });
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
      confirm: async () => ({ status: 'failed', checkoutFailure: 'retry' }),
      routeTo: (action) => { routedTo = action; },
      onError: (msg) => { errored = msg; },
      setBusy: (b) => busy.push(b),
      errorMessage: 'fallback message',
    });
    await handler();
    assert.equal(routedTo, null);
    assert.equal(errored, 'fallback message');
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

  test('routes to not-confirmable handling on a 422 order_not_confirmable, not a generic error', async () => {
    let errored = null;
    let notConfirmable = false;
    const err = Object.assign(new Error('unprocessable'), {
      status: 422,
      body: { details: { rule: 'order_not_confirmable', state: 'payment_cancelled' } },
    });
    const handler = createConfirmHandler({
      orderId: 'o',
      confirm: async () => { throw err; },
      routeTo: () => {},
      onError: (msg) => { errored = msg; },
      onNotConfirmable: () => { notConfirmable = true; },
      errorMessage: 'fallback message',
    });
    await handler();
    assert.equal(notConfirmable, true);
    assert.equal(errored, null); // no generic error when the order is dead
  });

  test('routes to cart on a 200 failed result flagged cancelled (terminal), not a retry error', async () => {
    let errored = null;
    let notConfirmable = false;
    const handler = createConfirmHandler({
      orderId: 'o',
      confirm: async () => ({ status: 'failed', checkoutFailure: 'retry', cancelled: true }),
      routeTo: () => {},
      onError: (msg) => { errored = msg; },
      onNotConfirmable: () => { notConfirmable = true; },
      errorMessage: 'fallback message',
    });
    await handler();
    assert.equal(notConfirmable, true);
    assert.equal(errored, null); // terminal: routed to cart, not a stay-and-retry error
  });

  test('stays on the page with an error on a 200 failed result that is NOT cancelled (soft decline)', async () => {
    let errored = null;
    let notConfirmable = false;
    const busy = [];
    const handler = createConfirmHandler({
      orderId: 'o',
      confirm: async () => ({ status: 'failed', checkoutFailure: 'retry' }),
      routeTo: () => {},
      onError: (msg) => { errored = msg; },
      onNotConfirmable: () => { notConfirmable = true; },
      setBusy: (b) => busy.push(b),
      errorMessage: 'fallback message',
    });
    await handler();
    assert.equal(notConfirmable, false);
    assert.equal(errored, 'fallback message');
    assert.deepEqual(busy, [true, false]);
  });

  test('routes a contact_support result to the contact-support handler, not the cart or a generic error', async () => {
    let errored = null;
    let notConfirmable = false;
    let contactSupport = false;
    const handler = createConfirmHandler({
      orderId: 'o',
      // The confirm endpoint returns a 200 with checkoutFailure=contact_support
      // and cancelled:true when Forter declines the capture.
      confirm: async () => ({ status: 'failed', checkoutFailure: 'contact_support', cancelled: true }),
      routeTo: () => {},
      onError: (msg) => { errored = msg; },
      onNotConfirmable: () => { notConfirmable = true; },
      onContactSupport: () => { contactSupport = true; },
      errorMessage: 'fallback message',
    });
    await handler();
    assert.equal(contactSupport, true); // routed to the order-cancelled page
    assert.equal(notConfirmable, false); // NOT the generic cart bounce
    assert.equal(errored, null); // terminal: no stay-and-retry error
  });

  test('routes a retry result to the retryable handler, not the generic cancelled path', async () => {
    let errored = null;
    let notConfirmable = false;
    let retryable = false;
    const handler = createConfirmHandler({
      orderId: 'o',
      // The confirm endpoint returns a 200 with checkoutFailure=retry and
      // cancelled:true for a retryable authorization-stage decline.
      confirm: async () => ({ status: 'failed', checkoutFailure: 'retry', cancelled: true }),
      routeTo: () => {},
      onError: (msg) => { errored = msg; },
      onNotConfirmable: () => { notConfirmable = true; },
      onRetryable: () => { retryable = true; },
      errorMessage: 'fallback message',
    });
    await handler();
    assert.equal(retryable, true); // routed to the retry-copy restart
    assert.equal(notConfirmable, false); // NOT the generic expired/cancelled path
    assert.equal(errored, null); // terminal, handled before the cancelled branch
  });

  test('falls back to the cancelled path for contact_support when no handler is wired', async () => {
    let notConfirmable = false;
    const handler = createConfirmHandler({
      orderId: 'o',
      confirm: async () => ({ status: 'failed', checkoutFailure: 'contact_support', cancelled: true }),
      routeTo: () => {},
      onError: () => {},
      onNotConfirmable: () => { notConfirmable = true; },
      errorMessage: 'fallback message',
    });
    await handler();
    assert.equal(notConfirmable, true); // still terminal, just without the tailored copy
  });
});

describe('isOrderNotConfirmable', () => {
  test('true for a 422 with order_not_confirmable rule or payment_cancelled state', () => {
    assert.equal(isOrderNotConfirmable({ status: 422, body: { details: { rule: 'order_not_confirmable' } } }), true);
    assert.equal(isOrderNotConfirmable({ status: 422, body: { details: { state: 'payment_cancelled' } } }), true);
  });

  test('false for other statuses, other 422s, or missing errors', () => {
    assert.equal(isOrderNotConfirmable({ status: 503, body: { retryable: true } }), false);
    assert.equal(isOrderNotConfirmable({ status: 422, body: { details: { rule: 'something_else' } } }), false);
    assert.equal(isOrderNotConfirmable({ status: 422 }), false);
    assert.equal(isOrderNotConfirmable(null), false);
    assert.equal(isOrderNotConfirmable(undefined), false);
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

describe('resolveLineItem', () => {
  test('a gift-with-purchase is free and flagged as a gift', () => {
    const r = resolveLineItem({ price: { final: '0' }, quantity: 1, custom: { giftWithPurchase: true } });
    assert.equal(r.isGift, true);
    assert.equal(r.isFree, true);
  });

  test('a linkedTo add-on (paid warranty) is NOT free and NOT a gift', () => {
    const r = resolveLineItem({
      sku: '001314',
      price: { final: '117.00' },
      quantity: 1,
      custom: { linkedTo: '075861-04', coverageYears: 3 },
    });
    assert.equal(r.isGift, false);
    assert.equal(r.isFree, false);
    assert.equal(r.unitPrice, 117);
    assert.equal(r.lineSubtotal, 117);
  });

  test('a zero-priced non-gift line is free but not flagged as a gift', () => {
    const r = resolveLineItem({ price: { final: '0' }, quantity: 2 });
    assert.equal(r.isGift, false);
    assert.equal(r.isFree, true);
  });

  test('computes line subtotal from unit price x quantity', () => {
    const r = resolveLineItem({ price: { final: '62' }, quantity: 2 });
    assert.equal(r.unitPrice, 62);
    assert.equal(r.lineSubtotal, 124);
    assert.equal(r.isFree, false);
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

  test('does not send on a back/forward-cache transition (pagehide persisted=true)', () => {
    let sent = 0;
    const handler = createAbandonmentHandler({
      isFinalized: () => false,
      sendCancel: () => { sent += 1; },
    });
    handler({ persisted: true });
    assert.equal(sent, 0);
  });

  test('sends on a genuine terminal unload (pagehide persisted=false)', () => {
    let sent = 0;
    const handler = createAbandonmentHandler({
      isFinalized: () => false,
      sendCancel: () => { sent += 1; },
    });
    handler({ persisted: false });
    assert.equal(sent, 1);
  });
});
