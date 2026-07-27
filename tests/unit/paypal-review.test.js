import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isExpressReviewEnabled,
  resolveExpressOutcome,
  isRetryableInitiateError,
  withInitiateRetry,
} from '../../scripts/payments/paypal-review.js';

beforeEach(() => {
  globalThis.__resetTestState();
  delete globalThis.CommerceConfig;
});

describe('isExpressReviewEnabled', () => {
  test('true only when orderReview.express is set on CommerceConfig.paypal', () => {
    globalThis.CommerceConfig = { paypal: { orderReview: { express: true } } };
    assert.equal(isExpressReviewEnabled(), true);
  });

  test('false when the flag is off, absent, or paypal config is missing', () => {
    globalThis.CommerceConfig = { paypal: { orderReview: { express: false } } };
    assert.equal(isExpressReviewEnabled(), false);
    globalThis.CommerceConfig = { paypal: { orderReview: {} } };
    assert.equal(isExpressReviewEnabled(), false);
    globalThis.CommerceConfig = { paypal: {} };
    assert.equal(isExpressReviewEnabled(), false);
    globalThis.CommerceConfig = {};
    assert.equal(isExpressReviewEnabled(), false);
  });
});

describe('resolveExpressOutcome', () => {
  test('action:review → review (review mode)', () => {
    assert.equal(resolveExpressOutcome({ action: 'review', status: 'requires_action' }), 'review');
  });

  test('status:completed → completed (review off, inline capture)', () => {
    assert.equal(resolveExpressOutcome({ status: 'completed' }), 'completed');
  });

  test('review action wins even if a status is present', () => {
    assert.equal(resolveExpressOutcome({ action: 'review', status: 'completed' }), 'review');
  });

  test('failed / unknown / empty → failed (never routes away)', () => {
    assert.equal(resolveExpressOutcome({ status: 'failed', reason: 'declined' }), 'failed');
    assert.equal(resolveExpressOutcome({ status: 'pending' }), 'failed');
    assert.equal(resolveExpressOutcome({}), 'failed');
    assert.equal(resolveExpressOutcome(), 'failed');
  });
});

describe('isRetryableInitiateError', () => {
  test('retryable on 502 / 503 or an explicit retryable body flag', () => {
    assert.equal(isRetryableInitiateError({ status: 502 }), true);
    assert.equal(isRetryableInitiateError({ status: 503 }), true);
    assert.equal(isRetryableInitiateError({ status: 500, body: { retryable: true } }), true);
  });

  test('not retryable on authoritative failures or missing errors', () => {
    assert.equal(isRetryableInitiateError({ status: 400 }), false);
    assert.equal(isRetryableInitiateError({ status: 404 }), false);
    assert.equal(isRetryableInitiateError({ status: 422, body: { retryable: false } }), false);
    assert.equal(isRetryableInitiateError({ status: 500 }), false);
    assert.equal(isRetryableInitiateError(null), false);
    assert.equal(isRetryableInitiateError(undefined), false);
  });
});

/** Build an Error shaped like a CommerceApiError (status + body). */
function apiErr(status, body) {
  return Object.assign(new Error(`API error ${status}`), { status, body });
}

describe('withInitiateRetry', () => {
  test('returns the result on first success without retrying', async () => {
    let calls = 0;
    const result = await withInitiateRetry(async () => { calls += 1; return 'ok'; }, { baseDelay: 0 });
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  test('retries a retryable error then succeeds (same closure = same key)', async () => {
    let calls = 0;
    const result = await withInitiateRetry(async () => {
      calls += 1;
      if (calls < 3) throw apiErr(502);
      return 'recovered';
    }, { baseDelay: 0 });
    assert.equal(result, 'recovered');
    assert.equal(calls, 3);
  });

  test('rethrows a non-retryable error immediately (no retry)', async () => {
    let calls = 0;
    await assert.rejects(
      () => withInitiateRetry(async () => { calls += 1; throw apiErr(422); }, { baseDelay: 0 }),
      (err) => err.status === 422,
    );
    assert.equal(calls, 1);
  });

  test('gives up after exhausting retries and rethrows the last error', async () => {
    let calls = 0;
    await assert.rejects(
      () => withInitiateRetry(
        async () => { calls += 1; throw apiErr(503); },
        { retries: 2, baseDelay: 0 },
      ),
      (err) => err.status === 503,
    );
    assert.equal(calls, 3); // initial attempt + 2 retries
  });
});
