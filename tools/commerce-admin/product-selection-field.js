/**
 * Embeddable merged product + category scope field (form + read-only summary).
 * Persists via separate hidden comma-separated inputs; opens product selector in a modal to edit.
 */

import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';
import { formatProductConditionEntry, productConditionDisplayLabel } from './product-conditions.js';
import {
  loadProductScopeIndexContext,
  productPathDisplayLabel,
  renderProductScopePills,
} from './product-scope-pills.js';
import {
  formatCommaList,
  mountProductSelector,
  parseCommaList,
  PRODUCT_SELECTOR_INDEX_LOCALES,
} from './product-selector.js';

const VALID_SELECTOR_LOCALES = new Set(PRODUCT_SELECTOR_INDEX_LOCALES);

let stylesInjected = false;

function ensureProductSelectionStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  ['product-scope-pills.css', 'product-selector.css', 'product-selection-field.css'].forEach((href) => {
    if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  });
}

/**
 * Map coupon / PIM locale paths to a product-selector index option.
 *
 * @param {string} localePath
 * @returns {string}
 */
export function localePathForProductSelector(localePath) {
  const p = String(localePath || '').trim() || 'us/en_us';
  if (p === 'ca/en_ca') return 'ca/en_us';
  if (VALID_SELECTOR_LOCALES.has(p)) return p;
  return 'us/en_us';
}

/**
 * AEM products index path for fetch — always `/<country>/en_us/` (storefront catalog index).
 *
 * @param {string} localePath
 * @returns {string}
 */
export function indexFetchPathForLocale(localePath) {
  const p = String(localePath || '').trim() || 'us/en_us';
  const country = p.split('/')[0]?.toLowerCase();
  if (country && /^[a-z]{2}$/.test(country)) return `${country}/en_us`;
  return 'us/en_us';
}

/**
 * @param {unknown} productsRaw
 * @param {unknown} categoriesRaw
 * @returns {Array<{ kind: 'product' | 'category'; key: string; label: string }>}
 */
export function mergedProductScopeItems(productsRaw, categoriesRaw) {
  /** @type {Array<{ kind: 'product' | 'category'; key: string; label: string }>} */
  const items = [];
  const cats = Array.isArray(categoriesRaw) ? categoriesRaw : [];
  cats.forEach((c) => {
    const key = String(c ?? '').trim();
    if (!key) return;
    items.push({ kind: 'category', key, label: key });
  });
  const prods = Array.isArray(productsRaw) ? productsRaw : [];
  prods.forEach((entry) => {
    const key = formatProductConditionEntry(entry);
    if (!key) return;
    items.push({
      kind: 'product',
      key,
      label: productConditionDisplayLabel(entry) || productPathDisplayLabel(key),
    });
  });
  items.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  return items;
}

/**
 * @param {unknown} productsRaw
 * @param {unknown} categoriesRaw
 * @param {string} emptyHtml
 * @returns {string}
 */
export function mergedProductScopeTagsHtml(productsRaw, categoriesRaw, emptyHtml) {
  const items = mergedProductScopeItems(productsRaw, categoriesRaw);
  if (!items.length) return emptyHtml;
  return '<span class="ps-pills-empty psf-scope-loading">Loading…</span>';
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   productsRaw: unknown;
 *   categoriesRaw: unknown;
 *   localePath: string;
 *   emptyText?: string;
 * }} options
 */
export async function hydrateProductScopePills(container, options) {
  ensureProductSelectionStyles();
  const {
    productsRaw,
    categoriesRaw,
    localePath,
    emptyText = 'None',
  } = options;

  const productPaths = [];
  let prods = [];
  if (Array.isArray(productsRaw)) prods = productsRaw;
  else if (typeof productsRaw === 'string' && productsRaw.trim()) {
    prods = productsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  prods.forEach((entry) => {
    const key = typeof entry === 'string' ? entry : formatProductConditionEntry(entry);
    if (key) productPaths.push(key);
  });
  let categorySlugs = [];
  if (Array.isArray(categoriesRaw)) {
    categorySlugs = categoriesRaw.map((c) => String(c ?? '').trim()).filter(Boolean);
  } else if (typeof categoriesRaw === 'string' && categoriesRaw.trim()) {
    categorySlugs = categoriesRaw.split(',').map((s) => s.trim()).filter(Boolean);
  }

  if (!productPaths.length && !categorySlugs.length) {
    container.innerHTML = `<span class="coupons-muted">${escapeHtml(emptyText)}</span>`;
    return;
  }

  container.classList.add('ps-pills');
  try {
    const selectorLocale = localePathForProductSelector(localePath);
    const ctx = await loadProductScopeIndexContext(selectorLocale, {
      indexFetchPath: indexFetchPathForLocale(localePath),
    });
    renderProductScopePills(container, ctx, {
      productPaths,
      categorySlugs,
      emptyText,
    });
  } catch {
    container.innerHTML = mergedProductScopeItems(productsRaw, categoriesRaw)
      .map((item) => `<span class="coupons-mini-tag">${escapeHtml(item.label)}</span>`)
      .join('');
  }
}

/**
 * @param {{
 *   title: string;
 *   localePath: string;
 *   products: string;
 *   categories: string;
 * }} options
 * @returns {Promise<{ products: string; categories: string } | null>}
 */
export function openProductSelectorModal(options) {
  ensureProductSelectionStyles();
  const {
    title,
    localePath,
    products = '',
    categories = '',
  } = options;

  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ps-modal-dialog';
    dialog.innerHTML = `
      <div class="ps-modal-inner">
        <h2 class="ps-modal-title"></h2>
        <div class="ps-modal-body"></div>
        <div class="ps-modal-actions">
          <button type="button" class="ps-modal-btn" data-ps-modal-cancel>Cancel</button>
          <button type="button" class="ps-modal-btn ps-modal-btn-primary" data-ps-modal-apply>Apply</button>
        </div>
      </div>`;

    const titleEl = dialog.querySelector('.ps-modal-title');
    const bodyEl = dialog.querySelector('.ps-modal-body');
    if (titleEl) titleEl.textContent = title;
    if (!bodyEl) {
      resolve(null);
      return;
    }

    const productsInput = document.createElement('input');
    productsInput.type = 'text';
    productsInput.value = products;
    const categoriesInput = document.createElement('input');
    categoriesInput.type = 'text';
    categoriesInput.value = categories;

    const selectorHost = document.createElement('div');
    bodyEl.appendChild(selectorHost);

    let settled = false;
    /** @type {{ destroy: () => void } | null} */
    let selectorApi = null;
    const finish = (/** @type {{ products: string; categories: string } | null} */ result) => {
      if (settled) return;
      settled = true;
      selectorApi?.destroy();
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(result);
    };

    selectorApi = mountProductSelector(selectorHost, {
      productsInput,
      categoriesInput,
      localePath: localePathForProductSelector(localePath),
      syncUrl: false,
    });

    dialog.querySelector('[data-ps-modal-cancel]')?.addEventListener('click', () => finish(null));
    dialog.querySelector('[data-ps-modal-apply]')?.addEventListener('click', () => {
      finish({
        products: productsInput.value,
        categories: categoriesInput.value,
      });
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) finish(null);
    });
    wireDialogEscapeDismiss(dialog, () => finish(null));

    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   productsInput: HTMLInputElement;
 *   categoriesInput: HTMLInputElement;
 *   getLocalePath: () => string;
 *   label?: string;
 *   emptyText?: string;
 *   editable?: boolean;
 * }} options
 */
export function mountProductSelectionField(container, options) {
  ensureProductSelectionStyles();
  const {
    productsInput,
    categoriesInput,
    getLocalePath,
    label = 'Products',
    emptyText = 'None — click to select products and categories.',
    editable = true,
  } = options;

  if (!container || !productsInput || !categoriesInput) {
    throw new Error('mountProductSelectionField: container and sync inputs are required');
  }

  productsInput.classList.add('psf-value-input');
  categoriesInput.classList.add('psf-value-input');
  productsInput.readOnly = true;
  categoriesInput.readOnly = true;
  productsInput.tabIndex = -1;
  categoriesInput.tabIndex = -1;
  productsInput.setAttribute('aria-hidden', 'true');
  categoriesInput.setAttribute('aria-hidden', 'true');

  const root = document.createElement('div');
  root.className = 'psf-root';
  root.innerHTML = `
    <div class="psf-display${editable ? ' psf-display-editable' : ''}" ${editable ? 'role="button" tabindex="0"' : ''}>
      <div class="ps-pills psf-pills" aria-live="polite"></div>
      <span class="psf-empty"></span>
    </div>
    ${editable ? '<button type="button" class="psf-edit-btn">Edit selection…</button>' : ''}`;

  const displayEl = root.querySelector('.psf-display');
  const pillsEl = root.querySelector('.psf-pills');
  const emptyEl = root.querySelector('.psf-empty');
  const editBtn = root.querySelector('.psf-edit-btn');
  if (emptyEl) emptyEl.textContent = emptyText;

  container.replaceChildren(root);

  /** @type {import('./product-scope-pills.js').ProductScopeIndexContext | null} */
  let scopeContext = null;
  let scopeLocaleKey = '';

  async function ensureScopeContext() {
    const rawLocale = getLocalePath();
    const key = `${localePathForProductSelector(rawLocale)}|${indexFetchPathForLocale(rawLocale)}`;
    if (scopeContext && scopeLocaleKey === key) return scopeContext;
    scopeLocaleKey = key;
    scopeContext = await loadProductScopeIndexContext(
      localePathForProductSelector(rawLocale),
      { indexFetchPath: indexFetchPathForLocale(rawLocale) },
    );
    return scopeContext;
  }

  function renderDisplay() {
    if (!pillsEl || !emptyEl || !displayEl) return;
    const hasProducts = parseCommaList(productsInput.value).length > 0;
    const hasCategories = parseCommaList(categoriesInput.value).length > 0;
    if (!hasProducts && !hasCategories) {
      emptyEl.hidden = false;
      displayEl.classList.add('psf-display-empty');
      pillsEl.replaceChildren();
      return;
    }
    emptyEl.hidden = true;
    displayEl.classList.remove('psf-display-empty');
    if (!scopeContext) {
      pillsEl.replaceChildren();
      const loading = document.createElement('span');
      loading.className = 'ps-pills-empty';
      loading.textContent = 'Loading…';
      pillsEl.appendChild(loading);
      return;
    }
    renderProductScopePills(pillsEl, scopeContext, {
      productPaths: parseCommaList(productsInput.value),
      categorySlugs: parseCommaList(categoriesInput.value),
      emptyText,
    });
  }

  function dispatchInputChange() {
    productsInput.dispatchEvent(new Event('input', { bubbles: true }));
    categoriesInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setValues(products, categories) {
    const nextProducts = formatCommaList(products);
    const nextCategories = formatCommaList(categories);
    if (productsInput.value !== nextProducts) productsInput.value = nextProducts;
    if (categoriesInput.value !== nextCategories) categoriesInput.value = nextCategories;
    renderDisplay();
  }

  async function refresh() {
    scopeLocaleKey = '';
    try {
      await ensureScopeContext();
    } catch {
      scopeContext = null;
    }
    renderDisplay();
  }

  async function openEditor() {
    if (!editable) return;
    const result = await openProductSelectorModal({
      title: label,
      localePath: getLocalePath(),
      products: productsInput.value,
      categories: categoriesInput.value,
    });
    if (!result) return;
    setValues(parseCommaList(result.products), parseCommaList(result.categories));
    dispatchInputChange();
    await refresh();
  }

  const onSyncInput = () => {
    renderDisplay();
  };

  productsInput.addEventListener('input', onSyncInput);
  categoriesInput.addEventListener('input', onSyncInput);

  if (editable && displayEl) {
    displayEl.addEventListener('click', () => { openEditor().catch(() => {}); });
    displayEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openEditor().catch(() => {});
      }
    });
  }
  editBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditor().catch(() => {});
  });

  refresh().catch(() => renderDisplay());

  return {
    refresh,
    setValues,
    openEditor,
    destroy: () => {
      productsInput.removeEventListener('input', onSyncInput);
      categoriesInput.removeEventListener('input', onSyncInput);
      container.replaceChildren();
    },
  };
}

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
