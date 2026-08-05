import assert from 'node:assert/strict';
import { test } from 'node:test';
import deriveOrderStatusKey from '../../widgets/forms/order-status-state.js';

test('derives processed for a booked EBS order without deliveries', () => {
  assert.equal(
    deriveOrderStatusKey({ succeeded: true, order: { state: 'Booked' } }),
    'processed',
  );
});

test('maps EBS line-item statuses like Magento', () => {
  assert.equal(
    deriveOrderStatusKey({ succeeded: true, order: { lineItem: [{ status: 'Booked', quantity: '1' }] } }),
    'processed',
  );
  assert.equal(
    deriveOrderStatusKey({ succeeded: true, order: { lineItem: [{ status: 'Entered', quantity: '1' }] } }),
    'received',
  );
  assert.equal(
    deriveOrderStatusKey({ succeeded: true, order: { lineItem: [{ status: 'Closed', quantity: '1' }] } }),
    'shipped',
  );
});

test('keeps delivery-based shipped detection as a fallback', () => {
  assert.equal(
    deriveOrderStatusKey({ succeeded: true, order: { delivery: [{ shipped: '2026-01-01' }] } }),
    'shipped',
  );
});
