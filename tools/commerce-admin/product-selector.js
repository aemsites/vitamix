/**
 * Product + category scope picker for commerce-admin.
 * Values: comma-separated catalog paths (`/locale/products/…`) and category slugs (kebab-case).
 */

import {
  catalogPathForProduct,
  createCategoryScopePillEl,
  createProductScopePillEl,
  loadProductScopeIndexContext,
  productPathDisplayLabel,
  renderProductScopePills,
} from './product-scope-pills.js';

export {
  buildCategoryProductCounts,
  buildCategoryThumbUrls,
  catalogPathForProduct,
  categorySlugsForProduct,
  categoryThumbGridHtml,
  formatCategoryProductCount,
  productPathDisplayLabel,
} from './product-scope-pills.js';

/** @typedef {'all' | 'products' | 'categories' | 'skus'} PickerFilter */

const MAX_PICKER_ROWS = 120;

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
  /** @type {import('./product-scope-pills.js').ProductScopeIndexContext | null} */
  let scopeContext = null;
  /** @type {object[]} */
  let parentProducts = [];
  /** @type {string[]} */
  let categorySlugs = [];

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
          <button type="button" class="ps-filter-tab" data-filter="skus" aria-pressed="false">SKUs</button>
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

  function productDisplayName(product) {
    return String(product?.title || '').trim();
  }

  function productMatchesSearch(product) {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const name = productDisplayName(product).toLowerCase();
    return name.includes(q);
  }

  function skuMatchesSearch(variant, parent) {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      String(variant?.sku || ''),
      String(variant?.title || ''),
      String(variant?.color || ''),
      productDisplayName(parent),
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  }

  function categoryMatchesSearch(slug) {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const name = String(scopeContext?.categoryLabels.get(slug) || slug).trim().toLowerCase();
    return name.includes(q);
  }

  function renderAll() {
    renderSelection();
    renderPicker();
    updateStatus();
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
    if (!selectionPillsEl || !scopeContext) return;
    const count = renderProductScopePills(selectionPillsEl, scopeContext, {
      productPaths: selectedProducts,
      categorySlugs: selectedCategories,
      removable: true,
      emptyText: 'Nothing selected yet — pick items below.',
    });
    if (clearAllBtn) clearAllBtn.disabled = count === 0;
  }

  function renderPicker() {
    if (!pickerEl || !scopeContext) return;
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
          label: scopeContext.categoryLabels.get(slug) || slug,
        });
      });
    }

    if (filterMode === 'skus') {
      (scopeContext.variantSkuEntries || []).forEach(({ token, variant, parent }) => {
        if (!skuMatchesSearch(variant, parent)) return;
        const label = String(variant?.title || '').trim()
          || String(variant?.sku || '').trim()
          || productPathDisplayLabel(token);
        rows.push({ kind: 'product', key: token, label });
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
        pickerEl.appendChild(createProductScopePillEl(scopeContext, row.key, {
          query: q,
          picker: true,
          selected: selectedProducts.has(row.key),
        }));
      } else {
        pickerEl.appendChild(createCategoryScopePillEl(scopeContext, row.key, {
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
    const skuCount = scopeContext?.variantSkuEntries?.length ?? 0;
    if (filterMode === 'skus') {
      statusEl.textContent = `${skuCount} SKUs`;
    } else {
      statusEl.textContent = `${parentProducts.length} products · ${categorySlugs.length} categories`;
    }
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
      scopeContext = await loadProductScopeIndexContext(localePath);
      parentProducts = scopeContext.parentProducts;
      categorySlugs = scopeContext.categorySlugs;
    } catch (err) {
      loadError = err?.message || 'Failed to load product index';
      scopeContext = null;
      parentProducts = [];
      categorySlugs = [];
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
      if (mode !== 'all' && mode !== 'products' && mode !== 'categories' && mode !== 'skus') return;
      filterMode = /** @type {PickerFilter} */ (mode);
      filterTabs.forEach((t) => {
        const pressed = t === tab;
        t.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      });
      if (searchEl) {
        searchEl.placeholder = mode === 'skus'
          ? 'Filter by SKU, variant name, or parent product…'
          : 'Filter by product or category name…';
      }
      renderPicker();
      updateStatus();
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
