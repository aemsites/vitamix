/* eslint-disable no-await-in-loop */

export const ADMIN_URL = 'https://admin.da.live';
export const AEM_ADMIN_URL = 'https://admin.hlx.page';
const AEM_REF = 'main';
const PUBLISH_CONCURRENCY = 4;
export const PRODUCTS_PATH = '/assets/products';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function toSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^0-9a-z]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Locates the sheet holding the image rows in DA single-sheet or multi-sheet JSON. */
function findSheet(json) {
  if (Array.isArray(json?.data)) return json;
  if (Array.isArray(json?.data?.data)) return json.data;
  const first = json?.[':names']?.[0];
  return Array.isArray(json?.[first]?.data) ? json[first] : null;
}

function sheetRows(json) {
  return findSheet(json)?.data || [];
}

export const MARKETS = ['us', 'ca', 'mx', 'vr'];

export function setRowField(row, key, value) {
  const existing = Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase());
  row[existing || key] = value;
}

export function rowField(row, key) {
  return String(row?.[key] ?? row?.[key.toLowerCase()] ?? '').trim();
}

export function rowPath(row) {
  return rowField(row, 'Path').replace(/^\/+/, '');
}

export function isAbsolute(path) {
  return /^https?:\/\//i.test(path);
}

/** Variant color is the folder prefix of `Path`, e.g. `white/a3500-front.png`. */
export function rowColor(row) {
  const path = rowPath(row);
  const slash = path.indexOf('/');
  if (slash <= 0 || isAbsolute(path)) return '';
  return toSlug(path.slice(0, slash));
}

export function rowMarkets(row) {
  return rowField(row, 'Market')
    .split(',')
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
}

/** Groups image rows by variant color, keeping first-seen order; shared images use key `''`. */
export function groupByColor(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const color = rowColor(row);
    if (!groups.has(color)) groups.set(color, []);
    groups.get(color).push(row);
  });
  return groups;
}

export function colorLabel(color) {
  return color.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function buildSwatch(color, title) {
  const swatch = el('span', 'color-swatch pa-swatch');
  swatch.style.setProperty('--swatch', `var(--color-${color})`);
  swatch.title = title || colorLabel(color);
  swatch.setAttribute('aria-label', swatch.title);
  return swatch;
}

export function buildMarkets(markets) {
  const wrap = el('span', 'pa-markets');
  markets.forEach((market) => {
    const badge = el('span', `pa-market pa-market-${market}`);
    badge.title = market.toUpperCase();
    if (MARKETS.includes(market)) {
      const img = el('img');
      img.src = `/icons/flag-${market}.svg`;
      img.alt = market.toUpperCase();
      img.addEventListener('error', () => { badge.textContent = market.toUpperCase(); }, { once: true });
      badge.append(img);
    } else {
      badge.textContent = market.toUpperCase();
    }
    wrap.append(badge);
  });
  return wrap;
}

/** Catalog locales, in the same order as the commerce-admin catalog picker. */
export const LOCALES = [
  { path: 'us/en_us', market: 'us', label: 'US' },
  { path: 'ca/en_us', market: 'ca', label: 'Canada EN' },
  { path: 'ca/fr_ca', market: 'ca', label: 'Canada FR' },
  { path: 'mx/en_us', market: 'mx', label: 'Mexico EN' },
  { path: 'mx/es_mx', market: 'mx', label: 'Mexico ES' },
  { path: 'vr/en_us', market: 'vr', label: 'Rest of World EN' },
];

const PRODUCT_ADMIN = 'https://product-admin--vitamix--aemsites.aem.live/tools/commerce-admin/product-detail.html';
// The product index is only served by the overlay host, which sends no CORS headers,
// so it's read through the same proxy as tools/commerce-admin/pim.js.
const INDEX_BASE = 'https://main--vitamix--aemsites.aem.network';
const CORS_PROXY = 'https://fcors.org/?url=';
const CORS_KEY = '&key=Mg23N96GgR8O3NjU';
const INDEX_TTL = 10 * 60 * 1000;

export function productAdminUrl(locale, slug) {
  const params = new URLSearchParams({ catalog: locale, product: slug });
  return `${PRODUCT_ADMIN}?${params}`;
}

/** Product slugs (path under `/<locale>/products/`) of parent products in a locale's index. */
async function localeProductSlugs(locale) {
  const cacheKey = `product-assets:index:${locale}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey));
    if (cached && Date.now() - cached.time < INDEX_TTL) return new Set(cached.slugs);
  } catch {
    // ignore unreadable cache
  }
  const indexUrl = `${INDEX_BASE}/${locale}/products/index.json?include=all`;
  const resp = await fetch(CORS_PROXY + encodeURIComponent(indexUrl) + CORS_KEY);
  if (!resp.ok) throw new Error(`${locale} index: ${resp.status}`);
  const json = await resp.json();
  const prefix = `/${locale}/products/`;
  const slugs = (Array.isArray(json) ? json : json.data || [])
    .filter((row) => !row.parentSku)
    .map((row) => {
      try {
        const path = new URL(row.url).pathname;
        if (path.startsWith(prefix)) return path.slice(prefix.length).replace(/\/$/, '');
      } catch {
        // fall through to urlKey
      }
      return row.urlKey;
    })
    .filter(Boolean);
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), slugs }));
  } catch {
    // storage full or unavailable
  }
  return new Set(slugs);
}

/** Locales whose product index contains `slug`; locales that fail to load are skipped. */
export async function findProductLocales(slug) {
  const results = await Promise.allSettled(LOCALES.map((l) => localeProductSlugs(l.path)));
  return LOCALES.filter((locale, i) => results[i].value?.has(slug));
}

/** Returns DA-backed helpers for the products folder from a resolved DA SDK. */
export function createClient({ context, actions }) {
  const { daFetch } = actions;
  const { org, repo } = context;
  const productsSource = `${ADMIN_URL}/source/${org}/${repo}${PRODUCTS_PATH}`;
  const imagesUrl = (slug) => `${productsSource}/${encodeURIComponent(slug)}/images.json`;

  async function listProductFolders() {
    const folders = [];
    let token;
    do {
      const opts = token ? { headers: { 'da-continuation-token': token } } : {};
      const resp = await daFetch(`${ADMIN_URL}/list/${org}/${repo}${PRODUCTS_PATH}`, opts);
      if (!resp.ok) throw new Error(`Failed to list ${PRODUCTS_PATH} (${resp.status} ${resp.statusText})`);
      const items = await resp.json();
      folders.push(...items.filter((item) => !item.ext).map((item) => item.name));
      token = resp.headers.get('da-continuation-token');
    } while (token);
    return folders.sort((a, b) => a.localeCompare(b));
  }

  /**
   * @returns {Promise<{rows?: object[], doc?: object, error?: string}>} `rows` only holds rows
   * with a Path; `doc` is the raw DA document, needed to save without losing other rows/sheets.
   */
  async function loadImagesSheet(slug) {
    try {
      const resp = await daFetch(imagesUrl(slug));
      if (resp.status === 404) return { error: 'No images.json', missing: true };
      if (!resp.ok) return { error: `images.json: ${resp.status} ${resp.statusText}` };
      const doc = await resp.json();
      return { rows: sheetRows(doc).filter((r) => rowPath(r)), doc };
    } catch (error) {
      return { error: `images.json: ${error.message}` };
    }
  }

  /**
   * Fetches the current DA document without normalizing, for conflict checks before saving.
   * @returns {Promise<object|null>} `null` when images.json doesn't exist yet
   */
  async function fetchImagesDoc(slug) {
    const resp = await daFetch(imagesUrl(slug));
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`images.json: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  /**
   * Writes `rows` into the image sheet of `doc` (other sheets/props kept) and saves to DA.
   * A `null` doc creates a new single-sheet images.json.
   */
  async function saveImagesSheet(slug, doc, rows) {
    const next = doc ? JSON.parse(JSON.stringify(doc)) : { ':type': 'sheet', ':sheetname': 'data', data: [] };
    const sheet = findSheet(next);
    if (!sheet) throw new Error('images.json has no sheet to write to');
    sheet.data = rows;
    sheet.total = rows.length;
    sheet.limit = rows.length;
    sheet.offset = 0;

    const body = new FormData();
    body.append('data', new Blob([JSON.stringify(next)], { type: 'application/json' }));
    const resp = await daFetch(imagesUrl(slug), { method: 'PUT', body });
    if (!resp.ok) throw new Error(`Save failed: ${resp.status} ${resp.statusText}`);
    return next;
  }

  /** Uploads a file to `/assets/products/<slug>/<path>` in DA. */
  async function uploadAsset(slug, path, file) {
    const body = new FormData();
    body.append('data', file);
    const url = `${productsSource}/${encodeURIComponent(slug)}/${encodePath(path)}`;
    const resp = await daFetch(url, { method: 'PUT', body });
    if (!resp.ok) throw new Error(`Upload of ${path} failed: ${resp.status} ${resp.statusText}`);
  }

  /** Deletes a file in `/assets/products/<slug>/` in DA. */
  async function deleteAsset(slug, path) {
    const url = `${productsSource}/${encodeURIComponent(slug)}/${encodePath(path)}`;
    const resp = await daFetch(url, { method: 'DELETE' });
    if (!resp.ok && resp.status !== 404) {
      throw new Error(`Delete of ${path} failed: ${resp.status} ${resp.statusText}`);
    }
  }

  /** Moves a file within `/assets/products/<slug>/` in DA. */
  async function moveAsset(slug, from, to) {
    const base = `${PRODUCTS_PATH}/${encodeURIComponent(slug)}`;
    const body = new FormData();
    body.append('destination', `/${org}/${repo}${base}/${to}`);
    const resp = await daFetch(`${ADMIN_URL}/move/${org}/${repo}${base}/${encodePath(from)}`, { method: 'POST', body });
    if (!resp.ok) throw new Error(`Move of ${from} failed: ${resp.status} ${resp.statusText}`);
  }

  /**
   * Runs one AEM admin action per path (`/assets/products/<slug>/…`), a few at a time.
   * `preview`/`live` with POST publishes, with DELETE removes from live/preview.
   * @returns {Promise<string[]>} error messages for paths that failed
   */
  async function aemEach(paths, steps, onProgress) {
    const errors = [];
    const queue = [...paths];
    let done = 0;
    const run = async () => {
      while (queue.length) {
        const path = queue.shift();
        for (let i = 0; i < steps.length; i += 1) {
          const [route, method] = steps[i];
          const url = `${AEM_ADMIN_URL}/${route}/${org}/${repo}/${AEM_REF}${encodePath(path)}`;
          try {
            const resp = await daFetch(url, { method });
            if (!resp.ok && !(method === 'DELETE' && resp.status === 404)) {
              const reason = resp.headers.get('x-error') || resp.statusText;
              throw new Error(`${route === 'live' ? 'Publish' : 'Preview'} of ${path} failed: ${resp.status} ${reason}`);
            }
          } catch (error) {
            errors.push(error.message);
            break;
          }
        }
        done += 1;
        onProgress?.(done, paths.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PUBLISH_CONCURRENCY, paths.length) }, run));
    return errors;
  }

  const assetPath = (slug, path) => `${PRODUCTS_PATH}/${slug}/${path}`;

  /** Previews then publishes files of a product (paths relative to its folder). */
  function publishAssets(slug, paths, onProgress) {
    return aemEach(paths.map((p) => assetPath(slug, p)), [['preview', 'POST'], ['live', 'POST']], onProgress);
  }

  /** Unpublishes then removes from preview files that were moved or deleted. */
  function unpublishAssets(slug, paths, onProgress) {
    return aemEach(paths.map((p) => assetPath(slug, p)), [['live', 'DELETE'], ['preview', 'DELETE']], onProgress);
  }

  /** Falls back to the DA source for assets that have not been previewed yet. */
  async function loadFromSource(img, thumb, sourceUrl) {
    try {
      const resp = await daFetch(sourceUrl);
      if (!resp.ok) throw new Error(resp.statusText);
      img.src = URL.createObjectURL(await resp.blob());
    } catch {
      thumb.classList.add('broken');
    }
  }

  /**
   * @param {string} slug product folder
   * @param {object} row images.json row
   * @param {object} [opts]
   * @param {boolean} [opts.link] wrap in a link to the full-size asset
   * @param {string} [opts.src] local (blob) URL for images that are not uploaded yet
   */
  function buildThumb(slug, row, { link = false, src: localSrc } = {}) {
    const path = rowPath(row);
    const absolute = isAbsolute(path) || !!localSrc;
    const src = localSrc || (isAbsolute(path) ? path : `${PRODUCTS_PATH}/${encodeURIComponent(slug)}/${encodePath(path)}`);
    const label = rowField(row, 'Label') || path;

    const thumb = el(link ? 'a' : 'span', 'pa-thumb');
    if (link) {
      thumb.href = src;
      thumb.target = '_blank';
      thumb.rel = 'noopener';
    }
    thumb.title = label;

    const img = el('img');
    img.alt = label;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      if (absolute || img.src.startsWith('blob:')) {
        thumb.classList.add('broken');
        return;
      }
      loadFromSource(img, thumb, `${productsSource}/${encodeURIComponent(slug)}/${encodePath(path)}`);
    }, { once: true });
    img.src = src;
    thumb.append(img);

    const markets = rowMarkets(row);
    if (markets.length) thumb.append(buildMarkets(markets));
    if (rowField(row, 'Video')) thumb.append(el('span', 'pa-video', 'Video'));
    return thumb;
  }

  return {
    org,
    repo,
    listProductFolders,
    loadImagesSheet,
    fetchImagesDoc,
    saveImagesSheet,
    uploadAsset,
    moveAsset,
    deleteAsset,
    publishAssets,
    unpublishAssets,
    sheetRows,
    buildThumb,
  };
}
