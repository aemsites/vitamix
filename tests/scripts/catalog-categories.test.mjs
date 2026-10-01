import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogCategoriesTsv,
  categoryPreviewRows,
  parseCategoriesTsv,
  withCategories,
} from '../../tools/commerce-admin/commerce-catalog-io.js';

const path = '/us/en_us/products/commercial/blender';
const product = {
  path,
  urlKey: 'blender',
  name: 'Blender',
  custom: {
    warranty: '10 years',
    categories: [{ url_key: 'blenders', name: 'Blenders', id: 42 }],
  },
};

test('category TSV round trips nested product paths and empty categories', () => {
  const tsv = catalogCategoriesTsv([product, { path: '/us/en_us/products/empty' }]);
  assert.equal(tsv, 'Slug\tCategories\nblender\tBlenders\nempty\t\n');
  assert.deepEqual(parseCategoriesTsv(tsv), [
    { slug: 'blender', categories: ['Blenders'] },
    { slug: 'empty', categories: [] },
  ]);
});

test('category TSV rejects malformed and duplicate entries', () => {
  assert.throws(() => parseCategoriesTsv('Product\tCategories\nblender\tblenders'), /must start/);
  assert.throws(() => parseCategoriesTsv('Slug\tCategories\nblender\ta\tblenders'), /Row 2/);
  assert.throws(() => parseCategoriesTsv('Slug\tCategories\nblender\tBlenders, blenders'), /duplicate category/);
  assert.throws(() => parseCategoriesTsv('Slug\tCategories\nblender\ta\nblender\tb'), /duplicate slug/);
});

test('preview resolves real paths and excludes missing, ambiguous and unchanged rows', () => {
  const byPath = new Map([
    [path, product],
    ['/us/en_us/products/duplicate', { path: '/us/en_us/products/duplicate' }],
    ['/us/en_us/products/commercial/duplicate', { path: '/us/en_us/products/commercial/duplicate' }],
  ]);
  const rows = categoryPreviewRows(parseCategoriesTsv(
    'Slug\tCategories\nblender\tBlenders\nmissing\ta\nduplicate\ta\nblender-other\ta',
  ), byPath);
  assert.deepEqual(rows.map((row) => row.kind), ['same', 'missing', 'ambiguous', 'missing']);
  const changed = categoryPreviewRows([{ slug: 'blender', categories: [] }], byPath);
  assert.equal(changed[0].kind, 'update');
  assert.equal(changed[0].path, path);
});

test('category updates retain other product fields and known category metadata', () => {
  const updated = withCategories(product, ['blenders', 'Fresh & Easy']);
  assert.equal(updated.name, 'Blender');
  assert.equal(updated.custom.warranty, '10 years');
  assert.deepEqual(updated.custom.categories, [
    product.custom.categories[0],
    { url_key: 'fresh-easy', name: 'Fresh & Easy' },
  ]);
  assert.deepEqual(product.custom.categories, [{ url_key: 'blenders', name: 'Blenders', id: 42 }]);
  assert.deepEqual(withCategories(product, []).custom.categories, []);
});

test('import reuses named categories and their slugs from other products', () => {
  const borrowed = { url_key: 'tools-and-parts', name: 'Tools & Accessories', id: 7 };
  const byPath = new Map([
    [path, product],
    ['/us/en_us/products/other', {
      path: '/us/en_us/products/other',
      custom: { categories: [borrowed] },
    }],
  ]);
  const [row] = categoryPreviewRows(parseCategoriesTsv(
    'Slug\tCategories\nblender\tBlenders, Tools & Accessories',
  ), byPath);
  assert.equal(row.kind, 'update');
  assert.deepEqual(row.after, ['Blenders', 'Tools & Accessories']);
  const updated = withCategories(product, row.categories, new Map([
    ['tools & accessories', borrowed],
  ]));
  assert.deepEqual(updated.custom.categories, [product.custom.categories[0], borrowed]);
});
