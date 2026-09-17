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
export async function listCatalogSummaries() {
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
 * @returns {Promise<object[]>}
 */
export async function fetchCatalogProductsForLocale(locale) {
  const summaries = (await listCatalogSummaries())
    .filter((row) => productInLocale(row?.path, locale));
  const fetched = await mapWithConcurrency(summaries, FETCH_CONCURRENCY, async (row) => {
    try {
      return await fetchCatalogProduct(row.path);
    } catch {
      return null;
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

function downloadJson(text, filename) {
  const raw = String(text || '');
  if (!raw.trim()) throw new Error('Nothing to download — the JSON is empty.');
  const blob = new Blob([raw], { type: 'application/json' });
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
 * @param {() => Promise<string>} [opts.loadJson]
 * @param {Map<string, object>} [opts.existingByPath]
 * @param {(imported: object[]) => void} [opts.onApplied]
 */
export function openCatalogExportImportDialog({
  title,
  hint,
  filename,
  initialJson = '',
  loadJson,
  existingByPath = new Map(),
  onApplied,
}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'pim-io-dialog';
    dialog.innerHTML = `
      <div class="pim-io-dialog-inner">
        <div class="pim-io-dialog-scroll" tabindex="-1">
          <div data-pim-io-pane="json">
            <h2 class="pim-io-title">${escapeHtml(title)}</h2>
            <p class="pim-io-hint">${hint}</p>
            <label class="pim-sr-only" for="pim-io-json">Product JSON</label>
            <textarea id="pim-io-json" class="pim-io-textarea" spellcheck="false" rows="16">${escapeHtml(initialJson)}</textarea>
            <div class="pim-io-status" data-pim-io-status hidden></div>
          </div>
          <div data-pim-io-pane="preview" hidden>
            <h2 class="pim-io-title">Import preview</h2>
            <p class="pim-io-hint" data-pim-io-preview-lead></p>
            <div class="pim-io-preview" data-pim-io-preview-list></div>
          </div>
        </div>
        <div class="pim-io-actions">
          <button type="button" class="pim-io-btn" data-pim-io-cancel>Cancel</button>
          <button type="button" class="pim-io-btn" data-pim-io-back hidden>Back</button>
          <button type="button" class="pim-io-btn" data-pim-io-preview>Preview import</button>
          <button type="button" class="pim-io-btn pim-io-btn-primary" data-pim-io-save>Download</button>
          <button type="button" class="pim-io-btn pim-io-btn-primary" data-pim-io-import hidden>Import</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);

    const jsonPane = dialog.querySelector('[data-pim-io-pane="json"]');
    const previewPane = dialog.querySelector('[data-pim-io-pane="preview"]');
    const statusEl = dialog.querySelector('[data-pim-io-status]');
    const textarea = /** @type {HTMLTextAreaElement | null} */ (dialog.querySelector('#pim-io-json'));
    const leadEl = dialog.querySelector('[data-pim-io-preview-lead]');
    const listHost = dialog.querySelector('[data-pim-io-preview-list]');
    const btnCancel = dialog.querySelector('[data-pim-io-cancel]');
    const btnBack = dialog.querySelector('[data-pim-io-back]');
    const btnPreview = dialog.querySelector('[data-pim-io-preview]');
    const btnSave = dialog.querySelector('[data-pim-io-save]');
    const btnImport = dialog.querySelector('[data-pim-io-import]');

    /** @type {{ body: object, existed: boolean }[]} */
    let pendingImport = [];
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
      if (busy && label) setStatus(label, 'ok');
    };

    const showJsonPane = () => {
      if (jsonPane instanceof HTMLElement) jsonPane.hidden = false;
      if (previewPane instanceof HTMLElement) previewPane.hidden = true;
      btnBack?.setAttribute('hidden', '');
      btnPreview?.removeAttribute('hidden');
      btnSave?.removeAttribute('hidden');
      btnImport?.setAttribute('hidden', '');
      pendingImport = [];
    };

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
      showJsonPane();
      setStatus('');
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dismiss(false);
    });
    wireDialogEscapeDismiss(dialog, () => dismiss(false));

    btnSave?.addEventListener('click', () => {
      try {
        const downloaded = downloadJson(textarea?.value ?? '', filename);
        showToast(`Downloaded ${downloaded}`);
      } catch (err) {
        setStatus(err?.message || 'Could not download JSON');
        showToast(err?.message || 'Could not download JSON', 'error');
      }
    });

    btnPreview?.addEventListener('click', async () => {
      try {
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
      setBusy(true, 'Loading catalog…');
      loadJson().then((text) => {
        if (textarea) textarea.value = text;
        setBusy(false);
        setStatus('');
      }).catch((err) => {
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
    existingByPath,
    loadJson: async () => {
      const products = await fetchCatalogProductsForLocale(loc);
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
