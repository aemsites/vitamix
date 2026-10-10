import { apiFetch, getApiBase, getApiEnvironment } from './commerce-otp-api.js';
import {
  catalogApiPath,
  fetchCatalogProduct,
  normalizeProductPath,
  startProductExportImport,
} from './commerce-catalog-io.js';
import { putOrPatchResource } from './commerce-resource-save.js';
import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';
import { PB_ORG, PB_SITE } from './commerce-pbus-config.js';
import { showToast } from './commerce-otp-ui.js';
import { startProductImageSync } from './product-image-sync.js';
import { fetchProductsIndexForLocale, getProductRefFromIndex } from './pim.js';

/** Product JSON edits are production-only (active API env, not staging). */
function canUseEditMode() {
  return getApiEnvironment() === 'prod';
}

const AEM_BASE = 'https://main--vitamix--aemsites.aem.network';
const IMAGE_QUERY = '?width=750&format=webply&optimize=medium';

const CATALOG_PARAM = 'catalog';
const DEFAULT_CATALOG = 'us/en_us';
const AVAILABILITY_CATALOGS = [
  { path: 'us/en_us', label: 'US · en_us' },
  { path: 'ca/fr_ca', label: 'CA · fr_ca' },
];
const AVAILABILITY_STATES = [
  'InStock',
  'OutOfStock',
  'ManagedInventory',
  'Discontinued',
];

function getCatalogFromParams() {
  const params = new URLSearchParams(window.location.search);
  return params.get(CATALOG_PARAM) || DEFAULT_CATALOG;
}

function getProductsBaseUrl() {
  return `${AEM_BASE}/${getCatalogFromParams()}/products/`;
}

let currentProductData = null;
let currentIndexByUrlKey = {};
let currentProductRef = '';
let editMode = false;

function getProductParam() {
  const params = new URLSearchParams(window.location.search);
  return params.get('product') || '';
}

function resolveImageUrl(imagePath) {
  if (!imagePath) return '';
  const path = typeof imagePath === 'string' ? imagePath : imagePath?.url || imagePath?.src || '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const normalized = path.startsWith('./') ? path.slice(2) : path;
  return normalized ? getProductsBaseUrl() + normalized + IMAGE_QUERY : '';
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

function getCatalogProductPath(productRef) {
  const path = normalizeProductPath(productRef);
  const prefix = `/${getCatalogFromParams()}/products/`;
  return path.startsWith(prefix) ? path : `${prefix}${path.replace(/^\/+/, '')}`;
}

async function fetchProductBusRecord(productRef) {
  const path = getCatalogProductPath(productRef);
  const product = await fetchCatalogProduct(path);
  if (!product) throw new Error('HTTP 404: Product not found');
  return product;
}

/** Build urlKey -> product (prefer parent) from index array */
function buildIndexByUrlKey(indexData) {
  const map = {};
  if (!Array.isArray(indexData)) return map;
  indexData.forEach((item) => {
    const key = item.urlKey
      || (item.path ? pathToUrlKey(item.path) : '')
      || (item.url ? item.url.replace(/\/$/, '').split('/').pop() : '');
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
  const path = typeof imagePath === 'string' ? imagePath : imagePath?.url || imagePath?.src || '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const normalized = path.startsWith('./') ? path.slice(2) : path;
  return normalized ? getProductsBaseUrl() + normalized + IMAGE_QUERY : '';
}

function renderValue(label, value) {
  if (value == null) return '';
  const v = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  return `<div class="pim-detail-field"><span class="pim-detail-label">${escapeHtml(label)}</span><span class="pim-detail-value">${escapeHtml(v)}</span></div>`;
}

function renderPrice(price) {
  if (!price) return '';
  const value = price.final != null ? price.final : price.regular;
  return renderValue('Price', value);
}

function renderImages(images, canEdit = false) {
  if (!Array.isArray(images) && !canEdit) return '';
  const list = Array.isArray(images) ? images : [];
  const items = list.map((img) => {
    const src = resolveImageUrl(img.url || img);
    const label = img.label ? ` title="${escapeHtml(img.label)}"` : '';
    const wrap = src ? `<a href="${escapeHtml(src)}" target="_blank" rel="noopener" class="pim-detail-img-wrap"${label}><img src="${escapeHtml(src)}" alt="" loading="lazy" class="pim-detail-img" /></a>` : '<span class="pim-detail-img-wrap pim-detail-no-img">—</span>';
    return `<span class="pim-detail-img-item">${wrap}</span>`;
  });
  return `<div class="pim-detail-section">
    <div class="pim-detail-section-head">
      <h3 class="pim-detail-section-title">Images</h3>
      ${canEdit ? '<button type="button" class="pim-io-open-btn" id="productUpdateImagesBtn">Update images</button>' : ''}
    </div>
    <div class="pim-detail-gallery">${items.join('')}</div>
  </div>`;
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

function renderResources(resources) {
  if (!Array.isArray(resources) || resources.length === 0) return '';
  const list = Array.isArray(resources) ? resources : [];
  const items = list.map((r) => {
    const name = r.name || 'Resource';
    const url = r.url || '#';
    const type = (r.type || 'file').toLowerCase();
    return `<li class="pim-detail-resource"><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(name)}</a><span class="pim-detail-resource-type pim-detail-resource-type-${escapeHtml(type)}">${escapeHtml(r.type || '')}</span></li>`;
  }).join('');
  return `<div class="pim-detail-section"><h3 class="pim-detail-section-title">Resources</h3><ul class="pim-detail-resource-list">${items}</ul></div>`;
}

function renderLinkedProducts(paths, indexByUrlKey, sectionTitle) {
  const list = Array.isArray(paths) ? paths : [];
  if (list.length === 0) return '';
  const cards = list.map((path) => {
    const urlKey = pathToUrlKey(path);
    const product = indexByUrlKey[urlKey];
    const catalog = getCatalogFromParams();
    const productRef = product ? getProductRefFromIndex(product, catalog) : urlKey;
    const detailHref = `product-detail.html?catalog=${encodeURIComponent(catalog)}&product=${encodeURIComponent(productRef)}`;
    const name = product ? (product.title || product.name || product.sku || urlKey) : urlKey;
    const image = product?.image || product?.images?.[0]?.url || product?.images?.[0];
    const imgSrc = image ? resolveIndexImageUrl(image) : '';
    return `<span><a href="${escapeHtml(detailHref)}" class="pim-detail-linked-card">
      <span class="pim-detail-linked-thumb">${imgSrc ? `<img src="${escapeHtml(imgSrc)}" alt="" loading="lazy" />` : '<span class="pim-detail-linked-no-img">—</span>'}</span>
      <span class="pim-detail-linked-name">${escapeHtml(name)}</span>
    </a></span>`;
  }).join('');
  return `<div class="pim-detail-section"><h3 class="pim-detail-section-title">${escapeHtml(sectionTitle)}</h3><div class="pim-detail-linked-grid">${cards}</div></div>`;
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

function renderCustom(custom) {
  if (!custom) return '';
  const obj = custom && typeof custom === 'object' ? custom : {};
  const skipKeys = ['categories', 'resources', 'crosssellSkus', 'relatedSkus'];
  const entries = Object.entries(obj).filter(([k, v]) => v != null && v !== '' && !skipKeys.includes(k));
  if (entries.length === 0) return '';
  const rows = entries.map(([k, v]) => {
    const val = formatCustomCellValue(k, v);
    return `<tr><td class="pim-detail-custom-key">${escapeHtml(k)}</td><td class="pim-detail-custom-val">${val}</td></tr>`;
  }).join('');
  return `<div class="pim-detail-section"><h3 class="pim-detail-section-title">Custom</h3><table class="pim-detail-custom-table"><tbody>${rows}</tbody></table></div>`;
}

function variantImageEntries(images) {
  if (!Array.isArray(images)) return [];
  return images.map((img) => {
    const src = resolveImageUrl(img);
    if (!src) return null;
    const label = img && typeof img === 'object' ? String(img.label || '') : '';
    return { src, label };
  }).filter(Boolean);
}

function renderVariantThumbs(variant) {
  const entries = variantImageEntries(variant.images);
  if (!entries.length) return '—';
  const sku = variant.sku || variant.name || 'variant';
  return `<div class="pim-detail-var-thumbs">${entries.map((img, i) => {
    const alt = img.label || `${sku} image ${i + 1}`;
    const title = img.label ? ` title="${escapeHtml(img.label)}"` : '';
    return `<a href="${escapeHtml(img.src)}" target="_blank" rel="noopener" class="pim-detail-var-thumb-link"${title}><img src="${escapeHtml(img.src)}" alt="${escapeHtml(alt)}" loading="lazy" class="pim-detail-var-img" /></a>`;
  }).join('')}</div>`;
}

function renderAvailability(value, editable = false) {
  const state = value || '';
  const availabilityClass = state.toLowerCase().replace(/\s+/g, '-');
  const label = escapeHtml(state || '—');
  if (editable) {
    return `<button type="button" class="pim-card-availability pim-availability-edit-trigger ${availabilityClass}" data-availability-edit aria-label="Edit availability: ${label}">${label}</button>`;
  }
  return `<span class="pim-card-availability ${availabilityClass}">${label}</span>`;
}

function renderVariants(variants, editable = false) {
  if (!Array.isArray(variants) || variants.length === 0) return '';
  const rows = variants.map((v) => {
    const price = v.price ? (v.price.final ?? v.price.regular ?? '') : '';
    const opts = Array.isArray(v.options) ? v.options.map((o) => `${o.id || ''}: ${o.value || ''}`).filter(Boolean).join('; ') : '';
    return `<tr>
      <td class="pim-detail-var-thumb">${renderVariantThumbs(v)}</td>
      <td class="pim-detail-var-sku">${escapeHtml(v.sku || '')}</td>
      <td class="pim-detail-var-name">${escapeHtml(v.name || '')}</td>
      <td class="pim-detail-var-opts">${escapeHtml(opts)}</td>
      <td class="pim-detail-var-price">${escapeHtml(price)}</td>
      <td class="pim-detail-var-avail">${renderAvailability(v.availability, editable)}</td>
    </tr>`;
  }).join('');
  return `<div class="pim-detail-section"><h3 class="pim-detail-section-title">Variants (${variants.length})</h3><div class="pim-detail-table-wrap"><table class="pim-detail-variants-table"><thead><tr><th>Images</th><th>SKU</th><th>Name</th><th>Options</th><th>Price</th><th>Availability</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function renderOptions(options) {
  if (!Array.isArray(options) || options.length === 0) return '';
  const rows = options.map((o) => {
    const values = (o.values || []).map((v) => v.value || v).join(', ');
    return `<tr><td class="pim-detail-custom-key">${escapeHtml(o.label || o.id || '')}</td><td class="pim-detail-custom-val">${escapeHtml(values)}</td></tr>`;
  }).join('');
  return `<div class="pim-detail-section"><h3 class="pim-detail-section-title">Options</h3><table class="pim-detail-custom-table"><tbody>${rows}</tbody></table></div>`;
}

function renderDeleteProduct(productPath, canDelete) {
  if (!canDelete || !productPath) return '';
  return `<section class="pim-delete-product">
    <div>
      <h2 class="pim-delete-product-title">Delete product</h2>
      <p class="pim-delete-product-copy">Permanently remove this product from the catalog.</p>
    </div>
    <button type="button" class="pim-delete-product-btn" data-pim-delete-product>Delete product</button>
  </section>`;
}

function renderProduct(data, indexByUrlKey = {}, canEdit = false) {
  const priceBlock = renderPrice(data.price);
  const sections = [
    `<div class="pim-detail-header">
      <h1 class="pim-detail-name">${escapeHtml(data.name || data.sku || '')}</h1>
      <div class="pim-detail-meta">
        ${renderValue('SKU', data.sku)}
        ${renderValue('Type', data.type)}
        ${renderValue('URL key', data.urlKey)}
        ${renderValue('Path', data.path)}
        ${renderValue('Brand', data.brand)}
        ${renderAvailability(data.availability, canEdit)}
        ${priceBlock}
      </div>
    </div>`,
    renderImages(data.images, canEdit),
    data.options && data.options.length ? renderOptions(data.options) : '',
    renderVariants(data.variants, canEdit),
    renderCategories(data.custom?.categories),
    renderResources(data.custom?.resources),
    renderLinkedProducts(data.custom?.crosssellSkus, indexByUrlKey, 'Cross-sell'),
    renderLinkedProducts(data.custom?.relatedSkus, indexByUrlKey, 'Related products'),
    renderCustom(data.custom),
    (data.metadata && Object.keys(data.metadata).length > 0)
      ? `<div class="pim-detail-section"><h3 class="pim-detail-section-title">Raw metadata</h3><pre class="pim-detail-raw">${escapeHtml(JSON.stringify(data.metadata, null, 2))}</pre></div>`
      : '',
    renderDeleteProduct(
      normalizeProductPath(data.path || getCatalogProductPath(currentProductRef)),
      canEdit,
    ),
  ];
  return sections.filter(Boolean).join('\n');
}

function openDeleteProductDialog(productPath) {
  const normalizedPath = normalizeProductPath(productPath);
  const requestPath = catalogApiPath(normalizedPath);
  const requestUrl = `${getApiBase()}/${PB_ORG}/sites/${PB_SITE}/${requestPath}`;
  const dialog = document.createElement('dialog');
  dialog.className = 'pim-delete-dialog';
  dialog.innerHTML = `
    <form method="dialog" class="pim-delete-dialog-inner">
      <h2 class="pim-delete-dialog-title">Delete product?</h2>
      <p class="pim-delete-dialog-copy">This permanently removes <strong>${escapeHtml(normalizedPath)}</strong>.</p>
      <div class="pim-delete-dialog-call">
        <span>API call</span>
        <code>DELETE ${escapeHtml(requestUrl)}</code>
      </div>
      <label class="pim-delete-dialog-label" for="pim-delete-product-path">Enter the full product path to confirm</label>
      <input id="pim-delete-product-path" class="pim-delete-dialog-input" type="text" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(normalizedPath)}" />
      <p class="pim-delete-dialog-status" data-pim-delete-status aria-live="polite"></p>
      <div class="pim-delete-dialog-actions">
        <button type="button" class="pim-delete-dialog-cancel">Cancel</button>
        <button type="submit" class="pim-delete-dialog-confirm" disabled>Delete product</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);

  const form = dialog.querySelector('form');
  const input = dialog.querySelector('#pim-delete-product-path');
  const cancelBtn = dialog.querySelector('.pim-delete-dialog-cancel');
  const confirmBtn = dialog.querySelector('.pim-delete-dialog-confirm');
  const statusEl = dialog.querySelector('[data-pim-delete-status]');
  const dismiss = () => {
    dialog.close();
    dialog.remove();
  };

  input.addEventListener('input', () => {
    confirmBtn.disabled = input.value !== normalizedPath;
  });
  cancelBtn.addEventListener('click', dismiss);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dismiss();
  });
  wireDialogEscapeDismiss(dialog, dismiss);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (input.value !== normalizedPath || !canUseEditMode()) return;
    input.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
    statusEl.textContent = '';
    try {
      const resp = await apiFetch(PB_ORG, PB_SITE, requestPath, { method: 'DELETE' });
      if (!resp.ok) {
        const message = resp.headers.get('x-error')
          || (await resp.text().catch(() => '')).trim()
          || `HTTP ${resp.status}`;
        throw new Error(message);
      }
      const results = await resp.json();
      const result = Array.isArray(results) ? results[0] : null;
      if (!result || (result.status !== 200 && result.success !== true)) {
        throw new Error(result?.message || result?.reason || 'The API did not delete this product.');
      }
      showToast(`Deleted ${normalizedPath}`);
      window.location.assign(`catalog.html?catalog=${encodeURIComponent(getCatalogFromParams())}`);
    } catch (err) {
      statusEl.textContent = err.message || 'Failed to delete product';
      input.disabled = false;
      cancelBtn.disabled = false;
      confirmBtn.disabled = input.value !== normalizedPath;
      confirmBtn.textContent = 'Delete product';
      showToast(err.message || 'Failed to delete product', 'error');
    }
  });

  dialog.showModal();
  input.focus();
}

function normalizeAvailabilitySku(sku) {
  return String(sku || '').trim().toUpperCase();
}

function getAvailabilityProductPath(locale, productRef) {
  const normalizedRef = normalizeProductPath(productRef);
  const prefix = `/${locale}/products/`;
  if (normalizedRef.startsWith(prefix)) return normalizedRef;
  return `${prefix}${normalizedRef.replace(/^\/+/, '')}`;
}

async function fetchAvailabilityRows() {
  const productSku = normalizeAvailabilitySku(currentProductData?.sku);
  if (!productSku) throw new Error('The current product does not have a SKU.');

  const indexes = await Promise.all(AVAILABILITY_CATALOGS.map(async (catalog) => {
    const json = await fetchProductsIndexForLocale(catalog.path);
    const rows = Array.isArray(json) ? json : json?.data;
    if (!Array.isArray(rows)) {
      throw new Error(`Could not read the product index for ${catalog.label}.`);
    }
    return { catalog, rows };
  }));

  const products = await Promise.all(indexes.map(async ({ catalog, rows }) => {
    const indexedProduct = rows.find((item) => (
      !item.parentSku && normalizeAvailabilitySku(item.sku) === productSku
    ));
    if (!indexedProduct) return { catalog, product: null };

    const productPath = getAvailabilityProductPath(
      catalog.path,
      getProductRefFromIndex(indexedProduct, catalog.path),
    );
    const product = await fetchCatalogProduct(productPath);
    if (!product) throw new Error(`Product not found in ${catalog.label}: ${productPath}`);
    return { catalog, productPath, product };
  }));

  const rows = [];
  const missingCatalogs = [];
  products.forEach(({ catalog, productPath, product }) => {
    if (!product) {
      missingCatalogs.push(catalog.label);
      return;
    }
    rows.push({
      catalog: catalog.label,
      locale: catalog.path,
      productPath,
      sku: product.sku,
      name: product.name || product.sku,
      availability: product.availability || '',
    });
    (Array.isArray(product.variants) ? product.variants : []).forEach((variant) => {
      rows.push({
        catalog: catalog.label,
        locale: catalog.path,
        productPath,
        sku: variant.sku,
        name: variant.name || variant.color || variant.sku,
        availability: variant.availability || '',
      });
    });
  });
  if (!rows.length) {
    throw new Error(`Product SKU ${currentProductData.sku} was not found in either catalog.`);
  }
  return { rows, missingCatalogs };
}

function availabilityStateOptions(current) {
  const states = [...AVAILABILITY_STATES];
  if (current && !states.includes(current)) states.push(current);
  return `${current ? '' : '<option value="">Select a state</option>'}${states.map((state) => (
    `<option value="${escapeHtml(state)}"${state === current ? ' selected' : ''}>${escapeHtml(state)}</option>`
  )).join('')}`;
}

function availabilityRowHtml(row, index) {
  const state = row.availability || '';
  return `<tr data-availability-row="${index}">
    <td class="pim-availability-select-col"><input type="checkbox" data-availability-select aria-label="Select ${escapeHtml(row.name)} (${escapeHtml(row.sku)}) in ${escapeHtml(row.catalog)}" /></td>
    <td><span class="pim-availability-item-name">${escapeHtml(row.name || row.sku)}</span><span class="pim-availability-item-sku">${escapeHtml(row.sku || '—')}</span></td>
    <td>${escapeHtml(row.catalog)}</td>
    <td><span class="pim-card-availability pim-availability-state ${state.toLowerCase()}">${escapeHtml(state || '—')}</span></td>
    <td class="pim-availability-target-cell">
      <span class="pim-availability-diff-arrow" aria-hidden="true">→</span>
      <select class="pim-availability-target-select ${state.toLowerCase()}" data-availability-target aria-label="Target availability for ${escapeHtml(row.sku)}">${availabilityStateOptions(state)}</select>
    </td>
  </tr>`;
}

function selectedAvailabilityChanges(rows, body) {
  return rows.map((row, index) => {
    const tableRow = body.querySelector(`[data-availability-row="${index}"]`);
    const selected = tableRow?.querySelector('[data-availability-select]');
    const target = tableRow?.querySelector('[data-availability-target]');
    if (!selected?.checked || !target?.value || target.value === row.availability) return null;
    return {
      ...row,
      targetAvailability: target.value,
    };
  }).filter(Boolean);
}

async function saveAvailabilityChanges(changes, onSaved) {
  const groups = new Map();
  changes.forEach((change) => {
    if (!groups.has(change.productPath)) {
      groups.set(change.productPath, {
        path: change.productPath,
        changes: [],
      });
    }
    groups.get(change.productPath).changes.push(change);
  });

  const outcomes = await Promise.allSettled([...groups.values()].map(async (group) => {
    const product = await fetchCatalogProduct(group.path);
    if (!product) throw new Error(`Product not found: ${group.path}`);
    group.changes.forEach((change) => {
      const target = normalizeAvailabilitySku(change.sku) === normalizeAvailabilitySku(product.sku)
        ? product
        : (product.variants || []).find((variant) => (
          normalizeAvailabilitySku(variant.sku) === normalizeAvailabilitySku(change.sku)
        ));
      if (!target) throw new Error(`SKU ${change.sku} was not found in ${group.path}.`);
      target.availability = change.targetAvailability;
    });
    await putOrPatchResource(catalogApiPath(group.path), product);
    const saved = { path: group.path, product, changes: group.changes };
    onSaved(saved);
    return saved;
  }));
  const savedProducts = outcomes
    .filter((outcome) => outcome.status === 'fulfilled')
    .map((outcome) => outcome.value);
  const failures = outcomes
    .filter((outcome) => outcome.status === 'rejected')
    .map((outcome) => outcome.reason?.message || 'An availability update failed.');
  if (failures.length) {
    throw new Error(
      `${savedProducts.length} of ${outcomes.length} product updates saved. ${failures.join(' ')}`,
    );
  }
  return savedProducts;
}

function openAvailabilityDialog() {
  if (!canUseEditMode() || !editMode || !currentProductData) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'pim-availability-dialog';
  dialog.innerHTML = `
    <div class="pim-availability-dialog-inner">
      <header class="pim-availability-dialog-header">
        <h2 class="pim-availability-dialog-title">Edit availability</h2>
        <p>Choose availability changes for this product and its variants in US (en_us) and Canada (fr_ca).</p>
      </header>
      <p class="pim-availability-dialog-status" data-availability-status role="status">Loading product availability…</p>
      <div class="pim-availability-dialog-table-wrap">
        <table class="pim-availability-table">
          <thead><tr>
            <th class="pim-availability-select-col"><input type="checkbox" data-availability-select-all aria-label="Select all rows" /></th>
            <th>Product / variant</th>
            <th>Catalog</th>
            <th>Current availability</th>
            <th class="pim-availability-target-heading">
              <select data-availability-bulk-target aria-label="Set target availability for all rows">
                <option value="">Set all to…</option>
                ${AVAILABILITY_STATES.map((state) => `<option value="${state}">${state}</option>`).join('')}
              </select>
            </th>
          </tr></thead>
          <tbody data-availability-rows></tbody>
        </table>
      </div>
      <footer class="pim-availability-dialog-actions">
        <button type="button" class="pim-availability-cancel" data-availability-cancel>Cancel</button>
        <button type="button" class="pim-availability-apply" data-availability-apply disabled>Make changes</button>
      </footer>
    </div>`;
  document.body.appendChild(dialog);

  const status = dialog.querySelector('[data-availability-status]');
  const body = dialog.querySelector('[data-availability-rows]');
  const selectAll = dialog.querySelector('[data-availability-select-all]');
  const bulkTarget = dialog.querySelector('[data-availability-bulk-target]');
  const cancelButton = dialog.querySelector('[data-availability-cancel]');
  const applyButton = dialog.querySelector('[data-availability-apply]');
  let rows = [];
  let loading = true;
  let saving = false;
  const scrollLock = {
    html: {
      overflow: document.documentElement.style.overflow,
      overscrollBehavior: document.documentElement.style.overscrollBehavior,
    },
    body: {
      overflow: document.body.style.overflow,
      overscrollBehavior: document.body.style.overscrollBehavior,
    },
  };
  document.documentElement.style.overflow = 'hidden';
  document.documentElement.style.overscrollBehavior = 'none';
  document.body.style.overflow = 'hidden';
  document.body.style.overscrollBehavior = 'none';

  const updateRowDiff = (tableRow) => {
    const index = Number(tableRow.dataset.availabilityRow);
    const row = rows[index];
    const target = tableRow.querySelector('[data-availability-target]');
    if (!row || !target) return;
    const targetState = target.value;
    const targetClass = targetState.toLowerCase();
    target.className = `pim-availability-target-select ${targetClass}`;
    tableRow.classList.toggle(
      'pim-availability-row-changed',
      Boolean(targetState && targetState !== row.availability),
    );
  };
  const updateApplyState = () => {
    const selections = [...body.querySelectorAll('[data-availability-select]')];
    const selectedCount = selections.filter((checkbox) => checkbox.checked).length;
    selectAll.checked = selections.length > 0 && selectedCount === selections.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < selections.length;
    applyButton.disabled = loading || selectedAvailabilityChanges(rows, body).length === 0;
  };
  const close = () => {
    if (dialog.open && !saving) dialog.close();
  };
  const closeAfterSave = () => {
    if (dialog.open) dialog.close();
  };

  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.addEventListener('close', () => {
    document.documentElement.style.overflow = scrollLock.html.overflow;
    document.documentElement.style.overscrollBehavior = scrollLock.html.overscrollBehavior;
    document.body.style.overflow = scrollLock.body.overflow;
    document.body.style.overscrollBehavior = scrollLock.body.overscrollBehavior;
  }, { once: true });
  cancelButton.addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  wireDialogEscapeDismiss(dialog, close);
  body.addEventListener('change', (event) => {
    const { target } = event;
    if (target instanceof HTMLSelectElement && target.matches('[data-availability-target]')) {
      const tableRow = target.closest('[data-availability-row]');
      updateRowDiff(tableRow);
      const row = rows[Number(tableRow.dataset.availabilityRow)];
      const checkbox = tableRow.querySelector('[data-availability-select]');
      if (row && checkbox) checkbox.checked = target.value !== row.availability;
      bulkTarget.value = '';
    }
    updateApplyState();
  });
  bulkTarget.addEventListener('change', () => {
    if (!bulkTarget.value) return;
    body.querySelectorAll('[data-availability-row]').forEach((tableRow) => {
      const row = rows[Number(tableRow.dataset.availabilityRow)];
      const target = tableRow.querySelector('[data-availability-target]');
      const checkbox = tableRow.querySelector('[data-availability-select]');
      if (!row || !target) return;
      target.value = bulkTarget.value;
      updateRowDiff(tableRow);
      if (checkbox) checkbox.checked = target.value !== row.availability;
    });
    updateApplyState();
  });
  selectAll.addEventListener('change', () => {
    body.querySelectorAll('[data-availability-select]').forEach((checkbox) => {
      checkbox.checked = selectAll.checked;
    });
    updateApplyState();
  });

  applyButton.addEventListener('click', async () => {
    const changes = selectedAvailabilityChanges(rows, body);
    if (!changes.length || loading) return;
    loading = true;
    saving = true;
    applyButton.disabled = true;
    cancelButton.disabled = true;
    body.querySelectorAll('input, select').forEach((control) => {
      control.disabled = true;
    });
    status.textContent = 'Saving availability changes…';
    let currentProductUpdated = false;
    try {
      const savedProducts = await saveAvailabilityChanges(
        changes,
        ({ path, product, changes: productChanges }) => {
          productChanges.forEach((change) => {
            const index = rows.findIndex((row) => (
              row.productPath === path && row.sku === change.sku
            ));
            if (index < 0) return;
            rows[index].availability = change.targetAvailability;
            const tableRow = body.querySelector(`[data-availability-row="${index}"]`);
            tableRow.classList.remove('pim-availability-row-changed');
            tableRow.querySelector('.pim-availability-state').textContent = change.targetAvailability;
            tableRow.querySelector('.pim-availability-state').className = `pim-card-availability pim-availability-state ${change.targetAvailability.toLowerCase()}`;
            tableRow.querySelector('[data-availability-target]').value = change.targetAvailability;
            updateRowDiff(tableRow);
            tableRow.querySelector('[data-availability-select]').checked = false;
          });
          const currentPath = normalizeProductPath(
            currentProductData.path || getCatalogProductPath(currentProductRef),
          );
          if (currentPath === path) {
            currentProductData = product;
            currentProductUpdated = true;
          }
        },
      );
      if (savedProducts.some(({ path }) => (
        normalizeProductPath(currentProductData.path) === path
      ))) {
        refreshDetailContent();
      }
      if (selectedAvailabilityChanges(rows, body).length === 0) {
        showToast('Availability updated');
        closeAfterSave();
      } else {
        status.textContent = 'Some selected rows still need changes.';
      }
    } catch (err) {
      status.textContent = err.message || 'Failed to save availability changes.';
      if (currentProductUpdated) refreshDetailContent();
      showToast(status.textContent, 'error');
    } finally {
      loading = false;
      saving = false;
      cancelButton.disabled = false;
      body.querySelectorAll('input, select').forEach((control) => {
        control.disabled = false;
      });
      updateApplyState();
    }
  });

  dialog.showModal();
  fetchAvailabilityRows().then(({ rows: loadedRows, missingCatalogs }) => {
    rows = loadedRows;
    body.innerHTML = rows.map(availabilityRowHtml).join('');
    status.textContent = missingCatalogs.length
      ? `Not found in ${missingCatalogs.join(' and ')}. You can still update the catalog shown below.`
      : '';
    loading = false;
    updateApplyState();
  }).catch((err) => {
    status.textContent = err.message || 'Failed to load product availability.';
    loading = false;
    updateApplyState();
    showToast(status.textContent, 'error');
  });
}

function attachDeleteProductHandler() {
  const content = document.getElementById('content');
  if (!content || !canUseEditMode() || !editMode) return;

  content.querySelectorAll('[data-availability-edit]').forEach((button) => {
    button.addEventListener('click', openAvailabilityDialog);
  });
  const deleteBtn = content.querySelector('[data-pim-delete-product]');
  if (deleteBtn instanceof HTMLButtonElement) {
    deleteBtn.addEventListener('click', () => {
      const productPath = normalizeProductPath(
        currentProductData.path
          || getCatalogProductPath(currentProductRef),
      );
      openDeleteProductDialog(productPath);
    });
  }
}

function applyEditModeToggle(editCheckbox) {
  if (!(editCheckbox instanceof HTMLInputElement)) return;
  const allowed = canUseEditMode();
  const label = editCheckbox.closest('.pim-edit-toggle');
  editCheckbox.disabled = !allowed;
  if (!allowed) {
    editCheckbox.checked = false;
    editMode = false;
  }
  if (label instanceof HTMLElement) {
    label.title = allowed ? '' : 'Switch the API to Production to edit products.';
    label.setAttribute('aria-disabled', allowed ? 'false' : 'true');
  }
}

function refreshDetailContent() {
  const content = document.getElementById('content');
  const isEdit = editMode && canUseEditMode();
  content.innerHTML = renderProduct(currentProductData, currentIndexByUrlKey, isEdit);
  const ioBtn = document.getElementById('productExportImportBtn');
  if (ioBtn instanceof HTMLButtonElement) ioBtn.hidden = !isEdit;
  attachDeleteProductHandler();
}
async function init() {
  const productRef = getProductParam();
  const loading = document.getElementById('loading');
  const content = document.getElementById('content');
  const errorEl = document.getElementById('error');
  const toolbar = document.getElementById('toolbar');
  const editCheckbox = document.getElementById('editModeCheckbox');

  if (!productRef) {
    showError('Missing product parameter. Use ?product=path');
    loading.classList.remove('active');
    return;
  }

  loading.classList.add('active');
  content.innerHTML = '';
  errorEl.classList.remove('active');

  try {
    const indexPromise = fetchProductsIndexForLocale(getCatalogFromParams())
      .then((json) => json.data || json)
      .catch(() => []);
    currentProductRef = productRef;
    let data;
    try {
      data = await fetchProductBusRecord(productRef);
    } catch (err) {
      if (!/^HTTP 404\b/.test(err.message)) throw err;
      const index = buildIndexByUrlKey(await indexPromise);
      const indexedProduct = index[pathToUrlKey(productRef)];
      const indexedRef = indexedProduct
        && getProductRefFromIndex(indexedProduct, getCatalogFromParams());
      if (!indexedRef || indexedRef === productRef) throw err;
      data = await fetchProductBusRecord(indexedRef);
      currentProductRef = indexedRef;
    }
    const indexData = await indexPromise;
    currentProductRef = normalizeProductPath(data.path || getCatalogProductPath(currentProductRef));
    currentProductData = JSON.parse(JSON.stringify(data));
    currentIndexByUrlKey = buildIndexByUrlKey(indexData);
    loading.classList.remove('active');
    toolbar.style.display = 'flex';
    const backLink = toolbar.querySelector('.pim-detail-back-link');
    if (backLink) backLink.href = `catalog.html?catalog=${encodeURIComponent(getCatalogFromParams())}`;

    if (editCheckbox instanceof HTMLInputElement) {
      applyEditModeToggle(editCheckbox);
      editCheckbox.addEventListener('change', () => {
        if (!canUseEditMode()) {
          applyEditModeToggle(editCheckbox);
          refreshDetailContent();
          return;
        }
        editMode = editCheckbox.checked;
        refreshDetailContent();
      });
    }

    content.addEventListener('click', async (event) => {
      const imagesBtn = event.target instanceof Element
        && event.target.closest('#productUpdateImagesBtn');
      if (!(imagesBtn instanceof HTMLButtonElement) || imagesBtn.disabled) return;
      if (!canUseEditMode() || !editMode || !currentProductData) return;
      imagesBtn.disabled = true;
      try {
        const product = {
          ...currentProductData,
          path: currentProductData.path || getCatalogProductPath(currentProductRef),
        };
        await startProductImageSync({
          product,
          urlKey: pathToUrlKey(product.path),
          previewSrc: resolveImageUrl,
          onApplied: (updated) => {
            currentProductData = updated;
            refreshDetailContent();
          },
        });
      } catch (err) {
        showToast(err.message || 'Failed to update images', 'error');
      } finally {
        imagesBtn.disabled = false;
      }
    });

    const ioBtn = document.getElementById('productExportImportBtn');
    if (ioBtn instanceof HTMLButtonElement) {
      ioBtn.addEventListener('click', async () => {
        if (!canUseEditMode() || !editMode || !currentProductData) return;
        ioBtn.disabled = true;
        try {
          const product = { ...currentProductData };
          if (!product.path) {
            product.path = getCatalogProductPath(currentProductRef);
          }
          await startProductExportImport({
            product,
            fallbackPath: product.path,
            onApplied: (updated) => {
              currentProductData = updated;
              refreshDetailContent();
            },
          });
        } catch (err) {
          showToast(err.message || 'Failed to export / import product', 'error');
        } finally {
          ioBtn.disabled = false;
        }
      });
    }

    refreshDetailContent();
  } catch (err) {
    loading.classList.remove('active');
    showError(err.message || 'Failed to load product');
  }
}

init();
