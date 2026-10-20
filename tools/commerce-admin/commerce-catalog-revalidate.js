/* eslint-disable no-console -- authoring index convergence diagnostics */
/* eslint-disable import/prefer-default-export -- single revalidation API */
/* eslint-disable no-restricted-syntax -- sequential direct reads bound ProductBus load */
import {
  apiFetch, getApiEnvironment, PRODUCTION_API_BASE, STAGE_API_BASE,
} from './commerce-otp-api.js';
import { PB_ORG, PB_SITE } from './commerce-pbus-config.js';
import { pendingCatalogKey, readPendingCatalog } from './commerce-catalog-pending.js';

function indexRows(product, path) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const categories = product.custom?.categories || [];
  const priceFields = (item) => ({
    price: item.price?.final ?? '',
    regularPrice: item.price?.regular ?? '',
    currency: item.price?.currency ?? '',
    image: item.images?.[0]?.url ?? '',
    availability: item.availability ?? '',
  });
  const parent = {
    path,
    sku: product.sku,
    url: product.url || '',
    urlKey: product.urlKey || path.split('/').pop(),
    title: product.name || '',
    ...priceFields(product),
    description: product.metaDescription || '',
    categories: categories.map((category) => category.name).join(','),
    categoriesUrlKey: categories.map((category) => category.url_key || category.urlKey).join(','),
    series: product.custom?.collection || '',
    collections: product.custom?.productCollections || '',
    productType: product.custom?.catalogProductType || '',
    visibility: product.custom?.visibility || '',
    ratingValue: product.aggregateRating?.ratingValue || '',
    reviewCount: product.aggregateRating?.reviewCount || '',
    variantSkus: variants.map((variant) => variant.sku).join(','),
  };
  return [parent, ...variants.map((variant) => ({
    path,
    parentSku: product.sku,
    sku: variant.sku,
    url: variant.url || product.url || '',
    title: variant.name || '',
    ...priceFields(variant),
    color: variant.options?.find((option) => option.id === 'color')?.value || '',
  }))];
}

function sameRows(indexed, direct) {
  if (indexed.length !== direct.length) return false;
  return direct.every((row) => {
    const match = indexed.find((item) => item.sku === row.sku
      && Boolean(item.parentSku) === Boolean(row.parentSku));
    return match && Object.entries(row).every(([key, value]) => {
      if (key === 'path') return true;
      const actual = match[key] ?? '';
      if (key === 'price' || key === 'regularPrice') {
        return String(actual) === String(value)
          || (actual !== '' && value !== '' && Number(actual) === Number(value));
      }
      return String(actual) === String(value);
    });
  });
}

/** Patch only this session's modified products, retaining them until the index agrees. */
export async function revalidateCatalogIndex(rows, locale) {
  const base = getApiEnvironment() === 'prod' ? PRODUCTION_API_BASE : STAGE_API_BASE;
  const key = pendingCatalogKey(base, PB_ORG, PB_SITE);
  const pending = readPendingCatalog(key);
  const paths = Object.keys(pending).filter((path) => path.startsWith(`/${locale}/`));
  let patched = rows;
  // Keep direct reads bounded rather than fanning out an entire bulk import.
  /* eslint-disable no-await-in-loop */
  for (const path of paths) {
    const updatedAt = pending[path];
    const ageSeconds = Math.round((Date.now() - updatedAt) / 1000);
    console.info('[commerce-admin] Revalidating catalog index', { path, ageSeconds, base });
    try {
      const response = await apiFetch(PB_ORG, PB_SITE, `catalog${path}.json?_=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`ProductBus HTTP ${response.status}`);
      }
      const product = response.status === 404 ? null : await response.json();
      if (product && (!product.sku || !product.name)) {
        throw new Error('Invalid ProductBus product response');
      }
      const direct = product ? indexRows(product, path) : [];
      const indexed = rows.filter((row) => row.path === path);
      const caughtUp = sameRows(indexed, direct);
      const latest = readPendingCatalog(key);
      if (caughtUp && latest[path] === updatedAt) {
        delete latest[path];
        sessionStorage.setItem(key, JSON.stringify(latest));
      }
      patched = patched.filter((row) => row.path !== path);
      patched.push(...direct.map((row) => ({
        ...indexed.find((item) => item.sku === row.sku), ...row,
      })));
      console.info('[commerce-admin] Catalog index revalidated', {
        path, ageSeconds, caughtUp, status: caughtUp ? 'removed from revalidation' : 'still pending',
      });
    } catch (error) {
      console.error('[commerce-admin] Catalog index revalidation failed', { path, ageSeconds, error });
      throw new Error(`Could not revalidate ${path}: ${error.message}`);
    }
  }
  /* eslint-enable no-await-in-loop */
  return patched;
}
