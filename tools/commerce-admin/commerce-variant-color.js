/**
 * Color ↔ variant-SKU resolution for promotions.
 *
 * The admin shows color variants the storefront way — a product URL with a `?color=<slug>`
 * query param (see `blocks/pdp/options.js`). The commerce API instead identifies a variant by
 * its **SKU** (`CatalogPriceRule.variants` is keyed by sku; see helix-commerce-api
 * `src/schemas/PriceRules.js`). This module maps between the two using the catalog products
 * index, whose variant rows carry `{ sku, parentSku, color }`.
 *
 * The `?color=` slug matches the storefront swatch value: `toClassName(variant.color)`.
 */

import {
  fetchProductsIndexForLocale,
  getParentProducts,
  getVariantProducts,
  getUrlKeyFromProduct,
} from './pim.js';

/**
 * Storefront color slug from a human color value, e.g. `"Very Berry"` → `"very-berry"`.
 * Mirrors `toClassName` in `scripts/aem.js` (kept inline so this tool has no storefront import).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function colorSlugFromValue(value) {
  return typeof value === 'string'
    ? value
      .toLowerCase()
      .replace(/[^0-9a-z]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    : '';
}

/** url_key (last path segment) from a storefront product URL or catalog path. */
function urlKeyFromProductRef(ref) {
  const s = String(ref || '').trim();
  if (!s) return '';
  let pathname = s;
  try {
    pathname = new URL(s).pathname;
  } catch {
    // already a path
  }
  const marker = '/products/';
  const i = pathname.indexOf(marker);
  const tail = i === -1 ? pathname : pathname.slice(i + marker.length);
  return tail.replace(/\/+$/, '').split('/').filter(Boolean).pop() || '';
}

/**
 * @typedef {object} VariantColorMaps
 * @property {(productRef: string, colorSlug: string) => string} skuForColor
 *   Variant SKU for a product (URL or path) + color slug, or '' when unknown.
 * @property {(sku: string) => string} colorSlugForSku Color slug for a variant SKU, or ''.
 * @property {(productRef: string) => boolean} productExists
 *   True when the product (URL or path) resolves to a parent in the catalog index.
 * @property {(productRef: string) => boolean} hasVariants
 *   True when the product has at least one color variant in the index.
 */

async function buildMapsUncached(locale) {
  const json = await fetchProductsIndexForLocale(locale);
  const raw = Array.isArray(json) ? json : (json?.data ?? []);
  const data = Array.isArray(raw) ? raw : [];

  // parent url_keys (existence check) and parent sku -> url_key (variant rows only carry parentSku)
  const parentUrlKeys = new Set();
  const urlKeyByParentSku = new Map();
  getParentProducts(data).forEach((p) => {
    const urlKey = String(getUrlKeyFromProduct(p) || '').toLowerCase();
    if (!urlKey) return;
    parentUrlKeys.add(urlKey);
    if (p.sku) urlKeyByParentSku.set(String(p.sku), urlKey);
  });

  /** `${urlKey}\0${colorSlug}` -> variant sku */
  const skuByUrlKeyColor = new Map();
  /** variant sku -> color slug */
  const colorSlugBySku = new Map();
  /** url_keys that have at least one color variant */
  const urlKeysWithVariants = new Set();
  getVariantProducts(data).forEach((v) => {
    const slug = colorSlugFromValue(v.color);
    if (!slug) return;
    colorSlugBySku.set(String(v.sku), slug);
    const urlKey = urlKeyByParentSku.get(String(v.parentSku))
      || String(getUrlKeyFromProduct(v) || '').toLowerCase();
    if (urlKey) {
      skuByUrlKeyColor.set(`${urlKey}\0${slug}`, String(v.sku));
      urlKeysWithVariants.add(urlKey);
    }
  });

  return {
    skuForColor(productRef, colorSlug) {
      const urlKey = urlKeyFromProductRef(productRef);
      if (!urlKey || !colorSlug) return '';
      return skuByUrlKeyColor.get(`${urlKey.toLowerCase()}\0${colorSlug}`) || '';
    },
    colorSlugForSku(sku) {
      return colorSlugBySku.get(String(sku)) || '';
    },
    productExists(productRef) {
      const urlKey = urlKeyFromProductRef(productRef);
      return Boolean(urlKey) && parentUrlKeys.has(urlKey.toLowerCase());
    },
    hasVariants(productRef) {
      const urlKey = urlKeyFromProductRef(productRef);
      return Boolean(urlKey) && urlKeysWithVariants.has(urlKey.toLowerCase());
    },
  };
}

/** locale -> in-flight/resolved maps (validation + hydration hit the same index repeatedly). */
const localeMapsCache = new Map();

/**
 * Build color↔SKU + existence lookups for one locale from its products index. Cached per locale
 * for the page session; a failed fetch is evicted so a later call can retry.
 *
 * @param {string} locale e.g. `us/en_us`
 * @param {{ cache?: boolean }} [opts] set `cache:false` to force a fresh fetch
 * @returns {Promise<VariantColorMaps>}
 */
export function buildVariantColorMapsForLocale(locale, opts = {}) {
  const key = String(locale || '');
  if (opts.cache === false) localeMapsCache.delete(key);
  if (localeMapsCache.has(key)) return localeMapsCache.get(key);
  const promise = buildMapsUncached(key);
  promise.catch(() => {
    if (localeMapsCache.get(key) === promise) localeMapsCache.delete(key);
  });
  localeMapsCache.set(key, promise);
  return promise;
}
