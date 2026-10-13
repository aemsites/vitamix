import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

// scripts/scripts.js bootstraps the page at import time, so it cannot be imported in
// the Node test runner (the loader swaps it for a mock). Run the real
// getLocaleAndLanguage from the source instead of relying on the mock's copy.
const source = readFileSync(new URL('../../scripts/scripts.js', import.meta.url), 'utf8');
const block = source.match(/^export function getLocaleAndLanguage\([\s\S]*?\n\}\n/m);

/**
 * Evaluates the value loadEager assigns to `document.documentElement.lang` for a path.
 *
 * @param {string} pathname
 * @returns {string}
 */
function htmlLang(pathname) {
  const window = { location: { pathname } };
  return runInNewContext(
    `${block[0].replace(/^export function/m, 'function')}
    getLocaleAndLanguage(true, true).language;`,
    { window },
  );
}

describe('document language', () => {
  it('is set in loadEager from the store path with the Canadian English remap and BCP 47 form', () => {
    assert.ok(block, 'expected getLocaleAndLanguage in scripts/scripts.js');
    assert.match(
      source,
      /document\.documentElement\.lang = getLocaleAndLanguage\(true, true\)\.language;/,
    );
  });

  it('tags the US English store as en-US', () => {
    assert.equal(htmlLang('/us/en_us/products/ascent-x5'), 'en-US');
  });

  it('tags Canadian English (served from /ca/en_us) as en-CA, not en-US', () => {
    assert.equal(htmlLang('/ca/en_us/products/ascent-x5'), 'en-CA');
  });

  it('tags Canadian French as fr-CA', () => {
    assert.equal(htmlLang('/ca/fr_ca/products/ascent-x5'), 'fr-CA');
  });

  it('tags Mexican Spanish as es-MX', () => {
    assert.equal(htmlLang('/mx/es_mx/products/ascent-x5'), 'es-MX');
  });

  it('defaults to en-US when the path has no locale or language', () => {
    assert.equal(htmlLang('/'), 'en-US');
  });
});
