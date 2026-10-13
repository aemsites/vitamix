import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

// scripts/scripts.js bootstraps the page at import time, so it cannot be imported in
// the Node test runner (the loader swaps it for a mock). Run the real getLocaleAndLanguage
// and the real lines of loadEager that set the document language from the source.
const source = readFileSync(new URL('../../scripts/scripts.js', import.meta.url), 'utf8');
const getLocaleAndLanguage = source.match(/^export function getLocaleAndLanguage\([\s\S]*?\n\}\n/m);
const setLang = source.match(
  /async function loadEager[\s\S]*?\n( {2}const \{ locale, language \} = getLocaleAndLanguage\(\);[\s\S]*? {2}document\.documentElement\.lang = .*;)/,
);

/**
 * Evaluates the `lang` loadEager sets on the document for a path.
 *
 * @param {string} pathname
 * @returns {string}
 */
function htmlLang(pathname) {
  const window = { location: { pathname } };
  const document = { documentElement: {} };
  runInNewContext(
    `${getLocaleAndLanguage[0].replace(/^export function/m, 'function')}\n${setLang[1]}`,
    { window, document },
  );
  return document.documentElement.lang;
}

describe('document language', () => {
  it('is set in loadEager from the store path', () => {
    assert.ok(getLocaleAndLanguage, 'expected getLocaleAndLanguage in scripts/scripts.js');
    assert.ok(setLang, 'expected loadEager to set document.documentElement.lang');
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

  it('tags Mexican English (served from /mx/en_us) as en-MX, not en-US', () => {
    assert.equal(htmlLang('/mx/en_us/'), 'en-MX');
  });

  it('tags the VR English store (served from /vr/en_us) as en since VR is not a country', () => {
    assert.equal(htmlLang('/vr/en_us/'), 'en');
  });

  it('defaults to en-US when the path has no locale or language', () => {
    assert.equal(htmlLang('/'), 'en-US');
  });
});
