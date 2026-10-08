/**
 * ProductBus catalog JSON export / import (copy-paste textarea + import preview),
 * shared by product detail and the catalog overview.
 */
import { apiFetch } from './commerce-otp-api.js';
import { putOrPatchResource } from './commerce-resource-save.js';
import { PB_ORG, PB_SITE } from './commerce-pbus-config.js';
import { escapeHtml, showToast } from './commerce-otp-ui.js';
import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';
import { jsonDiffLines, jsonEqual, renderJsonDiffHtml } from './commerce-json-diff.js';

const FETCH_CONCURRENCY = 6;
const WRITE_CONCURRENCY = 4;
const OMIT_KEYS = ['internal'];

/**
 * @param {string} productPath
 * @returns {string} apiFetch path, e.g. `catalog/us/en_us/products/ascent-x3.json`
 */
export function catalogApiPath(productPath) {
  const path = String(productPath || '').trim();
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  const noJson = withSlash.endsWith('.json') ? withSlash.slice(0, -5) : withSlash;
  return `catalog${noJson}.json`;
}

export function normalizeProductPath(path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.endsWith('.json') ? withSlash.slice(0, -5) : withSlash;
}

function productInLocale(path, locale) {
  const prefix = `/${String(locale || '').replace(/^\/+|\/+$/g, '')}/`;
  return normalizeProductPath(path).startsWith(prefix);
}

export function sanitizeCatalogProduct(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(row));
  } catch {
    return null;
  }
  delete copy.internal;
  const path = normalizeProductPath(copy.path);
  if (path) copy.path = path;
  return copy;
}

async function readRespError(resp) {
  return resp.headers.get('x-error')
    || (await resp.text().catch(() => '')).trim()
    || `HTTP ${resp.status}`;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const i = index;
      index += 1;
      // eslint-disable-next-line no-await-in-loop -- bounded worker-pool fan-out
      results[i] = await mapper(items[i], i);
    }
  };
  if (!items.length) return results;
  const pool = Math.min(Math.max(limit, 1), items.length);
  await Promise.all(Array.from({ length: pool }, () => worker()));
  return results;
}

/**
 * @returns {Promise<{ sku: string, name: string, path: string }[]>}
 */
export async function listCatalogSummaries(onProgress) {
  const all = [];
  let cursor = '';
  /* eslint-disable no-await-in-loop -- cursor pages must be sequential */
  do {
    const path = cursor ? `catalog?cursor=${encodeURIComponent(cursor)}` : 'catalog';
    const resp = await apiFetch(PB_ORG, PB_SITE, path, { method: 'GET' });
    if (!resp.ok) throw new Error(await readRespError(resp));
    const data = await resp.json();
    const page = Array.isArray(data?.products) ? data.products : [];
    all.push(...page);
    onProgress?.({ phase: 'listing', found: all.length });
    cursor = data?.truncated ? String(data.cursor || '') : '';
  } while (cursor);
  /* eslint-enable no-await-in-loop */
  return all;
}

export async function fetchCatalogProduct(productPath) {
  const path = normalizeProductPath(productPath);
  if (!path) return null;
  const resp = await apiFetch(PB_ORG, PB_SITE, catalogApiPath(path), { method: 'GET' });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(await readRespError(resp));
  const data = await resp.json();
  return sanitizeCatalogProduct(data);
}

/**
 * Full ProductBus entries for one catalog locale (`us/en_us`, …).
 * @param {string} locale
 * @param {(progress: object) => void} [onProgress]
 * @returns {Promise<object[]>}
 */
export async function fetchCatalogProductsForLocale(locale, onProgress) {
  onProgress?.({ phase: 'listing', found: 0 });
  const summaries = (await listCatalogSummaries(onProgress))
    .filter((row) => productInLocale(row?.path, locale));
  let done = 0;
  onProgress?.({ phase: 'products', done, total: summaries.length });
  const fetched = await mapWithConcurrency(summaries, FETCH_CONCURRENCY, async (row) => {
    try {
      return await fetchCatalogProduct(row.path);
    } catch {
      return null;
    } finally {
      done += 1;
      onProgress?.({ phase: 'products', done, total: summaries.length });
    }
  });
  return fetched.filter(Boolean);
}

function productLabel(row, index) {
  const n = index + 1;
  const name = String(row?.name || row?.sku || '').trim();
  const path = normalizeProductPath(row?.path);
  if (name && path) return `Product ${n} (${name})`;
  if (path) return `Product ${n} (${path})`;
  return `Product ${n}`;
}

function validateImportedProduct(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${productLabel(raw, index)} must be a JSON object.`);
  }
  const body = sanitizeCatalogProduct(raw);
  if (!body) throw new Error(`${productLabel(raw, index)}: could not read this product.`);
  const path = normalizeProductPath(body.path);
  if (!path) throw new Error(`${productLabel(body, index)}: missing path.`);
  if (!String(body.sku || '').trim()) {
    throw new Error(`${productLabel(body, index)}: missing sku.`);
  }
  if (!String(body.name || '').trim()) {
    throw new Error(`${productLabel(body, index)}: missing name.`);
  }
  body.path = path;
  return body;
}

function parseImportJson(text) {
  let data;
  try {
    data = JSON.parse(String(text || ''));
  } catch {
    throw new Error('JSON is not valid. Fix the textarea and try again.');
  }
  let rows;
  if (Array.isArray(data)) {
    rows = data;
  } else if (data && typeof data === 'object') {
    rows = [data];
  } else {
    throw new Error('Import must be a product object or a JSON array of products.');
  }
  const bodies = rows.map((row, i) => validateImportedProduct(row, i));
  const seen = new Set();
  bodies.forEach((body, i) => {
    const path = normalizeProductPath(body.path);
    if (seen.has(path)) {
      throw new Error(`${productLabel(body, i)}: duplicate path in this JSON.`);
    }
    seen.add(path);
  });
  return bodies;
}

const CATEGORY_TSV_HEADER = 'Slug\tCategories';

function categoryNames(product) {
  return (Array.isArray(product?.custom?.categories) ? product.custom.categories : [])
    .map((category) => String(category?.name || category?.url_key || category?.urlKey || '').trim())
    .filter(Boolean);
}

function categoryNameKey(name) {
  return String(name).trim().toLocaleLowerCase();
}

export function categorySlugFromName(name) {
  return String(name).normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function knownCategoriesByName(products) {
  const known = new Map();
  products.forEach((product) => {
    const categories = Array.isArray(product?.custom?.categories) ? product.custom.categories : [];
    categories.forEach((category) => {
      const name = String(category?.name || category?.url_key || category?.urlKey || '').trim();
      if (name && !known.has(categoryNameKey(name))) known.set(categoryNameKey(name), category);
    });
  });
  return known;
}

function productSlug(product) {
  return String(product?.urlKey || product?.path?.split('/').pop() || '').trim();
}

function categoryExportProducts(products) {
  const byPath = new Map();
  products.forEach((product) => {
    const path = normalizeProductPath(product.path);
    if (!path) throw new Error('Cannot export categories for a product without a full path.');
    if (!byPath.has(path)) byPath.set(path, product);
  });
  return [...byPath.values()];
}

function categoryExportCollisions(products) {
  const bySlug = new Map();
  categoryExportProducts(products).forEach((product) => {
    const slug = productSlug(product);
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(normalizeProductPath(product.path));
  });
  return new Map([...bySlug].filter(([, paths]) => paths.length > 1));
}

export function catalogCategoriesTsv(products) {
  const unique = categoryExportProducts(products);
  const collisions = categoryExportCollisions(unique);
  return `${[CATEGORY_TSV_HEADER, ...unique.map((product) => (
    `${collisions.has(productSlug(product)) ? normalizeProductPath(product.path) : productSlug(product)}\t${categoryNames(product).join(', ')}`
  ))].join('\n')}\n`;
}

export function parseCategoriesTsv(text) {
  const lines = String(text || '').replace(/(?:\r?\n)+$/, '').split(/\r?\n/);
  if (lines.shift()?.replace(/^\uFEFF/, '').trim().toLowerCase() !== CATEGORY_TSV_HEADER.toLowerCase()) {
    throw new Error('Categories TSV must start with Slug and Categories columns.');
  }
  return lines.filter((line) => line.trim()).map((line, index) => {
    const cells = line.split('\t');
    const slug = cells[0]?.trim();
    const fullPath = /^\/[^/]+\/[^/]+\/(?:commercial\/)?products\/[^\\\r\n]+$/.test(slug || '');
    if (cells.length !== 2 || !slug || /[\\\r\n]/.test(slug)
      || (slug.includes('/') && !fullPath)) {
      throw new Error(`Row ${index + 2}: expected a product slug or full path and categories.`);
    }
    const categories = cells[1].split(',').map((value) => value.trim()).filter(Boolean);
    if (new Set(categories.map(categoryNameKey)).size !== categories.length) {
      throw new Error(`Row ${index + 2}: duplicate category name.`);
    }
    return { slug, categories };
  });
}

export function categoryPreviewRows(rows, existingByPath) {
  const bySlug = new Map();
  const byPath = new Map();
  const slugCounts = new Map();
  rows.forEach(({ slug }) => slugCounts.set(slug, (slugCounts.get(slug) || 0) + 1));
  const known = knownCategoriesByName([...existingByPath.values()]);
  existingByPath.forEach((product, path) => {
    const normalizedPath = normalizeProductPath(path);
    if (byPath.has(normalizedPath)) return;
    byPath.set(normalizedPath, { product, path: normalizedPath });
    const slug = productSlug(product);
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push({ product, path: normalizedPath });
  });
  const preview = rows.map((row) => {
    const matches = row.slug.startsWith('/')
      ? [byPath.get(normalizeProductPath(row.slug))].filter(Boolean) : bySlug.get(row.slug) || [];
    const existing = matches.length === 1 ? matches[0].product : null;
    const before = categoryNames(existing);
    const updated = existing ? withCategories(existing, row.categories, known) : null;
    const beforeCategories = existing?.custom?.categories || [];
    const target = updated || withCategories({}, row.categories, known);
    const afterCategories = target.custom.categories;
    const after = updated ? categoryNames(updated) : row.categories;
    let kind = 'missing';
    if (matches.length > 1) kind = 'ambiguous';
    else if (existing) {
      kind = jsonEqual(beforeCategories, afterCategories) ? 'same' : 'update';
    }
    return {
      ...row,
      path: matches[0]?.path,
      matchingPaths: matches.map((match) => match.path),
      before,
      after,
      beforeCategories,
      afterCategories,
      kind,
    };
  });
  const categoryNamesBySlug = new Map();
  const collectCategories = (categories) => {
    categories.forEach((category) => {
      const slug = category.url_key || category.urlKey;
      const { name } = category;
      if (!slug || !name) return;
      if (!categoryNamesBySlug.has(slug)) categoryNamesBySlug.set(slug, new Map());
      categoryNamesBySlug.get(slug).set(categoryNameKey(name), name);
    });
  };
  known.forEach((category) => collectCategories([{
    ...category,
    url_key: categorySlugFromName(category.name || category.url_key || category.urlKey),
  }]));
  preview.forEach((row) => collectCategories(row.afterCategories));
  return preview.map((row) => {
    const warnings = [];
    if (row.kind === 'ambiguous') {
      warnings.push(`Different product paths share this slug: ${row.matchingPaths.join(', ')}. Use a full path to identify the product.`);
    }
    if (slugCounts.get(row.slug) > 1) {
      warnings.push('Duplicate product slug. Selected rows apply in TSV order; the last one wins.');
    }
    const collisions = new Set();
    row.afterCategories.forEach((category) => {
      const slug = category.url_key || category.urlKey;
      const names = categoryNamesBySlug.get(slug);
      if (names?.size > 1 && !collisions.has(slug)) {
        collisions.add(slug);
        warnings.push(`Category slug "${slug}" is shared by different names: ${
          [...names.values()].join(', ')
        }.`);
      }
    });
    return { ...row, warnings };
  });
}

function categoryDiffHtml(before, after) {
  const fields = (category) => ({
    name: category.name || category.url_key || category.urlKey || '',
    slug: category.url_key || category.urlKey || '',
  });
  const fieldDiff = (oldValue, newValue) => (oldValue === newValue
    ? escapeHtml(newValue)
    : `<del class="pim-io-category-diff-del">${escapeHtml(oldValue)}</del>
      <span class="pim-io-category-diff-add">${escapeHtml(newValue)}</span>`);
  const remaining = [...before];
  const additions = after.map((category) => {
    const next = fields(category);
    let index = remaining.findIndex((current) => jsonEqual(current, category));
    if (index < 0) {
      index = remaining.findIndex((current) => fields(current).name === next.name);
    }
    if (index < 0) {
      index = remaining.findIndex((current) => fields(current).slug === next.slug);
    }
    if (index < 0) return { category, type: 'add' };
    const [previous] = remaining.splice(index, 1);
    return { category, previous, type: 'same' };
  });
  const lines = [...remaining.map((category) => ({ category, type: 'del' })), ...additions];
  return lines.map(({ category, previous, type }) => {
    const { name, slug } = fields(category);
    if (previous) {
      const old = fields(previous);
      return `<div class="pim-io-category-diff-same">${fieldDiff(old.name, name)}
        [${fieldDiff(old.slug, slug)}]</div>`;
    }
    const label = escapeHtml(`${name} [${slug}]`);
    const sign = { add: '+', del: '-', same: ' ' }[type];
    const text = type === 'del' ? `<del>${label}</del>` : label;
    return `<div class="pim-io-category-diff-${type}">
      <span aria-hidden="true">${sign}</span> ${text}</div>`;
  }).join('') || '—';
}

function categoryPreviewHtml(rows) {
  const selectable = rows.some((row) => row.kind === 'update');
  const body = rows.map((row, index) => {
    let status = statusBadge(row.kind);
    if (row.kind === 'missing') status = 'Not found';
    if (row.kind === 'ambiguous') status = 'Ambiguous slug';
    const warnings = row.warnings.map((warning) => (
      `<div class="pim-io-category-warning">${escapeHtml(warning)}</div>`
    )).join('');
    return `<tr${row.warnings.length ? ' class="pim-io-category-row-warning"' : ''}>
    <td>${row.kind === 'update' ? `<input type="checkbox" data-pim-io-select value="${index}" aria-label="Select ${escapeHtml(row.slug)} category change">` : ''}</td>
    <td>${status}${warnings}</td>
    <td>${escapeHtml(row.slug)}</td>
    <td>${categoryDiffHtml(row.beforeCategories, row.afterCategories)}</td>
  </tr>`;
  }).join('');
  return `<table class="pim-io-category-table" aria-label="Category import differences">
    <thead><tr><th scope="col">${selectable ? '<input type="checkbox" data-pim-io-select-all aria-label="Select all category changes">' : ''}</th>
      <th scope="col">Status</th><th scope="col">Slug</th><th scope="col">Category changes</th></tr></thead>
    <tbody>${body || '<tr><td colspan="4">No products in this TSV.</td></tr>'}</tbody>
  </table>`;
}

export function withCategories(product, names, knownByName = new Map()) {
  const local = knownCategoriesByName([product]);
  const categories = names.map((name) => {
    const known = local.get(categoryNameKey(name)) || knownByName.get(categoryNameKey(name));
    const slug = categorySlugFromName(name);
    if (!slug) throw new Error(`Cannot derive a category slug from "${name}".`);
    return {
      ...known,
      ...(known && Object.hasOwn(known, 'urlKey') ? { urlKey: slug } : {}),
      url_key: slug,
      name,
    };
  });
  return { ...product, custom: { ...product.custom, categories } };
}

async function applyCategoryChanges(rows, existingByPath, onProgress) {
  const ok = [];
  const failed = [];
  let done = 0;
  const known = knownCategoriesByName([...existingByPath.values()]);
  const hasDuplicates = new Set(rows.map((row) => row.path)).size !== rows.length;
  await mapWithConcurrency(rows, hasDuplicates ? 1 : WRITE_CONCURRENCY, async (row) => {
    try {
      const product = await fetchCatalogProduct(row.path);
      if (!product) throw new Error('Product not found');
      const body = withCategories(product, row.categories, known);
      await putOrPatchResource(catalogApiPath(row.path), body);
      ok.push(body);
    } catch (err) {
      failed.push({ path: row.path, message: err?.message || String(err) });
    } finally {
      done += 1;
      onProgress?.(done, rows.length);
    }
  });
  return { ok, failed };
}

function classifyBodies(bodies, existingByPath) {
  const toAdd = [];
  const toUpdate = [];
  const skipped = [];
  bodies.forEach((body) => {
    const existing = existingByPath.get(normalizeProductPath(body.path));
    if (!existing) {
      toAdd.push(body);
      return;
    }
    if (jsonEqual(existing, body, OMIT_KEYS)) skipped.push(body);
    else toUpdate.push(body);
  });
  return {
    bodies, toAdd, toUpdate, skipped,
  };
}

function importPreviewLead(toAdd, toUpdate, skipped) {
  if (!toAdd.length && !toUpdate.length) {
    return skipped.length
      ? 'Nothing to import. Every product in this JSON already matches this environment.'
      : 'Nothing to import.';
  }
  const bits = [];
  if (toAdd.length) bits.push(`${toAdd.length} will be created`);
  if (toUpdate.length) bits.push(`${toUpdate.length} will be updated`);
  if (skipped.length) bits.push(`${skipped.length} unchanged and skipped`);
  return `${bits.join('. ')}.`;
}

function statusBadge(kind) {
  if (kind === 'new') return '<span class="pim-io-badge pim-io-badge-new">New</span>';
  if (kind === 'update') return '<span class="pim-io-badge pim-io-badge-update">Update</span>';
  return '<span class="pim-io-badge pim-io-badge-same">Unchanged</span>';
}

function previewItemHtml(body, existing, kind) {
  const name = String(body.name || body.sku || 'Product');
  const sku = String(body.sku || '');
  const path = normalizeProductPath(body.path);
  let diff = '';
  if (kind === 'update' && existing) {
    const lines = jsonDiffLines(existing, body, OMIT_KEYS).filter((l) => l.type !== 'same');
    const n = lines.length;
    const summary = n === 1 ? 'Show 1 changed line' : `Show ${n} changed lines`;
    diff = `<details class="pim-io-diff">
      <summary>${escapeHtml(summary)}</summary>
      ${renderJsonDiffHtml(lines)}
    </details>`;
  }
  return `<article class="pim-io-item pim-io-item-${escapeHtml(kind)}">
    <div class="pim-io-item-head">
      ${statusBadge(kind)}
      <strong class="pim-io-item-name">${escapeHtml(name)}</strong>
      ${sku ? `<span class="pim-io-item-sku">${escapeHtml(sku)}</span>` : ''}
      <span class="pim-io-item-path">${escapeHtml(path)}</span>
    </div>
    ${diff}
  </article>`;
}

function previewListHtml(parsed, existingByPath) {
  const toAddSet = new Set(parsed.toAdd);
  const toUpdateSet = new Set(parsed.toUpdate);
  return parsed.bodies.map((body) => {
    const existing = existingByPath.get(normalizeProductPath(body.path));
    let kind = 'new';
    if (toUpdateSet.has(body)) kind = 'update';
    else if (!toAddSet.has(body)) kind = 'same';
    return previewItemHtml(body, existing, kind);
  }).join('');
}

function downloadJson(text, filename, categories = false) {
  const raw = String(text || '');
  if (!raw.trim()) throw new Error('Nothing to download — the text is empty.');
  const blob = new Blob([raw], { type: categories ? 'text/tab-separated-values;charset=utf-8' : 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
}

async function applyImportedProducts(items, onProgress) {
  const ok = [];
  const failed = [];
  let done = 0;
  await mapWithConcurrency(items, WRITE_CONCURRENCY, async (item) => {
    const path = normalizeProductPath(item.body?.path);
    try {
      await putOrPatchResource(catalogApiPath(path), item.body);
      ok.push({ path, action: item.existed ? 'update' : 'create' });
    } catch (err) {
      failed.push({ path, message: err?.message || String(err) });
    } finally {
      done += 1;
      onProgress?.(done, items.length);
    }
  });
  return { ok, failed };
}

function stampFilename(prefix) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${prefix}-${stamp}.json`;
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.hint
 * @param {string} opts.filename
 * @param {string} [opts.initialJson]
 * @param {(onProgress: (progress: object) => void) => Promise<string>} [opts.loadJson]
 * @param {Map<string, object>} [opts.existingByPath]
 * @param {(imported: object[]) => void} [opts.onApplied]
 * @param {string} [opts.locale] enables category TSV mode for catalog exports
 */
export function openCatalogExportImportDialog({
  title,
  hint,
  filename,
  initialJson = '',
  loadJson,
  existingByPath = new Map(),
  onApplied,
  locale = '',
}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'pim-io-dialog';
    dialog.innerHTML = `
      <div class="pim-io-dialog-inner">
        <div class="pim-io-dialog-scroll" tabindex="-1">
          ${locale ? `<div class="pim-io-choice" data-pim-io-pane="choice">
            <h2 class="pim-io-title">${escapeHtml(title)}</h2>
            <div class="pim-io-choice-options">
              <button type="button" class="pim-io-choice-option" data-pim-io-format="json">
                <strong>Full Catalog (JSON)</strong>
                <span>Export or import complete product records.</span>
              </button>
              <button type="button" class="pim-io-choice-option" data-pim-io-format="categories">
                <strong>Categories</strong>
                <span>Export or import product category assignments as TSV.</span>
              </button>
            </div>
            <div class="pim-io-load-progress" data-pim-io-load-progress role="status" aria-live="polite" hidden>
              <span data-pim-io-load-label>Scanning catalog…</span>
              <progress data-pim-io-load-bar aria-label="Catalog loading progress"></progress>
            </div>
          </div>` : ''}
          <div data-pim-io-pane="json" ${locale ? 'hidden' : ''}>
            <h2 class="pim-io-title">${escapeHtml(title)}</h2>
            <p class="pim-io-hint">${hint}</p>
            <label class="pim-sr-only" for="pim-io-json" data-pim-io-label>Product JSON</label>
            <textarea id="pim-io-json" class="pim-io-textarea" spellcheck="false" rows="16">${escapeHtml(initialJson)}</textarea>
          </div>
          <div data-pim-io-pane="preview" hidden>
            <h2 class="pim-io-title">Import preview</h2>
            <p class="pim-io-hint" data-pim-io-preview-lead></p>
            <div class="pim-io-preview" data-pim-io-preview-list></div>
          </div>
          <div class="pim-io-status" data-pim-io-status hidden></div>
        </div>
        <div class="pim-io-actions">
          <button type="button" class="pim-io-btn" data-pim-io-cancel>Cancel</button>
          <button type="button" class="pim-io-btn" data-pim-io-back hidden>Back</button>
          <button type="button" class="pim-io-btn" data-pim-io-preview ${locale ? 'hidden' : ''}>Preview import</button>
          <button type="button" class="pim-io-btn pim-io-btn-primary" data-pim-io-save ${locale ? 'hidden' : ''}>Download</button>
          <button type="button" class="pim-io-btn pim-io-btn-primary" data-pim-io-import hidden>Import</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);

    const choicePane = dialog.querySelector('[data-pim-io-pane="choice"]');
    const jsonPane = dialog.querySelector('[data-pim-io-pane="json"]');
    const previewPane = dialog.querySelector('[data-pim-io-pane="preview"]');
    const statusEl = dialog.querySelector('[data-pim-io-status]');
    const loadProgress = dialog.querySelector('[data-pim-io-load-progress]');
    const loadLabel = dialog.querySelector('[data-pim-io-load-label]');
    const loadBar = dialog.querySelector('[data-pim-io-load-bar]');
    const textarea = /** @type {HTMLTextAreaElement | null} */ (dialog.querySelector('#pim-io-json'));
    const leadEl = dialog.querySelector('[data-pim-io-preview-lead]');
    const listHost = dialog.querySelector('[data-pim-io-preview-list]');
    const hintEl = dialog.querySelector('.pim-io-hint');
    const labelEl = dialog.querySelector('[data-pim-io-label]');
    const btnCancel = dialog.querySelector('[data-pim-io-cancel]');
    const btnBack = dialog.querySelector('[data-pim-io-back]');
    const btnPreview = dialog.querySelector('[data-pim-io-preview]');
    const btnSave = dialog.querySelector('[data-pim-io-save]');
    const btnImport = dialog.querySelector('[data-pim-io-import]');

    /** @type {{ body: object, existed: boolean }[]} */
    let pendingImport = [];
    let categoryRows = [];
    let mode = 'json';
    let jsonText = initialJson;
    let categoriesText = `${CATEGORY_TSV_HEADER}\n`;
    const liveExisting = existingByPath;

    const setStatus = (msg, tone = 'error') => {
      if (!(statusEl instanceof HTMLElement)) return;
      if (!msg) {
        statusEl.hidden = true;
        statusEl.textContent = '';
        statusEl.classList.remove('pim-io-status-error', 'pim-io-status-ok');
        return;
      }
      statusEl.hidden = false;
      statusEl.textContent = msg;
      statusEl.classList.toggle('pim-io-status-error', tone === 'error');
      statusEl.classList.toggle('pim-io-status-ok', tone !== 'error');
    };

    const setBusy = (busy, label) => {
      [btnPreview, btnSave, btnImport, btnBack].forEach((btn) => {
        if (btn instanceof HTMLButtonElement) btn.disabled = busy;
      });
      if (textarea) textarea.disabled = busy;
      choicePane?.querySelectorAll('button').forEach((btn) => { btn.disabled = busy; });
      if (busy && label) setStatus(label, 'ok');
    };

    const showJsonPane = () => {
      if (choicePane instanceof HTMLElement) choicePane.hidden = true;
      if (jsonPane instanceof HTMLElement) jsonPane.hidden = false;
      if (previewPane instanceof HTMLElement) previewPane.hidden = true;
      if (locale) btnBack?.removeAttribute('hidden');
      else btnBack?.setAttribute('hidden', '');
      btnPreview?.removeAttribute('hidden');
      btnSave?.removeAttribute('hidden');
      btnImport?.setAttribute('hidden', '');
      pendingImport = [];
      categoryRows = [];
    };

    const showChoicePane = () => {
      if (choicePane instanceof HTMLElement) choicePane.hidden = false;
      if (jsonPane instanceof HTMLElement) jsonPane.hidden = true;
      if (previewPane instanceof HTMLElement) previewPane.hidden = true;
      btnBack?.setAttribute('hidden', '');
      btnPreview?.setAttribute('hidden', '');
      btnSave?.setAttribute('hidden', '');
      btnImport?.setAttribute('hidden', '');
      setStatus('');
    };

    choicePane?.addEventListener('click', (event) => {
      const selected = event.target instanceof Element
        ? event.target.closest('[data-pim-io-format]') : null;
      if (!(selected instanceof HTMLButtonElement)) return;
      mode = selected.dataset.pimIoFormat;
      if (textarea) textarea.value = mode === 'json' ? jsonText : categoriesText;
      if (hintEl) {
        hintEl.innerHTML = mode === 'json' ? hint
          : `TSV of product slugs (full paths when slugs collide) and comma-separated category names in <strong>${escapeHtml(locale)}</strong>. Import regenerates all category slugs from display names. Edit or paste, then Preview import.`;
      }
      if (labelEl) labelEl.textContent = mode === 'json' ? 'Product JSON' : 'Categories TSV';
      setStatus('');
      showJsonPane();
    });

    const updateCategorySelection = () => {
      const selected = [...(listHost?.querySelectorAll('[data-pim-io-select]:checked') || [])];
      const checks = [...(listHost?.querySelectorAll('[data-pim-io-select]') || [])];
      const all = listHost?.querySelector('[data-pim-io-select-all]');
      if (all instanceof HTMLInputElement) {
        all.checked = !!checks.length && selected.length === checks.length;
        all.indeterminate = !!selected.length && selected.length < checks.length;
      }
      if (btnImport instanceof HTMLButtonElement) {
        btnImport.hidden = !selected.length;
        btnImport.textContent = `Import ${selected.length} category change${selected.length === 1 ? '' : 's'}`;
      }
    };

    listHost?.addEventListener('change', (event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      if (event.target.matches('[data-pim-io-select-all]')) {
        listHost.querySelectorAll('[data-pim-io-select]').forEach((checkbox) => {
          checkbox.checked = event.target.checked;
        });
      }
      updateCategorySelection();
    });

    const showPreviewPane = (parsed) => {
      const {
        bodies, toAdd, toUpdate, skipped,
      } = parsed;
      const toAddSet = new Set(toAdd);
      const toUpdateSet = new Set(toUpdate);
      pendingImport = bodies
        .filter((body) => toAddSet.has(body) || toUpdateSet.has(body))
        .map((body) => ({
          body,
          existed: toUpdateSet.has(body),
        }));
      if (jsonPane instanceof HTMLElement) jsonPane.hidden = true;
      if (previewPane instanceof HTMLElement) previewPane.hidden = false;
      btnBack?.removeAttribute('hidden');
      btnPreview?.setAttribute('hidden', '');
      btnSave?.setAttribute('hidden', '');
      if (pendingImport.length) btnImport?.removeAttribute('hidden');
      else btnImport?.setAttribute('hidden', '');
      if (btnImport instanceof HTMLButtonElement) {
        btnImport.disabled = !pendingImport.length;
        const n = pendingImport.length;
        const bits = [];
        if (toAdd.length) bits.push(`${toAdd.length} new`);
        if (toUpdate.length) bits.push(`${toUpdate.length} update${toUpdate.length === 1 ? '' : 's'}`);
        const detail = bits.length ? ` (${bits.join(', ')})` : '';
        btnImport.textContent = n === 1 ? `Import 1 product${detail}` : `Import ${n} products${detail}`;
      }
      if (leadEl) leadEl.textContent = importPreviewLead(toAdd, toUpdate, skipped);
      if (listHost) {
        listHost.innerHTML = bodies.length
          ? previewListHtml(parsed, liveExisting)
          : '<p class="pim-io-empty">No products in this JSON.</p>';
      }
    };

    const dismiss = (ok) => {
      dialog.close();
      dialog.remove();
      resolve(ok);
    };

    btnCancel?.addEventListener('click', () => dismiss(false));
    btnBack?.addEventListener('click', () => {
      if (previewPane instanceof HTMLElement && !previewPane.hidden) {
        showJsonPane();
        setStatus('');
      } else if (locale) {
        if (mode === 'json') jsonText = textarea?.value ?? '';
        else categoriesText = textarea?.value ?? '';
        showChoicePane();
      }
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dismiss(false);
    });
    wireDialogEscapeDismiss(dialog, () => dismiss(false));

    btnSave?.addEventListener('click', () => {
      try {
        const categories = mode === 'categories';
        const downloaded = downloadJson(textarea?.value ?? '', categories ? filename.replace(/\.json$/, '.tsv') : filename, categories);
        showToast(`Downloaded ${downloaded}`);
      } catch (err) {
        setStatus(err?.message || 'Could not download JSON');
        showToast(err?.message || 'Could not download JSON', 'error');
      }
    });

    btnPreview?.addEventListener('click', async () => {
      try {
        if (mode === 'categories') {
          const rows = parseCategoriesTsv(textarea?.value ?? '');
          setBusy(true, 'Comparing with catalog…');
          const knownSlugs = new Set([...liveExisting.values()].map(productSlug));
          const missing = rows.filter((row) => (
            row.slug.startsWith('/')
              ? !liveExisting.has(normalizeProductPath(row.slug)) : !knownSlugs.has(row.slug)
          ));
          const fetched = await mapWithConcurrency(missing, FETCH_CONCURRENCY, async (row) => {
            const path = row.slug.startsWith('/')
              ? normalizeProductPath(row.slug) : `/${locale}/products/${row.slug}`;
            if (!productInLocale(path, locale)) {
              throw new Error(`Product path is outside the selected catalog: ${path}`);
            }
            const product = await fetchCatalogProduct(path);
            return product && (row.slug.startsWith('/')
              ? normalizeProductPath(product.path) === path
              : productSlug(product) === row.slug) ? [path, product] : null;
          });
          fetched.filter(Boolean).forEach(([path, product]) => liveExisting.set(path, product));
          categoryRows = categoryPreviewRows(rows, liveExisting);
          if (leadEl) {
            const changed = categoryRows.filter((row) => row.kind === 'update').length;
            const unresolved = categoryRows.filter((row) => row.kind === 'missing' || row.kind === 'ambiguous').length;
            const unchanged = categoryRows.length - changed - unresolved;
            leadEl.textContent = `${changed} category changes. ${unchanged} unchanged. ${unresolved} unresolved. Select changes to import.`;
          }
          if (listHost) listHost.innerHTML = categoryPreviewHtml(categoryRows);
          if (jsonPane instanceof HTMLElement) jsonPane.hidden = true;
          if (previewPane instanceof HTMLElement) previewPane.hidden = false;
          btnBack?.removeAttribute('hidden');
          btnPreview?.setAttribute('hidden', '');
          btnSave?.setAttribute('hidden', '');
          updateCategorySelection();
          setBusy(false);
          setStatus('');
          return;
        }
        const bodies = parseImportJson(textarea?.value ?? '');
        setBusy(true, 'Comparing with catalog…');
        const missing = bodies
          .map((b) => normalizeProductPath(b.path))
          .filter((path) => path && !liveExisting.has(path));
        if (missing.length) {
          const extras = await mapWithConcurrency(missing, FETCH_CONCURRENCY, async (path) => {
            try {
              const product = await fetchCatalogProduct(path);
              return product ? [path, product] : null;
            } catch {
              return null;
            }
          });
          extras.filter(Boolean).forEach(([path, product]) => {
            liveExisting.set(path, product);
          });
        }
        const parsed = classifyBodies(bodies, liveExisting);
        setBusy(false);
        setStatus('');
        showPreviewPane(parsed);
      } catch (err) {
        setBusy(false);
        setStatus(err?.message || 'Import is not valid');
        showToast(err?.message || 'Import is not valid', 'error');
      }
    });

    btnImport?.addEventListener('click', async () => {
      if (mode === 'categories') {
        const selected = [...(listHost?.querySelectorAll('[data-pim-io-select]:checked') || [])]
          .map((checkbox) => categoryRows[Number(checkbox.value)]).filter(Boolean);
        if (!selected.length) return;
        setBusy(true);
        try {
          const onProgress = (done, total) => {
            if (btnImport) btnImport.textContent = `Importing… (${done}/${total})`;
          };
          const { ok, failed } = await applyCategoryChanges(selected, liveExisting, onProgress);
          if (ok.length) onApplied?.(ok);
          if (failed.length) {
            showToast(`Imported ${ok.length} of ${selected.length} category changes`, 'error');
            showJsonPane();
            setStatus(failed.map((entry) => `${entry.path}: ${entry.message}`).join('\n'));
          } else {
            showToast(`Imported ${ok.length} category changes`);
            dismiss(true);
          }
        } catch (err) {
          showJsonPane();
          setStatus(err?.message || 'Import failed');
        } finally {
          setBusy(false);
        }
        return;
      }
      if (!pendingImport.length) return;
      if (btnImport instanceof HTMLButtonElement) {
        btnImport.disabled = true;
        btnImport.textContent = 'Importing…';
      }
      try {
        const { ok, failed } = await applyImportedProducts(pendingImport, (n, total) => {
          if (btnImport instanceof HTMLButtonElement) {
            btnImport.textContent = `Importing… (${n}/${total})`;
          }
        });
        if (failed.length) {
          showToast(
            `Imported ${ok.length} of ${pendingImport.length} — ${failed.length} failed.`,
            'error',
          );
          setStatus(failed.map((f) => `${f.path}: ${f.message}`).join('\n'));
          showJsonPane();
        } else {
          const nNew = ok.filter((x) => x.action === 'create').length;
          const nUp = ok.filter((x) => x.action === 'update').length;
          const bits = [];
          if (nNew) bits.push(nNew === 1 ? 'created 1' : `created ${nNew}`);
          if (nUp) bits.push(nUp === 1 ? 'updated 1' : `updated ${nUp}`);
          showToast(bits.join(', ') || 'Imported');
          if (typeof onApplied === 'function') {
            onApplied(pendingImport.map((item) => item.body));
          }
          dismiss(true);
        }
      } catch (err) {
        setStatus(err?.message || 'Import failed');
        showToast(err?.message || 'Import failed', 'error');
        showJsonPane();
      } finally {
        if (btnImport instanceof HTMLButtonElement && dialog.isConnected) {
          btnImport.disabled = false;
        }
      }
    });

    dialog.showModal();

    if (typeof loadJson === 'function') {
      const showLoadProgress = ({
        phase, found = 0, done = 0, total = 0,
      }) => {
        if (!dialog.isConnected) return;
        if (loadProgress instanceof HTMLElement) {
          loadProgress.hidden = false;
        }
        if (loadLabel) {
          loadLabel.textContent = phase === 'listing'
            ? `Scanning catalog… ${found} listed` : `Loading products… ${done} of ${total}`;
        }
        if (loadBar instanceof HTMLProgressElement) {
          if (phase === 'products' && total) {
            loadBar.max = total;
            loadBar.value = done;
          } else {
            loadBar.removeAttribute('value');
          }
        }
      };
      setBusy(true);
      showLoadProgress({ phase: 'listing' });
      loadJson(showLoadProgress).then((text) => {
        if (!dialog.isConnected) return;
        jsonText = text;
        categoriesText = catalogCategoriesTsv([...liveExisting.values()]);
        const collisions = categoryExportCollisions([...liveExisting.values()]);
        if (collisions.size) {
          const message = `Different product paths share category export slugs.\n\n${
            [...collisions].map(([slug, paths]) => `${slug}:\n${paths.join('\n')}`).join('\n\n')
          }\n\nAll products are exported using full paths to avoid ambiguity.`;
          // eslint-disable-next-line no-alert -- acknowledge export collisions before continuing
          window.alert(message);
        }
        if (textarea) textarea.value = mode === 'json' ? jsonText : categoriesText;
        if (loadProgress instanceof HTMLElement) loadProgress.hidden = true;
        setBusy(false);
        setStatus('');
      }).catch((err) => {
        if (!dialog.isConnected) return;
        if (loadProgress instanceof HTMLElement) loadProgress.hidden = true;
        setBusy(false);
        setStatus(err?.message || 'Failed to load catalog');
      });
    }
  });
}

/**
 * Export / import the currently selected product (edit mode).
 * @param {object} opts
 * @param {object} opts.product
 * @param {string} [opts.fallbackPath]
 * @param {(product: object) => void} [opts.onApplied]
 */
export async function startProductExportImport({ product, fallbackPath, onApplied }) {
  const path = normalizeProductPath(product?.path || fallbackPath);
  if (!path) throw new Error('Product is missing a catalog path.');
  let body = sanitizeCatalogProduct(product) || { path };
  try {
    const fetched = await fetchCatalogProduct(path);
    if (fetched) body = fetched;
  } catch {
    /* keep the displayed product when ProductBus GET fails */
  }
  if (!body.path) body.path = path;
  const existingByPath = new Map();
  existingByPath.set(path, body);
  const urlKey = path.split('/').filter(Boolean).pop() || 'product';
  return openCatalogExportImportDialog({
    title: 'Export / import product',
    hint: 'JSON for this product. Copy or paste, then Preview import to see changes before writing through the catalog API.',
    filename: stampFilename(`product-${urlKey}`),
    initialJson: `${JSON.stringify(body, null, 2)}\n`,
    existingByPath,
    onApplied: (imported) => {
      const match = imported.find((row) => normalizeProductPath(row.path) === path);
      if (match && typeof onApplied === 'function') onApplied(match);
    },
  });
}

/**
 * Export / import every ProductBus product in a catalog locale.
 * @param {object} opts
 * @param {string} opts.locale e.g. `us/en_us`
 * @param {(products: object[]) => void} [opts.onApplied]
 */
export async function startCatalogExportImport({ locale, onApplied }) {
  const loc = String(locale || '').replace(/^\/+|\/+$/g, '');
  const existingByPath = new Map();
  const fileSlug = loc.replace(/\//g, '-') || 'catalog';
  return openCatalogExportImportDialog({
    title: 'Export / import catalog',
    hint: `JSON array of ProductBus products in <strong>${escapeHtml(loc)}</strong>. Copy or paste, then Preview import. Unchanged paths are skipped.`,
    filename: stampFilename(`catalog-${fileSlug}`),
    initialJson: '[]\n',
    locale: loc,
    existingByPath,
    loadJson: async (onProgress) => {
      const products = await fetchCatalogProductsForLocale(loc, onProgress);
      existingByPath.clear();
      products.forEach((p) => {
        const path = normalizeProductPath(p.path);
        if (path) existingByPath.set(path, p);
      });
      return `${JSON.stringify(products, null, 2)}\n`;
    },
    onApplied,
  });
}
