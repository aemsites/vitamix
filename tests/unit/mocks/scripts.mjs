import { getMetadata } from './aem.mjs';

/**
 * Minimal mock of scripts/scripts.js for unit tests.
 *
 * The real module bootstraps the page at import time, which crashes outside
 * a browser. Tests currently import modules that need `checkVariantOutOfStock`,
 * `getLocaleAndLanguage`, `getPdpOverride`, and `loggedFetch` from this module.
 */

let outOfStockSkus = new Set();
let locale = { locale: 'us', language: 'en_us' };

export function __setOutOfStockSkus(skus) {
  outOfStockSkus = new Set(skus);
}

export function __setLocale(value) {
  locale = { ...value };
}

export function __resetScripts() {
  outOfStockSkus = new Set();
  locale = { locale: 'us', language: 'en_us' };
}

export function checkVariantOutOfStock(sku) {
  return outOfStockSkus.has(sku);
}

/** Returns the authored PDP override from mocked page metadata. */
export function getPdpOverride(name) {
  return getMetadata(name);
}

/**
 * Mirrors the real getLocaleAndLanguage(forceEnCA, bcp47) shape so callers that
 * request the BCP-47 form (e.g. 'fr-CA') get the same conversion they would in
 * production. The backing value set via __setLocale uses the URL/underscore form
 * (e.g. { locale: 'ca', language: 'fr_ca' }).
 */
export function getLocaleAndLanguage(forceEnCA = false, bcp47 = false) {
  const { locale: loc } = locale;
  let { language } = locale;
  if (forceEnCA && loc === 'ca' && language === 'en_us') {
    language = 'en_ca';
  }
  if (bcp47) {
    language = language.replace('_', '-').replace(/-([a-z]{2})$/, (_, r) => `-${r.toUpperCase()}`);
  }
  return { locale: loc, language };
}

export async function loggedFetch(...args) {
  return fetch(...args);
}

export const FORMS_ENDPOINT = 'https://forms.example.test';

export const isProdHost = false;
