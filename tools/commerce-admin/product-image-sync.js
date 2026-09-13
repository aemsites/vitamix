/**
 * Sync product + variant images from DAM `images.json` into ProductBus via the
 * commerce catalog API. Folder prefixes in Path (e.g. `black/image1.jpg`) map
 * to the variant color option. Preview shows the galleries that will be written.
 */
import { apiFetch } from './commerce-otp-api.js';
import { putOrPatchResource } from './commerce-resource-save.js';
import { PB_ORG, PB_SITE } from './commerce-pbus-config.js';
import { catalogApiPath } from './commerce-catalog-io.js';
import { escapeHtml, showToast } from './commerce-otp-ui.js';
import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';

const ASSETS_ORIGIN = 'https://main--vitamix--aemsites.aem.live';
const CORS_PROXY = 'https://fcors.org/?url=';
const CORS_KEY = '&key=Mg23N96GgR8O3NjU';
const IMAGE_FILENAME_OK = /^[A-Za-z0-9_-]+$/;

function colorSlugFromValue(value) {
  return typeof value === 'string'
    ? value
      .toLowerCase()
      .replace(/[^0-9a-z]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    : '';
}

async function readRespError(resp) {
  return resp.headers.get('x-error')
    || (await resp.text().catch(() => '')).trim()
    || `HTTP ${resp.status}`;
}

function fcorsUrl(url) {
  return `${CORS_PROXY}${encodeURIComponent(url)}${CORS_KEY}`;
}

function optionEntries(options) {
  if (Array.isArray(options)) {
    return options.map((o) => ({
      id: String(o?.id || o?.label || '').toLowerCase(),
      value: String(o?.value ?? o?.id ?? ''),
    }));
  }
  if (options && typeof options === 'object') {
    return Object.entries(options).map(([id, value]) => ({
      id: String(id).toLowerCase(),
      value: String(value ?? ''),
    }));
  }
  return [];
}

function variantColorSlug(variant) {
  const entries = optionEntries(variant?.options);
  const color = entries.find((e) => e.id === 'color' || e.id === 'colour');
  return colorSlugFromValue(color?.value || '');
}

function colorSlugMatchesFolder(colorSlug, folderSlug) {
  if (!colorSlug || !folderSlug) return false;
  if (colorSlug === folderSlug) return true;
  // DAM folders are often the last color word: `black/` for "Shadow Black"
  return colorSlug.endsWith(`-${folderSlug}`);
}

function variantMatchesColor(variant, folderSlug) {
  if (!folderSlug) return false;
  const entries = optionEntries(variant?.options);
  const slugs = [
    variantColorSlug(variant),
    ...entries.map((e) => colorSlugFromValue(e.value)),
  ].filter(Boolean);
  return slugs.some((slug) => colorSlugMatchesFolder(slug, folderSlug));
}

function rowField(row, ...keys) {
  for (let i = 0; i < keys.length; i += 1) {
    const v = row?.[keys[i]];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function splitSheetPath(rel) {
  const clean = String(rel || '').replace(/^\/+/, '').trim();
  const slash = clean.indexOf('/');
  if (slash === -1) return { colorSlug: '', filePath: clean };
  return {
    colorSlug: colorSlugFromValue(clean.slice(0, slash)),
    filePath: clean,
  };
}

function absoluteAssetUrl(urlKey, rel) {
  const tail = String(rel || '').replace(/^\/+/, '').trim();
  if (!tail) return '';
  if (/^https?:\/\//i.test(tail)) return tail;
  return `${ASSETS_ORIGIN}/assets/products/${encodeURIComponent(urlKey)}/${tail.split('/').map(encodeURIComponent).join('/')}`;
}

function filenameFromRel(rel) {
  const base = String(rel || '').split('/').pop() || '';
  const noExt = base.replace(/\.[^.]+$/, '');
  const safe = noExt.replace(/[^A-Za-z0-9_-]/g, '');
  return IMAGE_FILENAME_OK.test(safe) ? safe : '';
}

function mediaFromRow(row, urlKey) {
  const rel = rowField(row, 'Path', 'path');
  if (!rel) return null;
  const { colorSlug, filePath } = splitSheetPath(rel);
  const url = absoluteAssetUrl(urlKey, filePath);
  if (!url) return null;
  const media = { url };
  const label = rowField(row, 'Label', 'label');
  if (label) media.label = label;
  const videoRaw = rowField(row, 'Video', 'video');
  if (videoRaw) media.video = absoluteAssetUrl(urlKey, videoRaw) || videoRaw;
  const filename = filenameFromRel(filePath);
  if (filename) media.filename = filename;
  return { media, colorSlug };
}

function asMedia(item) {
  if (!item) return null;
  if (typeof item === 'string') return { url: item };
  return item;
}

function videoOf(item) {
  const m = asMedia(item);
  return String(m?.video || '').trim();
}

function groupLabel(colorSlug, variant) {
  if (!colorSlug) return 'Product';
  const color = optionEntries(variant?.options).find((e) => e.id === 'color' || e.id === 'colour');
  const pretty = color?.value || variant?.name || variant?.sku || colorSlug;
  return `Variant · ${pretty}`;
}

function mediaList(entries) {
  return (entries || []).map((e) => e.media);
}

/**
 * @param {object} product ProductBus entry
 * @param {object[]} rows images.json `data`
 * @param {string} urlKey
 */
export function planImageSync(product, rows, urlKey) {
  const byColor = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const parsed = mediaFromRow(row, urlKey);
    if (!parsed) return;
    const list = byColor.get(parsed.colorSlug) || [];
    list.push(parsed);
    byColor.set(parsed.colorSlug, list);
  });

  const variants = Array.isArray(product.variants) ? product.variants : [];
  const usedFolders = new Set();
  const variantPlans = variants.map((variant, index) => {
    const preferred = variantColorSlug(variant);
    let folder = '';
    if (preferred && byColor.has(preferred) && !usedFolders.has(preferred)) {
      folder = preferred;
    } else {
      folder = [...byColor.keys()].find((slug) => slug && !usedFolders.has(slug) && variantMatchesColor(variant, slug)) || '';
    }
    if (folder) usedFolders.add(folder);
    const images = folder ? mediaList(byColor.get(folder)) : [];
    return {
      index,
      colorSlug: folder || preferred,
      label: groupLabel(folder || preferred, variant),
      sku: variant.sku || '',
      unmatched: !folder,
      images,
    };
  });

  const productImages = mediaList(byColor.get(''));
  const unmatchedFolders = [...byColor.keys()].filter((slug) => slug && !usedFolders.has(slug));
  const unmatched = unmatchedFolders.map((slug) => ({
    colorSlug: slug,
    images: mediaList(byColor.get(slug)),
  }));

  const nextProduct = JSON.parse(JSON.stringify(product));
  delete nextProduct.internal;
  nextProduct.images = productImages;
  nextProduct.variants = variants.map((variant, i) => ({
    ...JSON.parse(JSON.stringify(variant)),
    images: variantPlans[i].images,
  }));

  const imageCount = productImages.length
    + variantPlans.reduce((n, g) => n + g.images.length, 0);

  return {
    nextProduct,
    productImages,
    variantPlans,
    unmatched,
    imageCount,
  };
}

async function fetchImageSheet(urlKey) {
  const sheetUrl = `${ASSETS_ORIGIN}/assets/products/${encodeURIComponent(urlKey)}/images.json`;
  const resp = await fetch(fcorsUrl(sheetUrl));
  if (resp.status === 404) {
    throw new Error(`No images.json at /assets/products/${urlKey}/`);
  }
  if (!resp.ok) throw new Error(`images.json: HTTP ${resp.status}`);
  const text = await resp.text();
  const trimmed = text.trim();
  if (trimmed.startsWith('<') || trimmed.startsWith('Sign in')) {
    throw new Error(`images.json is not available for ${urlKey}`);
  }
  let json;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new Error('images.json was not valid JSON');
  }
  return Array.isArray(json.data) ? json.data : [];
}

async function fetchCatalogProduct(productPath) {
  if (!productPath) return null;
  const resp = await apiFetch(PB_ORG, PB_SITE, catalogApiPath(productPath), { method: 'GET' });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(await readRespError(resp));
  const data = await resp.json();
  if (data && typeof data === 'object') delete data.internal;
  return data;
}

function previewUrl(item, resolvePreviewUrl) {
  const m = asMedia(item);
  if (!m) return '';
  if (typeof resolvePreviewUrl === 'function') return resolvePreviewUrl(m) || m.url || '';
  return m.url || '';
}

function mediaCardHtml(item, resolvePreviewUrl) {
  const m = asMedia(item);
  const src = previewUrl(m, resolvePreviewUrl);
  const video = videoOf(m);
  const label = m?.label || '';
  const img = src
    ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" class="pim-sync-card-img" />`
    : '<span class="pim-sync-card-missing">No preview</span>';
  const videoBadge = video ? '<span class="pim-sync-card-video">Video</span>' : '';
  return `<figure class="pim-sync-card">
    <div class="pim-sync-card-media">${img}${videoBadge}</div>
    ${label ? `<figcaption class="pim-sync-card-cap"><span class="pim-sync-card-label">${escapeHtml(label)}</span></figcaption>` : ''}
  </figure>`;
}

function groupHtml(title, sku, images, resolvePreviewUrl, extra = '') {
  const cards = (images || []).map((m) => mediaCardHtml(m, resolvePreviewUrl)).join('');
  const empty = cards || extra
    ? ''
    : '<p class="pim-sync-group-empty">No images in this group.</p>';
  const skuLine = sku ? `<span class="pim-sync-group-sku">${escapeHtml(sku)}</span>` : '';
  return `<section class="pim-sync-group">
    <h3 class="pim-sync-group-title">${escapeHtml(title)} ${skuLine}</h3>
    ${extra}
    ${empty}
    ${cards ? `<div class="pim-sync-cards">${cards}</div>` : ''}
  </section>`;
}

function openPlanDialog(plan, resolvePreviewUrl, onConfirm) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'pim-sync-dialog';
    const unmatchedHtml = plan.unmatched.length
      ? plan.unmatched.map((g) => {
        const cards = g.images.map((m) => mediaCardHtml(m, resolvePreviewUrl)).join('');
        return `<section class="pim-sync-group pim-sync-group-warn">
          <h3 class="pim-sync-group-title">Unmatched folder · ${escapeHtml(g.colorSlug)}</h3>
          <p class="pim-sync-group-empty">No variant color option matches this folder. These files will not be written.</p>
          <div class="pim-sync-cards">${cards}</div>
        </section>`;
      }).join('')
      : '';

    const summary = `${plan.imageCount} image${plan.imageCount === 1 ? '' : 's'} will be written`;

    dialog.innerHTML = `
      <div class="pim-sync-dialog-head">
        <h2 class="pim-sync-dialog-title">Sync images</h2>
        <p class="pim-sync-dialog-lead">Galleries from DAM <code>images.json</code>. Confirm replaces product and variant images through the catalog API.</p>
        <p class="pim-sync-dialog-summary">${escapeHtml(summary)}</p>
      </div>
      <div class="pim-sync-dialog-body">
        ${groupHtml('Product', '', plan.productImages, resolvePreviewUrl)}
        ${plan.variantPlans.map((g) => groupHtml(
    g.label,
    g.sku,
    g.images,
    resolvePreviewUrl,
    g.unmatched
      ? '<p class="pim-sync-group-empty">No matching color folder in images.json. This variant will have no images.</p>'
      : '',
  )).join('')}
        ${unmatchedHtml}
      </div>
      <p class="pim-sync-dialog-error" hidden></p>
      <div class="pim-sync-dialog-footer">
        <button type="button" class="pim-btn-cancel" data-pim-sync-cancel>Cancel</button>
        <button type="button" class="pim-btn-save" data-pim-sync-confirm>Confirm sync</button>
      </div>`;

    const errEl = dialog.querySelector('.pim-sync-dialog-error');
    const cancelBtn = dialog.querySelector('[data-pim-sync-cancel]');
    const confirmBtn = dialog.querySelector('[data-pim-sync-confirm]');

    const finish = (ok) => {
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(ok);
    };

    cancelBtn.addEventListener('click', () => finish(false));
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) finish(false);
    });
    wireDialogEscapeDismiss(dialog, () => finish(false));

    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      errEl.hidden = true;
      try {
        await onConfirm(plan.nextProduct);
        finish(true);
      } catch (err) {
        errEl.textContent = err.message || 'Failed to write product';
        errEl.hidden = false;
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });

    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

/**
 * Fetch DAM sheet, preview the galleries to write, PUT catalog product on confirm.
 * @param {object} opts
 * @param {object} opts.product currently displayed product
 * @param {string} opts.urlKey
 * @param {(media: object) => string} [opts.previewSrc]
 * @param {(product: object) => void} [opts.onApplied]
 */
export async function startProductImageSync({
  product, urlKey, previewSrc, onApplied,
}) {
  if (!product || !urlKey) throw new Error('Missing product');
  const catalogPath = product.path || '';
  const [rows, catalogProduct] = await Promise.all([
    fetchImageSheet(urlKey),
    fetchCatalogProduct(catalogPath).catch(() => null),
  ]);
  const base = catalogProduct || JSON.parse(JSON.stringify(product));
  delete base.internal;
  if (!base.path && catalogPath) base.path = catalogPath.startsWith('/') ? catalogPath : `/${catalogPath}`;
  if (!base.path) {
    throw new Error('Product is missing a catalog path; cannot write via the commerce API.');
  }
  const plan = planImageSync(base, rows, urlKey);
  const saved = await openPlanDialog(plan, previewSrc, async (nextProduct) => {
    await putOrPatchResource(catalogApiPath(nextProduct.path), nextProduct);
    showToast('Images synced');
    if (typeof onApplied === 'function') onApplied(nextProduct);
  });
  return saved;
}
