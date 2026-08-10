/* eslint-disable max-len */
import { getLocaleAndLanguage } from '../../scripts/scripts.js';
import { fetchReviewsData, getReviewsBySlug, slugFromUrl } from '../../scripts/product-badges.js';

// Column-name overrides for the label derived from a "* Facet" column in plp-data.json.
// Anything not listed here uses the column name with the trailing "Facet" stripped.
const FACET_LABEL_OVERRIDES = {
  'Type Facet': 'Product Type',
};

function buildProductsUrl(locale, language, path) {
  return `/${locale}/${language}/products/${path}`;
}

export const PLP_DATASETS = ['blenders', 'accessories', 'commercial'];
const DEFAULT_PLP_DATASET = 'blenders';

function normalizePlpDataset(dataset) {
  return PLP_DATASETS.includes(dataset) ? dataset : DEFAULT_PLP_DATASET;
}

/**
 * Locale and language for the widget. The pathname carries no real
 * locale/language segments when authoring (`/drafts/...`) or when the
 * widget is opened directly at its own `/widgets/...` URL, so both
 * cases default to `us`/`en_us`.
 * @returns {Object} Object with locale and language.
 */
export function getWidgetLocaleAndLanguage() {
  const { pathname } = window.location;
  if (pathname.startsWith('/drafts/') || pathname.startsWith('/widgets/')) {
    return { locale: 'us', language: 'en_us' };
  }
  return getLocaleAndLanguage();
}

function toCamelCase(label) {
  return label
    .trim()
    .split(/\s+/)
    .map((word, i) => (i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join('');
}

/**
 * Discovers facets dynamically from any plp-data.json column whose name ends in "Facet".
 * @param {Array<Object>} rows - Raw plp-data.json rows
 * @returns {Array<{rawKey: string, label: string, key: string}>}
 */
function getFacetDefsFromRows(rows) {
  const columns = new Set();
  rows.forEach((row) => Object.keys(row).forEach((key) => columns.add(key)));
  return [...columns]
    .filter((key) => /Facet$/i.test(key.trim()))
    .map((rawKey) => {
      const label = FACET_LABEL_OVERRIDES[rawKey] || rawKey.replace(/\s*Facet$/i, '').trim();
      return { rawKey, label, key: toCamelCase(label) };
    });
}

function parseFacetValues(value) {
  return value ? String(value).split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function parseIndexProduct(data, locale, language) {
  const parsed = {};
  Object.entries(data).forEach(([key, value]) => {
    switch (key) {
      case 'image':
        parsed[key] = value.startsWith('./') ? buildProductsUrl(locale, language, value.substring(2)) : value;
        break;
      case 'price':
      case 'regularPrice':
      case 'originalPrice':
        parsed[key] = parseFloat(value, 10);
        break;
      case 'variantSkus':
      case 'visibility':
        parsed[key] = value ? value.split(',').map((s) => s.trim()) : [];
        break;
      default:
        parsed[key] = typeof value === 'string' ? value.trim() : value;
        break;
    }
  });
  return parsed;
}

function titleFromUrl(pathname) {
  const slug = pathname.split('/').filter(Boolean).pop() || '';
  return slug.split('-').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

function pathnameFromUrl(rawUrl) {
  try {
    return new URL(rawUrl, window.location.origin).pathname;
  } catch {
    return rawUrl;
  }
}

/**
 * Fetches plp-data-{dataset}.json, the source of truth for which products are listed and
 * for every dynamically-discovered "* Facet" column.
 * @param {string} locale
 * @param {string} language
 * @param {string} dataset - One of PLP_DATASETS
 * @returns {Promise<Array<Object>>}
 */
async function fetchPlpData(locale, language, dataset) {
  const resp = await fetch(`/${locale}/${language}/products/config/plp-data-${dataset}.json`);
  if (!resp.ok) return [];
  const json = await resp.json();
  return Array.isArray(json.data) ? json.data : [];
}

/**
 * Fetches and filters products for the product-list widget.
 * Self-contained: does not depend on blocks/plp/plp.js.
 *
 * The product list and its facets come from plp-data-{dataset}.json; each row is augmented
 * with image/price/variants/etc. from products/index.json when a matching product is found there.
 * @param {Object} config - Filter criteria (only known facet keys are applied)
 * @param {Object} facets - Optional object to populate with facet counts
 * @param {string} [dataset] - Which plp-data-{dataset}.json to load; defaults to 'blenders'
 * @returns {Promise<Array<Object>>} Filtered products
 */
export default async function lookupProductListProducts(config = {}, facets = {}, dataset = DEFAULT_PLP_DATASET) {
  const { locale, language } = getWidgetLocaleAndLanguage();
  const plpDataset = normalizePlpDataset(dataset);

  window.productListWidgetIndexByDataset = window.productListWidgetIndexByDataset || {};
  if (!window.productListWidgetIndexByDataset[plpDataset]) {
    const [plpRows, reviewsRows] = await Promise.all([
      fetchPlpData(locale, language, plpDataset),
      fetchReviewsData(locale, language),
    ]);
    const facetDefs = getFacetDefsFromRows(plpRows);
    const reviewsBySlug = getReviewsBySlug(reviewsRows);

    const corsProxyFetch = async (url) => {
      const corsProxy = 'https://fcors.org/?url=';
      const corsKey = '&key=Mg23N96GgR8O3NjU';
      const fullUrl = `https://main--vitamix--aemsites.aem.network${url}`;
      return fetch(`${corsProxy}${encodeURIComponent(fullUrl)}${corsKey}`);
    };

    const isProd = window.location.hostname.includes('vitamix.com')
      || window.location.hostname.includes('.aem.network');
    const indexPath = plpDataset === 'commercial' ? 'products/commercial' : 'products';
    const pathname = `/${locale}/${language}/${indexPath}/index.json?include=all`;
    const resp = await (isProd ? fetch(pathname) : corsProxyFetch(pathname));
    const { data } = await resp.json();
    if (!isProd && resp.ok) {
      data.forEach((product) => {
        if (product.image) {
          product.image = `https://main--vitamix--aemsites.aem.network/${locale}/${language}/products/${product.image.substring(2)}`;
        }
      });
    }

    const parentsBySku = {};
    const variants = [];
    data.forEach((d) => {
      const product = parseIndexProduct(d, locale, language);
      if (product.sku && !product.parentSku) {
        parentsBySku[product.sku] = product;
      } else {
        variants.push(product);
      }
    });

    variants.forEach((variant) => {
      const parent = parentsBySku[variant.parentSku];
      if (parent) {
        parent.variants = parent.variants || [];
        parent.variants.push(variant);
        parent.colors = parent.colors || [];
        parent.colors.push(variant.color);
      }
    });

    const indexBySlug = {};
    Object.values(parentsBySku).forEach((product) => {
      const rawUrl = product.url || (product.urlKey ? buildProductsUrl(locale, language, product.urlKey) : '');
      const slug = rawUrl ? slugFromUrl(rawUrl) : '';
      if (slug) indexBySlug[slug] = product;
    });

    const parents = plpRows
      .filter((row) => slugFromUrl((row.Product || '').trim()) in indexBySlug)
      .map((row) => {
        const rowUrl = (row.Product || '').trim();
        const urlPathname = pathnameFromUrl(rowUrl);
        const augmented = indexBySlug[slugFromUrl(rowUrl)];
        const product = { ...augmented };
        product.url = urlPathname;
        if (!product.title) product.title = titleFromUrl(urlPathname);
        product.bullets = (row.Bullets || '').split(';').map((s) => s.trim()).filter(Boolean);
        product.comparisonFeatures = (row['Comparison Features'] || '').split(';').map((s) => s.trim()).filter(Boolean);
        const reviews = reviewsBySlug[slugFromUrl(rowUrl)];
        product.reviewCount = reviews?.reviewCount ?? 0;
        product.reviewAverage = reviews?.reviewAverage ?? 0;
        facetDefs.forEach(({ rawKey, key }) => {
          product[key] = parseFacetValues(row[rawKey]);
        });
        return product;
      })
      .filter((product) => !!product.image);

    window.productListWidgetIndexByDataset[plpDataset] = { parents, facetDefs };
  }

  const { parents, facetDefs } = window.productListWidgetIndexByDataset[plpDataset];
  const facetKeySet = new Set(facetDefs.map((d) => d.key));
  const filterKeys = Object.keys(config).filter((key) => key === 'fulltext' || facetKeySet.has(key));
  const facetKeys = Object.keys(facets);
  const tokens = {};
  filterKeys.forEach((key) => {
    if (key !== 'fulltext') tokens[key] = config[key].split(',').map((t) => t.trim());
  });

  return parents.filter((product) => {
    const filterMatches = {};
    const matchedAll = filterKeys.every((filterKey) => {
      let matched = false;
      if (filterKey === 'fulltext') {
        matched = (product.title || '').toLowerCase().includes(config.fulltext.toLowerCase());
      } else if (product[filterKey]) {
        matched = tokens[filterKey].some((t) => product[filterKey].includes(t));
      }
      filterMatches[filterKey] = matched;
      return matched;
    });

    facetKeys.forEach((facetKey) => {
      let includeInFacet = true;
      Object.keys(filterMatches).forEach((filterKey) => {
        if (filterKey !== facetKey && !filterMatches[filterKey]) includeInFacet = false;
      });
      if (includeInFacet && product[facetKey]) {
        product[facetKey].forEach((val) => {
          facets[facetKey][val] = (facets[facetKey][val] || 0) + 1;
        });
      }
    });

    return matchedAll;
  });
}

/**
 * Loads the facet definitions (key + display label) dynamically discovered from
 * every "* Facet" column in plp-data-{dataset}.json.
 * @param {string} [dataset] - Which plp-data-{dataset}.json to load; defaults to 'blenders'
 * @returns {Promise<Array<{rawKey: string, label: string, key: string}>>}
 */
export async function getFacetDefinitions(dataset) {
  const plpDataset = normalizePlpDataset(dataset);
  if (!window.productListWidgetIndexByDataset?.[plpDataset]) {
    await lookupProductListProducts({}, {}, plpDataset);
  }
  return window.productListWidgetIndexByDataset[plpDataset].facetDefs;
}

/**
 * Loads all distinct productType facet values from plp-data-{dataset}.json (sourced from
 * the "Type Facet" column, displayed as "Product Type").
 * @param {string} [dataset] - Which plp-data-{dataset}.json to load; defaults to 'blenders'
 * @returns {Promise<string[]>}
 */
export async function loadAllProductTypes(dataset) {
  const facets = { productType: {} };
  await lookupProductListProducts({}, facets, dataset);
  return Object.keys(facets.productType || {}).sort((a, b) => a.localeCompare(b));
}
