import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPromotionConditions,
  collapseProductPicksAcrossCatalogs,
  expandProductPicksAcrossCatalogs,
  promotionScopeFromConditions,
  promotionScopeSummary,
  primaryLanguagePicks,
  splitProductPicksByRegion,
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
    'only: blenders, US: a (S) · not: US: refurb · never with: commercial',
  );
});

test('groups product picks by region and keeps others aside', () => {
  assert.deepEqual(
    splitProductPicksByRegion('/us/en_us/products/a, /ca/en_us/products/b|S, /ca/fr_ca/products/b-fr, /mx/en_us/products/c', ['us', 'ca']),
    {
      us: '/us/en_us/products/a',
      ca: '/ca/en_us/products/b|S, /ca/fr_ca/products/b-fr',
      other: '/mx/en_us/products/c',
    },
  );
  assert.deepEqual(splitProductPicksByRegion('', ['us', 'ca']), { us: '', ca: '', other: '' });
});

test('hides French copies only when the region has English picks', () => {
  assert.deepEqual(
    primaryLanguagePicks([{ path: '/ca/en_us/products/a' }, { path: '/ca/fr_ca/products/a-fr' }, '/us/en_us/products/x']),
    [{ path: '/ca/en_us/products/a' }, '/us/en_us/products/x'],
  );
  assert.deepEqual(primaryLanguagePicks(['/ca/fr_ca/products/a-fr']), ['/ca/fr_ca/products/a-fr']);
});

const catalog = (entries) => {
  const pathsBySku = new Map();
  entries.forEach(([path, sku]) => pathsBySku.set(sku, [...(pathsBySku.get(sku) || []), path]));
  return { pathsBySku, skuByPath: new Map(entries) };
};
const en = catalog([['/ca/en_us/products/a', 'A'], ['/ca/en_us/products/b', 'B']]);
const fr = catalog([['/ca/fr_ca/products/a-fr', 'A'], ['/ca/fr_ca/products/c-fr', 'C']]);

test('expands product picks to every catalog by parent sku', () => {
  assert.equal(
    expandProductPicksAcrossCatalogs('/ca/en_us/products/a|A-RED, /ca/en_us/products/b, /ca/en_us/products/x', [en, fr]),
    '/ca/en_us/products/a|A-RED, /ca/fr_ca/products/a-fr|A-RED, /ca/en_us/products/b, /ca/en_us/products/x',
  );
  assert.equal(
    expandProductPicksAcrossCatalogs('/ca/en_us/products/a, /ca/fr_ca/products/a-fr', [en, fr]),
    '/ca/en_us/products/a, /ca/fr_ca/products/a-fr',
  );
});

test('collapses expanded picks and keeps picks only in another catalog', () => {
  assert.equal(
    collapseProductPicksAcrossCatalogs(
      '/ca/en_us/products/a|A-RED, /ca/fr_ca/products/a-fr|A-RED, /ca/fr_ca/products/a-fr, /ca/fr_ca/products/c-fr',
      [en, fr],
    ),
    '/ca/en_us/products/a|A-RED, /ca/fr_ca/products/a-fr, /ca/fr_ca/products/c-fr',
  );
});

test('summary lists a product once across languages', () => {
  assert.equal(
    promotionScopeSummary({ disqualifyingProducts: ['/ca/en_us/products/a', '/ca/fr_ca/products/a-fr', '/us/en_us/products/a'] }),
    'never with: CA: a, US: a',
  );
});

test('a sku under several paths matches the same url key and adds nothing in its own catalog', () => {
  const enDup = catalog([['/ca/en_us/products/jar-1', 'J'], ['/ca/en_us/products/jar-2806', 'J']]);
  const frDup = catalog([['/ca/fr_ca/products/jar-1', 'J'], ['/ca/fr_ca/products/jar-2806', 'J']]);
  const frOther = catalog([['/ca/fr_ca/products/pot-1', 'J'], ['/ca/fr_ca/products/pot-2', 'J']]);
  assert.equal(
    expandProductPicksAcrossCatalogs('/ca/en_us/products/jar-2806', [enDup, frDup]),
    '/ca/en_us/products/jar-2806, /ca/fr_ca/products/jar-2806',
  );
  assert.equal(
    expandProductPicksAcrossCatalogs('/ca/en_us/products/jar-2806', [enDup, frOther]),
    '/ca/en_us/products/jar-2806, /ca/fr_ca/products/pot-1, /ca/fr_ca/products/pot-2',
  );
  assert.equal(
    collapseProductPicksAcrossCatalogs('/ca/en_us/products/jar-2806, /ca/fr_ca/products/jar-2806', [enDup, frDup]),
    '/ca/en_us/products/jar-2806',
  );
  assert.equal(
    collapseProductPicksAcrossCatalogs('/ca/en_us/products/jar-2806, /ca/fr_ca/products/jar-1', [enDup, frDup]),
    '/ca/en_us/products/jar-2806, /ca/fr_ca/products/jar-1',
  );
});
