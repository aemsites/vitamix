import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectCouponGroups,
  couponGroupsOf,
  normalizeCouponGroups,
} from '../../tools/commerce-admin/coupon-groups-field.js';

test('normalizeCouponGroups trims, dedupes, drops blanks and keeps case and order', () => {
  assert.deepEqual(
    normalizeCouponGroups([' affiliate ', 'Affiliate', 'affiliate', '', '   ', 'employee', 3, null]),
    ['affiliate', 'Affiliate', 'employee'],
  );
});

test('normalizeCouponGroups returns [] for non-arrays', () => {
  assert.deepEqual(normalizeCouponGroups(undefined), []);
  assert.deepEqual(normalizeCouponGroups(null), []);
  assert.deepEqual(normalizeCouponGroups('affiliate'), []);
  assert.deepEqual(normalizeCouponGroups({ 0: 'a' }), []);
});

test('collectCouponGroups returns distinct sorted groups and skips types without groups', () => {
  const types = [
    { id: 'us-2026-a', groups: ['partner', 'affiliate'] },
    { id: 'us-2026-b' },
    { id: 'ca-2026-c', groups: ['Affiliate', ' partner ', 'b2b'] },
    { id: 'mx-2026-d', groups: null },
    null,
  ];
  assert.deepEqual(collectCouponGroups(types), ['Affiliate', 'affiliate', 'b2b', 'partner']);
  assert.deepEqual(collectCouponGroups(undefined), []);
});

test('couponGroupsOf reads old types as []', () => {
  assert.deepEqual(couponGroupsOf({ id: 'x' }), []);
  assert.deepEqual(couponGroupsOf({ id: 'x', groups: [' vip '] }), ['vip']);
});
