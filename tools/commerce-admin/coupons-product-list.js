/**
 * Product-list coupon editing — the "Product list" tab of the coupon form.
 *
 * A product-list coupon carries a `discountedProducts` array (helix-commerce-api)
 * mapping a product `path` (+ optional variant `sku`) to an absolute final
 * per-unit `price`, using the same format as catalog promotions. The cheaper of
 * the current effective price and the coupon price always wins per line.
 *
 * This module renders/collects the editable grid only; the coupon form
 * (coupons-page.js) owns the shared fields, the tab switching, and the save body
 * assembly (which omits the flat-discount/scoping fields the API rejects on a
 * product-list coupon).
 */
import { escapeHtml, showToast } from './commerce-otp-ui.js';
import {
  catalogPathToProductUrl,
  catalogPriceStringForApi,
  productUrlToCatalogPath,
} from './price-rules-api.js';
import {
  fetchProductsIndexForLocale,
  getParentProducts,
  getUrlKeyFromProduct,
  resolveImageUrlForLocale,
} from './pim.js';

const PLC_TSV_HEADER = 'Path\tSKU\tPrice';
const COUPON_COUNTRY_ORDER = ['us', 'ca', 'mx'];

/**
 * @param {string} raw path or full URL
 * @returns {string}
 */
function resolveProductUrlForRow(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith('/')) return catalogPathToProductUrl(t);
  return t;
}

/** @param {unknown} c */
function cleanCouponProductListTsvCell(c) {
  return String(c ?? '').replace(/^\uFEFF/, '').replace(/\u00a0/g, ' ').trim();
}

/** @param {string} line */
function isCouponProductListTsvHeaderLine(line) {
  const s = String(line || '').toLowerCase();
  return /\bpath\b/.test(s) && (/\bsku\b/.test(s) || /\bprice\b/.test(s));
}

/** @param {string} value */
function couponProductListTsvCell(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
}

/** @param {ParentNode} dlg */
function readCouponCountryCheckboxValues(dlg, selector) {
  return Array.from(dlg.querySelectorAll(selector))
    .filter((el) => el instanceof HTMLInputElement && el.checked)
    .map((el) => String(el.value || '').trim().toLowerCase())
    .filter(Boolean);
}

/** @param {ParentNode} dlg */
function couponDialogCountryKeySafe(dlg) {
  const fromNew = readCouponCountryCheckboxValues(dlg, 'input.cp-new-country-cb');
  if (fromNew.length) {
    return COUPON_COUNTRY_ORDER.find((k) => fromNew.includes(k)) || fromNew[0];
  }
  const fromEdit = readCouponCountryCheckboxValues(dlg, 'input.cp-edit-country-cb');
  if (fromEdit.length) {
    return COUPON_COUNTRY_ORDER.find((k) => fromEdit.includes(k)) || fromEdit[0];
  }
  return 'us';
}

function catalogLocaleFromVitamixProductUrl(productUrl) {
  try {
    const u = new URL(productUrl);
    const m = u.pathname.match(/\/(us|ca|mx)\/([a-z]{2}_[a-z]{2})\//i);
    if (m) return `${m[1].toLowerCase()}/${m[2].toLowerCase()}`;
  } catch {
    /* ignore */
  }
  return '';
}

function urlKeyFromVitamixProductUrl(productUrl) {
  try {
    const u = new URL(productUrl);
    const marker = '/products/';
    const i = u.pathname.indexOf(marker);
    if (i === -1) return '';
    return u.pathname.slice(i + marker.length).replace(/\/$/, '');
  } catch {
    return '';
  }
}

/**
 * @param {Array<{ product: string }>} rows
 * @param {string} countryKey
 */
function pickCatalogLocaleForCouponRows(rows, countryKey) {
  const locales = rows.map((r) => catalogLocaleFromVitamixProductUrl(r.product)).filter(Boolean);
  if (locales.length) {
    const counts = new Map();
    locales.forEach((loc) => {
      counts.set(loc, (counts.get(loc) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  if (countryKey === 'ca') return 'ca/en_ca';
  if (countryKey === 'mx') return 'us/en_us';
  return 'us/en_us';
}

/** @param {string} [imgSrc] @param {number} [size] */
export function couponProductThumbInnerHtml(imgSrc, size = 48) {
  if (imgSrc) {
    return `<img src="${escapeHtml(imgSrc)}" alt="" loading="lazy" width="${size}" height="${size}" class="pim-thumb-img" />`;
  }
  return '<span class="pim-thumb-placeholder" aria-hidden="true"></span>';
}

/**
 * @param {Array<{ path?: string, sku?: string, price?: string|number }>} entries
 * @param {string} countryKey
 * @returns {Promise<Map<string, string>>} catalog path → thumb URL
 */
export async function buildThumbUrlMapForCouponEntries(entries, countryKey) {
  const rows = (entries || [])
    .map((e) => {
      const product = resolveProductUrlForRow(String(e?.path ?? '').trim());
      const path = productUrlToCatalogPath(product) || String(e?.path ?? '').trim();
      return product && path ? { product, path } : null;
    })
    .filter(Boolean);
  if (!rows.length) return new Map();
  const urlMap = await buildThumbUrlMapForCouponRows(
    rows.map((r) => ({ product: r.product })),
    countryKey,
  );
  /** @type {Map<string, string>} */
  const pathMap = new Map();
  rows.forEach((r) => {
    const src = urlMap.get(r.product);
    if (src) pathMap.set(r.path, src);
  });
  return pathMap;
}

/**
 * Read-only discounted-products table for the coupon detail modal (thumb column
 * like promotions sale-line table).
 * @param {Array<{ path?: string, sku?: string, price?: string|number }>} entries
 * @param {Map<string, string>} [thumbByPath]
 */
export function couponDiscountedProductsDetailSectionHtml(entries, thumbByPath) {
  const thumbs = thumbByPath && thumbByPath.size ? thumbByPath : null;
  const rows = (entries || []).map((e) => {
    const path = String(e?.path ?? '');
    const sku = e?.sku ? escapeHtml(String(e.sku)) : '—';
    const price = escapeHtml(String(e?.price ?? ''));
    const imgSrc = thumbs?.get(path) || '';
    return `<tr>
      <td class="pim-col-thumb cp-plc-detail-thumb">${couponProductThumbInnerHtml(imgSrc)}</td>
      <td><code>${escapeHtml(path)}</code></td>
      <td>${sku}</td>
      <td>$${price}</td>
    </tr>`;
  }).join('');
  return `<section class="coupons-modal-section">
    <h3 class="coupons-modal-section-title">Discounted products</h3>
    <p class="coupons-field-hint" style="margin:0 0 8px">Each product path (and optional variant SKU) is discounted to this absolute per-unit price when the coupon code is applied.</p>
    <table class="cp-plc-detail-grid">
      <thead><tr>
        <th class="pim-col-thumb" scope="col"><span class="pim-sr-only">Image</span></th>
        <th scope="col">Product path</th>
        <th scope="col">SKU</th>
        <th scope="col">Price</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

const COUPON_OVERVIEW_THUMB_LIMIT = 4;

/**
 * Discount column cell for product-list coupons in the programs overview grid.
 * Thumbnails are filled asynchronously via {@link hydrateCouponOverviewProductListThumbs}.
 * @param {Array<{ path?: string, sku?: string, price?: string|number }>} entries
 * @param {string} couponId
 */
export function couponOverviewProductListDiscountHtml(entries, couponId) {
  const list = Array.isArray(entries) ? entries : [];
  const n = list.length;
  const thumbPlaceholders = list.slice(0, COUPON_OVERVIEW_THUMB_LIMIT).map((e) => {
    const path = String(e?.path ?? '').trim();
    return `<span class="cp-plc-overview-thumb" data-cp-plc-overview-thumb data-cp-plc-path="${escapeHtml(path)}">${couponProductThumbInnerHtml('', 32)}</span>`;
  }).join('');
  const overflow = n > COUPON_OVERVIEW_THUMB_LIMIT
    ? `<span class="cp-plc-overview-thumb-overflow">+${n - COUPON_OVERVIEW_THUMB_LIMIT}</span>`
    : '';
  const ariaLabel = `${n} discounted product${n === 1 ? '' : 's'}`;
  return `<div class="cp-plc-overview-discount" data-cp-plc-overview-discount data-cp-coupon-id="${escapeHtml(couponId)}" aria-label="${escapeHtml(ariaLabel)}">
    <span class="cp-plc-overview-thumb-strip" aria-hidden="true">${thumbPlaceholders}${overflow}</span>
  </div>`;
}

/**
 * Fill overview-grid thumbnail placeholders for product-list coupons.
 * @param {ParentNode} mount
 * @param {(couponId: string) => string} countryKeyForCouponId
 */
export async function hydrateCouponOverviewProductListThumbs(mount, countryKeyForCouponId) {
  const cells = mount.querySelectorAll('[data-cp-plc-overview-discount]');
  await Promise.all([...cells].map(async (cell) => {
    const id = cell.getAttribute('data-cp-coupon-id');
    if (!id) return;
    const thumbEls = cell.querySelectorAll('[data-cp-plc-overview-thumb]');
    const paths = [...thumbEls]
      .map((el) => el.getAttribute('data-cp-plc-path'))
      .filter((p) => p && String(p).trim());
    if (!paths.length) return;
    const thumbMap = await buildThumbUrlMapForCouponEntries(
      paths.map((path) => ({ path })),
      countryKeyForCouponId(id),
    );
    thumbEls.forEach((el) => {
      const path = el.getAttribute('data-cp-plc-path');
      const src = path ? thumbMap.get(path) : '';
      el.innerHTML = couponProductThumbInnerHtml(src, 32);
    });
  }));
}

/**
 * @param {Array<{ product: string }>} rows
 * @param {string} countryKey
 * @returns {Promise<Map<string, string>>}
 */
async function buildThumbUrlMapForCouponRows(rows, countryKey) {
  const map = new Map();
  if (!rows.length) return map;
  const locale = pickCatalogLocaleForCouponRows(rows, countryKey);
  try {
    const json = await fetchProductsIndexForLocale(locale);
    const raw = Array.isArray(json) ? json : (json?.data ?? []);
    const data = Array.isArray(raw) ? raw : [];
    const parents = getParentProducts(data);
    const byUrlKey = new Map();
    parents.forEach((p) => {
      const k = getUrlKeyFromProduct(p);
      if (!k || !p.image) return;
      byUrlKey.set(String(k).toLowerCase(), resolveImageUrlForLocale(locale, p.image));
    });
    rows.forEach((r) => {
      const slug = urlKeyFromVitamixProductUrl(r.product);
      const src = slug ? byUrlKey.get(String(slug).toLowerCase()) : '';
      if (src) map.set(r.product, src);
    });
  } catch (err) {
    /* eslint-disable-next-line no-console -- intentional: index/CORS failures are non-fatal */
    console.warn('[commerce-admin/coupons] catalog index for thumbnails failed', {
      locale,
      message: err?.message || String(err),
    });
  }
  return map;
}

/** @param {HTMLTableRowElement} tr */
function syncCouponProductListRowView(tr) {
  const hProduct = /** @type {HTMLInputElement | null} */ (tr.querySelector('.cp-plc-h-product'));
  const pathEl = tr.querySelector('.cp-plc-path-text');
  const path = productUrlToCatalogPath(hProduct?.value || '');
  if (pathEl) pathEl.textContent = path || '—';
}

/**
 * @param {HTMLElement} dlg
 * @param {string} countryKey
 */
async function hydrateCouponProductListThumbs(dlg, countryKey) {
  const rows = [];
  dlg.querySelectorAll('tr[data-cp-plc-row]').forEach((tr) => {
    const u = String(tr.querySelector('.cp-plc-h-product')?.value ?? '').trim();
    if (u) rows.push({ product: u });
  });
  const map = rows.length ? await buildThumbUrlMapForCouponRows(rows, countryKey) : new Map();
  dlg.querySelectorAll('tr[data-cp-plc-row]').forEach((tr) => {
    const u = String(tr.querySelector('.cp-plc-h-product')?.value ?? '').trim();
    const cell = tr.querySelector('.cp-plc-thumb-cell');
    if (!cell) return;
    if (!u) {
      cell.innerHTML = '<span class="pim-thumb-placeholder" aria-hidden="true"></span>';
      return;
    }
    const src = map.get(u) || '';
    cell.innerHTML = src
      ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" width="48" height="48" class="pim-thumb-img" />`
      : '<span class="pim-thumb-placeholder" aria-hidden="true"></span>';
  });
}

/** @param {HTMLElement} dlg */
function refreshCouponProductListVisuals(dlg) {
  dlg.querySelectorAll('tr[data-cp-plc-row]').forEach((tr) => {
    if (tr instanceof HTMLTableRowElement) syncCouponProductListRowView(tr);
  });
  hydrateCouponProductListThumbs(dlg, couponDialogCountryKeySafe(dlg)).catch(() => {});
}

/** @param {HTMLTableRowElement} tr */
function couponProductListRowTsvFromDom(tr) {
  const product = String(tr.querySelector('.cp-plc-h-product')?.value ?? '').trim();
  const path = productUrlToCatalogPath(product)
    || String(tr.querySelector('.cp-plc-path-text')?.textContent ?? '').trim();
  const sku = String(tr.querySelector('.cp-plc-input-sku')?.value ?? '').trim();
  const price = String(tr.querySelector('.cp-plc-input-price')?.value ?? '').trim();
  if (!path && !sku && !price) return '';
  return [
    couponProductListTsvCell(path === '—' ? '' : path),
    couponProductListTsvCell(sku),
    couponProductListTsvCell(price),
  ].join('\t');
}

/** @param {HTMLElement} dlg */
function syncCouponProductListTsvFromDom(dlg) {
  const ta = dlg.querySelector('#cp-plc-tsv-paste');
  if (!(ta instanceof HTMLTextAreaElement)) return;
  const rowLines = [...dlg.querySelectorAll('[data-cp-plc-row]')]
    .map((line) => (line instanceof HTMLTableRowElement ? couponProductListRowTsvFromDom(line) : ''))
    .filter(Boolean);
  ta.value = rowLines.length
    ? `${PLC_TSV_HEADER}\n${rowLines.join('\n')}`
    : PLC_TSV_HEADER;
}

/** @param {HTMLElement} dlg */
function closeCouponProductListPathEdits(dlg) {
  dlg.querySelectorAll('.cp-plc-cell-edit').forEach((el) => {
    /** @type {HTMLElement} */ (el).hidden = true;
  });
  dlg.querySelectorAll('.cp-plc-cell-view').forEach((v) => {
    v.classList.remove('cp-plc-cell-view-active');
  });
}

/** @param {HTMLElement} dlg */
function commitCouponProductListFieldsBeforeSave(dlg) {
  const ae = document.activeElement;
  if (
    ae instanceof HTMLElement
    && dlg.contains(ae)
    && ae.closest('.cp-plc-cell-edit')
  ) {
    ae.blur();
  }
  dlg.querySelectorAll('.cp-plc-cell-edit').forEach((edit) => {
    if (!(edit instanceof HTMLElement) || edit.hidden) return;
    const cell = edit.closest('.cp-plc-cell');
    const tr = edit.closest('tr[data-cp-plc-row]');
    if (!cell || !tr || !(tr instanceof HTMLTableRowElement)) return;
    const inp = /** @type {HTMLInputElement | null} */ (edit.querySelector('.cp-plc-input-product'));
    const h = tr.querySelector('.cp-plc-h-product');
    if (inp && h && 'value' in h) {
      /** @type {HTMLInputElement} */ (h).value = resolveProductUrlForRow(inp.value);
    }
    edit.hidden = true;
    cell.querySelector('.cp-plc-cell-view')?.classList.remove('cp-plc-cell-view-active');
    syncCouponProductListRowView(tr);
  });
  hydrateCouponProductListThumbs(dlg, couponDialogCountryKeySafe(dlg)).catch(() => {});
}

/** @param {{ path?: string, sku?: string, price?: string|number }} entry @param {number} index */
function couponProductListRowHtml(entry, index) {
  const productUrl = resolveProductUrlForRow(String(entry?.path ?? '').trim());
  const path = productUrlToCatalogPath(productUrl);
  const sku = String(entry?.sku ?? '').trim();
  const price = entry?.price == null || entry.price === '' ? '' : String(entry.price).trim();
  return `<tr class="cp-plc-row" data-cp-plc-row data-cp-plc-row-idx="${index}">
    <td class="cp-plc-col-del">
      <button type="button" class="coupons-btn cp-plc-row-remove-btn" data-cp-plc-row-remove aria-label="Remove row">×</button>
    </td>
    <td class="cp-plc-col-num">${index + 1}</td>
    <td class="cp-plc-cell cp-plc-cell-wide" data-field="product">
      <input type="hidden" class="cp-plc-h-product" value="${escapeHtml(productUrl)}" />
      <div class="cp-plc-cell-view cp-plc-product-view" tabindex="0" role="button">
        <span class="cp-plc-thumb-cell"></span>
        <code class="cp-plc-path-text">${path ? escapeHtml(path) : '—'}</code>
      </div>
      <div class="cp-plc-cell-edit" hidden>
        <input type="text" class="cp-plc-input-product" placeholder="/us/en_us/products/… or https://…" autocomplete="off" spellcheck="false" />
      </div>
    </td>
    <td class="cp-plc-cell">
      <input type="text" class="cp-plc-input-sku" value="${escapeHtml(sku)}" placeholder="optional variant SKU" autocomplete="off" spellcheck="false" />
    </td>
    <td class="cp-plc-cell cp-plc-col-price">
      <input type="text" class="cp-plc-input-price" value="${escapeHtml(price)}" inputmode="decimal" placeholder="429.95" autocomplete="off" />
    </td>
  </tr>`;
}

/**
 * Full "Discounted products" section for the product-list tab. Seeds one empty
 * row when no entries are given so there is always something to type into.
 * @param {Array<{ path?: string, sku?: string, price?: string|number }>} [entries]
 */
export function couponProductListSectionHtml(entries = []) {
  const rows = Array.isArray(entries) && entries.length ? entries : [{}];
  const rowsHtml = rows.map((e, i) => couponProductListRowHtml(e, i)).join('');
  return `<div class="coupons-field coupons-field-full cp-plc-group" data-cp-plc-only hidden>
    <div class="cp-plc-header">
      <h3 class="cp-form-options-title" style="margin:0">Discounted products</h3>
      <button type="button" class="coupons-btn" data-cp-plc-row-add>Add row</button>
    </div>
    <p class="coupons-field-hint">Each row maps a product path (and optional variant SKU) to an absolute final per-unit price, gated behind the coupon code — the same format as promotions. The cheaper of the current price and this price always wins. Paste a full product URL or a path; paths are normalized on save.</p>
    <div class="cp-plc-lines-wrap">
      <div class="cp-plc-lines-scroll">
        <table class="cp-plc-grid" aria-label="Discounted products">
          <thead>
            <tr>
              <th scope="col" class="cp-plc-col-del"><span class="pim-sr-only">Remove</span></th>
              <th scope="col" class="cp-plc-col-num">#</th>
              <th scope="col">Product path</th>
              <th scope="col">SKU (optional)</th>
              <th scope="col" class="cp-plc-col-price">Price</th>
            </tr>
          </thead>
          <tbody id="cp-plc-lines-tbody">${rowsHtml}</tbody>
        </table>
      </div>
      <details class="cp-plc-tsv-import">
        <summary>Import from spreadsheet (TSV)</summary>
        <p class="coupons-field-hint" style="margin-top:8px">Paste tab-separated columns in order:
          <strong>Path</strong>, <strong>SKU</strong> (optional), <strong>Price</strong>.
          A header row is ignored automatically. Product may be a path or full URL; prices may include <code>$</code>; values are normalized to plain numbers for the API. Opening this panel syncs the current grid into the box below.</p>
        <textarea id="cp-plc-tsv-paste" class="cp-plc-tsv-textarea" rows="6" spellcheck="false" placeholder="Path&#9;SKU&#9;Price"></textarea>
        <div class="cp-plc-tsv-actions">
          <button type="button" class="coupons-btn coupons-btn-primary" data-cp-plc-tsv-replace>Replace rows from paste</button>
          <button type="button" class="coupons-btn" data-cp-plc-tsv-append>Append rows from paste</button>
          <button type="button" class="coupons-btn" data-cp-plc-tsv-clear>Clear box</button>
        </div>
      </details>
    </div>
  </div>`;
}

/** @param {ParentNode} dlg */
function refreshCouponProductListIndices(dlg) {
  const rows = dlg.querySelectorAll('[data-cp-plc-row]');
  rows.forEach((row, i) => {
    row.setAttribute('data-cp-plc-row-idx', String(i));
    const num = row.querySelector('.cp-plc-col-num');
    if (num) num.textContent = String(i + 1);
    const rm = row.querySelector('[data-cp-plc-row-remove]');
    if (rm instanceof HTMLButtonElement) {
      rm.disabled = rows.length <= 1;
      if (rows.length <= 1) rm.setAttribute('aria-disabled', 'true');
      else rm.removeAttribute('aria-disabled');
    }
  });
}

/**
 * Parse pasted TSV into rows. Columns: Path, SKU (optional), Price. A leading
 * header row is skipped when detected.
 * @param {string} text
 */
function parseCouponProductListTsv(text) {
  const rawLines = String(text ?? '').split(/\r?\n/);
  let startIdx = 0;
  if (rawLines.length && isCouponProductListTsvHeaderLine(rawLines[0])) startIdx = 1;
  const out = [];
  rawLines.slice(startIdx).forEach((line) => {
    if (!String(line).trim()) return;
    const cols = line.split('\t');
    if (cols.length < 2) return;
    const rawPath = cleanCouponProductListTsvCell(cols[0]);
    const sku = cleanCouponProductListTsvCell(cols[1]);
    const price = cleanCouponProductListTsvCell(cols[2] ?? '');
    if (!rawPath || /^path$/i.test(rawPath)) return;
    if (!price) return;
    const productUrl = resolveProductUrlForRow(rawPath);
    const path = productUrlToCatalogPath(productUrl) || rawPath;
    out.push({ path, sku, price });
  });
  return out;
}

/** @param {HTMLElement} dlg */
function wireCouponProductListPathCells(dlg) {
  if (dlg.dataset.cpPlcPathCellsWired === '1') return;
  dlg.dataset.cpPlcPathCellsWired = '1';

  const tbody = dlg.querySelector('#cp-plc-lines-tbody');
  if (!tbody) return;

  const rehydrateThumbs = () => {
    hydrateCouponProductListThumbs(dlg, couponDialogCountryKeySafe(dlg)).catch(() => {});
  };

  dlg.querySelectorAll('input.cp-new-country-cb, input.cp-edit-country-cb').forEach((cb) => {
    cb.addEventListener('change', rehydrateThumbs);
  });

  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    const view = el.closest('.cp-plc-cell-view');
    if (!view) return;
    e.preventDefault();
    view.click();
  });

  tbody.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.closest('[data-cp-plc-row-remove]')) return;
    const view = t.closest('.cp-plc-cell-view');
    if (!view) return;
    const cell = view.closest('.cp-plc-cell');
    const tr = view.closest('tr[data-cp-plc-row]');
    if (!cell || !tr || !(tr instanceof HTMLTableRowElement)) return;
    if (cell.getAttribute('data-field') !== 'product') return;
    e.preventDefault();
    closeCouponProductListPathEdits(dlg);
    const edit = cell.querySelector('.cp-plc-cell-edit');
    const inp = /** @type {HTMLInputElement | null} */ (edit?.querySelector('.cp-plc-input-product'));
    if (!edit || !inp) return;
    const full = /** @type {HTMLInputElement} */ (tr.querySelector('.cp-plc-h-product')).value;
    inp.value = productUrlToCatalogPath(full) || full;
    /** @type {HTMLElement} */ (edit).hidden = false;
    view.classList.add('cp-plc-cell-view-active');
    inp.focus();
  });

  tbody.addEventListener('focusout', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !t.classList.contains('cp-plc-input-product')) return;
    const cell = t.closest('.cp-plc-cell');
    const tr = t.closest('tr[data-cp-plc-row]');
    if (!cell || !tr || !(tr instanceof HTMLTableRowElement)) return;
    const rt = /** @type {Node | null} */ (e.relatedTarget);
    if (rt && cell.contains(rt)) return;
    const edit = cell.querySelector('.cp-plc-cell-edit');
    if (!edit || /** @type {HTMLElement} */ (edit).hidden) return;

    /** @type {HTMLInputElement} */ (tr.querySelector('.cp-plc-h-product')).value = resolveProductUrlForRow(t.value);
    /** @type {HTMLElement} */ (edit).hidden = true;
    cell.querySelector('.cp-plc-cell-view')?.classList.remove('cp-plc-cell-view-active');
    syncCouponProductListRowView(tr);
    rehydrateThumbs();
  });
}

/** @param {HTMLElement} dlg */
export function wireCouponProductListRows(dlg) {
  wireCouponProductListPathCells(dlg);

  const tbody = dlg.querySelector('#cp-plc-lines-tbody');
  dlg.querySelector('[data-cp-plc-row-add]')?.addEventListener('click', () => {
    if (!tbody) return;
    const idx = tbody.querySelectorAll('[data-cp-plc-row]').length;
    tbody.insertAdjacentHTML('beforeend', couponProductListRowHtml({}, idx));
    refreshCouponProductListIndices(dlg);
    refreshCouponProductListVisuals(dlg);
    syncCouponProductListTsvFromDom(dlg);
  });
  tbody?.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (!t.closest('[data-cp-plc-row-remove]')) return;
    const row = t.closest('[data-cp-plc-row]');
    const all = tbody.querySelectorAll('[data-cp-plc-row]');
    if (!row || all.length <= 1) return;
    row.remove();
    refreshCouponProductListIndices(dlg);
    refreshCouponProductListVisuals(dlg);
    syncCouponProductListTsvFromDom(dlg);
  });

  const ta = /** @type {HTMLTextAreaElement | null} */ (dlg.querySelector('#cp-plc-tsv-paste'));
  const details = dlg.querySelector('.cp-plc-tsv-import');
  details?.addEventListener('toggle', () => {
    if (details instanceof HTMLDetailsElement && details.open) {
      syncCouponProductListTsvFromDom(dlg);
    }
  });
  dlg.querySelector('[data-cp-plc-tsv-clear]')?.addEventListener('click', () => {
    if (ta) ta.value = PLC_TSV_HEADER;
  });
  const applyParsed = (parsed, mode) => {
    if (!tbody) return;
    if (!parsed.length) {
      showToast('No valid rows found (need at least a path and price per line).', 'error');
      return;
    }
    if (mode === 'replace') {
      tbody.innerHTML = parsed.map((r, i) => couponProductListRowHtml(r, i)).join('');
    } else {
      const startIdx = tbody.querySelectorAll('[data-cp-plc-row]').length;
      tbody.insertAdjacentHTML(
        'beforeend',
        parsed.map((r, i) => couponProductListRowHtml(r, startIdx + i)).join(''),
      );
    }
    refreshCouponProductListIndices(dlg);
    refreshCouponProductListVisuals(dlg);
    syncCouponProductListTsvFromDom(dlg);
    showToast(`${mode === 'replace' ? 'Replaced with' : 'Appended'} ${parsed.length} row(s)`, 'success');
  };
  dlg.querySelector('[data-cp-plc-tsv-replace]')?.addEventListener('click', () => {
    applyParsed(parseCouponProductListTsv(ta?.value ?? ''), 'replace');
  });
  dlg.querySelector('[data-cp-plc-tsv-append]')?.addEventListener('click', () => {
    applyParsed(parseCouponProductListTsv(ta?.value ?? ''), 'append');
  });

  refreshCouponProductListVisuals(dlg);
}

/**
 * Collect the grid into `discountedProducts` entries, validating client-side to
 * match the API: path + price required, price a canonical number string ≥ 0, no
 * duplicate (path, sku) pairs. Fully-empty rows are skipped so a stray blank row
 * does not block save. Throws on the first invalid row.
 * @param {HTMLElement} dlg
 * @returns {Array<{ path: string, sku?: string, price: string }>}
 */
export function readCouponDiscountedProductsFromDom(dlg) {
  commitCouponProductListFieldsBeforeSave(dlg);
  const rows = Array.from(dlg.querySelectorAll('[data-cp-plc-row]'));
  const entries = [];
  const seen = new Set();
  rows.forEach((row) => {
    const productUrl = String(row.querySelector('.cp-plc-h-product')?.value ?? '').trim();
    const path = productUrlToCatalogPath(productUrl) || productUrl;
    const sku = /** @type {HTMLInputElement | null} */ (row.querySelector('.cp-plc-input-sku'))?.value?.trim() ?? '';
    const priceRaw = /** @type {HTMLInputElement | null} */ (row.querySelector('.cp-plc-input-price'))?.value?.trim() ?? '';
    if (!path && !sku && !priceRaw) return;
    if (!path) throw new Error('Each discounted product row needs a product path.');
    if (priceRaw === '') throw new Error(`Enter a price for ${path}.`);
    const price = catalogPriceStringForApi(priceRaw);
    if (!(parseFloat(price) >= 0)) throw new Error(`Price for ${path} must be a number greater than or equal to 0.`);
    const key = `${path}\0${sku}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate row for ${path}${sku ? ` (SKU ${sku})` : ''}.`);
    }
    seen.add(key);
    const entry = { path, price };
    if (sku) entry.sku = sku;
    entries.push(entry);
  });
  if (!entries.length) throw new Error('Add at least one discounted product.');
  return entries;
}

/**
 * Replace the grid rows with the given entries (edit flow). Seeds one empty row
 * when the list is empty.
 * @param {HTMLElement} dlg
 * @param {Array<{ path?: string, sku?: string, price?: string|number }>} entries
 */
export function fillCouponProductList(dlg, entries) {
  const tbody = dlg.querySelector('#cp-plc-lines-tbody');
  if (!tbody) return;
  const list = Array.isArray(entries) && entries.length ? entries : [{}];
  tbody.innerHTML = list.map((e, i) => couponProductListRowHtml(e, i)).join('');
  refreshCouponProductListIndices(dlg);
  refreshCouponProductListVisuals(dlg);
}
