import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

// scripts/scripts.js bootstraps the page at import time, so it cannot be imported in
// the Node test runner. Run the real checkout-mode block from the source instead.
const source = readFileSync(new URL('../../scripts/scripts.js', import.meta.url), 'utf8');
const settings = source.match(
  /^const STORE_LOCALES[\s\S]*?\nexport function isEdgeCheckoutOverrideEnabled\([\s\S]*?\n}\n/m,
);
const localeFn = source.match(
  /^export function getLocaleAndLanguage\([\s\S]*?\n}\n/m,
);
const block = source.match(
  /^export function isEdgeCheckoutEnabled\([\s\S]*?\nwindow\.useEdgeCheckout = isEdgeCheckoutEnabled\(\);\n/m,
);

/**
 * Evaluates the checkout-mode block for a URL and localStorage value.
 *
 * @param {string} url
 * @param {string|null} [stored] localStorage.edgeCheckout value
 * @param {boolean} [storageThrows]
 * @returns {boolean} window.useEdgeCheckout
 */
function evaluate(url, stored = null, storageThrows = false) {
  const { pathname, search } = new URL(url, 'https://example.com');
  const window = { location: { pathname, search } };
  const localStorage = {
    getItem: () => {
      if (storageThrows) throw new Error('SecurityError');
      return stored;
    },
  };
  const code = `${settings[0]}\n${localeFn[0]}\n${block[0]}`.replace(/^export /gm, '');
  runInNewContext(code, { window, localStorage, URLSearchParams });
  return window.useEdgeCheckout;
}

describe('scripts.js checkout mode', () => {
  it('finds the checkout-mode block in scripts.js', () => {
    assert.ok(settings, 'expected STORE_LOCALES … isEdgeCheckoutOverrideEnabled');
    assert.ok(localeFn, 'expected getLocaleAndLanguage in scripts.js');
    assert.ok(block, 'expected isEdgeCheckoutEnabled … window.useEdgeCheckout assignment');
  });

  it('defaults to Edge for US and CA, including legacy cart pages that embed the header', () => {
    [
      '/us/en_us/',
      '/us/en_us/products/a-product',
      '/us/en_us/checkout/cart/',
      '/ca/en_us/',
      '/ca/fr_ca/',
      '/',
    ].forEach((path) => assert.equal(evaluate(path), true, path));
  });

  it('keeps Magento for paths outside a store', () => {
    ['/drafts/someone/page', '/tools/embed-tester/example.html']
      .forEach((path) => assert.equal(evaluate(path), false, path));
    assert.equal(evaluate('/drafts/someone/page?cart=edge'), true);
  });

  it('keeps Magento for locales not yet migrated', () => {
    ['/mx/es_mx/', '/mx/en_us/', '/vr/en_us/']
      .forEach((path) => assert.equal(evaluate(path), false, path));
  });

  it('switches to Magento only with ?cart=magento', () => {
    assert.equal(evaluate('/us/en_us/?cart=magento'), false);
    assert.equal(evaluate('/us/en_us/?cart=edge'), true);
    assert.equal(evaluate('/mx/es_mx/?cart=edge'), true);
  });

  it('lets testers opt Magento locales in to Edge with localStorage', () => {
    assert.equal(evaluate('/mx/es_mx/', 'mx/es_mx, vr/en_us'), true);
    assert.equal(evaluate('/mx/en_us/', 'mx/es_mx'), false);
    assert.equal(evaluate('/mx/es_mx/?cart=magento', 'mx/es_mx'), false);
  });

  it('falls back to the locale default when localStorage is blocked', () => {
    assert.equal(evaluate('/us/en_us/', null, true), true);
    assert.equal(evaluate('/mx/es_mx/', null, true), false);
  });
});
