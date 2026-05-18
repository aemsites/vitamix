/**
 * Product + category scope picker for commerce-admin.
 * Values: comma-separated catalog paths (`/locale/products/…`) and category slugs (kebab-case).
 */

import {
  collectCategorySlugsFromIndexRows,
  fetchProductsIndexForLocale,
  getParentProducts,
  getUrlKeyFromProduct,
  resolveImageUrlForLocale,
} from './pim.js';
import { productUrlToCatalogPath } from './price-rules-api.js';
import { highlightMatch } from './search-highlight.js';

/** @typedef {'all' | 'products' | 'categories'} PickerFilter */

const MAX_PICKER_ROWS = 120;

const PILL_THUMB_PLACEHOLDER = '<span class="ps-pill-thumb-placeholder" aria-hidden="true"></span>';

/**
 * @param {string} raw
 * @returns {string[]}
 */
export function parseCommaList(raw) {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string[]} items
 * @returns {string}
 */
export function formatCommaList(items) {
  return items.join(', ');
}

/** @type {readonly string[]} */
export const PRODUCT_SELECTOR_INDEX_LOCALES = ['us/en_us', 'ca/en_us', 'ca/fr_ca'];

const VALID_INDEX_LOCALES = new Set(PRODUCT_SELECTOR_INDEX_LOCALES);

const QS_INDEX = 'index';
const QS_PRODUCTS = 'products';
const QS_CATEGORIES = 'categories';

/**
 * @param {string} [search]
 * @returns {{
 *   index: string;
 *   hasProducts: boolean;
 *   products: string;
 *   hasCategories: boolean;
 *   categories: string;
 * }}
 */
export function readProductSelectorUrlState(search = typeof window !== 'undefined' ? window.location.search : '') {
  const params = new URLSearchParams(search);
  return {
    index: params.get(QS_INDEX) || '',
    hasProducts: params.has(QS_PRODUCTS),
    products: params.get(QS_PRODUCTS) || '',
    hasCategories: params.has(QS_CATEGORIES),
    categories: params.get(QS_CATEGORIES) || '',
  };
}

/**
 * @param {URL} url
 * @param {{ localePath: string; products: string[]; categories: string[] }} state
 */
function writeProductSelectorUrlState(url, state) {
  const index = String(state.localePath || '').trim();
  if (index && index !== 'us/en_us' && VALID_INDEX_LOCALES.has(index)) {
    url.searchParams.set(QS_INDEX, index);
  } else {
    url.searchParams.delete(QS_INDEX);
  }
  const productsStr = formatCommaList(state.products);
  const categoriesStr = formatCommaList(state.categories);
  if (productsStr) url.searchParams.set(QS_PRODUCTS, productsStr);
  else url.searchParams.delete(QS_PRODUCTS);
  if (categoriesStr) url.searchParams.set(QS_CATEGORIES, categoriesStr);
  else url.searchParams.delete(QS_CATEGORIES);
}

/**
 * @param {string} localePath e.g. us/en_us
 * @param {object} product
 * @returns {string}
 */
export function catalogPathForProduct(localePath, product) {
  const rawUrl = product?.url;
  if (typeof rawUrl === 'string' && rawUrl.trim().startsWith('/')) {
    const normalized = productUrlToCatalogPath(rawUrl.trim());
    if (normalized) return normalized;
  }
  const urlKey = getUrlKeyFromProduct(product);
  const clean = String(localePath || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return `/${clean}/products/${urlKey}`;
}

/**
 * @param {string} path
 * @returns {string}
 */
export function productPathDisplayLabel(path) {
  const pipe = path.indexOf('|');
  const p = pipe > 0 ? path.slice(0, pipe) : path;
  const sku = pipe > 0 ? path.slice(pipe + 1).trim() : '';
  const parts = p.split('/').filter(Boolean);
  const tail = parts.length ? parts[parts.length - 1] : p;
  return sku ? `${tail} (${sku})` : tail;
}

/**
 * @param {object[]} rows
 * @returns {Map<string, string>}
 */
function buildCategoryLabels(rows) {
  /** @type {Map<string, string>} */
  const map = new Map();
  if (!Array.isArray(rows)) return map;
  rows.forEach((row) => {
    const cats = row?.custom?.categories;
    if (!Array.isArray(cats)) return;
    cats.forEach((c) => {
      if (!c || typeof c !== 'object') return;
      const slug = String(c.url_key || c.urlKey || '').trim();
      const name = String(c.name || '').trim();
      if (slug && !map.has(slug)) map.set(slug, name || slug);
    });
  });
  return map;
}

/**
 * Category slugs on an index row (same sources as {@link collectCategorySlugsFromIndexRows}).
 *
 * @param {object} row
 * @returns {string[]}
 */
export function categorySlugsForProduct(row) {
  /** @type {Set<string>} */
  const slugs = new Set();

  /** @param {unknown} raw */
  const addSlugListField = (raw) => {
    if (raw == null || raw === '') return;
    if (Array.isArray(raw)) {
      raw.forEach((x) => {
        if (typeof x === 'string' && x.trim()) slugs.add(x.trim());
      });
      return;
    }
    if (typeof raw === 'string') {
      raw.split(',').forEach((part) => {
        const s = part.trim();
        if (s) slugs.add(s);
      });
    }
  };

  if (!row || typeof row !== 'object') return [];
  addSlugListField(row.categoriesUrlKey);
  const customCats = row.custom?.categories;
  if (Array.isArray(customCats)) {
    customCats.forEach((c) => {
      if (!c || typeof c !== 'object') return;
      const slug = String(c.url_key || c.urlKey || '').trim();
      if (slug) slugs.add(slug);
    });
  }
  return [...slugs];
}

/**
 * First up to four product image URLs per category slug (index order, parents with images).
 *
 * @param {string} localePath
 * @param {object[]} products parent products from index
 * @returns {Map<string, string[]>}
 */
export function buildCategoryThumbUrls(localePath, products) {
  /** @type {Map<string, string[]>} */
  const bySlug = new Map();
  if (!Array.isArray(products)) return bySlug;

  products.forEach((product) => {
    if (!product?.image) return;
    const imgUrl = resolveImageUrlForLocale(localePath, product.image);
    if (!imgUrl) return;
    categorySlugsForProduct(product).forEach((slug) => {
      let list = bySlug.get(slug);
      if (!list) {
        list = [];
        bySlug.set(slug, list);
      }
      if (list.length < 4) list.push(imgUrl);
    });
  });
  return bySlug;
}

/**
 * Parent product count per category slug (index order).
 *
 * @param {object[]} products
 * @returns {Map<string, number>}
 */
export function buildCategoryProductCounts(products) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  if (!Array.isArray(products)) return counts;

  products.forEach((product) => {
    categorySlugsForProduct(product).forEach((slug) => {
      counts.set(slug, (counts.get(slug) || 0) + 1);
    });
  });
  return counts;
}

/**
 * @param {number} count
 * @returns {string}
 */
export function formatCategoryProductCount(count) {
  const n = Number(count) || 0;
  return n === 1 ? '1 product' : `${n} products`;
}

/**
 * 2×2 thumbnail grid from up to four product image URLs.
 *
 * @param {string[]} imageUrls
 * @param {string} [gridClass]
 * @returns {string}
 */
export function categoryThumbGridHtml(imageUrls, gridClass = 'ps-picker-thumb-grid') {
  const urls = Array.isArray(imageUrls) ? imageUrls.slice(0, 4) : [];
  const cells = [];
  for (let i = 0; i < 4; i += 1) {
    const url = urls[i];
    if (url) {
      cells.push(
        `<span class="ps-thumb-cell"><img src="${escapeAttr(url)}" alt="" loading="lazy" /></span>`,
      );
    } else {
      cells.push('<span class="ps-thumb-cell ps-thumb-cell-empty" aria-hidden="true"></span>');
    }
  }
  return `<div class="${escapeHtml(gridClass)}" aria-hidden="true">${cells.join('')}</div>`;
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   productsInput?: HTMLInputElement | HTMLTextAreaElement | null;
 *   categoriesInput?: HTMLInputElement | HTMLTextAreaElement | null;
 *   localePath?: string;
 *   syncUrl?: boolean;
 *   onChange?: (values: { products: string; categories: string }) => void;
 * }} [options]
 * @returns {{
 *   getProducts: () => string[];
 *   getCategories: () => string[];
 *   setProducts: (items: string[]) => void;
 *   setCategories: (items: string[]) => void;
 *   reload: () => Promise<void>;
 *   destroy: () => void;
 * }}
 */
export function mountProductSelector(container, options = {}) {
  if (!container) {
    throw new Error('mountProductSelector: container is required');
  }

  const {
    productsInput = null,
    categoriesInput = null,
    onChange = undefined,
  } = options;

  const syncUrl = options.syncUrl !== false && typeof window !== 'undefined';

  /** @type {Set<string>} */
  let selectedProducts = new Set(parseCommaList(productsInput?.value));
  /** @type {Set<string>} */
  let selectedCategories = new Set(parseCommaList(categoriesInput?.value));

  let localePath = options.localePath || 'us/en_us';

  if (syncUrl) {
    const fromUrl = readProductSelectorUrlState();
    if (fromUrl.index && VALID_INDEX_LOCALES.has(fromUrl.index)) {
      localePath = fromUrl.index;
    }
    if (fromUrl.hasProducts) {
      selectedProducts = new Set(parseCommaList(fromUrl.products));
    }
    if (fromUrl.hasCategories) {
      selectedCategories = new Set(parseCommaList(fromUrl.categories));
    }
  }

  let urlSyncMuted = false;
  /** @type {object[]} */
  let indexRows = [];
  /** @type {object[]} */
  let parentProducts = [];
  /** @type {string[]} */
  let categorySlugs = [];
  /** @type {Map<string, string>} */
  let categoryLabels = new Map();
  /** @type {Map<string, string[]>} */
  let categoryThumbUrls = new Map();
  /** @type {Map<string, number>} */
  let categoryProductCounts = new Map();
  /** @type {Map<string, object>} */
  let productByPath = new Map();

  let filterMode = /** @type {PickerFilter} */ ('all');
  let searchQuery = '';
  let loading = false;
  let loadError = '';

  const root = document.createElement('div');
  root.className = 'ps-root';
  root.innerHTML = `
    <div class="ps-layout">
      <div class="ps-toolbar-row">
        <div class="ps-toolbar">
          <label class="ps-index-label" for="ps-index-select">Index</label>
          <select id="ps-index-select" class="ps-index-select" aria-label="Product index locale">
            <option value="us/en_us">US (en-US)</option>
            <option value="ca/en_us">CA (en-US)</option>
            <option value="ca/fr_ca">CA (fr-CA)</option>
          </select>
          <span class="ps-status" id="ps-status" aria-live="polite"></span>
        </div>
        <button type="button" class="ps-clear-btn" data-clear="all">Clear all</button>
      </div>
      <section class="ps-panel ps-panel-selection" aria-label="Selected products and categories">
        <div class="ps-pills" id="ps-selection-pills"></div>
      </section>
      <section class="ps-panel ps-panel-picker" aria-label="Browse product index">
        <input
          type="search"
          class="ps-search"
          id="ps-search"
          placeholder="Filter by product or category name…"
          autocomplete="off"
          aria-label="Filter index"
        />
        <div class="ps-filter-tabs" role="group" aria-label="Show in picker">
          <button type="button" class="ps-filter-tab" data-filter="all" aria-pressed="true">All</button>
          <button type="button" class="ps-filter-tab" data-filter="products" aria-pressed="false">Products</button>
          <button type="button" class="ps-filter-tab" data-filter="categories" aria-pressed="false">Categories</button>
        </div>
        <div id="ps-loading" class="ps-loading" hidden>
          <span class="ps-spinner" aria-hidden="true"></span>
          <span>Loading product index…</span>
        </div>
        <div class="ps-pills ps-picker-list" id="ps-picker" role="listbox" aria-label="Matching products and categories"></div>
      </section>
    </div>
  `;

  container.replaceChildren(root);

  const indexSelect = /** @type {HTMLSelectElement} */ (root.querySelector('#ps-index-select'));
  const statusEl = root.querySelector('#ps-status');
  const searchEl = /** @type {HTMLInputElement} */ (root.querySelector('#ps-search'));
  const selectionPillsEl = root.querySelector('#ps-selection-pills');
  const pickerEl = root.querySelector('#ps-picker');
  const loadingEl = root.querySelector('#ps-loading');
  const filterTabs = root.querySelectorAll('.ps-filter-tab');
  const clearAllBtn = root.querySelector('[data-clear="all"]');

  indexSelect.value = localePath;

  function currentUrlState() {
    return {
      localePath,
      products: [...selectedProducts],
      categories: [...selectedCategories],
    };
  }

  function pushUrlState() {
    if (!syncUrl || urlSyncMuted) return;
    const url = new URL(window.location.href);
    writeProductSelectorUrlState(url, currentUrlState());
    window.history.pushState({ productSelector: true }, '', url);
  }

  /**
   * @returns {boolean} whether the index locale changed
   */
  function applyUrlState() {
    if (!syncUrl) return false;
    const fromUrl = readProductSelectorUrlState();
    let localeChanged = false;
    if (fromUrl.index && VALID_INDEX_LOCALES.has(fromUrl.index) && fromUrl.index !== localePath) {
      localePath = fromUrl.index;
      localeChanged = true;
      indexSelect.value = localePath;
    } else if (!fromUrl.index && localePath !== (options.localePath || 'us/en_us')) {
      const fallback = options.localePath || 'us/en_us';
      if (localePath !== fallback) {
        localePath = fallback;
        localeChanged = true;
        indexSelect.value = localePath;
      }
    } else if (fromUrl.index && VALID_INDEX_LOCALES.has(fromUrl.index)) {
      indexSelect.value = fromUrl.index;
    }
    if (fromUrl.hasProducts) {
      selectedProducts = new Set(parseCommaList(fromUrl.products));
    } else {
      selectedProducts = new Set();
    }
    if (fromUrl.hasCategories) {
      selectedCategories = new Set(parseCommaList(fromUrl.categories));
    } else {
      selectedCategories = new Set();
    }
    return localeChanged;
  }

  function syncInputs() {
    const productsStr = formatCommaList([...selectedProducts]);
    const categoriesStr = formatCommaList([...selectedCategories]);
    if (productsInput && productsInput.value !== productsStr) {
      productsInput.value = productsStr;
    }
    if (categoriesInput && categoriesInput.value !== categoriesStr) {
      categoriesInput.value = categoriesStr;
    }
    onChange?.({ products: productsStr, categories: categoriesStr });
    pushUrlState();
  }

  function rebuildProductMaps() {
    productByPath = new Map();
    parentProducts.forEach((p) => {
      const path = catalogPathForProduct(localePath, p);
      productByPath.set(path, p);
    });
  }

  function productDisplayName(product) {
    return String(product?.title || '').trim();
  }

  function productMatchesSearch(product) {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const name = productDisplayName(product).toLowerCase();
    return name.includes(q);
  }

  function categoryMatchesSearch(slug) {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const name = String(categoryLabels.get(slug) || slug).trim().toLowerCase();
    return name.includes(q);
  }

  function renderAll() {
    renderSelection();
    renderPicker();
    updateStatus();
  }

  /**
   * @param {string} path
   * @param {{ query?: string; removable?: boolean; picker?: boolean; selected?: boolean }} [opts]
   * @returns {HTMLElement}
   */
  function createProductPillEl(path, opts = {}) {
    const {
      query = '', removable = false, picker = false, selected = false,
    } = opts;
    const product = productByPath.get(path);
    const title = product?.title || product?.sku || productPathDisplayLabel(path);
    const sub = productPathDisplayLabel(path);
    const imgUrl = product?.image ? resolveImageUrlForLocale(localePath, product.image) : '';
    const thumbHtml = imgUrl
      ? `<img class="ps-pill-product-thumb" src="${escapeAttr(imgUrl)}" alt="" loading="lazy" width="39" height="39" />`
      : PILL_THUMB_PLACEHOLDER;

    const el = document.createElement('span');
    if (picker) {
      el.className = `ps-pill ps-pill-product ps-picker-pill${selected ? ' ps-pill-is-selected' : ''}`;
      el.dataset.kind = 'product';
      el.dataset.key = path;
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', selected ? 'true' : 'false');
      el.tabIndex = 0;
      el.setAttribute(
        'aria-label',
        selected ? `Remove ${title} from selection` : `Add ${title} to selection`,
      );
    } else {
      el.className = 'ps-pill ps-pill-product';
      el.dataset.path = path;
      el.title = path;
    }

    const removeHtml = removable
      ? `<button type="button" class="ps-pill-remove" aria-label="Remove ${escapeAttr(title)}">×</button>`
      : '';

    el.innerHTML = `
      ${thumbHtml}
      <span class="ps-pill-text">
        <span class="ps-pill-label">${highlightMatch(title, query)}</span>
        <span class="ps-pill-meta">${escapeHtml(sub)}</span>
      </span>
      ${removeHtml}
    `;
    return el;
  }

  /**
   * @param {string} slug
   * @param {{ query?: string; removable?: boolean; picker?: boolean; selected?: boolean }} [opts]
   * @returns {HTMLElement}
   */
  function createCategoryPillEl(slug, opts = {}) {
    const {
      query = '', removable = false, picker = false, selected = false,
    } = opts;
    const label = categoryLabels.get(slug) || slug;
    const showSlug = label !== slug;
    const thumbUrls = categoryThumbUrls.get(slug) || [];
    const thumbHtml = thumbUrls.length
      ? categoryThumbGridHtml(thumbUrls, 'ps-pill-thumb-grid')
      : PILL_THUMB_PLACEHOLDER;
    const countLabel = formatCategoryProductCount(categoryProductCounts.get(slug));
    const metaParts = showSlug ? [slug, countLabel] : [countLabel];

    const el = document.createElement('span');
    if (picker) {
      el.className = `ps-pill ps-pill-category ps-picker-pill${selected ? ' ps-pill-is-selected' : ''}`;
      el.dataset.kind = 'category';
      el.dataset.key = slug;
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', selected ? 'true' : 'false');
      el.tabIndex = 0;
      el.setAttribute(
        'aria-label',
        selected ? `Remove ${label} from selection` : `Add ${label} to selection`,
      );
    } else {
      el.className = 'ps-pill ps-pill-category';
      el.dataset.slug = slug;
    }

    const removeHtml = removable
      ? `<button type="button" class="ps-pill-remove" aria-label="Remove ${escapeAttr(slug)}">×</button>`
      : '';

    el.innerHTML = `
      ${thumbHtml}
      <span class="ps-pill-text">
        <span class="ps-pill-label">${highlightMatch(label, query)}</span>
        <span class="ps-pill-meta">${escapeHtml(metaParts.join(' · '))}</span>
      </span>
      ${removeHtml}
    `;
    return el;
  }

  function removeProduct(path) {
    selectedProducts.delete(path);
    syncInputs();
    renderAll();
  }

  function removeCategory(slug) {
    selectedCategories.delete(slug);
    syncInputs();
    renderAll();
  }

  function renderSelection() {
    if (!selectionPillsEl) return;
    selectionPillsEl.replaceChildren();

    /** @type {Array<{ kind: 'product' | 'category'; key: string; label: string }>} */
    const items = [];
    selectedProducts.forEach((path) => {
      const product = productByPath.get(path);
      const label = product?.title || product?.sku || productPathDisplayLabel(path);
      items.push({ kind: 'product', key: path, label });
    });
    selectedCategories.forEach((slug) => {
      items.push({
        kind: 'category',
        key: slug,
        label: categoryLabels.get(slug) || slug,
      });
    });
    items.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

    if (items.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'ps-pills-empty';
      empty.textContent = 'Nothing selected yet — pick items below.';
      selectionPillsEl.appendChild(empty);
    } else {
      items.forEach((item) => {
        if (item.kind === 'product') {
          selectionPillsEl.appendChild(createProductPillEl(item.key, { removable: true }));
        } else {
          selectionPillsEl.appendChild(createCategoryPillEl(item.key, { removable: true }));
        }
      });
    }

    if (clearAllBtn) {
      clearAllBtn.disabled = items.length === 0;
    }
  }

  function renderPicker() {
    if (!pickerEl) return;
    pickerEl.replaceChildren();

    if (loading) return;
    if (loadError) {
      const err = document.createElement('span');
      err.className = 'ps-pills-empty';
      err.textContent = loadError;
      pickerEl.appendChild(err);
      return;
    }

    const q = searchQuery.trim();
    /** @type {Array<{ kind: 'product' | 'category'; key: string; label: string }>} */
    const rows = [];

    if (filterMode === 'all' || filterMode === 'products') {
      parentProducts.forEach((product) => {
        if (!productMatchesSearch(product)) return;
        const path = catalogPathForProduct(localePath, product);
        const label = productDisplayName(product)
          || product?.sku
          || productPathDisplayLabel(path);
        rows.push({ kind: 'product', key: path, label });
      });
    }

    if (filterMode === 'all' || filterMode === 'categories') {
      categorySlugs.forEach((slug) => {
        if (!categoryMatchesSearch(slug)) return;
        rows.push({
          kind: 'category',
          key: slug,
          label: categoryLabels.get(slug) || slug,
        });
      });
    }

    rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    const capped = rows.slice(0, MAX_PICKER_ROWS);

    if (capped.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'ps-pills-empty';
      empty.textContent = q
        ? 'No matches — try another search or switch the filter tab.'
        : 'Nothing to show for this filter.';
      pickerEl.appendChild(empty);
      return;
    }

    capped.forEach((row) => {
      if (row.kind === 'product') {
        pickerEl.appendChild(createProductPillEl(row.key, {
          query: q,
          picker: true,
          selected: selectedProducts.has(row.key),
        }));
      } else {
        pickerEl.appendChild(createCategoryPillEl(row.key, {
          query: q,
          picker: true,
          selected: selectedCategories.has(row.key),
        }));
      }
    });

    if (rows.length > MAX_PICKER_ROWS) {
      const more = document.createElement('span');
      more.className = 'ps-pills-empty';
      more.textContent = `Showing first ${MAX_PICKER_ROWS} of ${rows.length} matches — refine your search.`;
      pickerEl.appendChild(more);
    }
  }

  function updateStatus() {
    if (!statusEl) return;
    statusEl.classList.remove('ps-status-error');
    if (loading) {
      statusEl.textContent = 'Loading…';
      return;
    }
    if (loadError) {
      statusEl.textContent = 'Index failed';
      statusEl.classList.add('ps-status-error');
      return;
    }
    statusEl.textContent = `${parentProducts.length} products · ${categorySlugs.length} categories`;
  }

  function setLoadingUi(on) {
    loading = on;
    if (loadingEl) loadingEl.hidden = !on;
    if (pickerEl) pickerEl.hidden = on;
    updateStatus();
  }

  async function loadIndex() {
    setLoadingUi(true);
    loadError = '';
    try {
      const json = await fetchProductsIndexForLocale(localePath);
      const data = json.data || json;
      indexRows = Array.isArray(data) ? data : [];
      parentProducts = getParentProducts(indexRows);
      categorySlugs = collectCategorySlugsFromIndexRows(indexRows);
      categoryLabels = buildCategoryLabels(indexRows);
      categoryThumbUrls = buildCategoryThumbUrls(localePath, parentProducts);
      categoryProductCounts = buildCategoryProductCounts(parentProducts);
      rebuildProductMaps();
    } catch (err) {
      loadError = err?.message || 'Failed to load product index';
      parentProducts = [];
      categorySlugs = [];
      categoryLabels = new Map();
      categoryThumbUrls = new Map();
      categoryProductCounts = new Map();
      productByPath = new Map();
    } finally {
      setLoadingUi(false);
      renderAll();
    }
  }

  function onProductsInputChange() {
    if (!productsInput) return;
    selectedProducts = new Set(parseCommaList(productsInput.value));
    renderAll();
  }

  function onCategoriesInputChange() {
    if (!categoriesInput) return;
    selectedCategories = new Set(parseCommaList(categoriesInput.value));
    renderAll();
  }

  selectionPillsEl?.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('.ps-pill-remove');
    if (!btn) return;
    const pill = btn.closest('.ps-pill');
    const path = pill?.getAttribute('data-path');
    const slug = pill?.getAttribute('data-slug');
    if (path) removeProduct(path);
    else if (slug) removeCategory(slug);
  });

  function togglePickerPill(pill) {
    const { kind } = pill.dataset;
    const { key } = pill.dataset;
    if (!key) return;
    if (kind === 'product') {
      if (selectedProducts.has(key)) selectedProducts.delete(key);
      else selectedProducts.add(key);
    } else if (kind === 'category') {
      if (selectedCategories.has(key)) selectedCategories.delete(key);
      else selectedCategories.add(key);
    }
    syncInputs();
    renderAll();
  }

  pickerEl?.addEventListener('click', (e) => {
    const pill = /** @type {HTMLElement} */ (e.target).closest('.ps-picker-pill');
    if (!pill) return;
    togglePickerPill(pill);
  });

  pickerEl?.addEventListener('keydown', (e) => {
    const pill = /** @type {HTMLElement} */ (e.target).closest('.ps-picker-pill');
    if (!pill || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    togglePickerPill(pill);
  });

  indexSelect.addEventListener('change', () => {
    localePath = indexSelect.value;
    pushUrlState();
    loadIndex();
  });

  searchEl.addEventListener('input', () => {
    searchQuery = searchEl.value;
    renderPicker();
  });

  filterTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = tab.getAttribute('data-filter');
      if (mode !== 'all' && mode !== 'products' && mode !== 'categories') return;
      filterMode = mode;
      filterTabs.forEach((t) => {
        const pressed = t === tab;
        t.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      });
      renderPicker();
    });
  });

  clearAllBtn?.addEventListener('click', () => {
    selectedProducts = new Set();
    selectedCategories = new Set();
    syncInputs();
    renderAll();
  });

  productsInput?.addEventListener('change', onProductsInputChange);
  productsInput?.addEventListener('blur', onProductsInputChange);
  categoriesInput?.addEventListener('change', onCategoriesInputChange);
  categoriesInput?.addEventListener('blur', onCategoriesInputChange);

  function onPopState() {
    if (!syncUrl) return;
    urlSyncMuted = true;
    const localeChanged = applyUrlState();
    const finish = () => {
      renderAll();
      const productsStr = formatCommaList([...selectedProducts]);
      const categoriesStr = formatCommaList([...selectedCategories]);
      if (productsInput && productsInput.value !== productsStr) {
        productsInput.value = productsStr;
      }
      if (categoriesInput && categoriesInput.value !== categoriesStr) {
        categoriesInput.value = categoriesStr;
      }
      onChange?.({ products: productsStr, categories: categoriesStr });
      urlSyncMuted = false;
    };
    if (localeChanged) {
      loadIndex().then(finish);
    } else {
      finish();
    }
  }

  if (syncUrl) {
    window.addEventListener('popstate', onPopState);
  }

  function destroy() {
    if (syncUrl) {
      window.removeEventListener('popstate', onPopState);
    }
    productsInput?.removeEventListener('change', onProductsInputChange);
    productsInput?.removeEventListener('blur', onProductsInputChange);
    categoriesInput?.removeEventListener('change', onCategoriesInputChange);
    categoriesInput?.removeEventListener('blur', onCategoriesInputChange);
    container.replaceChildren();
  }

  loadIndex();
  renderAll();
  urlSyncMuted = true;
  syncInputs();
  urlSyncMuted = false;

  return {
    getProducts: () => [...selectedProducts],
    getCategories: () => [...selectedCategories],
    setProducts: (items) => {
      selectedProducts = new Set(items.map((s) => s.trim()).filter(Boolean));
      syncInputs();
      renderAll();
    },
    setCategories: (items) => {
      selectedCategories = new Set(items.map((s) => s.trim()).filter(Boolean));
      syncInputs();
      renderAll();
    },
    reload: loadIndex,
    destroy,
  };
}

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
