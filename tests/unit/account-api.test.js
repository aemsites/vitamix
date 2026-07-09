import { test } from 'node:test';
import assert from 'node:assert/strict';

import sortAccountOrdersNewestFirst from '../../widgets/account/order-sort.js';

test('sortAccountOrdersNewestFirst sorts customer orders newest to oldest', () => {
  const orders = [
    { id: 'old', createdAt: '2025-01-01T00:00:00.000Z' },
    { id: 'new', createdAt: '2025-03-01T00:00:00.000Z' },
    { id: 'middle', createdAt: '2025-02-01T00:00:00.000Z' },
  ];

  const sorted = sortAccountOrdersNewestFirst(orders);

  assert.deepEqual(sorted.map((order) => order.id), ['new', 'middle', 'old']);
  assert.deepEqual(orders.map((order) => order.id), ['old', 'new', 'middle']);
});

test('sortAccountOrdersNewestFirst falls back to timestamp-prefixed order ids', () => {
  const orders = [
    { id: '2025-01-01T00-00-00.000Z-OLD' },
    { id: '2025-03-01T00-00-00.000Z-NEW' },
    { orderId: '2025-02-01T00-00-00.000Z-MIDDLE' },
  ];

  const sorted = sortAccountOrdersNewestFirst(orders);

  assert.deepEqual(sorted.map((order) => order.id || order.orderId), [
    '2025-03-01T00-00-00.000Z-NEW',
    '2025-02-01T00-00-00.000Z-MIDDLE',
    '2025-01-01T00-00-00.000Z-OLD',
  ]);
});
