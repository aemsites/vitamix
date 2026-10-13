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
  setAffiliateCode,
  getAffiliateCode,
  clearAffiliateCode,
  isAffiliateCode,
  updateAffiliateStatus,
  isAffiliateIneligible,
  getCouponErrorCode,
} from '../../scripts/commerce/coupon-state.js';

beforeEach(() => {
  globalThis.__resetTestState();
  clearAffiliateCode();
});

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

test('the affiliate coupon stays in the list when coupons are cleared or removed', () => {
  addCoupon('06-AFFILIATE', 'auto');
  setAffiliateCode(' 06-AFFILIATE ');
  clearCoupons();
  assert.deepEqual(getCoupons(), [{ code: '06-AFFILIATE', source: 'auto' }]);
  removeCoupon('06-AFFILIATE');
  assert.deepEqual(getCoupons(), [{ code: '06-AFFILIATE', source: 'auto' }]);
  clearAffiliateCode();
  assert.equal(getAffiliateCode(), '');
  assert.deepEqual(getCoupons(), []);
});

test('setAffiliateCode ignores blank codes', () => {
  setAffiliateCode('06-FIRST');
  setAffiliateCode('  ');
  assert.equal(getAffiliateCode(), '06-FIRST');
});

test('getCouponErrorCode maps API error codes to coupon rejection codes', () => {
  assert.equal(
    getCouponErrorCode({ body: { code: 'ADOBE_COMMERCE_COUPON_PRODUCT_NOT_ELIGIBLE' }, errorHeader: 'coupon not applicable' }),
    'coupon_product_not_eligible',
  );
  assert.equal(getCouponErrorCode({ code: 'ADOBE_COMMERCE_COUPON_EXPIRED' }), 'coupon_expired');
  assert.equal(getCouponErrorCode({ errorHeader: 'coupon_not_found' }), 'coupon_not_found');
});

test('getCouponErrorCode returns null for non-coupon failures', () => {
  assert.equal(getCouponErrorCode(new Error('fetch failed')), null);
  assert.equal(getCouponErrorCode({ status: 500, body: { code: 'ADOBE_COMMERCE_INTERNAL' } }), null);
  assert.equal(getCouponErrorCode({ status: 401, body: { code: 'ADOBE_COMMERCE_UNAUTHORIZED' } }), null);
  assert.equal(getCouponErrorCode({ errorHeader: 'unauthorized' }), null);
  assert.equal(getCouponErrorCode(undefined), null);
  assert.equal(getCouponErrorCode({ name: 'AbortError', code: 20 }), null);
  assert.equal(getCouponErrorCode({ body: { code: 400 }, code: 'ADOBE_COMMERCE_COUPON_EXPIRED' }), 'coupon_expired');
});

test('isAffiliateCode compares normalized codes', () => {
  assert.equal(isAffiliateCode('06-AFF'), false);
  setAffiliateCode('06-aff');
  assert.equal(isAffiliateCode('06-AFF'), true);
  assert.equal(isAffiliateCode(' 06-aff '), true);
  assert.equal(isAffiliateCode('SAVE10'), false);
});

test('getCoupons adds the affiliate code as an auto coupon', () => {
  setCoupons([{ code: 'SAVE10', source: 'manual' }]);
  setAffiliateCode('06-AFF');
  assert.deepEqual(getCoupons(), [
    { code: 'SAVE10', source: 'manual' },
    { code: '06-AFF', source: 'auto' },
  ]);
  assert.deepEqual(getAutoCoupons(), [{ code: '06-AFF', source: 'auto' }]);
  assert.equal(getManualCoupon(), 'SAVE10');
});

test('getCoupons keeps the stored position of the affiliate code and marks it auto', () => {
  setCoupons([{ code: '06-aff', source: 'manual' }, { code: 'SAVE10', source: 'manual' }]);
  setAffiliateCode('06-AFF');
  assert.deepEqual(getCoupons(), [
    { code: '06-aff', source: 'auto' },
    { code: 'SAVE10', source: 'manual' },
  ]);
});

test('getCoupons keeps the affiliate code when the list is full', () => {
  setCoupons(['A1', 'A2', 'A3', 'A4', 'A5'].map((code) => ({ code, source: 'manual' })));
  setAffiliateCode('06-AFF');
  const coupons = getCoupons();
  assert.equal(coupons.length, 5);
  assert.deepEqual(coupons.at(-1), { code: '06-AFF', source: 'auto' });
});

test('getCouponRequestFields sends a lone affiliate coupon as an array', () => {
  setAffiliateCode('06-AFF');
  assert.deepEqual(getCouponRequestFields(), { couponCode: ['06-AFF'], couponSource: ['auto'] });
});

test('updateAffiliateStatus tracks whether the affiliate coupon applied', () => {
  setAffiliateCode('06-AFF');
  assert.equal(isAffiliateIneligible(), false);
  updateAffiliateStatus([{ code: '06-AFF', status: 'rejected_invalid' }]);
  assert.equal(isAffiliateIneligible(), true);
  updateAffiliateStatus([{ code: 'SAVE10', status: 'applied' }]);
  assert.equal(isAffiliateIneligible(), true);
  updateAffiliateStatus([{ code: '06-aff', status: 'applied' }]);
  assert.equal(isAffiliateIneligible(), false);
});

test('isAffiliateIneligible is false without an affiliate code', () => {
  setAffiliateCode('06-AFF');
  updateAffiliateStatus([{ code: '06-AFF', status: 'rejected_invalid' }]);
  clearAffiliateCode();
  assert.equal(isAffiliateIneligible(), false);
});
