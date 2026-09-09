import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const MAGENTO_LOADED_BLOCKS = [
  ['PDP add to cart', new URL('../../blocks/pdp/add-to-cart.js', import.meta.url)],
  ['header', new URL('../../blocks/header/header.js', import.meta.url)],
];

const EDGE_ONLY_SCRIPTS_IMPORT = /import\s*{[^}]*\bgetOrderPath\b[^}]*}\s*from\s*['"][^'"]*scripts\/scripts\.js['"]/s;

test('Magento-loaded blocks do not statically import Edge Checkout-only scripts helpers', async () => {
  await Promise.all(MAGENTO_LOADED_BLOCKS.map(async ([name, file]) => {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(
      source,
      EDGE_ONLY_SCRIPTS_IMPORT,
      `${name} must link against a browser-cached base scripts.js before Edge Checkout is selected`,
    );
  }));
});
