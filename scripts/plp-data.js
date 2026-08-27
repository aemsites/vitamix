/* eslint-disable max-len */
/**
 * Shared PLP data layer, used by widgets/product-list and blocks/product-row:
 * fetching/parsing the commerce product index, plp-data-{dataset}.json, and
 * reviews.json, joining them by slug, and rendering the resulting badges/star-rating.
 */

// Color tier for each callout type - drives which .product-badge-tier-* class is applied.
const CALLOUT_TIERS = {
  sale: 'alert',
  new: 'alert',
  bestseller: 'merch',
  bundle: 'merch',
  exclusive: 'merch',
  topRated: 'merch',
  limitedEdition: 'merch',
  manual: 'info',
};

// plp-data-{dataset}.json datasets
export const PLP_DATASETS = ['blenders', 'accessories', 'commercial'];

/**
 * Classifies authored badge text into an existing callout type (and its tier).
 * @param {string} badge - Raw badge text from plp-data's Badges column
 * @returns {string}
 */
function classifyManualBadge(badge) {
  const text = badge.toLowerCase();
  if (text.includes('sale')) return 'sale';
  if (text.includes('new')) return 'new';
  if (text.includes('best seller') || text.includes('bestseller')) return 'bestseller';
  if (text.includes('top rated') || text.includes('toprated')) return 'topRated';
  if (text.includes('bundle')) return 'bundle';
  if (text.includes('limited edition') || text.includes('limitededition')) return 'limitedEdition';
  if (text.includes('exclusive')) return 'exclusive';
  return 'manual';
}

const CALLOUT_COPY_KEYS = {
  sale: 'sale',
  new: 'new',
  bestseller: 'bestSeller',
  bundle: 'bundleSave',
  exclusive: 'exclusive',
  topRated: 'topRated',
  limitedEdition: 'limitedEdition',
};

/**
 * Builds callouts from plp-data's Badges column only (no inference from title, collections, or price).
 * Known types use localized copy; anything else is shown as authored.
 * @param {Object} product - Product data object with `badge` from plp-data
 * @param {Object} copy - Localized copy object with badge labels (sale, new, bestSeller, bundleSave, exclusive, topRated, limitedEdition)
 * @returns {Array<{type: string, label: string, tier: string}>}
 */
export function getProductCallouts(product, copy) {
  const badge = (product.badge || '').trim();
  if (!badge) return [];

  const type = classifyManualBadge(badge);
  const label = type === 'manual' ? badge : (copy[CALLOUT_COPY_KEYS[type]] || badge);
  if (!label) return [];

  return [{ type, label, tier: CALLOUT_TIERS[type] }];
}

/**
 * Builds the badge/callout overlay for a product card.
 * @param {Object} product - Product data object
 * @param {Object} copy - Localized copy object with badge labels
 * @returns {HTMLDivElement} `.product-badges` wrapper containing one `.product-badge` per callout
 */
export function createCallouts(product, copy) {
  const wrap = document.createElement('div');
  wrap.className = 'product-badges';
  getProductCallouts(product, copy).forEach(({
    type, label, tier,
  }) => {
    const badge = document.createElement('span');
    badge.className = `product-badge product-badge-tier-${tier} product-badge-${type}`;
    badge.textContent = type === 'topRated' ? `★ ${label}` : label;
    wrap.appendChild(badge);
  });
  return wrap;
}

/**
 * Builds a compact star-rating element from reviews.json data (reviewAverage/reviewCount).
 * @param {Object} product - Product with reviewAverage (0-5) and reviewCount
 * @returns {HTMLElement} `.star-rating` element (empty if the product has no reviews)
 */
export function createStarRating(product) {
  const wrap = document.createElement('div');
  wrap.className = 'star-rating';
  const count = product.reviewCount || 0;
  if (!count) return wrap;

  const average = product.reviewAverage || 0;
  const fillPercent = Math.max(0, Math.min(100, (average / 5) * 100));

  const stars = document.createElement('span');
  stars.className = 'star-rating-stars';
  stars.setAttribute('role', 'img');
  stars.setAttribute('aria-label', `${average} out of 5 stars`);
  stars.innerHTML = `
    <span class="star-rating-track" aria-hidden="true">★★★★★</span>
    <span class="star-rating-fill" aria-hidden="true" style="width: ${fillPercent}%">★★★★★</span>
  `;

  const countEl = document.createElement('span');
  countEl.className = 'star-rating-count';
  countEl.textContent = `(${count})`;

  wrap.append(stars, countEl);
  return wrap;
}

/**
 * Resolves a URL/pathname down to its trailing slug, for joining product rows
 * against reviews.json (whose Path values may use a different URL prefix).
 * @param {string} rawUrl - Absolute URL or pathname
 * @returns {string}
 */
export function slugFromUrl(rawUrl) {
  let pathname;
  try {
    pathname = new URL(rawUrl, window.location.origin).pathname;
  } catch {
    pathname = rawUrl;
  }
  return pathname.split('/').filter(Boolean).pop() || '';
}

/**
 * Fetches reviews.json, the source of truth for each product's review count/average rating
 * (replaces the previous per-product Bazaarvoice inline widget lookup).
 * @param {string} locale
 * @param {string} language
 * @returns {Promise<Array<Object>>}
 */
export async function fetchReviewsData(locale, language) {
  const resp = await fetch(`/${locale}/${language}/products/config/reviews.json`);
  if (!resp.ok) return [];
  const json = await resp.json();
  return Array.isArray(json.data) ? json.data : [];
}

/**
 * Builds a slug -> { reviewCount, reviewAverage } lookup from reviews.json rows.
 * @param {Array<Object>} reviewsRows - Raw reviews.json rows (Path, Number of Reviews, Average Rating)
 * @returns {Object.<string, {reviewCount: number, reviewAverage: number}>}
 */
export function getReviewsBySlug(reviewsRows) {
  const bySlug = {};
  reviewsRows.forEach((row) => {
    const slug = slugFromUrl((row.Path || '').trim());
    if (!slug) return;
    bySlug[slug] = {
      reviewCount: parseInt(row['Number of Reviews'], 10) || 0,
      reviewAverage: parseFloat(row['Average Rating']) || 0,
    };
  });
  return bySlug;
}

/**
 * Fetches plp-data-{dataset}.json, the source of truth.
 * @param {string} locale
 * @param {string} language
 * @param {string} dataset - One of PLP_DATASETS
 * @returns {Promise<Array<Object>>}
 */
export async function fetchPlpData(locale, language, dataset) {
  const resp = await fetch(`/${locale}/${language}/products/config/plp-data-${dataset}.json`);
  if (!resp.ok) return [];
  const json = await resp.json();
  return Array.isArray(json.data) ? json.data : [];
}

/**
 * Builds a slug -> badge label lookup from plp-data.json rows' Badges column.
 * @param {Array<Object>} plpRows - Raw plp-data.json rows (Product, Badges, ...)
 * @returns {Object.<string, string>}
 */
export function getBadgesBySlug(plpRows) {
  const bySlug = {};
  plpRows.forEach((row) => {
    const slug = slugFromUrl((row.Product || '').trim());
    const badge = (row.Badges || '').trim();
    if (slug && badge) bySlug[slug] = badge;
  });
  return bySlug;
}

/**
 * @param {string} locale
 * @param {string} language
 * @param {string} path - Product-specific path or URL key
 * @returns {string} Fully constructed product URL path
 */
export function buildProductsUrl(locale, language, path) {
  return `/${locale}/${language}/products/${path}`;
}

/**
 * Parses a raw product-index row, transforming price/array fields.
 * @param {Object} data - Raw product data object from the product index
 * @param {string} locale
 * @param {string} language
 * @returns {Object} Parsed product object with transformed values
 */
function parseProductRow(data, locale, language) {
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
      case 'collections':
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

/**
 * Fetches the commerce product index (raw rows, image URLs resolved for local dev).
 * @param {string} locale
 * @param {string} language
 * @param {Object} [options]
 * @param {boolean} [options.commercial] - Whether to fetch the commercial product index
 * @returns {Promise<Array<Object>>}
 */
export async function fetchProductIndex(locale, language, { commercial = false } = {}) {
  const corsProxyFetch = async (url) => {
    const corsProxy = 'https://fcors.org/?url=';
    const corsKey = '&key=Mg23N96GgR8O3NjU';
    const fullUrl = `https://main--vitamix--aemsites.aem.network${url}`;
    return fetch(`${corsProxy}${encodeURIComponent(fullUrl)}${corsKey}`);
  };

  const isProd = window.location.hostname.includes('vitamix.com') || window.location.hostname.includes('.aem.network');
  const indexPath = commercial ? 'products/commercial' : 'products';
  const indexUrl = `/${locale}/${language}/${indexPath}/index.json?include=all`;
  const resp = await (isProd ? fetch(indexUrl) : corsProxyFetch(indexUrl));
  const { data } = await resp.json();
  if (!isProd && resp.ok) {
    data.forEach((product) => {
      if (product.image) product.image = `https://main--vitamix--aemsites.aem.network/${locale}/${language}/products/${product.image.substring(2)}`;
    });
  }
  return data;
}

/**
 * Parses raw product-index rows, merges variants into their parent by SKU, and
 * builds a slug -> parent-product lookup.
 * @param {Array<Object>} data - Raw rows from fetchProductIndex
 * @param {string} locale
 * @param {string} language
 * @returns {Object.<string, Object>}
 */
export function buildProductIndexBySlug(data, locale, language) {
  const parentsBySku = {};
  const variants = [];
  data.forEach((d) => {
    const product = parseProductRow(d, locale, language);
    if (product.sku && !product.parentSku) parentsBySku[product.sku] = product;
    else variants.push(product);
  });

  variants.forEach((variant) => {
    const parent = parentsBySku[variant.parentSku];
    if (!parent) return;
    parent.variants = parent.variants || [];
    parent.variants.push(variant);
    parent.colors = parent.colors || [];
    parent.colors.push(variant.color);
  });

  const bySlug = {};
  Object.values(parentsBySku).forEach((product) => {
    let url;
    if (product.url) url = new URL(product.url, window.location.origin).pathname;
    else if (product.urlKey) url = buildProductsUrl(locale, language, product.urlKey);
    if (!url) {
      // eslint-disable-next-line no-console
      console.warn(product.sku, 'has no URL key');
      return;
    }
    product.url = url;
    const slug = slugFromUrl(url);
    if (slug) bySlug[slug] = product;
  });
  return bySlug;
}
