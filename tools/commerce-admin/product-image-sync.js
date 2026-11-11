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

function colorSlugFromValue(value) {
  return typeof value === 'string'
    ? value
      .toLowerCase()
      .replace(/[^0-9a-z]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    : '';
}

export function colorLabel(slug) {
  return slug.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
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
  if (/^https?:\/\//i.test(clean)) return { colorSlug: '', filePath: clean };
  const slash = clean.indexOf('/');
  if (slash === -1) return { colorSlug: '', filePath: clean };
  return {
    colorSlug: colorSlugFromValue(clean.slice(0, slash)),
    filePath: clean,
  };
}

function rowMarket(row) {
  return rowField(row, 'Market', 'market').toUpperCase();
}

/** Rows with no Market are global; otherwise the market must appear in the row's market list. */
function marketAllowed(row, market) {
  const rowMkt = rowMarket(row);
  if (!rowMkt) return true;
  if (!market) return true;
  return rowMkt.split(/[,\s;]+/).includes(market.toUpperCase());
}

/** Derives the storefront market (e.g. `US`/`CA`) from a catalog path like `/ca/en_us/...`. */
function marketFromCatalogPath(path) {
  const seg = String(path || '').replace(/^\/+/, '').split('/')[0] || '';
  return seg.toUpperCase();
}

function absoluteAssetUrl(urlKey, rel) {
  const tail = String(rel || '').replace(/^\/+/, '').trim();
  if (!tail) return '';
  if (/^https?:\/\//i.test(tail)) return tail;
  return `${ASSETS_ORIGIN}/assets/products/${encodeURIComponent(urlKey)}/${tail.split('/').map(encodeURIComponent).join('/')}`;
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
 * @param {string} [market] current market (e.g. `US`/`CA`); rows for other markets are skipped
 */
export function planImageSync(product, rows, urlKey, market) {
  const byColor = new Map();
  let metaImage;
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!marketAllowed(row, market)) return;
    const parsed = mediaFromRow(row, urlKey);
    if (!parsed) return;
    if (!metaImage && rowField(row, 'og-image').toLowerCase() === 'true') {
      metaImage = parsed.media.url;
    }
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
  if (metaImage) nextProduct.metaImage = metaImage;
  nextProduct.images = productImages;
  nextProduct.variants = variants.map((variant, i) => ({
    ...JSON.parse(JSON.stringify(variant)),
    images: variantPlans[i].images,
  }));

  const imageCount = productImages.length
    + variantPlans.reduce((n, g) => n + g.images.length, 0);

  return {
    nextProduct,
    metaImage,
    productImages,
    variantPlans,
    unmatched,
    imageCount,
  };
}

export async function fetchImageSheet(urlKey) {
  const sheetUrl = new URL(
    `/assets/products/${encodeURIComponent(urlKey)}/images.json`,
    ASSETS_ORIGIN,
  );
  sheetUrl.searchParams.set('_cacheBust', String(Date.now()));
  const resp = await fetch(fcorsUrl(sheetUrl.toString()), { cache: 'no-store' });
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
  const sheet = [json, json?.data, ...Object.values(json || {})]
    .find((candidate) => Array.isArray(candidate?.data));
  if (!sheet) throw new Error('images.json must contain an image data array.');
  if (Number(sheet.total) > sheet.data.length) {
    throw new Error('images.json is incomplete; publish the complete image manifest first.');
  }
  return sheet.data;
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

export function mediaCardHtml(item, resolvePreviewUrl, metaImage) {
  const m = asMedia(item);
  const src = previewUrl(m, resolvePreviewUrl);
  const video = videoOf(m);
  const label = m?.label || '';
  const isMetaImage = Boolean(metaImage && m?.url === metaImage);
  const img = src
    ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" class="pim-sync-card-img" />`
    : '<span class="pim-sync-card-missing">No preview</span>';
  const videoBadge = video ? '<span class="pim-sync-card-video">Video</span>' : '';
  const metaBadge = isMetaImage
    ? '<span class="pim-sync-card-meta" title="Selected by og-image">Meta image</span>'
    : '';
  const labelHtml = label ? `<span class="pim-sync-card-label">${escapeHtml(label)}</span>` : '';
  return `<figure class="pim-sync-card${isMetaImage ? ' pim-sync-card-selected' : ''}">
    <div class="pim-sync-card-media">${img}${videoBadge}</div>
    ${metaBadge || labelHtml ? `<figcaption class="pim-sync-card-cap">${metaBadge}${labelHtml}</figcaption>` : ''}
  </figure>`;
}

function groupHtml(title, sku, images, resolvePreviewUrl, extra = '', metaImage = '') {
  const cards = (images || []).map((m) => mediaCardHtml(m, resolvePreviewUrl, metaImage)).join('');
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

function addVariant(product, group, { color, sku, gtin }) {
  if (product.bundleItems?.length || product.type === 'bundle' || product.custom?.type === 'bundle') {
    throw new Error('Colors cannot be added to bundles through image sync.');
  }
  const options = product.options || [];
  const variants = product.variants || [];
  if (!Array.isArray(options) || !Array.isArray(variants)
    || options.some((option) => !['color', 'colour'].includes(String(option.id || option.label || '').toLowerCase()))
    || variants.some((variant) => optionEntries(variant.options)
      .some((option) => !['color', 'colour'].includes(option.id)))) {
    throw new Error('Colors cannot be added to products with other variant options through image sync.');
  }
  const slug = colorSlugFromValue(color);
  if (!color || !colorSlugMatchesFolder(slug, group.colorSlug)) {
    throw new Error(`The color name must match the ${group.colorSlug} folder.`);
  }
  if (!sku || !gtin) throw new Error(`Enter a SKU and GTIN for ${color}.`);
  if (!/^(?:\d{8}|\d{12,14})$/.test(gtin)) {
    throw new Error(`Enter an 8, 12, 13, or 14 digit GTIN for ${color}.`);
  }
  if ([product.sku, ...variants.map((variant) => variant.sku)]
    .some((existing) => String(existing || '').trim().toLowerCase() === sku.toLowerCase())) {
    throw new Error(`SKU ${sku} is already used by this product.`);
  }
  if (variants.some((variant) => variantColorSlug(variant) === slug)) {
    throw new Error(`A variant for ${color} already exists.`);
  }
  if (!product.name || !product.url) {
    throw new Error('The product needs a name and canonical URL before a color can be added.');
  }
  const colorOptions = options.filter((option) => (
    ['color', 'colour'].includes(String(option.id || option.label || '').toLowerCase())
  ));
  if (colorOptions.length > 1 || (colorOptions[0] && !Array.isArray(colorOptions[0].values))) {
    throw new Error('The product has an invalid or ambiguous color option.');
  }
  let colorOption = colorOptions[0];
  if (!colorOption) {
    const values = variants.map((variant) => {
      const colorEntry = optionEntries(variant.options)
        .find((entry) => entry.id === 'color' || entry.id === 'colour');
      if (!colorEntry?.value) {
        throw new Error('Existing variants need color options before a new color can be added.');
      }
      return { id: colorSlugFromValue(colorEntry.value), value: colorEntry.value };
    });
    if (new Set(values.map((value) => value.id)).size !== values.length) {
      throw new Error('Existing variants have duplicate colors; cannot create a color option.');
    }
    colorOption = { id: 'color', label: 'Color', values };
    options.push(colorOption);
    product.options = options;
  }
  const existingValue = colorOption.values.find((value) => (
    colorSlugFromValue(value.value) === slug || colorSlugFromValue(value.id) === slug
  ));
  if (existingValue && existingValue.value !== color) {
    throw new Error(`Use the existing color name "${existingValue.value}" for ${color}.`);
  }
  if (!existingValue) colorOption.values.push({ id: slug, value: color });
  const url = new URL(product.url);
  url.searchParams.set('color', slug);
  const template = variants[0];
  const variant = {
    sku,
    gtin,
    name: `${product.name} ${color}`,
    url: url.toString(),
    images: group.images,
    options: [{ id: colorOption.id || 'color', value: color }],
    availability: 'OutOfStock',
  };
  ['price', 'description', 'custom', 'itemCondition', 'weight', 'shippingDimensions']
    .forEach((key) => {
      const value = template?.[key] ?? product[key];
      if (value != null) variant[key] = JSON.parse(JSON.stringify(value));
    });
  if (template?.jsonldExtensions != null) {
    variant.jsonldExtensions = JSON.parse(JSON.stringify(template.jsonldExtensions));
  }
  if (variant.custom) delete variant.custom.inventoryQuantity;
  variants.push(variant);
  product.variants = variants;
  if (!product.type || product.type === 'simple') product.type = 'configurable';
}

function openPlanDialog(plan, resolvePreviewUrl, onConfirm) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'pim-sync-dialog';
    const unmatchedHtml = plan.unmatched.length
      ? plan.unmatched.map((g, index) => {
        const cards = g.images.map((m) => mediaCardHtml(m, resolvePreviewUrl, plan.metaImage)).join('');
        return `<section class="pim-sync-group pim-sync-group-warn">
          <h3 class="pim-sync-group-title">Unmatched folder · ${escapeHtml(g.colorSlug)}</h3>
          <p class="pim-sync-group-empty">No variant color option matches this folder. These files will not be written unless a color is added.</p>
          <label class="pim-sync-add-toggle"><input type="checkbox" data-sync-add="${index}"> Add color variant</label>
          <div class="pim-sync-add-fields" data-sync-fields="${index}" hidden>
            <label>Color name <input type="text" data-sync-color value="${escapeHtml(colorLabel(g.colorSlug))}" autocomplete="off"></label>
            <label>SKU <input type="text" data-sync-sku autocomplete="off"></label>
            <label>GTIN <input type="text" data-sync-gtin inputmode="numeric" autocomplete="off"></label>
            <p class="pim-sync-group-empty">Verify the color name. The new variant starts out of stock and copies settings from the first existing variant, or the product if none exists.</p>
            ${plan.nextProduct.type === 'simple' ? '<p class="pim-sync-group-empty">Adding a color converts this simple product to a configurable product; its current SKU will remain the parent SKU, not a variant.</p>' : ''}
          </div>
          <div class="pim-sync-cards">${cards}</div>
        </section>`;
      }).join('')
      : '';

    const summary = (count) => `${count} image${count === 1 ? '' : 's'} will be written`;

    dialog.innerHTML = `
      <div class="pim-sync-dialog-head">
        <h2 class="pim-sync-dialog-title">Sync images</h2>
        <p class="pim-sync-dialog-lead">Galleries from DAM <code>images.json</code>. Confirm replaces product and variant images through the catalog API.</p>
        <p class="pim-sync-dialog-summary">${escapeHtml(summary(plan.imageCount))}</p>
      </div>
      <div class="pim-sync-dialog-body">
        ${groupHtml('Product', '', plan.productImages, resolvePreviewUrl, '', plan.metaImage)}
        ${plan.variantPlans.map((g) => groupHtml(
    g.label,
    g.sku,
    g.images,
    resolvePreviewUrl,
    g.unmatched
      ? '<p class="pim-sync-group-empty">No matching color folder in images.json. This variant will have no images.</p>'
      : '',
    plan.metaImage,
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
    const summaryEl = dialog.querySelector('.pim-sync-dialog-summary');
    let saving = false;

    const finish = (ok) => {
      if (saving) return;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(ok);
    };

    cancelBtn.addEventListener('click', () => finish(false));
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) finish(false);
    });
    wireDialogEscapeDismiss(dialog, () => finish(false));

    dialog.querySelectorAll('[data-sync-add]').forEach((toggle) => {
      toggle.addEventListener('change', () => {
        const index = Number(toggle.dataset.syncAdd);
        dialog.querySelector(`[data-sync-fields="${index}"]`).hidden = !toggle.checked;
        const count = plan.imageCount + [...dialog.querySelectorAll('[data-sync-add]:checked')]
          .reduce((sum, selected) => (
            sum + plan.unmatched[Number(selected.dataset.syncAdd)].images.length
          ), 0);
        summaryEl.textContent = summary(count);
      });
    });

    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      errEl.hidden = true;
      try {
        const nextProduct = JSON.parse(JSON.stringify(plan.nextProduct));
        dialog.querySelectorAll('[data-sync-add]:checked').forEach((toggle) => {
          const index = Number(toggle.dataset.syncAdd);
          const fields = dialog.querySelector(`[data-sync-fields="${index}"]`);
          addVariant(nextProduct, plan.unmatched[index], {
            color: fields.querySelector('[data-sync-color]').value.trim(),
            sku: fields.querySelector('[data-sync-sku]').value.trim(),
            gtin: fields.querySelector('[data-sync-gtin]').value.trim(),
          });
        });
        saving = true;
        dialog.querySelectorAll('[data-sync-add], [data-sync-fields] input')
          .forEach((input) => { input.disabled = true; });
        await onConfirm(nextProduct);
        saving = false;
        finish(true);
      } catch (err) {
        saving = false;
        errEl.textContent = err.message || 'Failed to write product';
        errEl.hidden = false;
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        dialog.querySelectorAll('[data-sync-add], [data-sync-fields] input')
          .forEach((input) => { input.disabled = false; });
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
    fetchCatalogProduct(catalogPath),
  ]);
  if (!catalogProduct) throw new Error('Catalog product not found; cannot sync images.');
  const base = catalogProduct;
  delete base.internal;
  if (!base.path && catalogPath) base.path = catalogPath.startsWith('/') ? catalogPath : `/${catalogPath}`;
  if (!base.path) {
    throw new Error('Product is missing a catalog path; cannot write via the commerce API.');
  }
  const market = marketFromCatalogPath(base.path);
  const plan = planImageSync(base, rows, urlKey, market);
  const saved = await openPlanDialog(plan, previewSrc, async (nextProduct) => {
    await putOrPatchResource(catalogApiPath(nextProduct.path), nextProduct);
    showToast('Images synced');
    if (typeof onApplied === 'function') onApplied(nextProduct);
  });
  return saved;
}
