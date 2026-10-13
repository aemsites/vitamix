import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import lookupProductListProducts, { PLP_DATASETS } from '../../widgets/product-list/products.js';

const originalLocation = window.location;

beforeEach(() => {
  globalThis.__resetTestState();
  window.location = {
    pathname: '/widgets/product-list/product-list.html',
    hostname: 'www.vitamix.com',
    origin: 'https://www.vitamix.com',
  };
  delete window.productListWidgetIndexByDataset;

  const products = [
    { sku: 'simple', urlKey: 'simple', image: './simple.jpg', availability: 'OutOfStock' },
    { sku: 'variants', urlKey: 'variants', image: './variants.jpg' },
    { sku: 'black', parentSku: 'variants', color: 'Black', availability: 'OutOfStock' },
    { sku: 'red', parentSku: 'variants', color: 'Red', availability: 'OutOfStock' },
    { sku: 'mixed', urlKey: 'mixed', image: './mixed.jpg' },
    { sku: 'white', parentSku: 'mixed', color: 'White', availability: 'InStock' },
    { sku: 'gray', parentSku: 'mixed', color: 'Gray', availability: 'OutOfStock' },
    { sku: 'unknown', urlKey: 'unknown', image: './unknown.jpg' },
    { sku: 'no-image', urlKey: 'no-image', availability: 'InStock' },
    { sku: 'hidden', urlKey: 'hidden', image: './hidden.jpg', availability: 'InStock' },
    { sku: 'hidden-oos', urlKey: 'hidden-oos', image: './hidden-oos.jpg', availability: 'OutOfStock' },
  ];
  const rows = ['simple', 'variants', 'mixed', 'unknown', 'no-image', 'missing'].map((slug) => ({
    Product: `/us/en_us/products/${slug}`,
    'Type Facet': 'Blenders',
  }));
  rows[0].Status = '';
  rows[1].Status = 'published';
  rows.push({
    Product: '/us/en_us/products/hidden', Status: 'hidden', 'Type Facet': 'Hidden',
  });
  rows.push({
    Product: '/us/en_us/products/hidden-oos', Status: ' Hidden ', 'Type Facet': 'Blenders',
  });
  rows.push({
    Product: '/us/en_us/fragments/hidden-promo', Status: 'HIDDEN', 'Type Facet': 'Hidden',
  });
  rows.push({ Product: '/us/en_us/fragments/promo', 'Type Facet': 'Promotion' });
  rows.push({ Product: '' });

  globalThis.__setFetchMock(async (url) => {
    let data;
    switch (url) {
      case '/us/en_us/products/config/plp-data-blenders.json':
      case '/us/en_us/products/config/plp-data-accessories.json':
      case '/us/en_us/products/config/plp-data-commercial.json':
        data = rows;
        break;
      case '/us/en_us/products/config/reviews.json':
        data = [];
        break;
      case '/us/en_us/products/index.json?include=all':
      case '/us/en_us/products/commercial/index.json?include=all':
        data = products;
        break;
      default:
        throw new Error(`Unexpected fetch: ${url}`);
    }
    return { ok: true, json: async () => ({ data }) };
  });
});

afterEach(() => {
  window.location = originalLocation;
  delete window.productListWidgetIndexByDataset;
  globalThis.__resetTestState();
});

test('product list includes out-of-stock products and preserves variant availability', async () => {
  const products = await lookupProductListProducts();

  assert.deepEqual(products.map((product) => product.title), [
    'Simple', 'Variants', 'Mixed', 'Unknown', 'Promo',
  ]);
  assert.equal(products[0].availability, 'OutOfStock');
  assert.deepEqual(products[1].variants.map((variant) => variant.availability), [
    'OutOfStock', 'OutOfStock',
  ]);
  assert.deepEqual(products[2].variants.map((variant) => variant.availability), [
    'InStock', 'OutOfStock',
  ]);
  assert.equal(products[4].isMarketing, true);
});

test('out-of-stock products participate in facet counts and filtering, including cached lookups', async () => {
  const facets = { productType: {} };
  const products = await lookupProductListProducts({ productType: 'Blenders' }, facets);

  assert.equal(products.length, 4);
  assert.deepEqual(facets.productType, { Blenders: 4, Promotion: 1 });

  const cachedProducts = await lookupProductListProducts({ fulltext: 'variants' });
  assert.equal(cachedProducts.length, 1);
  assert.equal(cachedProducts[0].title, 'Variants');
});

PLP_DATASETS.forEach((dataset) => {
  test(`${dataset}: hidden rows are excluded from listings, facets, and cached searches`, async () => {
    const facets = { productType: {} };
    const products = await lookupProductListProducts({}, facets, dataset);

    assert.deepEqual(products.map((product) => product.title), [
      'Simple', 'Variants', 'Mixed', 'Unknown', 'Promo',
    ]);
    assert.deepEqual(facets.productType, { Blenders: 4, Promotion: 1 });

    const hiddenProducts = await lookupProductListProducts({ fulltext: 'hidden' }, {}, dataset);
    assert.deepEqual(hiddenProducts, []);
  });
});
