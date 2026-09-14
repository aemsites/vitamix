import {
  fetchProductsIndexForLocale,
  resolveImageUrlForLocale,
  getProductsBaseUrlForLocale,
  getParentProducts,
  getVariantProducts,
  getVariantCount,
  getUrlKeyFromProduct,
  showError,
} from './pim.js';
import { showToast } from './commerce-otp-ui.js';
import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';

const CORS_PROXY = 'https://fcors.org/?url=';
const CORS_KEY = '&key=Mg23N96GgR8O3NjU';

const CATALOG_PARAM = 'catalog';
const FILTER_PARAM = 'filter';
const VALID_FILTERS = ['all', 'OutOfStock', 'ManagedInventory', 'Discontinued', 'InStock'];

/** How many per-product JSON fetches (for custom.managedStock/inventoryQuantity) run at once. */
const MANAGED_STOCK_CONCURRENCY = 6;

let currentLocalePath = 'us/en_us';

/** @type {Array<object>} flattened SKU rows (parents + variants) for the current locale */
let allSkuRows = [];

/** @type {Map<string, Map<string, { managedStock: boolean, inventoryQuantity: number|null }>>} */
const stockInfoCacheByLocale = new Map();

/** @type {{ key: string, dir: number }} */
let sortState = { key: 'title', dir: 1 };

/** @type {string} 'all' | 'OutOfStock' | 'Discontinued' | 'ManagedInventory' | 'InStock' */
let activeFilter = 'all';

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
  return getParams().get(CATALOG_PARAM);
}

function readFilterFromParams() {
  const filter = getParams().get(FILTER_PARAM);
  return VALID_FILTERS.includes(filter) ? filter : null;
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

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMatch(text, query) {
  const safe = escapeHtml(text);
  if (!query || !query.trim()) return safe;
  const re = new RegExp(escapeRegex(query.trim()), 'gi');
  return safe.replace(re, (match) => `<mark class="pim-highlight">${match}</mark>`);
}

/**
 * Flatten index rows into one row per physically-stocked SKU: simple (non-configurable)
 * products, plus every variant of a configurable product. Configurable parent rows are
 * excluded — they're just a grouping and don't carry their own inventory.
 * Variant rows inherit the parent's urlKey (for navigation) and title (for search/sort context).
 * @param {Array<object>} data - raw index.json rows
 * @returns {Array<object>}
 */
function buildSkuRows(data) {
  const parents = getParentProducts(data);
  const variants = getVariantProducts(data);
  const parentBySku = new Map(parents.map((p) => [p.sku, p]));

  const simpleProductRows = parents
    .filter((p) => getVariantCount(p.variantSkus) === 0)
    .map((p) => ({
      sku: p.sku,
      parentSku: '',
      title: p.title || p.sku,
      color: '',
      availability: p.availability || '',
      price: p.price != null ? String(p.price) : '',
      image: p.image || '',
      urlKey: getUrlKeyFromProduct(p),
    }));

  const variantRows = variants.map((v) => {
    const parent = parentBySku.get(v.parentSku);
    return {
      sku: v.sku,
      parentSku: v.parentSku,
      title: parent ? (parent.title || parent.sku) : (v.title || v.sku),
      color: v.color || '',
      availability: v.availability || '',
      price: v.price != null ? String(v.price) : '',
      image: v.image || (parent ? parent.image : ''),
      urlKey: parent ? getUrlKeyFromProduct(parent) : getUrlKeyFromProduct(v),
    };
  });

  return [...simpleProductRows, ...variantRows];
}

/**
 * Fetch a single product's full JSON (parent + variants), same endpoint used by product-detail.
 * @param {string} localePath
 * @param {string} urlKey
 * @returns {Promise<object>}
 */
async function fetchProductJson(localePath, urlKey) {
  const url = `${getProductsBaseUrlForLocale(localePath)}${encodeURIComponent(urlKey)}.json`;
  const fetchUrl = CORS_PROXY + encodeURIComponent(url) + CORS_KEY;
  const response = await fetch(fetchUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const text = (await response.text()).trim();
  if (text.startsWith('Sign in')) throw new Error('Product requires sign-in or is unavailable');
  return JSON.parse(text);
}

/**
 * custom.inventoryQuantity is not populated in the feed yet; parse defensively so it renders
 * as '—' until the property starts showing up.
 * @param {object} custom
 * @returns {number|null}
 */
function parseInventoryQuantity(custom) {
  const raw = custom?.inventoryQuantity;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

/**
 * Fetch custom.managedStock and custom.inventoryQuantity for every SKU (parent + its variants)
 * across the given parent urlKeys, with a small concurrency limit since this is one request per
 * product. Cached per locale.
 * @param {string} localePath
 * @param {Array<string>} urlKeys - unique parent urlKeys to fetch
 * @returns {Promise<Map<string, { managedStock: boolean, inventoryQuantity: number|null }>>}
 */
async function fetchStockInfoMap(localePath, urlKeys) {
  const cached = stockInfoCacheByLocale.get(localePath);
  if (cached) return cached;

  const map = new Map();
  const queue = [...urlKeys];

  function setStockInfo(sku, custom) {
    if (!sku) return;
    map.set(sku, {
      managedStock: custom?.managedStock === '1',
      inventoryQuantity: parseInventoryQuantity(custom),
    });
  }

  async function worker() {
    while (queue.length > 0) {
      const urlKey = queue.shift();
      try {
        // eslint-disable-next-line no-await-in-loop -- bounded by MANAGED_STOCK_CONCURRENCY workers
        const data = await fetchProductJson(localePath, urlKey);
        setStockInfo(data?.sku, data?.custom);
        (data?.variants || []).forEach((v) => setStockInfo(v?.sku, v?.custom));
      } catch {
        // Skip products that fail to load; they simply won't match the managed-inventory filter.
      }
    }
  }

  const workerCount = Math.min(MANAGED_STOCK_CONCURRENCY, urlKeys.length);
  const workers = Array.from({ length: workerCount }, worker);
  await Promise.all(workers);
  stockInfoCacheByLocale.set(localePath, map);
  return map;
}

function matchesFilter(row) {
  if (activeFilter === 'all') return true;
  if (activeFilter === 'ManagedInventory') return !!row.managedStock;
  return row.availability === activeFilter;
}

function matchesQuery(row, q) {
  if (!q || !q.trim()) return true;
  const term = q.trim().toLowerCase();
  return (
    (row.title || '').toLowerCase().includes(term)
    || (row.sku || '').toLowerCase().includes(term)
    || (row.parentSku || '').toLowerCase().includes(term)
    || (row.color || '').toLowerCase().includes(term)
    || (row.availability || '').toLowerCase().includes(term)
  );
}

function getSortValue(row, key) {
  if (key === 'price') return row.price != null ? Number(row.price) : NaN;
  if (key === 'inventoryQuantity') return row.inventoryQuantity != null ? row.inventoryQuantity : NaN;
  return row[key];
}

function compare(a, b, key) {
  const av = getSortValue(a, key);
  const bv = getSortValue(b, key);
  if ((av == null || av === '' || Number.isNaN(av)) && (bv == null || bv === '' || Number.isNaN(bv))) return 0;
  if (av == null || av === '' || Number.isNaN(av)) return 1;
  if (bv == null || bv === '' || Number.isNaN(bv)) return -1;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
}

function sortRows(rows, key, dir) {
  const sorted = [...rows];
  sorted.sort((a, b) => dir * compare(a, b, key));
  return sorted;
}

function filterAndSortRows(query) {
  const filtered = allSkuRows.filter((r) => matchesFilter(r) && matchesQuery(r, query));
  return sortRows(filtered, sortState.key, sortState.dir);
}

function updateSortHeaders() {
  document.querySelectorAll('.pim-sortable').forEach((th) => {
    const k = th.getAttribute('data-sort');
    th.classList.toggle('pim-sort-asc', sortState.key === k && sortState.dir === 1);
    th.classList.toggle('pim-sort-desc', sortState.key === k && sortState.dir === -1);
  });
}

/**
 * Render SKU/variant list (table body) with optional filter query for highlights.
 * @param {Array<object>} rows - already filtered and sorted
 * @param {string} [query] - search query for highlighting
 */
function renderRows(rows, query = '') {
  const tbody = document.getElementById('productGrid');
  const countEl = document.getElementById('productCount');
  tbody.innerHTML = '';
  const plural = rows.length !== 1 ? 's' : '';
  countEl.textContent = `${rows.length} SKU${plural}`;

  rows.forEach((row) => {
    const imgUrl = resolveImageUrlForLocale(currentLocalePath, row.image);
    const availability = row.availability || '—';
    const availabilityClass = availability.toLowerCase().replace(/\s+/g, '-');

    const tr = document.createElement('tr');
    tr.className = 'pim-row';
    tr.dataset.urlkey = row.urlKey;
    tr.setAttribute('role', 'button');
    tr.tabIndex = 0;
    const thumbCell = imgUrl
      ? `<img src="${escapeHtml(imgUrl)}" alt="" loading="lazy" width="48" height="48" class="pim-thumb-img" />`
      : '<span class="pim-thumb-placeholder" aria-hidden="true"></span>';
    const qty = row.inventoryQuantity != null ? String(row.inventoryQuantity) : '—';
    tr.innerHTML = `
      <td class="pim-col-thumb">${thumbCell}</td>
      <td class="pim-col-product pim-cell-title">${highlightMatch(row.title, query)}</td>
      <td class="pim-col-sku pim-cell-sku">${highlightMatch(row.sku || '', query)}</td>
      <td class="inv-col-variant">${row.color ? highlightMatch(row.color, query) : '—'}</td>
      <td class="pim-col-availability">
        <span class="pim-card-availability ${availabilityClass}">${highlightMatch(availability, query)}</span>
      </td>
      <td class="inv-col-qty">${qty}</td>
    `;
    tbody.appendChild(tr);
  });

  updateSortHeaders();
}

function refreshList() {
  const query = document.getElementById('searchInput').value;
  const rows = filterAndSortRows(query);
  renderRows(rows, query);
}

function setActiveFilter(filter) {
  activeFilter = filter;
  updateUrlParams({ [FILTER_PARAM]: filter === 'all' ? '' : filter });
  document.querySelectorAll('.inv-filter-tab').forEach((btn) => {
    const isActive = btn.getAttribute('data-filter') === filter;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  refreshList();
}

const INV_TSV_HEADER = ['SKU', 'Title', 'Variant', 'Availability', 'Managed Stock', 'Qty'].join('\t');

/** @param {unknown} value */
function invTsvCell(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
}

/** @param {object} row */
function inventoryRowToTsvLine(row) {
  return [
    row.sku,
    row.title,
    row.color,
    row.availability,
    row.managedStock ? 'Yes' : 'No',
    row.inventoryQuantity != null ? String(row.inventoryQuantity) : '',
  ].map(invTsvCell).join('\t');
}

/** @param {Array<object>} rows */
function inventoryTsvForExport(rows) {
  return [INV_TSV_HEADER, ...rows.map(inventoryRowToTsvLine)].join('\n');
}

/** @param {string} text */
function downloadInventoryTsv(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Nothing to download.');
  const blob = new Blob([text], { type: 'text/tab-separated-values;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `vitamix-inventory-${currentLocalePath.replace(/\//g, '-')}-${stamp}.tsv`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
}

/** @param {string} line */
function isInventoryTsvHeaderLine(line) {
  const s = String(line || '').toLowerCase();
  return /\bsku\b/.test(s) && (/\bavailability\b/.test(s) || /\bqty\b/.test(s) || /managed/.test(s));
}

/** @param {unknown} raw */
function parseManagedStockCell(raw) {
  const s = invTsvCell(raw).toLowerCase();
  if (!s) return undefined;
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return undefined;
}

/** @param {unknown} raw */
function parseQuantityCell(raw) {
  const s = invTsvCell(raw);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Parse pasted TSV into rows. Columns: SKU, Title, Variant, Availability, Managed Stock, Qty.
 * A leading header line (containing "sku") is skipped automatically. Blank cells mean
 * "no opinion" for that column and won't be treated as a change.
 * @param {string} text
 * @returns {Array<{ sku: string, title: string, color: string, availability: string,
 *   managedStock: boolean|undefined, inventoryQuantity: number|undefined }>}
 */
function parseInventoryImportTsv(text) {
  const rawLines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const startIdx = rawLines.length && isInventoryTsvHeaderLine(rawLines[0]) ? 1 : 0;
  return rawLines.slice(startIdx)
    .map((line) => line.split('\t'))
    .filter((cols) => invTsvCell(cols[0]))
    .map((cols) => ({
      sku: invTsvCell(cols[0]),
      title: invTsvCell(cols[1] ?? ''),
      color: invTsvCell(cols[2] ?? ''),
      availability: invTsvCell(cols[3] ?? ''),
      managedStock: parseManagedStockCell(cols[4]),
      inventoryQuantity: parseQuantityCell(cols[5]),
    }));
}

/**
 * Compare one parsed TSV row against the currently loaded SKU (if any).
 * @param {object} parsed
 * @returns {{ parsed: object, existing: object|null, changedKeys: Set<string>,
 *   kind: 'update'|'unchanged'|'missing' }}
 */
function diffInventoryImportRow(parsed) {
  const existing = allSkuRows.find((r) => r.sku === parsed.sku) || null;
  if (!existing) {
    return {
      parsed, existing, changedKeys: new Set(), kind: 'missing',
    };
  }

  const changedKeys = new Set();
  if (parsed.availability && parsed.availability !== existing.availability) {
    changedKeys.add('availability');
  }
  if (parsed.managedStock !== undefined && parsed.managedStock !== !!existing.managedStock) {
    changedKeys.add('managedStock');
  }
  if (parsed.inventoryQuantity !== undefined) {
    const existingQty = existing.inventoryQuantity != null ? existing.inventoryQuantity : null;
    if (parsed.inventoryQuantity !== existingQty) changedKeys.add('inventoryQuantity');
  }
  return {
    parsed, existing, changedKeys, kind: changedKeys.size ? 'update' : 'unchanged',
  };
}

/**
 * @param {string} text - pasted TSV
 * @returns {{ results: object[], changed: object[], missing: object[], unchanged: object[] }}
 */
function buildInventoryImportPreview(text) {
  const parsedRows = parseInventoryImportTsv(text);
  if (!parsedRows.length) throw new Error('No SKU rows found. Paste TSV with a SKU column.');
  const results = parsedRows.map(diffInventoryImportRow);
  return {
    results,
    changed: results.filter((r) => r.kind === 'update'),
    missing: results.filter((r) => r.kind === 'missing'),
    unchanged: results.filter((r) => r.kind === 'unchanged'),
  };
}

function inventoryImportStatusBadge(kind) {
  if (kind === 'update') return '<span class="inv-import-badge inv-import-badge-update">Update</span>';
  if (kind === 'missing') {
    return '<span class="inv-import-badge inv-import-badge-missing">Not found</span>';
  }
  return '<span class="inv-import-badge inv-import-badge-same">Unchanged</span>';
}

/** @param {unknown} before @param {unknown} after */
function inventoryImportDiffCellHtml(before, after) {
  return `${escapeHtml(before ?? '—')} → ${escapeHtml(after ?? '—')}`;
}

/** @param {object|null} existing */
function inventoryManagedStockLabel(existing) {
  if (!existing) return '—';
  return existing.managedStock ? 'Yes' : 'No';
}

/**
 * @param {{ parsed: object, existing: object|null, changedKeys: Set<string>, kind: string }} entry
 */
function inventoryImportRowHtml({
  parsed, existing, changedKeys, kind,
}) {
  const cellClass = (key) => (changedKeys.has(key) ? ' class="inv-import-cell-changed"' : '');
  const availabilityHtml = changedKeys.has('availability')
    ? inventoryImportDiffCellHtml(existing?.availability, parsed.availability)
    : escapeHtml((existing?.availability) || parsed.availability || '—');
  const managedHtml = changedKeys.has('managedStock')
    ? inventoryImportDiffCellHtml(existing?.managedStock ? 'Yes' : 'No', parsed.managedStock ? 'Yes' : 'No')
    : escapeHtml(inventoryManagedStockLabel(existing));
  const existingQty = existing?.inventoryQuantity != null ? existing.inventoryQuantity : null;
  const qtyHtml = changedKeys.has('inventoryQuantity')
    ? inventoryImportDiffCellHtml(existingQty, parsed.inventoryQuantity)
    : escapeHtml(existingQty != null ? String(existingQty) : '—');
  const rowClass = kind === 'missing' ? ' class="inv-import-row-missing"' : '';
  return `<tr${rowClass}>
    <td class="inv-import-col-status">${inventoryImportStatusBadge(kind)}</td>
    <td>${escapeHtml(parsed.sku)}</td>
    <td>${escapeHtml((existing?.title) || parsed.title || '—')}</td>
    <td>${escapeHtml((existing?.color) || parsed.color || '—')}</td>
    <td${cellClass('availability')}>${availabilityHtml}</td>
    <td${cellClass('managedStock')}>${managedHtml}</td>
    <td${cellClass('inventoryQuantity')}>${qtyHtml}</td>
  </tr>`;
}

/** @param {{ changed: object[], missing: object[], unchanged: object[] }} preview */
function inventoryImportPreviewLead({ changed, missing, unchanged }) {
  if (!changed.length && !missing.length) {
    return unchanged.length
      ? 'Nothing to import. Every SKU in this TSV already matches this locale.'
      : 'Nothing to import.';
  }
  const bits = [];
  if (changed.length) bits.push(`${changed.length} SKU${changed.length === 1 ? '' : 's'} will change`);
  if (missing.length) bits.push(`${missing.length} not found in the current inventory list`);
  if (unchanged.length) bits.push(`${unchanged.length} unchanged and skipped`);
  return `${bits.join('. ')}. Write-back isn't implemented yet — preview only.`;
}

function openInventoryExportImportDialog() {
  const query = document.getElementById('searchInput').value;
  const shown = filterAndSortRows(query);
  const initialTsv = inventoryTsvForExport(shown);

  const dialog = document.createElement('dialog');
  dialog.className = 'inv-dialog inv-dialog-export';
  dialog.innerHTML = `
    <div class="inv-dialog-inner">
      <div class="inv-dialog-scroll" tabindex="-1">
        <div data-inv-export-pane="tsv">
          <h2 class="inv-dialog-title">Export / import inventory</h2>
          <p class="inv-field-hint">TSV of the <strong>${escapeHtml(String(shown.length))}</strong>
            SKU${shown.length === 1 ? '' : 's'} currently shown. Download, edit in a spreadsheet, paste back,
            then Preview import to see exactly which SKUs would change. Write-back isn't implemented yet.</p>
          <label class="pim-sr-only" for="inv-export-tsv">Inventory TSV</label>
          <textarea id="inv-export-tsv" class="inv-tsv-input" spellcheck="false" rows="16">${escapeHtml(initialTsv)}</textarea>
          <div class="inv-export-status" data-inv-export-status hidden></div>
        </div>
        <div data-inv-export-pane="preview" hidden>
          <h2 class="inv-dialog-title">Import preview</h2>
          <p class="inv-field-hint" data-inv-export-preview-lead></p>
          <div class="inv-table-wrap pim-list-wrapper" data-inv-export-preview-table></div>
        </div>
      </div>
      <div class="inv-dialog-actions">
        <button type="button" class="inv-btn" data-inv-cancel>Cancel</button>
        <button type="button" class="inv-btn" data-inv-export-back hidden>Back</button>
        <button type="button" class="inv-btn" data-inv-export-preview>Preview import</button>
        <button type="button" class="inv-btn inv-btn-primary" data-inv-export-save>Download</button>
      </div>
    </div>`;
  document.body.appendChild(dialog);

  const tsvPane = dialog.querySelector('[data-inv-export-pane="tsv"]');
  const previewPane = dialog.querySelector('[data-inv-export-pane="preview"]');
  const statusEl = dialog.querySelector('[data-inv-export-status]');
  const textarea = /** @type {HTMLTextAreaElement | null} */ (dialog.querySelector('#inv-export-tsv'));
  const leadEl = dialog.querySelector('[data-inv-export-preview-lead]');
  const tableHost = dialog.querySelector('[data-inv-export-preview-table]');
  const btnCancel = dialog.querySelector('[data-inv-cancel]');
  const btnBack = dialog.querySelector('[data-inv-export-back]');
  const btnPreview = dialog.querySelector('[data-inv-export-preview]');
  const btnSave = dialog.querySelector('[data-inv-export-save]');

  const setStatus = (msg, tone = 'error') => {
    if (!(statusEl instanceof HTMLElement)) return;
    if (!msg) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      statusEl.classList.remove('inv-export-status-error', 'inv-export-status-ok');
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = msg;
    statusEl.classList.toggle('inv-export-status-error', tone === 'error');
    statusEl.classList.toggle('inv-export-status-ok', tone !== 'error');
  };

  const showTsvPane = () => {
    if (tsvPane instanceof HTMLElement) tsvPane.hidden = false;
    if (previewPane instanceof HTMLElement) previewPane.hidden = true;
    btnBack?.setAttribute('hidden', '');
    btnPreview?.removeAttribute('hidden');
    btnSave?.removeAttribute('hidden');
  };

  const showPreviewPane = (preview) => {
    if (tsvPane instanceof HTMLElement) tsvPane.hidden = true;
    if (previewPane instanceof HTMLElement) previewPane.hidden = false;
    btnBack?.removeAttribute('hidden');
    btnPreview?.setAttribute('hidden', '');
    btnSave?.setAttribute('hidden', '');
    if (leadEl) leadEl.textContent = inventoryImportPreviewLead(preview);
    if (tableHost) {
      const toShow = [...preview.changed, ...preview.missing];
      const body = toShow.length
        ? toShow.map(inventoryImportRowHtml).join('')
        : '<tr><td colspan="7" class="inv-empty-cell">No changed or unrecognized SKUs in this TSV.</td></tr>';
      tableHost.innerHTML = `<table class="inv-preview-table" aria-label="Imported inventory changes">
          <thead><tr>
            <th scope="col">Status</th>
            <th scope="col">SKU</th>
            <th scope="col">Title</th>
            <th scope="col">Variant</th>
            <th scope="col">Availability</th>
            <th scope="col">Managed stock</th>
            <th scope="col">Qty</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>`;
    }
  };

  const dismiss = () => {
    dialog.close();
    dialog.remove();
  };

  const prevBodyOverflow = document.body.style.overflow;
  dialog.addEventListener('close', () => {
    document.body.style.overflow = prevBodyOverflow;
  }, { once: true });

  btnCancel?.addEventListener('click', dismiss);
  btnBack?.addEventListener('click', () => {
    showTsvPane();
    setStatus('');
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dismiss();
  });
  wireDialogEscapeDismiss(dialog, dismiss);

  btnSave?.addEventListener('click', () => {
    try {
      const filename = downloadInventoryTsv(textarea?.value ?? '');
      showToast(`Downloaded ${filename}`, 'success');
    } catch (err) {
      setStatus(err?.message || 'Could not download TSV');
      showToast(err?.message || 'Could not download TSV', 'error');
    }
  });

  btnPreview?.addEventListener('click', () => {
    try {
      const preview = buildInventoryImportPreview(textarea?.value ?? '');
      setStatus('');
      showPreviewPane(preview);
    } catch (err) {
      setStatus(err?.message || 'Import is not valid');
      showToast(err?.message || 'Import is not valid', 'error');
    }
  });

  document.body.style.overflow = 'hidden';
  dialog.showModal();
}

async function loadIndex() {
  const loading = document.getElementById('loading');
  const loadingText = loading.querySelector('p');
  const content = document.getElementById('content');
  const errorEl = document.getElementById('error');

  loading.classList.add('active');
  content.classList.remove('active');
  errorEl.classList.remove('active');
  if (loadingText) loadingText.textContent = 'Loading inventory…';

  try {
    const json = await fetchProductsIndexForLocale(currentLocalePath);
    const data = json.data || json;
    allSkuRows = buildSkuRows(data);
    content.classList.add('active');
    refreshList();

    if (loadingText) loadingText.textContent = 'Loading managed inventory flags…';
    // Every row's urlKey points at its parent product page (simple products point at themselves),
    // so this also covers variant rows whose configurable parent was excluded from allSkuRows.
    const productUrlKeys = allSkuRows.map((r) => r.urlKey).filter(Boolean);
    const uniqueProductUrlKeys = [...new Set(productUrlKeys)];
    const stockInfoBySku = await fetchStockInfoMap(currentLocalePath, uniqueProductUrlKeys);
    allSkuRows = allSkuRows.map((row) => {
      const stockInfo = stockInfoBySku.get(row.sku);
      return {
        ...row,
        managedStock: stockInfo?.managedStock || false,
        inventoryQuantity: stockInfo ? stockInfo.inventoryQuantity : null,
      };
    });
    refreshList();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    showError(err.message || 'Failed to load inventory');
  } finally {
    loading.classList.remove('active');
  }
}

function init() {
  const indexSelect = document.getElementById('indexSelect');
  const searchInput = document.getElementById('searchInput');

  const catalogFromUrl = readCatalogFromParams();
  if (catalogFromUrl) {
    indexSelect.value = catalogFromUrl;
    currentLocalePath = catalogFromUrl;
  } else {
    currentLocalePath = indexSelect.value;
  }
  updateUrlParams({ [CATALOG_PARAM]: currentLocalePath });

  const filterFromUrl = readFilterFromParams();
  if (filterFromUrl) setActiveFilter(filterFromUrl);

  indexSelect.addEventListener('change', () => {
    currentLocalePath = indexSelect.value;
    updateUrlParams({ [CATALOG_PARAM]: currentLocalePath });
    loadIndex();
  });

  document.getElementById('filterTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.inv-filter-tab');
    if (!btn) return;
    setActiveFilter(btn.getAttribute('data-filter'));
  });

  document.getElementById('exportImportBtn')?.addEventListener('click', () => {
    openInventoryExportImportDialog();
  });

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
    const catalog = currentLocalePath ? `catalog=${encodeURIComponent(currentLocalePath)}&` : '';
    window.location.href = `product-detail.html?${catalog}product=${encodeURIComponent(row.dataset.urlkey)}`;
  });
  document.getElementById('productList').addEventListener('keydown', (e) => {
    const row = e.target.closest('tr.pim-row');
    if (!row || !row.dataset.urlkey) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const catalog = currentLocalePath ? `catalog=${encodeURIComponent(currentLocalePath)}&` : '';
      window.location.href = `product-detail.html?${catalog}product=${encodeURIComponent(row.dataset.urlkey)}`;
    }
  });

  loadIndex();
}

if (typeof document !== 'undefined' && document.getElementById('productGrid')) {
  init();
}
