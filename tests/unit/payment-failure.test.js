import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCheckoutFailure } from '../../scripts/payment-failure.js';

/**
 * Covers the order-cancel page's fetch orchestration (extracted from
 * blocks/order-cancel/order-cancel.js so it is testable without the browser-only
 * import chain). getOrder is injected.
 */
describe('resolveCheckoutFailure', () => {
  test('returns the bucket from the fetched order (happy path)', async () => {
    const getOrder = async () => ({ order: { payment: { checkoutFailure: 'retry' } } });
    const result = await resolveCheckoutFailure({
      reason: '', orderId: 'o1', email: 'a@b.com', getOrder,
    });
    assert.equal(result, 'retry');
  });

  test('skips the lookup and returns empty for a buyer cancellation', async () => {
    let called = false;
    const getOrder = async () => { called = true; return { order: {} }; };
    const result = await resolveCheckoutFailure({
      reason: 'customer_cancelled', orderId: 'o1', email: 'a@b.com', getOrder,
    });
    assert.equal(result, '');
    assert.equal(called, false);
  });

  test('skips the lookup when the email is missing', async () => {
    let called = false;
    const getOrder = async () => { called = true; return { order: {} }; };
    const result = await resolveCheckoutFailure({
      reason: '', orderId: 'o1', email: '', getOrder,
    });
    assert.equal(result, '');
    assert.equal(called, false);
  });

  test('skips the lookup when the orderId is missing', async () => {
    let called = false;
    const getOrder = async () => { called = true; return { order: {} }; };
    const result = await resolveCheckoutFailure({
      reason: '', orderId: '', email: 'a@b.com', getOrder,
    });
    assert.equal(result, '');
    assert.equal(called, false);
  });

  test('returns empty when the lookup throws (safe fallback)', async () => {
    const getOrder = async () => { throw new Error('network'); };
    const result = await resolveCheckoutFailure({
      reason: '', orderId: 'o1', email: 'a@b.com', getOrder,
    });
    assert.equal(result, '');
  });

  test('returns empty when the order has no checkoutFailure', async () => {
    const getOrder = async () => ({ order: { payment: {} } });
    const result = await resolveCheckoutFailure({
      reason: '', orderId: 'o1', email: 'a@b.com', getOrder,
    });
    assert.equal(result, '');
  });

  test('returns empty when the order has no payment object', async () => {
    const getOrder = async () => ({ order: {} });
    const result = await resolveCheckoutFailure({
      reason: '', orderId: 'o1', email: 'a@b.com', getOrder,
    });
    assert.equal(result, '');
  });
});
