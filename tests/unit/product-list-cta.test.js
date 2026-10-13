import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import createProductCta from '../../widgets/product-list/product-cta.js';
import { createCallouts, getProductCallouts } from '../../scripts/plp-data.js';

const copyByLanguage = JSON.parse(readFileSync(
  new URL('../../widgets/product-list/product-list.json', import.meta.url),
  'utf8',
));
const originalCreateElement = document.createElement;

beforeEach(() => {
  document.createElement = (tagName) => ({
    tagName,
    children: [],
    appendChild(child) { this.children.push(child); },
  });
});

afterEach(() => {
  document.createElement = originalCreateElement;
});

const stockCases = [
  { name: 'unavailable simple product', product: { availability: 'OutOfStock' }, outOfStock: true },
  { name: 'unavailable product with no variants', product: { availability: 'OutOfStock', variants: [] }, outOfStock: true },
  {
    name: 'all variants unavailable',
    product: { availability: 'InStock', variants: [{ availability: 'OutOfStock' }, { availability: 'OutOfStock' }] },
    outOfStock: true,
  },
  { name: 'available simple product', product: { availability: 'InStock' }, outOfStock: false },
  {
    name: 'one variant available',
    product: { availability: 'OutOfStock', variants: [{ availability: 'OutOfStock' }, { availability: 'InStock' }] },
    outOfStock: false,
  },
  { name: 'missing availability', product: {}, outOfStock: false },
  {
    name: 'one variant with unknown availability',
    product: { variants: [{ availability: 'OutOfStock' }, {}] },
    outOfStock: false,
  },
];

const detailsLabels = { en: 'View Details', fr: 'Voir les détails', es: 'Ver detalles' };
const stockLabels = { en: 'Out of Stock', fr: 'En rupture de stock', es: 'Agotado' };

Object.entries(copyByLanguage).forEach(([language, copy]) => {
  stockCases.forEach(({ name, product, outOfStock }) => {
    test(`${language}: CTA for ${name}`, () => {
      assert.equal(copy.viewDetails, detailsLabels[language]);
      const url = '/us/en_us/products/blender';
      const cta = createProductCta({ ...product, url }, copy);
      const [link] = cta.children;

      assert.equal(cta.tagName, 'p');
      assert.equal(cta.className, 'product-list-widget-cta button-container');
      assert.equal(link.tagName, 'a');
      assert.equal(link.className, 'button link');
      assert.equal(link.href, url);
      assert.equal(link.textContent, outOfStock ? detailsLabels[language] : copy.shopNow);
    });

    test(`${language}: badges for ${name}`, () => {
      assert.equal(copy.outOfStock, stockLabels[language]);
      const badgedProduct = { ...product, badge: 'Best Seller', price: 100, regularPrice: 200 };
      const badges = createCallouts(badgedProduct, copy, { showOutOfStock: true });

      assert.equal(badges.className, 'product-badges');
      assert.deepEqual(
        badges.children.map((badge) => ({ text: badge.textContent, className: badge.className })),
        outOfStock
          ? [{ text: stockLabels[language], className: 'product-badge product-badge-tier-info product-badge-outOfStock' }]
          : [
            { text: copy.sale, className: 'product-badge product-badge-tier-alert product-badge-sale' },
            { text: copy.bestSeller, className: 'product-badge product-badge-tier-merch product-badge-bestseller' },
          ],
      );
    });
  });

  test(`${language}: out-of-stock product without other badges still gets one badge`, () => {
    assert.deepEqual(
      getProductCallouts({ availability: 'OutOfStock' }, copy, { showOutOfStock: true }),
      [{ type: 'outOfStock', label: stockLabels[language], tier: 'info' }],
    );
  });
});

test('shared callouts preserve existing behavior when the out-of-stock option is omitted', () => {
  assert.deepEqual(
    getProductCallouts({ availability: 'OutOfStock', badge: 'New' }, copyByLanguage.en),
    [{ type: 'new', label: copyByLanguage.en.new, tier: 'alert' }],
  );
});
