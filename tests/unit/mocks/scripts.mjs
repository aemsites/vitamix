/**
 * Minimal mock of scripts/scripts.js for unit tests.
 *
 * The real module bootstraps the page at import time, which crashes outside
 * a browser. add-to-cart.js only needs `checkVariantOutOfStock` and
 * `getLocaleAndLanguage` from this module.
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

export function getLocaleAndLanguage() {
  return locale;
}

export const isProdHost = false;
