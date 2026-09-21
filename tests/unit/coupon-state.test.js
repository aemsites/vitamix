import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  getCoupons,
  setCoupons,
  addCoupon,
  setManualCoupon,
  removeCoupon,
  clearCoupons,
  getManualCoupon,
  getAutoCoupons,
  getCouponRequestFields,
  getStatusMessage,
} from '../../scripts/commerce/coupon-state.js';

beforeEach(() => globalThis.__resetTestState());

test('setCoupons de-duplicates case-insensitively, keeping the first occurrence', () => {
  const stored = setCoupons([
    { code: 'SAVE10', source: 'manual' },
    { code: 'save10', source: 'auto' },
  ]);
  assert.deepEqual(stored, [{ code: 'SAVE10', source: 'manual' }]);
});

test('setCoupons caps the list at 5 (order preserved)', () => {
  const stored = setCoupons(
    ['A', 'B', 'C', 'D', 'E', 'F'].map((code) => ({ code, source: 'manual' })),
  );
  assert.deepEqual(stored.map((c) => c.code), ['A', 'B', 'C', 'D', 'E']);
});

test('setCoupons drops blank codes and trims whitespace', () => {
  const stored = setCoupons([{ code: '  SAVE10 ' }, { code: '   ' }, { code: '' }]);
  assert.deepEqual(stored, [{ code: 'SAVE10', source: 'manual' }]);
});

test('getCoupons falls back to the legacy scalar keys when the array key is absent', () => {
  sessionStorage.setItem('checkout_coupon_code', 'IDME20');
  sessionStorage.setItem('checkout_coupon_source', 'auto');
  assert.deepEqual(getCoupons(), [{ code: 'IDME20', source: 'auto' }]);
});

test('setCoupons syncs the legacy scalars to the first entry', () => {
  setCoupons([{ code: 'IDME20', source: 'auto' }, { code: 'SAVE10', source: 'manual' }]);
  assert.equal(sessionStorage.getItem('checkout_coupon_code'), 'IDME20');
  assert.equal(sessionStorage.getItem('checkout_coupon_source'), 'auto');
});

test('a manual first entry clears the legacy source key', () => {
  setCoupons([{ code: 'SAVE10', source: 'manual' }]);
  assert.equal(sessionStorage.getItem('checkout_coupon_code'), 'SAVE10');
  assert.equal(sessionStorage.getItem('checkout_coupon_source'), null);
});

test('addCoupon appends in order and ignores duplicates', () => {
  addCoupon('IDME20', 'auto');
  addCoupon('SAVE10', 'manual');
  addCoupon('idme20', 'manual');
  assert.deepEqual(getCoupons(), [
    { code: 'IDME20', source: 'auto' },
    { code: 'SAVE10', source: 'manual' },
  ]);
});

test('setManualCoupon replaces the manual entry but preserves auto coupons', () => {
  addCoupon('IDME20', 'auto');
  addCoupon('OLD', 'manual');
  setManualCoupon('NEW');
  assert.deepEqual(getCoupons(), [
    { code: 'IDME20', source: 'auto' },
    { code: 'NEW', source: 'manual' },
  ]);
  assert.equal(getManualCoupon(), 'NEW');
  assert.deepEqual(getAutoCoupons(), [{ code: 'IDME20', source: 'auto' }]);
});

test('setManualCoupon with an empty code clears only the manual entry', () => {
  addCoupon('IDME20', 'auto');
  addCoupon('SAVE10', 'manual');
  setManualCoupon('');
  assert.deepEqual(getCoupons(), [{ code: 'IDME20', source: 'auto' }]);
  assert.equal(getManualCoupon(), '');
});

test('removeCoupon removes case-insensitively', () => {
  setCoupons([{ code: 'IDME20', source: 'auto' }, { code: 'SAVE10', source: 'manual' }]);
  removeCoupon('save10');
  assert.deepEqual(getCoupons(), [{ code: 'IDME20', source: 'auto' }]);
});

test('clearCoupons wipes the array key and both legacy scalars', () => {
  setCoupons([{ code: 'IDME20', source: 'auto' }]);
  clearCoupons();
  assert.deepEqual(getCoupons(), []);
  assert.equal(sessionStorage.getItem('checkout_coupon_code'), null);
  assert.equal(sessionStorage.getItem('checkout_coupon_source'), null);
});

test('getCouponRequestFields: empty when no coupons', () => {
  assert.deepEqual(getCouponRequestFields(), {});
});

test('getCouponRequestFields: single manual coupon → scalar code, no source', () => {
  setManualCoupon('SAVE10');
  assert.deepEqual(getCouponRequestFields(), { couponCode: 'SAVE10' });
});

test('getCouponRequestFields: single auto coupon → scalar code + auto source', () => {
  addCoupon('IDME20', 'auto');
  assert.deepEqual(getCouponRequestFields(), { couponCode: 'IDME20', couponSource: 'auto' });
});

test('getCouponRequestFields: multiple coupons → index-aligned arrays', () => {
  addCoupon('IDME20', 'auto');
  addCoupon('SAVE10', 'manual');
  assert.deepEqual(getCouponRequestFields(), {
    couponCode: ['IDME20', 'SAVE10'],
    couponSource: ['auto', 'manual'],
  });
});

test('getStatusMessage maps rejected statuses and is empty for applied', () => {
  const strings = {
    couponRejectedInvalid: 'invalid',
    couponRejectedNotCombinable: 'not combinable',
  };
  assert.equal(getStatusMessage('rejected_invalid', strings), 'invalid');
  assert.equal(getStatusMessage('rejected_not_combinable', strings), 'not combinable');
  assert.equal(getStatusMessage('applied', strings), '');
});
