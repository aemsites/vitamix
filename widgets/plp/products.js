/* eslint-disable max-len */
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

const FILTER_KEYS = ['series', 'collection', 'colors', 'productType', 'categories', 'fulltext'];

function buildProductsUrl(locale, language, path) {
  return `/${locale}/${language}/products/${path}`;
}

function getProductIndexLocale() {
  let { locale, language } = getLocaleAndLanguage();
  if (window.location.pathname.startsWith('/drafts/')) {
    locale = 'us';
    language = 'en_us';
  }
  return { locale, language };
}

function parseData(data, locale, language) {
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
      case 'categories':
      case 'categoriesUrlKey':
      case 'collections':
      case 'productType':
      case 'series':
      case 'variantSkus':
      case 'visibility':
        parsed[key] = value ? value.split(',').map((s) => s.trim()) : [];
        break;
      default:
        parsed[key] = typeof value === 'string' ? value.trim() : value;
        break;
    }
  });
  if (parsed.collections) parsed.collection = parsed.collections;
  return parsed;
}

/**
 * Fetches and filters products for the PLP widget.
 * Self-contained: does not depend on blocks/plp/plp.js.
 * @param {Object} config - Filter criteria (only known facet keys are applied)
 * @param {Object} facets - Optional object to populate with facet counts
 * @returns {Promise<Array<Object>>} Filtered parent products with variants
 */
export default async function lookupPlpWidgetProducts(config = {}, facets = {}) {
  const { locale, language } = getProductIndexLocale();
  const corsProxyFetch = async (url) => {
    const corsProxy = 'https://fcors.org/?url=';
    const corsKey = '&key=Mg23N96GgR8O3NjU';
    const fullUrl = `https://main--vitamix--aemsites.aem.network${url}`;
    return fetch(`${corsProxy}${encodeURIComponent(fullUrl)}${corsKey}`);
  };

  if (!window.plpWidgetProductIndex) {
    const isProd = window.location.hostname.includes('vitamix.com')
      || window.location.hostname.includes('.aem.network');
    const indexPath = window.location.pathname.includes('/commercial/') ? 'commercial/products' : 'products';
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

    const parentProductsBySKU = {};
    const variants = [];

    data.forEach((d) => {
      const product = parseData(d, locale, language);
      if (product.sku && !product.parentSku) {
        parentProductsBySKU[product.sku] = product;
      } else {
        variants.push(product);
      }
    });

    variants.forEach((variant) => {
      const parent = parentProductsBySKU[variant.parentSku];
      if (parent) {
        parent.variants = parent.variants || [];
        parent.variants.push(variant);
        parent.colors = parent.colors || [];
        parent.colors.push(variant.color);
      } else {
        // eslint-disable-next-line no-console
        console.warn(variant.sku, 'has no parent product');
      }
    });

    const urlLookup = {};
    Object.values(parentProductsBySKU).forEach((product) => {
      if (product.url) {
        const url = new URL(product.url, window.location.origin);
        product.url = url.pathname;
        urlLookup[url.pathname] = product;
      } else if (product.urlKey) {
        const url = buildProductsUrl(locale, language, product.urlKey);
        urlLookup[url] = product;
        product.url = url;
      } else {
        // eslint-disable-next-line no-console
        console.warn(product.sku, 'has no URL key');
      }
    });

    window.plpWidgetProductIndex = {
      lookup: urlLookup,
      parents: Object.values(parentProductsBySKU),
    };
  }

  const facetKeys = Object.keys(facets);
  const filterKeys = Object.keys(config).filter((key) => FILTER_KEYS.includes(key));
  const cleanKeys = { collection: 'collections' };
  const tokens = {};
  filterKeys.forEach((key) => {
    tokens[key] = config[key].split(',').map((t) => t.trim());
  });

  return window.plpWidgetProductIndex.parents.filter((product) => {
    const filterMatches = {};
    const matchedAll = filterKeys.every((filterKey) => {
      const key = cleanKeys[filterKey] || filterKey;
      let matched = false;
      if (product[key]) {
        matched = tokens[filterKey].some((t) => product[key].includes(t));
      }
      if (key === 'fulltext') {
        matched = product.title.toLowerCase().includes(config.fulltext.toLowerCase());
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
          if (facets[facetKey][val]) facets[facetKey][val] += 1;
          else facets[facetKey][val] = 1;
        });
      }
    });

    return matchedAll;
  });
}
