/**
 * Product Reviews - Fetches products for a locale, resolves reviewsId from
 * each product JSON, and displays Bazaarvoice rating summaries.
 */

import { createOptimizedPicture } from '../../scripts/aem.js';
import requireAuth from './auth.js';

const AEM_NETWORK_ORIGIN = 'https://main--vitamix--aemsites.aem.network';
const FCORS_PROXY = 'https://fcors.org/?url=';
const FCORS_KEY = '&key=Mg23N96GgR8O3NjU';
const FETCH_CONCURRENCY = 12;

const LOCALES = [
  { path: 'us/en_us', bvLang: 'en_US' },
  { path: 'ca/en_us', bvLang: 'en_US' },
  { path: 'ca/fr_ca', bvLang: 'fr_CA' },
  { path: 'mx/es_mx', bvLang: 'es_MX' },
];

let loadedBvLang = null;

/**
 * Fetch an aem.network URL via the fcors proxy (avoids CORS on localhost / .aem.page / .aem.live).
 * @param {string} pathOrUrl - Absolute aem.network URL or site path (e.g. /us/en_us/products/index.json)
 * @returns {Promise<Response>}
 */
function corsProxyFetch(pathOrUrl) {
  const fullUrl = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${AEM_NETWORK_ORIGIN}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
  return fetch(`${FCORS_PROXY}${encodeURIComponent(fullUrl)}${FCORS_KEY}`);
}

/**
 * @param {string} name
 * @returns {string}
 */
function toClassName(name) {
  return typeof name === 'string'
    ? name
      .toLowerCase()
      .replace(/[^0-9a-z]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    : '';
}

/**
 * @param {string} localePath - e.g. us/en_us
 * @returns {{ country: string, locale: string, bvLang: string }}
 */
function parseLocalePath(localePath) {
  const [country, locale] = (localePath || 'us/en_us').split('/');
  const match = LOCALES.find((item) => item.path === `${country}/${locale}`);
  return {
    country: country || 'us',
    locale: locale || 'en_us',
    bvLang: match?.bvLang || toBvLanguage(locale || 'en_us'),
  };
}

/**
 * @param {string} locale - e.g. en_us
 * @returns {string} e.g. en_US
 */
function toBvLanguage(locale) {
  const [lang, region] = String(locale).split('_');
  return region ? `${lang}_${region.toUpperCase()}` : 'en_US';
}

/**
 * @param {string} slug
 * @returns {boolean}
 */
function isSafeSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug);
}

/**
 * Resolves a relative product media path to an absolute aem.network URL.
 * @param {string} imagePath
 * @param {string} country
 * @param {string} locale
 * @param {string} [productsBase='products'] - e.g. products or products/commercial
 * @returns {string}
 */
function resolveProductImage(imagePath, country, locale, productsBase = 'products') {
  if (!imagePath) return '';
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    return imagePath;
  }
  const cleaned = imagePath.replace(/^\.\//, '');
  return `${AEM_NETWORK_ORIGIN}/${country}/${locale}/${productsBase}/${cleaned}`;
}

/**
 * @param {Object} product
 * @returns {string}
 */
function resolveReviewsId(product) {
  if (product?.custom?.reviewsId) {
    return String(product.custom.reviewsId);
  }
  const sku = product?.sku || product?.urlKey || product?.name || '';
  return toClassName(String(sku)).replace(/-/g, '');
}

/**
 * Runs async work over items with a concurrency limit.
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} fn
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<R[]>}
 */
async function mapPool(items, concurrency, fn, onProgress) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
      completed += 1;
      if (onProgress) onProgress(completed, items.length);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Loads parent rows from a products index sheet.
 * @param {string} indexPath - Path under aem.network (may include query)
 * @param {string} productsBase - products or products/commercial
 * @returns {Promise<Array<{urlKey: string, title: string, sku: string, image: string, url: string, productsBase: string}>>}
 */
async function fetchIndexParents(indexPath, productsBase) {
  const response = await corsProxyFetch(indexPath);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${indexPath}: ${response.status} ${response.statusText}`);
  }

  const indexData = await response.json();
  const rows = Array.isArray(indexData) ? indexData : (indexData.data || []);
  const parents = [];

  rows.forEach((row) => {
    const urlKey = (row.urlKey || '').trim();
    if (!urlKey || !isSafeSlug(urlKey)) return;
    parents.push({
      urlKey,
      title: (row.title || '').trim(),
      sku: (row.sku || '').trim(),
      image: row.image || '',
      url: row.url || '',
      productsBase,
    });
  });

  return parents;
}

/**
 * Fetches parent products from the locale consumer + commercial indexes, then
 * loads each product JSON to resolve reviewsId / name / image.
 * @param {string} localePath
 * @param {(message: string, progress?: string) => void} onStatus
 * @returns {Promise<Array<{
 *   name: string,
 *   sku: string,
 *   urlKey: string,
 *   path: string,
 *   image: string,
 *   reviewsId: string,
 * }>>}
 */
async function fetchProducts(localePath, onStatus) {
  const { country, locale } = parseLocalePath(localePath);
  const prefix = `/${country}/${locale}`;

  onStatus('Loading product indexes...');
  const [consumerParents, commercialParents] = await Promise.all([
    fetchIndexParents(`${prefix}/products/index.json`, 'products'),
    fetchIndexParents(`${prefix}/products/commercial/index.json?include=all`, 'products/commercial')
      .catch(() => []),
  ]);

  // Prefer consumer entry when the same urlKey appears in both catalogs.
  const parents = [];
  const seen = new Set();
  [...consumerParents, ...commercialParents].forEach((parent) => {
    const key = `${parent.productsBase}/${parent.urlKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    parents.push(parent);
  });

  parents.sort((a, b) => (a.title || a.urlKey).localeCompare(b.title || b.urlKey));

  onStatus(`Fetching product details (0/${parents.length})...`, `0 / ${parents.length}`);

  const products = await mapPool(
    parents,
    FETCH_CONCURRENCY,
    async (parent) => {
      const basePath = `/${country}/${locale}/${parent.productsBase}/${parent.urlKey}`;
      try {
        const response = await corsProxyFetch(`${basePath}.json`);
        if (!response.ok) {
          return {
            name: parent.title || parent.urlKey,
            sku: parent.sku,
            urlKey: parent.urlKey,
            path: basePath,
            image: resolveProductImage(parent.image, country, locale, parent.productsBase),
            reviewsId: resolveReviewsId(parent),
          };
        }

        const detail = await response.json();
        const imageFromDetail = detail.images?.[0]?.url || '';
        return {
          name: detail.name || parent.title || parent.urlKey,
          sku: detail.sku || parent.sku,
          urlKey: detail.urlKey || parent.urlKey,
          path: detail.path || basePath,
          image: resolveProductImage(
            imageFromDetail || parent.image,
            country,
            locale,
            parent.productsBase,
          ),
          reviewsId: resolveReviewsId(detail),
        };
      } catch {
        return {
          name: parent.title || parent.urlKey,
          sku: parent.sku,
          urlKey: parent.urlKey,
          path: basePath,
          image: resolveProductImage(parent.image, country, locale, parent.productsBase),
          reviewsId: resolveReviewsId(parent),
        };
      }
    },
    (done, total) => {
      onStatus(`Fetching product details (${done}/${total})...`, `${done} / ${total}`);
    },
  );

  return products;
}

/**
 * @returns {HTMLElement}
 */
function createPlaceholder() {
  const placeholder = document.createElement('div');
  placeholder.className = 'product-image placeholder';
  placeholder.textContent = 'No image';
  return placeholder;
}

/**
 * @param {Object} product
 * @param {number} index
 * @returns {HTMLElement}
 */
function createProductCard(product, index) {
  const card = document.createElement('div');
  card.className = 'product-card';
  if (index < 20) {
    card.style.animationDelay = `${index * 0.03}s`;
  } else {
    card.style.animation = 'none';
  }
  card.dataset.title = (product.name || '').toLowerCase();
  card.dataset.reviewsId = (product.reviewsId || '').toLowerCase();
  card.dataset.path = product.path || '';

  const imageContainer = document.createElement('div');
  imageContainer.className = 'product-image-container';

  if (product.image) {
    const picture = createOptimizedPicture(product.image, product.name, false);
    picture.classList.add('product-image');
    const img = picture.querySelector('img');
    if (img) {
      img.onload = () => imageContainer.classList.add('loaded');
      img.onerror = () => {
        picture.replaceWith(createPlaceholder());
        imageContainer.classList.add('loaded');
      };
    }
    imageContainer.appendChild(picture);
  } else {
    imageContainer.appendChild(createPlaceholder());
    imageContainer.classList.add('loaded');
  }
  card.appendChild(imageContainer);

  const info = document.createElement('div');
  info.className = 'product-info';

  const title = document.createElement('h3');
  title.className = 'product-title';
  title.textContent = product.name;
  info.appendChild(title);

  if (product.sku) {
    const sku = document.createElement('div');
    sku.className = 'product-sku';
    sku.textContent = product.sku;
    info.appendChild(sku);
  }

  const reviewsIdEl = document.createElement('div');
  reviewsIdEl.className = 'product-reviews-id';
  reviewsIdEl.textContent = product.reviewsId || '(none)';
  info.appendChild(reviewsIdEl);

  if (product.reviewsId) {
    const bvRating = document.createElement('div');
    bvRating.className = 'product-bv-rating';
    bvRating.setAttribute('data-bv-show', 'rating_summary');
    bvRating.setAttribute('data-bv-product-id', product.reviewsId);
    info.appendChild(bvRating);
  }

  if (product.path) {
    const link = document.createElement('a');
    link.className = 'product-link';
    link.href = `${AEM_NETWORK_ORIGIN}${product.path}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = product.urlKey || 'View product';
    link.title = product.path;
    info.appendChild(link);
  }

  card.appendChild(info);
  return card;
}

function updateVisibleCount() {
  const cards = document.querySelectorAll('.product-card');
  const visible = Array.from(cards).filter((card) => !card.classList.contains('hidden')).length;
  document.getElementById('visible-count').textContent = visible;
  document.getElementById('no-results').style.display = visible === 0 ? 'block' : 'none';
}

/**
 * @param {HTMLElement} card
 * @returns {{ reviewCount: number, avgRating: number }}
 */
function getBvDataFromCard(card) {
  const bvContainer = card.querySelector('.product-bv-rating');
  let reviewCount = 0;
  let avgRating = 0;

  if (bvContainer && bvContainer.getAttribute('data-bv-ready') === 'true') {
    const reviewCountMeta = bvContainer.querySelector('meta[itemprop="reviewCount"]');
    if (reviewCountMeta) {
      reviewCount = parseInt(reviewCountMeta.getAttribute('content'), 10) || 0;
    }
    const ratingValueDiv = bvContainer.querySelector('[itemprop="ratingValue"]');
    if (ratingValueDiv) {
      avgRating = parseFloat(ratingValueDiv.textContent) || 0;
    }
  }

  return { reviewCount, avgRating };
}

/**
 * @param {HTMLElement} card
 * @returns {Object}
 */
function getDetailedBvDataFromCard(card) {
  const reviewsId = card.querySelector('.product-reviews-id')?.textContent || '';
  const { reviewCount, avgRating } = getBvDataFromCard(card);
  return {
    path: card.dataset.path || '',
    reviewsId: reviewsId === '(none)' ? '' : reviewsId,
    reviewCount,
    avgRating,
  };
}

async function exportToTSV() {
  const visibleCards = document.querySelectorAll('.product-card:not(.hidden)');
  if (visibleCards.length === 0) {
    // eslint-disable-next-line no-alert
    alert('No products to export. Adjust your filters to show some products.');
    return;
  }

  const headers = ['Path', 'Reviews ID', 'Number of Reviews', 'Average Rating'];
  const rows = [headers.join('\t')];

  visibleCards.forEach((card) => {
    const data = getDetailedBvDataFromCard(card);
    rows.push([
      data.path,
      data.reviewsId,
      data.reviewCount,
      data.avgRating,
    ].join('\t'));
  });

  const tsv = rows.join('\n');
  try {
    await navigator.clipboard.writeText(tsv);
    // eslint-disable-next-line no-alert
    alert(`Copied ${visibleCards.length} products to clipboard!\n\nPaste into a spreadsheet.`);
  } catch {
    const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'product-reviews.tsv';
    a.click();
    URL.revokeObjectURL(url);
  }
}

function applyFilters() {
  const searchTerm = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
  const minReviews = parseInt(document.getElementById('min-reviews')?.value, 10) || 0;
  const minRating = parseFloat(document.getElementById('min-rating')?.value) || 0;

  document.querySelectorAll('.product-card').forEach((card) => {
    const matchesSearch = searchTerm === ''
      || card.dataset.title.includes(searchTerm)
      || (card.dataset.reviewsId || '').includes(searchTerm);
    const { reviewCount, avgRating } = getBvDataFromCard(card);
    const matchesReviews = reviewCount >= minReviews;
    const matchesRating = minRating === 0 || avgRating >= minRating;
    card.classList.toggle('hidden', !(matchesSearch && matchesReviews && matchesRating));
  });

  updateVisibleCount();
}

/**
 * @param {Array} products
 */
function renderProducts(products) {
  const grid = document.getElementById('product-grid');
  grid.innerHTML = '';

  products.forEach((product, index) => {
    grid.appendChild(createProductCard(product, index));
  });

  document.getElementById('total-count').textContent = products.length;
  document.getElementById('reviews-id-count').textContent = products.filter((p) => p.reviewsId).length;
  updateVisibleCount();
}

/**
 * @param {string} message
 */
function showError(message) {
  document.getElementById('loading').style.display = 'none';
  const errorEl = document.getElementById('error');
  errorEl.textContent = message;
  errorEl.style.display = 'block';
  document.getElementById('content').style.display = 'none';
}

function showLoading(message, progress = '') {
  document.getElementById('error').style.display = 'none';
  document.getElementById('content').style.display = 'none';
  document.getElementById('loading').style.display = 'flex';
  document.getElementById('loading-message').textContent = message;
  document.getElementById('loading-progress').textContent = progress;
}

function showContent() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('error').style.display = 'none';
  document.getElementById('content').style.display = 'block';
}

/**
 * Loads the Bazaarvoice script for the given language (once per page load).
 * Locale changes navigate with ?locale= so BV starts clean for that language.
 * @param {string} bvLang
 */
function loadBazaarvoice(bvLang) {
  if (loadedBvLang === bvLang) return;
  window.bvCallback = () => {};
  const script = document.createElement('script');
  script.src = `https://apps.bazaarvoice.com/deployments/vitamix/main_site/production/${bvLang}/bv.js`;
  script.async = true;
  script.dataset.bvLoader = 'true';
  document.head.appendChild(script);
  loadedBvLang = bvLang;
}

function watchForBvReady() {
  const filterStatus = document.getElementById('filter-status');
  let checkCount = 0;
  const maxChecks = 60;

  const setStatus = (text, ready = false) => {
    filterStatus.textContent = '';
    const span = document.createElement('span');
    span.className = ready ? 'bv-ready' : 'bv-loading';
    span.textContent = text;
    filterStatus.appendChild(span);
  };

  const checkBvReady = () => {
    const ready = document.querySelectorAll('.product-bv-rating[data-bv-ready="true"]').length;
    const total = document.querySelectorAll('.product-bv-rating').length;

    if (total === 0) {
      setStatus('No rating widgets', true);
      return;
    }

    if (ready > 0) {
      setStatus(`${ready}/${total} ratings loaded`, true);
      if (ready === total || checkCount >= maxChecks) return;
    }

    checkCount += 1;
    if (checkCount < maxChecks) {
      setTimeout(checkBvReady, 500);
    } else {
      setStatus(`${ready}/${total} ratings loaded`, true);
    }
  };

  setStatus('Loading ratings...');
  setTimeout(checkBvReady, 1500);
}

/**
 * @param {string} localePath
 */
async function loadLocale(localePath) {
  const loadBtn = document.getElementById('load-btn');
  loadBtn.disabled = true;

  try {
    const { bvLang } = parseLocalePath(localePath);
    const products = await fetchProducts(localePath, (message, progress) => {
      showLoading(message, progress || '');
    });

    renderProducts(products);
    showContent();
    loadBazaarvoice(bvLang);
    watchForBvReady();

    const params = new URLSearchParams(window.location.search);
    params.set('locale', localePath);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load products:', error);
    showError(`Failed to load products: ${error.message}`);
  } finally {
    loadBtn.disabled = false;
  }
}

async function init() {
  await requireAuth();

  const localeSelect = document.getElementById('locale-select');
  const params = new URLSearchParams(window.location.search);
  const initialLocale = params.get('locale') || 'us/en_us';
  if ([...localeSelect.options].some((opt) => opt.value === initialLocale)) {
    localeSelect.value = initialLocale;
  }

  document.getElementById('load-btn').addEventListener('click', () => {
    loadLocale(localeSelect.value);
  });

  // Full navigation on locale change so Bazaarvoice loads the matching language cleanly.
  localeSelect.addEventListener('change', () => {
    const next = new URLSearchParams(window.location.search);
    next.set('locale', localeSelect.value);
    window.location.search = next.toString();
  });

  const searchInput = document.getElementById('search-input');
  const minReviewsInput = document.getElementById('min-reviews');
  const minRatingInput = document.getElementById('min-rating');
  let debounceTimer;

  const debouncedFilter = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 200);
  };

  searchInput.addEventListener('input', debouncedFilter);
  minReviewsInput.addEventListener('input', debouncedFilter);
  minRatingInput.addEventListener('input', debouncedFilter);
  document.getElementById('export-btn').addEventListener('click', exportToTSV);

  // Auto-load the selected locale on first visit.
  await loadLocale(localeSelect.value);
}

init();
