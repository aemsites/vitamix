import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveOrderStatusKey } from '../../widgets/forms/order-status-lookup.js';

test('uses the normalized status returned by the forms action', () => {
  assert.equal(
    deriveOrderStatusKey({ succeeded: true, order: { key: 'ocuat3941245310', status: 'processed' } }),
    'processed',
  );
});

test('returns unavailable for unsuccessful responses', () => {
  assert.equal(deriveOrderStatusKey({ succeeded: false }), 'unavailable');
});

test('keeps delivery-based shipped detection as a fallback', () => {
  assert.equal(
    deriveOrderStatusKey({ succeeded: true, order: { delivery: [{ shipped: '2026-01-01' }] } }),
    'shipped',
  );
});
