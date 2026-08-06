/* eslint-disable max-len */
/**
 * Shared product-badge (callout) and star-rating rendering, used by
 * widgets/product-list and blocks/product-row. Also shares the reviews.json
 * fetch/join used to source star ratings for both.
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
};

/**
 * @param {Object} product - Product data object
 * @returns {boolean} true if the product's regular/original price is higher than its current price
 */
export function isOnSale(product) {
  const regular = product.originalPrice || product.regularPrice;
  return regular && product.price && Number(regular) > Number(product.price);
}

/**
 * Detects which promotional badges apply to a product, capped to 2.
 * @param {Object} product - Product data object
 * @param {Object} copy - Localized copy object with badge labels (sale, new, bestSeller, bundleSave, exclusive, topRated, limitedEdition)
 * @returns {Array<{type: string, label: string, tier: string}>}
 */
export function getProductCallouts(product, copy) {
  const callouts = [];
  const collections = (product.collections || []).join(' ').toLowerCase();
  const title = (product.title || '').toLowerCase();

  if (isOnSale(product)) callouts.push({ type: 'sale', label: copy.sale });
  if (collections.includes('new') || title.includes('new')) {
    callouts.push({ type: 'new', label: copy.new });
  }
  if (collections.includes('bestseller') || title.includes('best seller')) {
    callouts.push({ type: 'bestseller', label: copy.bestSeller });
  }
  if (title.includes('bundle') || collections.includes('bundle') || collections.includes('kitchen systems')) {
    callouts.push({ type: 'bundle', label: copy.bundleSave });
  }
  if (collections.includes('exclusive')) callouts.push({ type: 'exclusive', label: copy.exclusive });
  if (product.reviewCount >= 100 && Number(product.reviewAverage) >= 4.7) {
    callouts.push({ type: 'topRated', label: copy.topRated });
  }
  if (title.includes('limited edition') || collections.includes('limited edition')) {
    callouts.push({ type: 'limitedEdition', label: copy.limitedEdition });
  }

  return callouts
    .filter((callout) => callout.label)
    .slice(0, 2)
    .map((callout) => ({ ...callout, tier: CALLOUT_TIERS[callout.type] }));
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
