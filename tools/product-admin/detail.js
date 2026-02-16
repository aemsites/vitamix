import {
  fetchReviewLog,
  appendReviewEvent,
  getReviewHistoryForProduct,
  REVIEW_STATUS_OPTIONS,
} from './review-status.js';
import { getFirstName } from './user-identity.js';

const AEM_BASE = 'https://main--vitamix--aemsites.aem.network';
const PRODUCT_JSON_BASE = `${AEM_BASE}/us/en_us/products/`;
const PRODUCTS_BASE_URL = `${AEM_BASE}/us/en_us/products/`;
const INDEX_URL = `${AEM_BASE}/us/en_us/products/index.json?include=all`;
const IMAGE_QUERY = '?width=750&format=webply&optimize=medium';
const CORS_PROXY = 'https://fcors.org/?url=';
const CORS_KEY = '&key=Mg23N96GgR8O3NjU';

let currentProductData = null;
let currentIndexByUrlKey = {};
let editMode = false;
/** @type {Array<{ op: string, user: string, ts: string, status?: string, text?: string }>} */
let reviewHistory = [];

function getProductParam() {
  const params = new URLSearchParams(window.location.search);
  return params.get('product') || '';
}

function getByPath(obj, path) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  return parts.reduce((cur, p) => {
    if (cur == null) return undefined;
    const key = /^\d+$/.test(p) ? parseInt(p, 10) : p;
    return cur[key];
  }, obj);
}

function setByPath(obj, path, value) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  if (parts.length === 0) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    const nextKey = parts[i + 1];
    const key = /^\d+$/.test(p) ? parseInt(p, 10) : p;
    const nextIsNum = /^\d+$/.test(nextKey);
    if (cur[key] == null) cur[key] = nextIsNum ? [] : {};
    cur = cur[key];
  }
  const last = parts[parts.length - 1];
  const lastKey = /^\d+$/.test(last) ? parseInt(last, 10) : last;
  cur[lastKey] = value;
}

function resolveImageUrl(imagePath) {
  if (!imagePath) return '';
  const path = typeof imagePath === 'string' ? imagePath : imagePath?.url || '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const normalized = path.startsWith('./') ? path.slice(2) : path;
  return normalized ? PRODUCTS_BASE_URL + normalized + IMAGE_QUERY : '';
}

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function showError(message) {
  const el = document.getElementById('error');
  el.textContent = message;
  el.classList.add('active');
}

async function fetchProductJson(urlKey) {
  const url = `${PRODUCT_JSON_BASE}${encodeURIComponent(urlKey)}.json`;
  const fetchUrl = CORS_PROXY + encodeURIComponent(url) + CORS_KEY;
  const response = await fetch(fetchUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const text = await response.text();
  const trimmed = text.trim();
  if (trimmed.startsWith('Sign in')) throw new Error('Product requires sign-in or is unavailable');
  return JSON.parse(trimmed);
}

async function fetchProductsIndex() {
  const fetchUrl = CORS_PROXY + encodeURIComponent(INDEX_URL) + CORS_KEY;
  const response = await fetch(fetchUrl);
  if (!response.ok) throw new Error(`Index: HTTP ${response.status}`);
  const json = await response.json();
  return json.data || json;
}

/** Build urlKey -> product (prefer parent) from index array */
function buildIndexByUrlKey(indexData) {
  const map = {};
  if (!Array.isArray(indexData)) return map;
  indexData.forEach((item) => {
    const key = item.urlKey || (item.url ? item.url.replace(/\/$/, '').split('/').pop() : '');
    if (!key) return;
    if (!map[key] || !item.parentSku) map[key] = item;
  });
  return map;
}

function pathToUrlKey(path) {
  if (!path || typeof path !== 'string') return '';
  return path.replace(/\/$/, '').split('/').filter(Boolean).pop() || '';
}

function resolveIndexImageUrl(imagePath) {
  if (!imagePath) return '';
  const path = typeof imagePath === 'string' ? imagePath : imagePath?.url || '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const normalized = path.startsWith('./') ? path.slice(2) : path;
  return normalized ? PRODUCTS_BASE_URL + normalized + IMAGE_QUERY : '';
}

function renderValue(label, value, path, isEditMode) {
  if (value == null && !isEditMode) return '';
  let v = '';
  if (value != null) {
    v = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  }
  const editAttrs = isEditMode && path
    ? ` data-edit-path="${escapeHtml(path)}" class="pim-editable pim-detail-value"`
    : ' class="pim-detail-value"';
  return `<div class="pim-detail-field"><span class="pim-detail-label">${escapeHtml(label)}</span><span${editAttrs}>${escapeHtml(v)}</span></div>`;
}

function renderPrice(price, isEditMode) {
  if (!price && !isEditMode) return '';
  let p = '';
  if (price && (price.final != null || price.regular != null)) {
    p = price.final != null ? price.final : price.regular;
  }
  return renderValue('Price', p, 'price.regular', isEditMode);
}

function renderImages(images, isEditMode) {
  if (!Array.isArray(images) && !isEditMode) return '';
  const list = Array.isArray(images) ? images : [];
  const items = list.map((img, i) => {
    const src = resolveImageUrl(img.url || img);
    const label = img.label ? ` title="${escapeHtml(img.label)}"` : '';
    const wrap = src ? `<a href="${escapeHtml(src)}" target="_blank" rel="noopener" class="pim-detail-img-wrap"${label}><img src="${escapeHtml(src)}" alt="" loading="lazy" class="pim-detail-img" /></a>` : '<span class="pim-detail-img-wrap pim-detail-no-img">—</span>';
    const delBtn = isEditMode ? `<button type="button" class="pim-edit-delete" data-edit-path="images" data-edit-index="${i}" aria-label="Delete">×</button>` : '';
    return `<span class="pim-edit-list-item" data-edit-path="images" data-edit-index="${i}">${wrap}${delBtn}</span>`;
  });
  const addPlaceholder = isEditMode ? '<button type="button" class="pim-edit-add pim-detail-img-add" data-edit-path="images" data-edit-action="add" aria-label="Add image"><span class="pim-detail-img-add-inner">+</span></button>' : '';
  return `<div class="pim-detail-section" data-edit-path="images"><h3 class="pim-detail-section-title">Images</h3><div class="pim-detail-gallery">${items.join('')}${addPlaceholder}</div></div>`;
}

function renderCategories(categories) {
  if (!Array.isArray(categories) || categories.length === 0) return '';
  const colorIndex = (i) => i % 5;
  const tags = categories.map((c, i) => {
    const name = c.name || c.url_key || '';
    const colorClass = `pim-detail-tag-i${colorIndex(i)}`;
    return `<span class="pim-detail-tag pim-detail-tag-cat ${colorClass}">${escapeHtml(name)}</span>`;
  }).join('');
  return `<div class="pim-detail-section"><h3 class="pim-detail-section-title">Categories</h3><div class="pim-detail-tags">${tags}</div></div>`;
}

function renderResources(resources, isEditMode) {
  if (!Array.isArray(resources) && !isEditMode) return '';
  const list = Array.isArray(resources) ? resources : [];
  const items = list.map((r, i) => {
    const name = r.name || 'Resource';
    const url = r.url || '#';
    const type = (r.type || 'file').toLowerCase();
    const delBtn = isEditMode ? `<button type="button" class="pim-edit-delete" data-edit-path="custom.resources" data-edit-index="${i}" aria-label="Delete">×</button>` : '';
    return `<li class="pim-detail-resource pim-edit-list-item" data-edit-path="custom.resources" data-edit-index="${i}"><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(name)}</a><span class="pim-detail-resource-type pim-detail-resource-type-${escapeHtml(type)}">${escapeHtml(r.type || '')}</span>${delBtn}</li>`;
  }).join('');
  const addBtn = isEditMode ? '<button type="button" class="pim-edit-add" data-edit-path="custom.resources" data-edit-action="add">+ Add resource</button>' : '';
  return `<div class="pim-detail-section" data-edit-path="custom.resources"><h3 class="pim-detail-section-title">Resources</h3><ul class="pim-detail-resource-list">${items}</ul>${addBtn}</div>`;
}

function renderLinkedProducts(paths, indexByUrlKey, sectionTitle, pathKey, isEditMode) {
  const list = Array.isArray(paths) ? paths : [];
  if (list.length === 0 && !isEditMode) return '';
  const cards = list.map((path, i) => {
    const urlKey = pathToUrlKey(path);
    const product = indexByUrlKey[urlKey];
    const detailHref = `detail.html?product=${encodeURIComponent(urlKey)}`;
    const name = product ? (product.title || product.name || product.sku || urlKey) : urlKey;
    const imgSrc = product && product.image ? resolveIndexImageUrl(product.image) : '';
    const delBtn = isEditMode ? `<button type="button" class="pim-edit-delete" data-edit-path="${escapeHtml(pathKey)}" data-edit-index="${i}" aria-label="Delete">×</button>` : '';
    return `<span class="pim-edit-list-item" data-edit-path="${escapeHtml(pathKey)}" data-edit-index="${i}"><a href="${escapeHtml(detailHref)}" class="pim-detail-linked-card">
      <span class="pim-detail-linked-thumb">${imgSrc ? `<img src="${escapeHtml(imgSrc)}" alt="" loading="lazy" />` : '<span class="pim-detail-linked-no-img">—</span>'}</span>
      <span class="pim-detail-linked-name">${escapeHtml(name)}</span>
    </a>${delBtn}</span>`;
  }).join('');
  const addBtn = isEditMode ? `<button type="button" class="pim-edit-add" data-edit-path="${escapeHtml(pathKey)}" data-edit-action="add">+ Add</button>` : '';
  return `<div class="pim-detail-section" data-edit-path="${escapeHtml(pathKey)}"><h3 class="pim-detail-section-title">${escapeHtml(sectionTitle)}</h3><div class="pim-detail-linked-grid">${cards}</div>${addBtn}</div>`;
}

function formatCustomCellValue(key, v) {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) {
    if (v.length === 0) return '—';
    const first = v[0];
    if (typeof first === 'object' && first !== null) {
      if ('name' in first && 'url_key' in first) {
        return v.map((c, i) => {
          const name = c.name || c.url_key || '';
          const colorClass = `pim-detail-tag-i${i % 5}`;
          return `<span class="pim-detail-tag pim-detail-tag-cat ${colorClass}">${escapeHtml(name)}</span>`;
        }).join(' ');
      }
      if ('name' in first && 'url' in first) return v.map((r) => `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.name)}</a>`).join(', ');
      if ('name' in first && 'type' in first) return v.map((opt) => `${escapeHtml(opt.name || '')}${opt.price != null ? ` (${opt.price})` : ''}`).join(', ');
      if ('value' in first) return v.map((x) => escapeHtml(x.value != null ? x.value : JSON.stringify(x))).join(', ');
      return v.map((x) => escapeHtml(x.name || x.label || x.id || JSON.stringify(x))).join(', ');
    }
    return v.map((x) => escapeHtml(String(x))).join(', ');
  }
  if (typeof v === 'object') return escapeHtml(JSON.stringify(v, null, 2));
  return escapeHtml(String(v));
}

function renderCustom(custom, isEditMode) {
  if (!custom && !isEditMode) return '';
  const obj = custom && typeof custom === 'object' ? custom : {};
  const skipKeys = ['categories', 'resources', 'crosssellSkus', 'relatedSkus'];
  const entries = Object.entries(obj).filter(([k, v]) => v != null && v !== '' && !skipKeys.includes(k));
  if (entries.length === 0 && !isEditMode) return '';
  const rows = entries.map(([k, v]) => {
    const val = formatCustomCellValue(k, v);
    const path = `custom.${k}`;
    const editAttrs = isEditMode ? ` data-edit-path="${escapeHtml(path)}" class="pim-editable pim-detail-custom-val"` : ' class="pim-detail-custom-val"';
    return `<tr><td class="pim-detail-custom-key">${escapeHtml(k)}</td><td${editAttrs}>${val}</td></tr>`;
  }).join('');
  return `<div class="pim-detail-section"><h3 class="pim-detail-section-title">Custom</h3><table class="pim-detail-custom-table"><tbody>${rows}</tbody></table></div>`;
}

function renderVariants(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return '';
  const rows = variants.map((v) => {
    const price = v.price ? (v.price.final ?? v.price.regular ?? '') : '';
    const opts = Array.isArray(v.options) ? v.options.map((o) => `${o.id || ''}: ${o.value || ''}`).filter(Boolean).join('; ') : '';
    const img = (v.images && v.images[0]) ? resolveImageUrl(v.images[0].url || v.images[0]) : '';
    return `<tr>
      <td class="pim-detail-var-thumb">${img ? `<img src="${escapeHtml(img)}" alt="" loading="lazy" class="pim-detail-var-img" />` : '—'}</td>
      <td class="pim-detail-var-sku">${escapeHtml(v.sku || '')}</td>
      <td class="pim-detail-var-name">${escapeHtml(v.name || '')}</td>
      <td class="pim-detail-var-opts">${escapeHtml(opts)}</td>
      <td class="pim-detail-var-price">${escapeHtml(price)}</td>
      <td class="pim-detail-var-avail"><span class="pim-card-availability ${String(v.availability || '').toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(v.availability || '')}</span></td>
    </tr>`;
  }).join('');
  return `<div class="pim-detail-section"><h3 class="pim-detail-section-title">Variants (${variants.length})</h3><div class="pim-detail-table-wrap"><table class="pim-detail-variants-table"><thead><tr><th></th><th>SKU</th><th>Name</th><th>Options</th><th>Price</th><th>Availability</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function renderOptions(options) {
  if (!Array.isArray(options) || options.length === 0) return '';
  const rows = options.map((o) => {
    const values = (o.values || []).map((v) => v.value || v).join(', ');
    return `<tr><td class="pim-detail-custom-key">${escapeHtml(o.label || o.id || '')}</td><td class="pim-detail-custom-val">${escapeHtml(values)}</td></tr>`;
  }).join('');
  return `<div class="pim-detail-section"><h3 class="pim-detail-section-title">Options</h3><table class="pim-detail-custom-table"><tbody>${rows}</tbody></table></div>`;
}

function getCurrentReviewStatus(history) {
  const last = [...(history || [])].filter((e) => e.op === 'status_change').pop();
  return last ? last.status : '';
}

function formatReviewTs(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return ts;
  }
}

function renderReviewSection(urlKey, history) {
  const currentStatus = getCurrentReviewStatus(history);
  const effectiveStatus = currentStatus || 'Not started';
  const optionsHtml = REVIEW_STATUS_OPTIONS.map((opt) => {
    const val = escapeHtml(opt);
    const label = escapeHtml(opt);
    const sel = opt === effectiveStatus ? ' selected' : '';
    return `<option value="${val}"${sel}>${label}</option>`;
  }).join('');
  const historyHtml = (history || []).map((e) => {
    if (e.op === 'status_change') {
      return `<li class="pim-review-entry pim-review-status"><span class="pim-review-meta">${escapeHtml(e.user || '')} · ${formatReviewTs(e.ts)}</span><span class="pim-review-status-badge">${escapeHtml(e.status || '')}</span></li>`;
    }
    if (e.op === 'comment') {
      return `<li class="pim-review-entry pim-review-comment"><span class="pim-review-meta">${escapeHtml(e.user || '')} · ${formatReviewTs(e.ts)}</span><p class="pim-review-comment-text">${escapeHtml(e.text || '')}</p></li>`;
    }
    return '';
  }).filter(Boolean).join('');
  return `
    <div class="pim-detail-section pim-review-section" data-review-urlkey="${escapeHtml(urlKey)}">
      <h3 class="pim-detail-section-title">Review</h3>
      <div class="pim-review-controls">
        <label for="pim-review-status-select">Status</label>
        <select id="pim-review-status-select" class="pim-review-status-select" aria-label="Review status">
          ${optionsHtml}
        </select>
      </div>
      <div class="pim-review-add-comment">
        <label for="pim-review-comment-input">Add comment</label>
        <textarea id="pim-review-comment-input" class="pim-review-comment-input" rows="2" placeholder="Add a comment…" aria-label="Comment text"></textarea>
        <button type="button" id="pim-review-save" class="pim-review-comment-submit">Save</button>
      </div>
      <div class="pim-review-history">
        <h4 class="pim-review-history-title">History</h4>
        <ul class="pim-review-history-list">${historyHtml || '<li class="pim-review-empty">No status changes or comments yet.</li>'}</ul>
      </div>
    </div>`;
}

function renderProduct(data, indexByUrlKey = {}, isEditMode = false) {
  const availabilityClass = (data.availability || '').toLowerCase().replace(/\s+/g, '-');
  const priceBlock = renderPrice(data.price, isEditMode);
  const nameEditAttrs = isEditMode ? ' data-edit-path="name" class="pim-editable pim-detail-name"' : ' class="pim-detail-name"';
  const availabilityEditAttrs = isEditMode ? ` data-edit-path="availability" data-edit-type="availability" class="pim-editable pim-card-availability ${availabilityClass}"` : ` class="pim-card-availability ${availabilityClass}"`;
  const sections = [
    `<div class="pim-detail-header">
      <h1${nameEditAttrs}>${escapeHtml(data.name || data.sku || '')}</h1>
      <div class="pim-detail-meta">
        ${renderValue('SKU', data.sku, 'sku', isEditMode)}
        ${renderValue('Type', data.type, 'type', isEditMode)}
        ${renderValue('URL key', data.urlKey, 'urlKey', isEditMode)}
        ${renderValue('Path', data.path, 'path', isEditMode)}
        ${renderValue('Brand', data.brand, 'brand', isEditMode)}
        <span${availabilityEditAttrs}>${escapeHtml(data.availability || '')}</span>
        ${priceBlock}
      </div>
    </div>`,
    renderImages(data.images, isEditMode),
    data.options && data.options.length ? renderOptions(data.options) : '',
    renderVariants(data.variants),
    renderCategories(data.custom?.categories),
    renderResources(data.custom?.resources, isEditMode),
    renderLinkedProducts(data.custom?.crosssellSkus, indexByUrlKey, 'Cross-sell', 'custom.crosssellSkus', isEditMode),
    renderLinkedProducts(data.custom?.relatedSkus, indexByUrlKey, 'Related products', 'custom.relatedSkus', isEditMode),
    renderCustom(data.custom, isEditMode),
    (data.metadata && Object.keys(data.metadata).length > 0)
      ? `<div class="pim-detail-section"><h3 class="pim-detail-section-title">Raw metadata</h3><pre class="pim-detail-raw">${escapeHtml(JSON.stringify(data.metadata, null, 2))}</pre></div>`
      : '',
  ];
  return sections.filter(Boolean).join('\n');
}

function showInlineEditor(options) {
  const {
    path,
    currentValue,
    type,
    onSave,
  } = options;
  const isAvailability = type === 'availability';
  const isObjectOrArray = typeof currentValue === 'object' && currentValue !== null;
  const isLong = typeof currentValue === 'string' && currentValue.length > 80;
  const overlay = document.createElement('div');
  overlay.className = 'pim-inline-editor-wrap';
  let inputHtml;
  if (isAvailability) {
    const val = String(currentValue || '');
    inputHtml = `<select id="pim-edit-input">
      <option value="InStock"${val === 'InStock' ? ' selected' : ''}>InStock</option>
      <option value="OutOfStock"${val === 'OutOfStock' ? ' selected' : ''}>OutOfStock</option>
      <option value="Discontinued"${val === 'Discontinued' ? ' selected' : ''}>Discontinued</option>
    </select>`;
  } else if (isObjectOrArray) {
    const val = escapeHtml(JSON.stringify(currentValue, null, 2));
    inputHtml = `<textarea id="pim-edit-input">${val}</textarea>`;
  } else {
    const val = currentValue != null ? escapeHtml(String(currentValue)) : '';
    if (isLong) inputHtml = `<textarea id="pim-edit-input">${val}</textarea>`;
    else inputHtml = `<input type="text" id="pim-edit-input" value="${val}" />`;
  }
  overlay.innerHTML = `
    <div class="pim-inline-editor">
      <label>${escapeHtml(path)}</label>
      ${inputHtml}
      <div class="pim-inline-editor-actions">
        <button type="button" class="pim-btn-cancel">Cancel</button>
        <button type="button" class="pim-btn-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#pim-edit-input');
  const remove = () => { overlay.remove(); };
  overlay.querySelector('.pim-btn-cancel').addEventListener('click', remove);
  overlay.querySelector('.pim-btn-save').addEventListener('click', () => {
    let newVal = input.value;
    if (isObjectOrArray) {
      try {
        newVal = JSON.parse(input.value);
      } catch {
        return;
      }
    }
    onSave(newVal);
    remove();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) remove(); });
  input.focus();
}

/* eslint-disable no-use-before-define */
function arrayDelete(path, index) {
  const arr = getByPath(currentProductData, path) || [];
  if (!Array.isArray(arr)) return;
  const next = [...arr];
  next.splice(index, 1);
  setByPath(currentProductData, path, next);
  refreshDetailContent();
}

function arrayAdd(path) {
  let template;
  if (path === 'images') template = { url: './media_new.jpg' };
  else if (path === 'custom.resources') template = { name: 'New resource', type: 'pdf', url: 'https://' };
  else if (path === 'custom.crosssellSkus' || path === 'custom.relatedSkus') template = '/us/en_us/products/new-product';
  else template = {};
  const arr = getByPath(currentProductData, path) || [];
  const next = Array.isArray(arr) ? [...arr, template] : [template];
  setByPath(currentProductData, path, next);
  refreshDetailContent();
}

function attachEditHandlers() {
  const content = document.getElementById('content');
  if (!content) return;

  content.querySelectorAll('.pim-editable').forEach((el) => {
    const prev = el.pimEditClick;
    if (prev) el.removeEventListener('click', prev);
    const path = el.getAttribute('data-edit-path');
    const type = el.getAttribute('data-edit-type') || 'string';
    const handler = (e) => {
      if (e.target.closest('a')) return;
      const current = getByPath(currentProductData, path);
      showInlineEditor({
        path,
        currentValue: current,
        type,
        onSave: (newVal) => {
          if (path === 'price.regular') {
            if (!currentProductData.price) currentProductData.price = {};
            currentProductData.price.regular = newVal;
            if (currentProductData.price.final == null) currentProductData.price.final = newVal;
          } else setByPath(currentProductData, path, newVal);
          refreshDetailContent();
        },
      });
    };
    el.pimEditClick = handler;
    el.addEventListener('click', handler);
  });

  content.querySelectorAll('.pim-edit-delete').forEach((btn) => {
    const prev = btn.pimDelClick;
    if (prev) btn.removeEventListener('click', prev);
    const path = btn.getAttribute('data-edit-path');
    const index = parseInt(btn.getAttribute('data-edit-index'), 10);
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      arrayDelete(path, index);
    };
    btn.pimDelClick = handler;
    btn.addEventListener('click', handler);
  });

  content.querySelectorAll('.pim-edit-add').forEach((btn) => {
    const prev = btn.pimAddClick;
    if (prev) btn.removeEventListener('click', prev);
    const path = btn.getAttribute('data-edit-path');
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      arrayAdd(path);
    };
    btn.pimAddClick = handler;
    btn.addEventListener('click', handler);
  });
}

async function refreshReviewSection() {
  const urlKey = getProductParam();
  if (!urlKey) return;
  try {
    const events = await fetchReviewLog();
    reviewHistory = getReviewHistoryForProduct(events, urlKey);
  } catch {
    reviewHistory = [];
  }
  refreshDetailContent();
}

function refreshDetailContent() {
  const content = document.getElementById('content');
  const urlKey = getProductParam();
  content.innerHTML = renderProduct(currentProductData, currentIndexByUrlKey, editMode);
  if (urlKey) {
    const reviewEl = document.createElement('div');
    reviewEl.innerHTML = renderReviewSection(urlKey, reviewHistory);
    content.appendChild(reviewEl.firstElementChild);
  }
  if (editMode) content.classList.add('pim-edit-mode');
  else content.classList.remove('pim-edit-mode');
  attachEditHandlers();
  attachReviewHandlers();
}

function attachReviewHandlers() {
  const urlKey = getProductParam();
  if (!urlKey) return;
  const statusSelect = document.getElementById('pim-review-status-select');
  const commentInput = document.getElementById('pim-review-comment-input');
  const saveBtn = document.getElementById('pim-review-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const status = statusSelect ? statusSelect.value : '';
      const text = (commentInput && commentInput.value || '').trim();
      const currentStatus = getCurrentReviewStatus(reviewHistory);
      const statusChanged = status !== currentStatus;
      if (!statusChanged && !text) return;
      const user = await getFirstName();
      try {
        if (statusChanged) {
          await appendReviewEvent({ op: 'status_change', urlKey, user, status, ts: new Date().toISOString() });
        }
        if (text) {
          await appendReviewEvent({ op: 'comment', urlKey, user, text, ts: new Date().toISOString() });
        }
        if (commentInput) commentInput.value = '';
        await refreshReviewSection();
      } catch (err) {
        showError(err.message || 'Failed to save');
      }
    });
  }
}
/* eslint-enable no-use-before-define */

async function init() {
  const urlKey = getProductParam();
  const loading = document.getElementById('loading');
  const content = document.getElementById('content');
  const errorEl = document.getElementById('error');
  const toolbar = document.getElementById('toolbar');
  const editCheckbox = document.getElementById('editModeCheckbox');

  if (!urlKey) {
    showError('Missing product parameter. Use ?product=urlKey');
    loading.classList.remove('active');
    return;
  }

  loading.classList.add('active');
  content.innerHTML = '';
  errorEl.classList.remove('active');

  try {
    const [data, indexData, reviewEvents] = await Promise.all([
      fetchProductJson(urlKey),
      fetchProductsIndex().catch(() => []),
      fetchReviewLog().catch(() => []),
    ]);
    currentProductData = JSON.parse(JSON.stringify(data));
    currentIndexByUrlKey = buildIndexByUrlKey(indexData);
    reviewHistory = getReviewHistoryForProduct(reviewEvents, urlKey);
    loading.classList.remove('active');
    toolbar.style.display = 'flex';

    editCheckbox.addEventListener('change', () => {
      editMode = editCheckbox.checked;
      content.classList.toggle('pim-edit-mode', editMode);
      refreshDetailContent();
    });

    refreshDetailContent();
  } catch (err) {
    loading.classList.remove('active');
    showError(err.message || 'Failed to load product');
  }
}

init();
