import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPromotionConditions,
  promotionScopeFromConditions,
  promotionScopeSummary,
} from '../../tools/commerce-admin/product-conditions.js';

const empty = {
  includedProducts: '',
  excludedProducts: '',
  includedCategories: '',
  excludedCategories: '',
  disqualifyingProducts: '',
  disqualifyingCategories: '',
};

test('builds every scope and disqualifier field', () => {
  const conditions = buildPromotionConditions({
    minimumSubtotal: 300,
    includedProducts: '/us/en_us/products/a, /us/en_us/products/b|SKU-1',
    excludedProducts: '/us/en_us/products/refurb',
    includedCategories: 'blenders, ',
    excludedCategories: 'parts',
    disqualifyingProducts: '/us/en_us/products/x',
    disqualifyingCategories: 'commercial',
  });
  assert.deepEqual(conditions, {
    minimumSubtotal: 300,
    includedProducts: [{ path: '/us/en_us/products/a' }, { path: '/us/en_us/products/b', sku: 'SKU-1' }],
    excludedProducts: [{ path: '/us/en_us/products/refurb' }],
    includedCategories: ['blenders'],
    excludedCategories: ['parts'],
    disqualifyingProducts: [{ path: '/us/en_us/products/x' }],
    disqualifyingCategories: ['commercial'],
  });
});

test('a scope field alone makes a promotion conditional without a minimum', () => {
  assert.deepEqual(
    buildPromotionConditions({ ...empty, minimumSubtotal: null, disqualifyingCategories: 'commercial' }),
    { disqualifyingCategories: ['commercial'] },
  );
});

test('no fields set returns undefined', () => {
  assert.equal(buildPromotionConditions({ ...empty, minimumSubtotal: 0 }), undefined);
  assert.equal(buildPromotionConditions({ ...empty }, { minimumSubtotal: 100, includedCategories: ['a'] }), undefined);
});

test('keeps unknown keys, drops cart-rule required fields and cleared fields', () => {
  const previous = {
    minimumSubtotal: 100,
    includedCategories: ['old'],
    requiredProducts: [{ path: '/us/en_us/products/a' }],
    requiredCategories: ['blenders'],
    futureKey: true,
  };
  assert.deepEqual(
    buildPromotionConditions({ ...empty, minimumSubtotal: 150 }, previous),
    { minimumSubtotal: 150, futureKey: true },
  );
  assert.deepEqual(previous.includedCategories, ['old']);
});

test('round trips through the form values', () => {
  const conditions = {
    minimumSubtotal: 50,
    includedProducts: ['/us/en_us/products/a', { path: '/us/en_us/products/b', sku: 'S' }],
    excludedCategories: ['parts'],
    disqualifyingCategories: ['commercial', 'refurb'],
  };
  const form = promotionScopeFromConditions(conditions);
  assert.deepEqual(form, {
    ...empty,
    includedProducts: '/us/en_us/products/a, /us/en_us/products/b|S',
    excludedCategories: 'parts',
    disqualifyingCategories: 'commercial, refurb',
  });
  assert.deepEqual(buildPromotionConditions({ ...form, minimumSubtotal: 50 }, conditions), {
    minimumSubtotal: 50,
    includedProducts: [{ path: '/us/en_us/products/a' }, { path: '/us/en_us/products/b', sku: 'S' }],
    excludedCategories: ['parts'],
    disqualifyingCategories: ['commercial', 'refurb'],
  });
});

test('summary lists scope and disqualifiers', () => {
  assert.equal(promotionScopeSummary({ minimumSubtotal: 10 }), '');
  assert.equal(promotionScopeSummary(undefined), '');
  assert.equal(
    promotionScopeSummary({
      includedCategories: ['blenders'],
      includedProducts: [{ path: '/us/en_us/products/a', sku: 'S' }],
      excludedProducts: ['/us/en_us/products/refurb'],
      disqualifyingCategories: ['commercial'],
    }),
    'only: blenders, a (S) · not: refurb · never with: commercial',
  );
});
