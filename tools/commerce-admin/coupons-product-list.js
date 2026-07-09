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
import { catalogPriceStringForApi } from './price-rules-api.js';

const PLC_TSV_HEADER = 'Path\tSKU\tPrice';

/** @param {{ path?: string, sku?: string, price?: string|number }} entry @param {number} index */
function couponProductListRowHtml(entry, index) {
  const path = String(entry?.path ?? '').trim();
  const sku = String(entry?.sku ?? '').trim();
  const price = entry?.price == null || entry.price === '' ? '' : String(entry.price).trim();
  return `<tr class="cp-plc-row" data-cp-plc-row data-cp-plc-row-idx="${index}">
    <td class="cp-plc-col-del">
      <button type="button" class="coupons-btn cp-plc-row-remove-btn" data-cp-plc-row-remove aria-label="Remove row">×</button>
    </td>
    <td class="cp-plc-col-num">${index + 1}</td>
    <td class="cp-plc-cell">
      <input type="text" class="cp-plc-input-path" value="${escapeHtml(path)}" placeholder="/us/en_us/products/…" autocomplete="off" spellcheck="false" />
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
    <p class="coupons-field-hint">Each row maps a product path (and optional variant SKU) to an absolute final per-unit price, gated behind the coupon code — the same format as promotions. The cheaper of the current price and this price always wins.</p>
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
          A header row is ignored automatically. Prices may include <code>$</code>; values are normalized to plain numbers for the API.</p>
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
 * header row (first cell equals "path", case-insensitive) is skipped.
 * @param {string} text
 */
function parseCouponProductListTsv(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '');
  const out = [];
  lines.forEach((line) => {
    const cols = line.split('\t');
    const path = String(cols[0] ?? '').trim();
    if (!path || /^path$/i.test(path)) return;
    out.push({
      path,
      sku: String(cols[1] ?? '').trim(),
      price: String(cols[2] ?? '').trim(),
    });
  });
  return out;
}

/** @param {HTMLElement} dlg */
export function wireCouponProductListRows(dlg) {
  const tbody = dlg.querySelector('#cp-plc-lines-tbody');
  dlg.querySelector('[data-cp-plc-row-add]')?.addEventListener('click', () => {
    if (!tbody) return;
    const idx = tbody.querySelectorAll('[data-cp-plc-row]').length;
    tbody.insertAdjacentHTML('beforeend', couponProductListRowHtml({}, idx));
    refreshCouponProductListIndices(dlg);
  });
  tbody?.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (!t.closest('[data-cp-plc-row-remove]')) return;
    const row = t.closest('[data-cp-plc-row]');
    const all = tbody.querySelectorAll('[data-cp-plc-row]');
    if (!row || all.length <= 1) return;
    row.remove();
    refreshCouponProductListIndices(dlg);
  });

  const ta = /** @type {HTMLTextAreaElement | null} */ (dlg.querySelector('#cp-plc-tsv-paste'));
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
    showToast(`${mode === 'replace' ? 'Replaced with' : 'Appended'} ${parsed.length} row(s)`, 'success');
  };
  dlg.querySelector('[data-cp-plc-tsv-replace]')?.addEventListener('click', () => {
    applyParsed(parseCouponProductListTsv(ta?.value ?? ''), 'replace');
  });
  dlg.querySelector('[data-cp-plc-tsv-append]')?.addEventListener('click', () => {
    applyParsed(parseCouponProductListTsv(ta?.value ?? ''), 'append');
  });
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
  const rows = Array.from(dlg.querySelectorAll('[data-cp-plc-row]'));
  const entries = [];
  const seen = new Set();
  rows.forEach((row) => {
    const path = /** @type {HTMLInputElement | null} */ (row.querySelector('.cp-plc-input-path'))?.value?.trim() ?? '';
    const sku = /** @type {HTMLInputElement | null} */ (row.querySelector('.cp-plc-input-sku'))?.value?.trim() ?? '';
    const priceRaw = /** @type {HTMLInputElement | null} */ (row.querySelector('.cp-plc-input-price'))?.value?.trim() ?? '';
    if (!path && !sku && !priceRaw) return;
    if (!path) throw new Error('Each discounted product row needs a product path.');
    if (priceRaw === '') throw new Error(`Enter a price for ${path}.`);
    const price = catalogPriceStringForApi(priceRaw);
    if (!(parseFloat(price) >= 0)) throw new Error(`Price for ${path} must be a number greater than or equal to 0.`);
    const key = `${path} ${sku}`;
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
}
