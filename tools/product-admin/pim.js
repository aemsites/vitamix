import { fetchReviewLog, getLatestStatusByUrlKey, getLastStatusUpdateByUrlKey } from './review-status.js';

const AEM_BASE = 'https://main--vitamix--aemsites.aem.network';
const CORS_PROXY = 'https://fcors.org/?url=';
const CORS_KEY = '&key=Mg23N96GgR8O3NjU';

const CATALOG_PARAM = 'catalog';
const PRODUCT_PARAM = 'product';

let currentLocalePath = 'us/en_us';

function getLocation() {
  try {
    return window.location;
  } catch {
    return null;
  }
}

function getParams() {
  const loc = getLocation();
  if (!loc || !loc.search) return new URLSearchParams();
  return new URLSearchParams(loc.search);
}

function readCatalogFromParams() {
  const params = getParams();
  const catalog = params.get(CATALOG_PARAM);
  if (catalog) return catalog;
  return null;
}

function readProductFromParams() {
  const params = getParams();
  return params.get(PRODUCT_PARAM);
}

function updateUrlParams(updates) {
  const loc = getLocation();
  if (!loc) return;
  const params = new URLSearchParams(loc.search);
  Object.entries(updates).forEach(([key, value]) => {
    if (value != null && value !== '') params.set(key, value);
    else params.delete(key);
  });
  const query = params.toString();
  const url = query ? `${loc.pathname}?${query}` : loc.pathname;
  window.history.replaceState({}, '', url);
}

function getIndexUrl() {
  return `${AEM_BASE}/${currentLocalePath}/products/index.json?include=all`;
}

function getProductsBaseUrl() {
  return `${AEM_BASE}/${currentLocalePath}/products/`;
}

/**
 * Fetch products index via CORS proxy (same as recipe tool).
 * @returns {Promise<{ data: Array<object> }>}
 */
export async function fetchProductsIndex() {
  const url = CORS_PROXY + encodeURIComponent(getIndexUrl()) + CORS_KEY;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

const IMAGE_QUERY = '?width=750&format=webply&optimize=medium';

/**
 * Resolve relative image path to full URL with image query params.
 * @param {string} imagePath - e.g. "./media_xxx.jpeg"
 * @returns {string}
 */
export function resolveImageUrl(imagePath) {
  if (!imagePath) return '';
  const path = imagePath.startsWith('./') ? imagePath.slice(2) : imagePath;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return getProductsBaseUrl() + path + IMAGE_QUERY;
}

/**
 * Top-level parent products: have sku, no parentSku, optional variantSkus.
 * @param {Array<object>} data
 * @returns {Array<object>}
 */
export function getParentProducts(data) {
  if (!Array.isArray(data)) return [];
  return data.filter((item) => !item.parentSku && item.sku);
}

/**
 * Count variants from variantSkus string.
 * @param {string} variantSkus - e.g. "057728-04,057725-04"
 * @returns {number}
 */
export function getVariantCount(variantSkus) {
  if (!variantSkus || typeof variantSkus !== 'string') return 0;
  return variantSkus.split(',').map((s) => s.trim()).filter(Boolean).length;
}

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escape text and optionally wrap search phrase in <mark> for highlight.
 * @param {string} text
 * @param {string} [query] - search query (empty = no highlight)
 * @returns {string} HTML-safe string with optional <mark> wrappers
 */
function highlightMatch(text, query) {
  const safe = escapeHtml(text);
  if (!query || !query.trim()) return safe;
  const re = new RegExp(escapeRegex(query.trim()), 'gi');
  return safe.replace(re, (match) => `<mark class="pim-highlight">${match}</mark>`);
}

export function showError(message) {
  const el = document.getElementById('error');
  el.textContent = message;
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 8000);
}

/** @type {{ key: string, dir: number }} */
let sortState = { key: 'title', dir: 1 };

/** @type {Array<object>} */
let allParents = [];

/** @type {Record<string, string>} urlKey -> latest review status */
let reviewStatusByUrlKey = {};
/** @type {Record<string, string>} urlKey -> last status update ts (ISO) */
let lastReviewUpdateByUrlKey = {};

function getUrlKeyFromProduct(p) {
  return p.urlKey || (p.url ? p.url.replace(/\/$/, '').split('/').pop() : '') || p.sku || '';
}

function formatLastReview(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { dateStyle: 'short' });
  } catch {
    return ts;
  }
}

function enrichForSort(p) {
  const urlKey = getUrlKeyFromProduct(p);
  return {
    ...p,
    _variants: getVariantCount(p.variantSkus),
    _priceNum: p.price != null ? Number(p.price) : NaN,
    _lastReviewTs: lastReviewUpdateByUrlKey[urlKey] || '',
    _reviewStatus: reviewStatusByUrlKey[urlKey] || 'Not started',
  };
}

function compare(a, b, key) {
  let sortKey = key;
  if (key === 'variants') sortKey = '_variants';
  else if (key === 'price') sortKey = '_priceNum';
  else if (key === 'lastReview') sortKey = '_lastReviewTs';
  else if (key === 'reviewStatus') sortKey = '_reviewStatus';
  const av = a[sortKey];
  const bv = b[sortKey];
  if (av == null && bv == null) return 0;
  if (av == null || av === '') return 1;
  if (bv == null || bv === '') return -1;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
}

function sortProducts(products, key, dir) {
  const sorted = [...products];
  sorted.sort((a, b) => dir * compare(a, b, key));
  return sorted;
}

function matchesQuery(product, q) {
  if (!q || !q.trim()) return true;
  const term = q.trim().toLowerCase();
  const urlKey = getUrlKeyFromProduct(product);
  const reviewStatus = (reviewStatusByUrlKey[urlKey] || 'Not started').toLowerCase();
  const title = (product.title || product.sku || '').toLowerCase();
  const sku = (product.sku || '').toLowerCase();
  const availability = (product.availability || '').toLowerCase();
  const priceStr = (product.price != null ? String(product.price) : '').toLowerCase();
  return (
    title.includes(term)
    || sku.includes(term)
    || availability.includes(term)
    || priceStr.includes(term)
    || reviewStatus.includes(term)
  );
}

function filterAndSortParents(query) {
  const filtered = allParents.filter((p) => matchesQuery(p, query));
  const enriched = filtered.map(enrichForSort);
  return sortProducts(enriched, sortState.key, sortState.dir);
}

function updateSortHeaders() {
  document.querySelectorAll('.pim-sortable').forEach((th) => {
    const k = th.getAttribute('data-sort');
    th.classList.toggle('pim-sort-asc', sortState.key === k && sortState.dir === 1);
    th.classList.toggle('pim-sort-desc', sortState.key === k && sortState.dir === -1);
  });
}

/**
 * Render product list (table body) with optional filter query for highlights.
 * @param {Array<object>} parents - products to show (already sorted)
 * @param {string} [query] - search query for highlighting
 */
export function renderProductList(parents, query = '') {
  const tbody = document.getElementById('productGrid');
  const countEl = document.getElementById('productCount');
  tbody.innerHTML = '';
  const plural = parents.length !== 1 ? 's' : '';
  countEl.textContent = `${parents.length} product${plural}`;

  parents.forEach((product) => {
    const variantCount = getVariantCount(product.variantSkus);
    const imgUrl = resolveImageUrl(product.image);
    const availability = product.availability || '—';
    const availabilityClass = (availability || '').toLowerCase().replace(/\s+/g, '-');
    const price = product.price != null ? String(product.price) : '';
    const urlKey = getUrlKeyFromProduct(product);
    const reviewStatus = reviewStatusByUrlKey[urlKey] || 'Not started';
    const lastReviewDisplay = formatLastReview(lastReviewUpdateByUrlKey[urlKey]);

    const title = product.title || product.sku;
    const tr = document.createElement('tr');
    const selectedProduct = readProductFromParams();
    tr.className = 'pim-row' + (selectedProduct && urlKey === selectedProduct ? ' pim-row-selected' : '');
    tr.dataset.urlkey = urlKey;
    tr.setAttribute('role', 'button');
    tr.tabIndex = 0;
    const thumbCell = imgUrl
      ? `<img src="${escapeHtml(imgUrl)}" alt="" loading="lazy" width="48" height="48" class="pim-thumb-img" />`
      : '<span class="pim-thumb-placeholder" aria-hidden="true"></span>';
    tr.innerHTML = `
      <td class="pim-col-thumb">${thumbCell}</td>
      <td class="pim-col-product pim-cell-title">${highlightMatch(title, query)}</td>
      <td class="pim-col-sku pim-cell-sku">${highlightMatch(product.sku || '', query)}</td>
      <td class="pim-col-variants pim-cell-variants">${variantCount > 0 ? variantCount : '—'}</td>
      <td class="pim-col-availability">
        <span class="pim-card-availability ${availabilityClass}">${highlightMatch(availability, query)}</span>
      </td>
      <td class="pim-col-price pim-cell-price">${price ? highlightMatch(price, query) : '—'}</td>
      <td class="pim-col-review pim-cell-review">${escapeHtml(reviewStatus)}</td>
      <td class="pim-col-last-review pim-cell-last-review">${escapeHtml(lastReviewDisplay)}</td>
    `;
    tbody.appendChild(tr);
  });

  const productFromUrl = readProductFromParams();
  if (productFromUrl) {
    const selectedRow = [...tbody.querySelectorAll('tr.pim-row')].find(
      (tr) => tr.dataset.urlkey === productFromUrl
    );
    if (selectedRow) {
      selectedRow.classList.add('pim-row-selected');
      selectedRow.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }

  updateSortHeaders();
}

function refreshList() {
  const query = document.getElementById('searchInput').value;
  const list = filterAndSortParents(query);
  renderProductList(list, query);
}

async function loadIndex() {
  const loading = document.getElementById('loading');
  const content = document.getElementById('content');
  const errorEl = document.getElementById('error');

  loading.classList.add('active');
  content.classList.remove('active');
  errorEl.classList.remove('active');

  try {
    const json = await fetchProductsIndex();
    const data = json.data || json;
    allParents = getParentProducts(data);
    content.classList.add('active');
    refreshList();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    showError(err.message || 'Failed to load products');
  } finally {
    loading.classList.remove('active');
  }
}

export async function init() {
  const loading = document.getElementById('loading');
  const content = document.getElementById('content');
  const errorEl = document.getElementById('error');
  const searchInput = document.getElementById('searchInput');
  const indexSelect = document.getElementById('indexSelect');

  loading.classList.add('active');
  content.classList.remove('active');
  errorEl.classList.remove('active');

  const catalogFromUrl = readCatalogFromParams();
  if (catalogFromUrl) {
    indexSelect.value = catalogFromUrl;
    currentLocalePath = catalogFromUrl;
  } else {
    currentLocalePath = indexSelect.value;
  }

  indexSelect.addEventListener('change', () => {
    currentLocalePath = indexSelect.value;
    updateUrlParams({ [CATALOG_PARAM]: currentLocalePath });
    loadIndex();
  });

  try {
    currentLocalePath = indexSelect.value;
    updateUrlParams({ [CATALOG_PARAM]: currentLocalePath });
    const [json, reviewEvents] = await Promise.all([
      fetchProductsIndex(),
      fetchReviewLog().catch(() => []),
    ]);
    const data = json.data || json;
    allParents = getParentProducts(data);
    reviewStatusByUrlKey = getLatestStatusByUrlKey(reviewEvents);
    lastReviewUpdateByUrlKey = getLastStatusUpdateByUrlKey(reviewEvents);
    content.classList.add('active');

    searchInput.addEventListener('input', refreshList);
    searchInput.addEventListener('search', refreshList);

    document.querySelectorAll('.pim-sortable').forEach((th) => {
      const handleSort = () => {
        const key = th.getAttribute('data-sort');
        if (sortState.key === key) sortState.dir *= -1;
        else sortState = { key, dir: 1 };
        refreshList();
      };
      th.addEventListener('click', handleSort);
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleSort();
        }
      });
    });

    document.getElementById('productList').addEventListener('click', (e) => {
      const row = e.target.closest('tr.pim-row');
      if (!row || !row.dataset.urlkey) return;
      window.location.href = `product-admin/detail.html?product=${encodeURIComponent(row.dataset.urlkey)}`;
    });
    document.getElementById('productList').addEventListener('keydown', (e) => {
      const row = e.target.closest('tr.pim-row');
      if (!row || !row.dataset.urlkey) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.location.href = `product-admin/detail.html?product=${encodeURIComponent(row.dataset.urlkey)}`;
      }
    });

    refreshList();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    showError(err.message || 'Failed to load products');
  } finally {
    loading.classList.remove('active');
  }
}

init();
