import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getCompareSlug,
  getStoredCompareItems,
} from '../../scripts/compare-storage.js';

test('getCompareSlug accepts slugs, paths, and absolute URLs', () => {
  assert.equal(getCompareSlug('ascent-x5'), 'ascent-x5');
  assert.equal(getCompareSlug('/ca/fr_ca/products/Ascent-X5/'), 'ascent-x5');
  assert.equal(
    getCompareSlug('https://www.vitamix.com/us/en_us/products/ascent-x5?color=red#details'),
    'ascent-x5',
  );
});

test('legacy compare storage is deduplicated and migrated to slugs', () => {
  const storage = new Map();
  storage.set('vitamix-compare-products', JSON.stringify([
    '/us/en_us/products/ascent-x5',
    {
      url: 'https://www.vitamix.com/ca/fr_ca/products/ASCENT-X5/',
      title: 'Duplicate',
      image: '/duplicate.jpg',
    },
    {
      url: '/ca/fr_ca/products/propel-750',
      title: 'Propel 750',
      image: '/propel.jpg',
    },
  ]));
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
  };

  try {
    assert.deepEqual(getStoredCompareItems(), [
      { slug: 'ascent-x5', title: '', image: '' },
      { slug: 'propel-750', title: 'Propel 750', image: '/propel.jpg' },
    ]);
    assert.deepEqual(JSON.parse(storage.get('vitamix-compare-products')), [
      { slug: 'ascent-x5', title: '', image: '' },
      { slug: 'propel-750', title: 'Propel 750', image: '/propel.jpg' },
    ]);
  } finally {
    globalThis.window = originalWindow;
  }
});
