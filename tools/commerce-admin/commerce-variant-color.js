/**
 * Color ↔ variant-SKU resolution for promotions.
 *
 * The admin shows color variants the storefront way — a product URL with a `?color=<slug>`
 * query param (see `blocks/pdp/options.js`). The commerce API instead identifies a variant by
 * its **SKU** (`CatalogPriceRule.variants` is keyed by sku; see helix-commerce-api
 * `src/schemas/PriceRules.js`). This module maps between the two using ProductBus product records.
 *
 * The `?color=` slug matches the storefront swatch value: `toClassName(variant.color)`.
 */

import { fetchCatalogProduct } from './commerce-catalog-io.js';

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

function catalogPathFromProductRef(ref) {
  const s = String(ref || '').trim();
  if (!s) return '';
  try {
    return new URL(s).pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return s.split(/[?#]/, 1)[0].replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * @typedef {object} VariantColorMaps
 * @property {(productRef: string, colorSlug: string) => string} skuForColor
 *   Variant SKU for a product (URL or path) + color slug, or '' when unknown.
 * @property {(sku: string, productRef: string) => string} colorSlugForSku Color slug for a variant
 *   SKU, or ''.
 * @property {(productRef: string) => boolean} productExists
 *   True when the product (URL or path) resolves to a ProductBus product record.
 * @property {(productRef: string) => boolean} hasVariants
 *   True when the product has at least one color variant.
 */

/** ProductBus product fetches shared by validation and row hydration during this page session. */
const productCache = new Map();

/**
 * Build color↔SKU + existence lookups from the ProductBus records for the supplied products.
 * Each product record is cached for the page session; a failed fetch is evicted so a later call
 * can retry.
 *
 * @param {string[]} productRefs storefront product URLs or catalog paths
 * @returns {Promise<VariantColorMaps>}
 */
export async function buildVariantColorMapsForProducts(productRefs) {
  const paths = [...new Set((productRefs || []).map(catalogPathFromProductRef).filter(Boolean))];
  const products = await Promise.all(paths.map((path) => {
    if (productCache.has(path)) return productCache.get(path);
    const request = fetchCatalogProduct(path);
    request.catch(() => {
      if (productCache.get(path) === request) productCache.delete(path);
    });
    productCache.set(path, request);
    return request;
  }));
  const productsByPath = new Map(paths.map((path, i) => [path, products[i]]));
  /** `${path}\0${colorSlug}` -> variant SKU */
  const skuByPathColor = new Map();
  /** `${path}\0${sku}` -> color slug */
  const colorSlugByPathSku = new Map();
  const pathsWithVariants = new Set();

  productsByPath.forEach((product, path) => {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    variants.forEach((variant) => {
      const color = variant.options?.find((option) => option.id === 'color')?.value || variant.color;
      const slug = colorSlugFromValue(color);
      if (!slug || !variant.sku) return;
      const sku = String(variant.sku);
      skuByPathColor.set(`${path}\0${slug}`, sku);
      colorSlugByPathSku.set(`${path}\0${sku}`, slug);
      pathsWithVariants.add(path);
    });
  });

  return {
    skuForColor(productRef, colorSlug) {
      const path = catalogPathFromProductRef(productRef);
      if (!path || !colorSlug) return '';
      return skuByPathColor.get(`${path}\0${colorSlug}`) || '';
    },
    colorSlugForSku(sku, productRef) {
      const path = catalogPathFromProductRef(productRef);
      if (!path || !sku) return '';
      return colorSlugByPathSku.get(`${path}\0${sku}`) || '';
    },
    productExists(productRef) {
      return Boolean(productsByPath.get(catalogPathFromProductRef(productRef)));
    },
    hasVariants(productRef) {
      return pathsWithVariants.has(catalogPathFromProductRef(productRef));
    },
  };
}
