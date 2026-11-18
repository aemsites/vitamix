import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCouponScope,
  couponScopeForMode,
  couponScopeMode,
  couponScopeOf,
  couponScopeSummary,
  couponTypeInMarket,
  describeCatalogSaveErrors,
  hasCouponScope,
  missingCouponTypeIds,
} from '../../tools/commerce-admin/promotion-coupon-scope.js';

const full = {
  includedCouponTypes: ['us-2026-vip'],
  excludedCouponTypes: ['us-2026-x'],
  includedCouponGroups: ['employee'],
  excludedCouponGroups: ['affiliate'],
};

test('each mode keeps only its lists', () => {
  assert.deepEqual(couponScopeForMode('all', full), couponScopeOf({}));
  assert.deepEqual(couponScopeForMode('block', full), {
    includedCouponTypes: [],
    excludedCouponTypes: ['us-2026-x'],
    includedCouponGroups: [],
    excludedCouponGroups: ['affiliate'],
  });
  assert.deepEqual(couponScopeForMode('allow', full), {
    includedCouponTypes: ['us-2026-vip'],
    excludedCouponTypes: [],
    includedCouponGroups: ['employee'],
    excludedCouponGroups: [],
  });
  assert.deepEqual(couponScopeForMode('advanced', full), full);
});

test('mode of a stored promotion', () => {
  assert.equal(couponScopeMode({}), 'all');
  assert.equal(couponScopeMode({ excludedCouponGroups: ['affiliate'] }), 'block');
  assert.equal(couponScopeMode({ includedCouponTypes: ['a'], includedCouponGroups: [] }), 'allow');
  assert.equal(couponScopeMode({ excludedCouponGroups: ['affiliate'], includedCouponTypes: ['x'] }), 'advanced');
  assert.equal(couponScopeMode({ excludedCouponTypes: ['  '] }), 'all');
});

test('apply writes non-empty lists, removes empty keys and keeps everything else', () => {
  const promo = {
    id: 'p',
    name: 'P',
    rules: [{ path: '/us/en_us/products/a', price: '1' }],
    excludedCouponTypes: ['old'],
    includedCouponGroups: ['gone'],
    futureKey: { kept: true },
  };
  const out = applyCouponScope(promo, { excludedCouponGroups: [' affiliate ', 'affiliate'] });
  assert.deepEqual(out, {
    id: 'p',
    name: 'P',
    rules: [{ path: '/us/en_us/products/a', price: '1' }],
    excludedCouponGroups: ['affiliate'],
    futureKey: { kept: true },
  });
  assert.deepEqual(promo.excludedCouponTypes, ['old']);
  assert.deepEqual(applyCouponScope({ id: 'p' }, {}), { id: 'p' });
});

test('advanced mix round-trips', () => {
  const promo = applyCouponScope({ id: 'p' }, full);
  assert.equal(couponScopeMode(promo), 'advanced');
  assert.deepEqual(applyCouponScope(promo, couponScopeForMode('advanced', couponScopeOf(promo))), promo);
});

test('summary', () => {
  assert.equal(couponScopeSummary({}), '');
  assert.equal(couponScopeSummary({ excludedCouponGroups: ['affiliate'] }), 'Coupons: blocks affiliate');
  assert.equal(couponScopeSummary({ includedCouponTypes: ['employee-vip'] }), 'Coupons: only employee-vip');
  assert.equal(
    couponScopeSummary({ excludedCouponGroups: ['affiliate'], includedCouponTypes: ['x'] }),
    'Coupons: blocks affiliate; allows x',
  );
  assert.equal(hasCouponScope({ includedCouponGroups: [] }), false);
});

test('market match: listed market or none set', () => {
  assert.equal(couponTypeInMarket({ country: 'us' }, 'us'), true);
  assert.equal(couponTypeInMarket({ country: 'ca' }, 'us'), false);
  assert.equal(couponTypeInMarket({ countries: ['ca', 'us'] }, 'us'), true);
  assert.equal(couponTypeInMarket({}, 'mx'), true);
});

test('missing type ids skip ones the target already stores', () => {
  const promo = { excludedCouponTypes: ['a', 'b'], includedCouponTypes: ['c'] };
  assert.deepEqual(missingCouponTypeIds(promo, ['a']), ['b', 'c']);
  assert.deepEqual(missingCouponTypeIds(promo, ['a'], { includedCouponTypes: ['c'] }), ['b']);
});

test('save errors name the promotion and field', () => {
  const promotions = [{ id: 'a', name: 'A' }, { id: 'spring', name: 'Spring sale' }];
  assert.deepEqual(describeCatalogSaveErrors([
    { path: '$.promotions[1].excludedCouponTypes', message: 'unknown coupon types: x, y' },
    { path: '$.promotions[0].includedCouponGroups', message: 'is not allowed on a conditional promotion' },
    { path: '$.promotions', message: 'must be an array' },
  ], promotions), [
    '"Spring sale": blocked coupon types: unknown coupon types: x, y',
    '"A": allowed coupon groups aren\'t allowed on a promotion with conditions',
    '$.promotions: must be an array',
  ]);
});
