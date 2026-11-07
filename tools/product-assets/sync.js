/* eslint-disable no-await-in-loop */
import {
  INDEX_BASE, PRODUCTS_PATH, fcorsUrl, groupByColor, isAbsolute, isOgImage,
  rowField, rowMarkets, rowPath, toSlug,
} from './shared.js';

const ASSETS_ORIGIN = 'https://main--vitamix--aemsites.aem.live';

function assetUrl(slug, row) {
  const path = rowPath(row);
  return isAbsolute(path) ? path
    : `${ASSETS_ORIGIN}${PRODUCTS_PATH}/${encodeURIComponent(slug)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function productionMediaUrl(value, pageUrl) {
  const url = new URL(value, pageUrl);
  if (/(^|\.)vitamix\.com$/i.test(url.hostname)
    && /^\/[a-z]{2}\/[a-z_]+\/products\/media_[^/]+$/i.test(url.pathname)) {
    url.host = new URL(INDEX_BASE).host;
    url.protocol = 'https:';
  }
  return url.href;
}

function mediaFromPicture(picture, pageUrl) {
  const img = picture.querySelector('img');
  if (!img?.getAttribute('src')) throw new Error('Production gallery image has no source');
  const wrapper = picture.parentElement;
  return {
    url: productionMediaUrl(img.getAttribute('src'), pageUrl),
    label: img.getAttribute('alt') || '',
    video: wrapper.querySelector('a[href*="youtube.com"], a[href*="youtu.be"]')?.getAttribute('href') || '',
  };
}

/** Reads galleries and variant colors from a single production HTML response. */
export async function loadProduction(slug, locale) {
  const pageUrl = `${INDEX_BASE}/${locale.path}/products/${encodeURIComponent(slug)}`;
  const stamp = Date.now();
  const page = await fetch(fcorsUrl(`${pageUrl}?_cacheBust=${stamp}`), {
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  });
  if (page.status === 404) return { missing: true };
  if (!page.ok) throw new Error(`Production request failed (${page.status})`);
  const html = await page.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const main = doc.querySelector('main');
  const type = doc.querySelector('meta[name="type"]')?.content;
  if (!main || !['simple', 'configurable', 'bundle'].includes(type)) {
    throw new Error('Production response is not a supported product page');
  }
  const first = main.firstElementChild;
  if (!first) throw new Error('Production product gallery is missing');
  const images = [...first.querySelectorAll('picture')].map((p) => mediaFromPicture(p, pageUrl));
  const sections = [...main.querySelectorAll(':scope > .section[data-sku]')];
  const variants = sections.map((section) => {
    if (!section.dataset.color) throw new Error(`Production variant ${section.dataset.sku} has no color`);
    return {
      sku: section.dataset.sku,
      options: { color: section.dataset.color },
      images: [...section.querySelectorAll('picture')].map((p) => mediaFromPicture(p, pageUrl)),
    };
  });
  const social = doc.querySelector('meta[property="og:image"]')?.content;
  return { images, variants, social: social ? productionMediaUrl(social, pageUrl) : '' };
}

function optionValues(variant) {
  if (Array.isArray(variant.options)) {
    const color = variant.options.find((o) => /^(color|colour)$/i.test(o.id));
    return [color?.value, ...variant.options.map((o) => o.value)].filter(Boolean).map(toSlug);
  }
  const options = variant.options || {};
  return [options.color || options.colour, ...Object.values(options)].filter(Boolean).map(toSlug);
}

/** Mirrors product-admin's exact-color-first, then suffix matching, once per folder. */
export function planGalleries(rows, market, variants) {
  const allowed = rows.filter((row) => {
    const markets = rowMarkets(row);
    return rowPath(row) && (!markets.length || markets.includes(market));
  });
  const groups = groupByColor(allowed);
  const used = new Set();
  const galleries = variants.map((variant) => {
    const options = optionValues(variant);
    const preferred = options[0];
    let folder = preferred && groups.has(preferred) && !used.has(preferred) ? preferred : '';
    if (!folder) {
      folder = [...groups.keys()].find((f) => f && !used.has(f)
        && options.some((o) => o === f || o.endsWith(`-${f}`))) || '';
    }
    if (folder) used.add(folder);
    return { label: `Variant ${variant.sku}`, rows: groups.get(folder) && folder ? groups.get(folder) : [], images: variant.images };
  });
  return {
    galleries: [{ label: 'Product', rows: groups.get('') || [], images: [] }, ...galleries],
    unmatched: [...groups.keys()].filter((f) => f && !used.has(f)),
    social: allowed.find(isOgImage),
  };
}

/** Compares image bytes rather than media IDs, which differ between media buses. */
export function createImageFingerprint() {
  const cache = new Map();
  let active = 0;
  const waiting = [];
  return (value) => {
    const url = new URL(value);
    url.hash = '';
    if (/\.(aem\.(live|page|network)|vitamix\.com)$/.test(url.hostname)) {
      ['width', 'height', 'format', 'optimize'].forEach((name) => url.searchParams.delete(name));
      url.searchParams.set('format', 'original');
    }
    const key = url.href;
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        if (active >= 4) await new Promise((resolve) => { waiting.push(resolve); });
        else active += 1;
        try {
          const resp = await fetch(fcorsUrl(key), {
            cache: 'no-store', signal: AbortSignal.timeout(20000),
          });
          if (!resp.ok) throw new Error(`Image request failed (${resp.status}): ${url.pathname}`);
          if (!resp.headers.get('content-type')?.startsWith('image/')) {
            throw new Error(`Image request returned non-image content: ${url.pathname}`);
          }
          const digest = await crypto.subtle.digest('SHA-256', await resp.arrayBuffer());
          return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
        } finally {
          if (waiting.length) waiting.shift()();
          else active -= 1;
        }
      })());
    }
    return cache.get(key);
  };
}

export async function compareProduction(slug, rows, locale, production, lookupHash) {
  if (production.missing) return { state: 'missing', text: 'No production page', reasons: [] };
  const plan = planGalleries(rows, locale.market, production.variants);
  plan.galleries[0].images = production.images;
  const reasons = plan.unmatched.map((folder) => `No production variant matches ${folder}`);
  for (let g = 0; g < plan.galleries.length; g += 1) {
    const gallery = plan.galleries[g];
    if (gallery.rows.length !== gallery.images.length) {
      reasons.push(`${gallery.label}: ${gallery.images.length} production images, ${gallery.rows.length} expected`);
    } else {
      for (let i = 0; i < gallery.rows.length; i += 1) {
        const row = gallery.rows[i];
        const image = gallery.images[i];
        const [expected, actual] = await Promise.all([
          lookupHash(assetUrl(slug, row)), lookupHash(image.url),
        ]);
        if (expected !== actual || rowField(row, 'Label') !== image.label
          || rowField(row, 'Video') !== image.video) {
          reasons.push(`${gallery.label}: image ${i + 1} differs (image/order, label or video)`);
        }
      }
    }
  }
  // Without an explicit social image, the storefront falls back to its first gallery image.
  const socialRow = plan.social || plan.galleries.find((g) => g.rows.length)?.rows[0];
  if (socialRow && production.social) {
    const [expected, actual] = await Promise.all([
      lookupHash(assetUrl(slug, socialRow)), lookupHash(production.social),
    ]);
    if (expected !== actual) reasons.push('Social image differs');
  } else if (socialRow || production.social) reasons.push('Social image is missing or unexpected');
  return reasons.length
    ? { state: 'out-of-sync', text: 'Update', reasons }
    : { state: 'synced', text: 'Up to date', reasons: [] };
}
