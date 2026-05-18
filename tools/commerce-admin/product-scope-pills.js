/**
 * Shared product + category scope pills (DOM + index context).
 * Used by the product selector and embeddable selection field.
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

export const PILL_THUMB_PLACEHOLDER = '<span class="ps-pill-thumb-placeholder" aria-hidden="true"></span>';

/**
 * @typedef {'product' | 'category'} ScopePillKind
 */

/**
 * @typedef {{
 *   localePath: string;
 *   productByPath: Map<string, object>;
 *   categoryLabels: Map<string, string>;
 *   categoryThumbUrls: Map<string, string[]>;
 *   categoryProductCounts: Map<string, number>;
 *   parentProducts: object[];
 *   categorySlugs: string[];
 * }} ProductScopeIndexContext
 */

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
 * Category slugs on an index row.
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
 * @param {string} localePath
 * @param {object[]} products
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
 * @param {string[]} imageUrls
 * @param {string} [gridClass]
 * @returns {string}
 */
export function categoryThumbGridHtml(imageUrls, gridClass = 'ps-pill-thumb-grid') {
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
 * @param {string} selectorLocalePath locale used for image URLs and catalog paths
 * @param {{ indexFetchPath?: string }} [options]
 * @returns {Promise<ProductScopeIndexContext>}
 */
export async function loadProductScopeIndexContext(selectorLocalePath, options = {}) {
  const localePath = String(selectorLocalePath || 'us/en_us').trim() || 'us/en_us';
  const fetchPath = options.indexFetchPath || localePath;
  const json = await fetchProductsIndexForLocale(fetchPath);
  const data = json.data || json;
  const indexRows = Array.isArray(data) ? data : [];
  const parentProducts = getParentProducts(indexRows);
  const categoryLabels = buildCategoryLabels(indexRows);
  collectCategorySlugsFromIndexRows(indexRows).forEach((slug) => {
    if (!categoryLabels.has(slug)) categoryLabels.set(slug, slug);
  });

  /** @type {Map<string, object>} */
  const productByPath = new Map();
  parentProducts.forEach((p) => {
    const path = catalogPathForProduct(localePath, p);
    productByPath.set(path, p);
  });

  return {
    localePath,
    productByPath,
    categoryLabels,
    categoryThumbUrls: buildCategoryThumbUrls(localePath, parentProducts),
    categoryProductCounts: buildCategoryProductCounts(parentProducts),
    parentProducts,
    categorySlugs: collectCategorySlugsFromIndexRows(indexRows),
  };
}

/**
 * @param {ProductScopeIndexContext} ctx
 * @param {string} pathToken
 * @returns {object|undefined}
 */
function productForPath(ctx, pathToken) {
  return ctx.productByPath.get(pathToken)
    || ctx.productByPath.get(pathToken.split('|')[0]);
}

/**
 * @param {ProductScopeIndexContext} ctx
 * @param {string} path
 * @param {{
 *   query?: string;
 *   removable?: boolean;
 *   picker?: boolean;
 *   selected?: boolean;
 * }} [opts]
 * @returns {HTMLElement}
 */
export function createProductScopePillEl(ctx, path, opts = {}) {
  const {
    query = '', removable = false, picker = false, selected = false,
  } = opts;
  const product = productForPath(ctx, path);
  const title = product?.title || product?.sku || productPathDisplayLabel(path);
  const sub = productPathDisplayLabel(path);
  const imgUrl = product?.image ? resolveImageUrlForLocale(ctx.localePath, product.image) : '';
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
 * @param {ProductScopeIndexContext} ctx
 * @param {string} slug
 * @param {{
 *   query?: string;
 *   removable?: boolean;
 *   picker?: boolean;
 *   selected?: boolean;
 * }} [opts]
 * @returns {HTMLElement}
 */
export function createCategoryScopePillEl(ctx, slug, opts = {}) {
  const {
    query = '', removable = false, picker = false, selected = false,
  } = opts;
  const label = ctx.categoryLabels.get(slug) || slug;
  const showSlug = label !== slug;
  const thumbUrls = ctx.categoryThumbUrls.get(slug) || [];
  const thumbHtml = thumbUrls.length
    ? categoryThumbGridHtml(thumbUrls, 'ps-pill-thumb-grid')
    : PILL_THUMB_PLACEHOLDER;
  const countLabel = formatCategoryProductCount(ctx.categoryProductCounts.get(slug));
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

/**
 * @param {HTMLElement} container
 * @param {ProductScopeIndexContext} ctx
 * @param {{
 *   productPaths?: Iterable<string>;
 *   categorySlugs?: Iterable<string>;
 *   query?: string;
 *   removable?: boolean;
 *   picker?: boolean;
 *   isSelected?: (kind: ScopePillKind, key: string) => boolean;
 *   emptyText?: string;
 * }} options
 * @returns {number} pill count rendered
 */
export function renderProductScopePills(container, ctx, options = {}) {
  const {
    productPaths = [],
    categorySlugs = [],
    query = '',
    removable = false,
    picker = false,
    isSelected = () => false,
    emptyText = 'Nothing selected.',
  } = options;

  container.replaceChildren();

  /** @type {Array<{ kind: ScopePillKind; key: string; label: string }>} */
  const items = [];
  [...categorySlugs].forEach((slug) => {
    const key = String(slug || '').trim();
    if (!key) return;
    items.push({
      kind: 'category',
      key,
      label: ctx.categoryLabels.get(key) || key,
    });
  });
  [...productPaths].forEach((path) => {
    const key = String(path || '').trim();
    if (!key) return;
    const product = productForPath(ctx, key);
    items.push({
      kind: 'product',
      key,
      label: product?.title || product?.sku || productPathDisplayLabel(key),
    });
  });

  items.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

  if (!items.length) {
    const empty = document.createElement('span');
    empty.className = 'ps-pills-empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return 0;
  }

  items.forEach((item) => {
    const selected = picker && isSelected(item.kind, item.key);
    if (item.kind === 'product') {
      container.appendChild(createProductScopePillEl(ctx, item.key, {
        query, removable, picker, selected,
      }));
    } else {
      container.appendChild(createCategoryScopePillEl(ctx, item.key, {
        query, removable, picker, selected,
      }));
    }
  });
  return items.length;
}

export function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

export function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
