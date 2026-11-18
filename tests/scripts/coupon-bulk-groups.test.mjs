import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCouponBulkGroupEdit,
  couponGroupCounts,
  couponSelectAllState,
  mapWithConcurrency,
  normalizeCouponBulkGroupEdit,
  parseCouponGroupList,
  planCouponBulkGroupEdit,
  sameCouponGroupSet,
  sharedCouponGroupSet,
} from '../../tools/commerce-admin/coupon-bulk-groups.js';

test('parseCouponGroupList splits on commas and new lines and normalizes', () => {
  assert.deepEqual(parseCouponGroupList(' a, b\nc,,  \r\nA , a '), ['a', 'b', 'c', 'A']);
  assert.deepEqual(parseCouponGroupList(''), []);
  assert.deepEqual(parseCouponGroupList(undefined), []);
});

test('sameCouponGroupSet ignores order and duplicates, is case-sensitive', () => {
  assert.equal(sameCouponGroupSet(['a', 'b'], ['b', 'a', 'a']), true);
  assert.equal(sameCouponGroupSet([], undefined), true);
  assert.equal(sameCouponGroupSet(['a'], ['A']), false);
  assert.equal(sameCouponGroupSet(['a'], ['a', 'b']), false);
});

test('sharedCouponGroupSet returns the set only when every row matches', () => {
  assert.deepEqual(sharedCouponGroupSet([
    { groups: ['x', 'y'] }, { groups: ['y', 'x', ' x '] },
  ]), ['x', 'y']);
  assert.deepEqual(sharedCouponGroupSet([{ id: 'a' }, { groups: [] }]), []);
  assert.equal(sharedCouponGroupSet([{ groups: ['x'] }, { groups: [] }]), null);
});

test('couponGroupCounts counts per group, most used first', () => {
  assert.deepEqual(couponGroupCounts([
    { groups: ['b', 'a'] }, { groups: ['a'] }, {}, { groups: ['c', 'b', 'a'] },
  ]), [{ group: 'a', count: 3 }, { group: 'b', count: 2 }, { group: 'c', count: 1 }]);
});

test('normalizeCouponBulkGroupEdit normalizes and flags add+remove conflicts', () => {
  const ok = normalizeCouponBulkGroupEdit({ add: [' a ', 'a', ''], remove: ['b'] });
  assert.equal(ok.error, '');
  assert.deepEqual(ok.edit, { replace: null, add: ['a'], remove: ['b'] });
  const bad = normalizeCouponBulkGroupEdit({ add: ['a', 'b'], remove: ['b ', 'c'] });
  assert.match(bad.error, /b/);
  assert.doesNotMatch(bad.error, /c/);
});

test('applyCouponBulkGroupEdit: replace, then add (appended), then remove', () => {
  assert.deepEqual(applyCouponBulkGroupEdit(['x', 'y'], { add: ['z', 'x'] }), ['x', 'y', 'z']);
  assert.deepEqual(applyCouponBulkGroupEdit(['x', 'y'], { remove: ['x', 'q'] }), ['y']);
  assert.deepEqual(applyCouponBulkGroupEdit(['x', 'y'], { replace: ['k'] }), ['k']);
  assert.deepEqual(
    applyCouponBulkGroupEdit(['x'], { replace: ['k', 'm'], add: ['n'], remove: ['m'] }),
    ['k', 'n'],
  );
  assert.deepEqual(applyCouponBulkGroupEdit([' x ', 'x'], {}), ['x']);
});

test('planCouponBulkGroupEdit lists changes and counts unchanged coupons', () => {
  const items = [
    { id: 'a', row: { groups: ['vip'] } },
    { id: 'b', row: { groups: ['sales-exclusions'] } },
    { id: 'c', row: {} },
  ];
  const plan = planCouponBulkGroupEdit(items, { add: ['sales-exclusions'] });
  assert.deepEqual(plan.changes, [
    { id: 'a', before: ['vip'], after: ['vip', 'sales-exclusions'] },
    { id: 'c', before: [], after: ['sales-exclusions'] },
  ]);
  assert.deepEqual(plan.unchanged, ['b']);
  assert.deepEqual(planCouponBulkGroupEdit(items, { remove: ['nope'] }).changes, []);
});

test('couponSelectAllState for visible rows', () => {
  assert.equal(couponSelectAllState(['a', 'b'], new Set(['a', 'b', 'z'])), 'checked');
  assert.equal(couponSelectAllState(['a', 'b'], new Set(['a'])), 'indeterminate');
  assert.equal(couponSelectAllState(['a', 'b'], new Set(['z'])), 'unchecked');
  assert.equal(couponSelectAllState([], new Set(['z'])), 'unchecked');
});

test('mapWithConcurrency caps in-flight calls and collects failures', async () => {
  let inFlight = 0;
  let max = 0;
  const progress = [];
  const results = await mapWithConcurrency(
    Array.from({ length: 12 }, (_, i) => i),
    5,
    async (i) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((r) => { setTimeout(r, 2); });
      inFlight -= 1;
      if (i === 3) throw new Error('boom');
      return i * 2;
    },
    (done) => progress.push(done),
  );
  assert.equal(max, 5);
  assert.equal(results.length, 12);
  assert.equal(results[3].ok, false);
  assert.equal(results[4].value, 8);
  assert.deepEqual(progress, Array.from({ length: 12 }, (_, i) => i + 1));
  assert.deepEqual(await mapWithConcurrency([], 5, async () => 1), []);
});
