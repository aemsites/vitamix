/**
 * Promotion schedule sources for commerce-admin: the storefront nav banners, free-gift offers and
 * the promo-schedule sheet, read from the Edge Delivery content origin.
 *
 * Shared by the Promotion Control Center (`misc/promotion-control-center.js`) and the orders chart
 * overlay (`promotion-overlay.js`). Parsing is a port of the storefront's (`scripts/scripts.js`).
 *
 * Loaders never touch the DOM of the host page. Callers receive progress through
 * `options.onStatus(key, text, error, info)` and may inject `options.fetchContent`
 * (default: a plain `fetch` against {@link contentOrigin} with `cache: 'no-store'`).
 */
import { easternCivilToUtc } from './commerce-eastern-time.js';
import { getApiEnvironment } from './commerce-otp-api.js';

/**
 * Orders-chart market keys (`orderMarketKey()` in `orders-page.js`) → storefront locale folders.
 * @type {Record<string, string[]>}
 */
export const MARKET_LOCALES = {
  us: ['us/en_us'],
  'ca-en': ['ca/en_us'],
  'ca-fr': ['ca/fr_ca'],
  mx: ['mx/es_mx'],
};

/** Locale folder → chart market key (`us/en_us` → `us`, `ca/fr_ca` → `ca-fr`). */
const LOCALE_MARKET_KEY = Object.fromEntries(
  Object.entries(MARKET_LOCALES).flatMap(([key, locales]) => locales.map((l) => [l, key])),
);

/**
 * Content origin the schedule documents are read from: published content (`aem.live`) when the
 * admin talks to the production API, preview content (`aem.page`) otherwise.
 * Evaluated at call time because the API environment is read from `localStorage`.
 * @returns {string}
 */
export function contentOrigin() {
  return `https://main--vitamix--aemsites.aem.${getApiEnvironment() === 'prod' ? 'live' : 'page'}`;
}

/** Country folder of a locale (`ca/fr_ca` → `ca`). */
export function marketForLocale(locale) {
  return String(locale || '').split('/')[0];
}

/**
 * Chart market key for a locale folder.
 * @param {string} locale e.g. `ca/fr_ca`
 * @returns {string} e.g. `ca-fr`, or '' for a locale the chart has no key for
 */
export function marketKeyForLocale(locale) {
  return LOCALE_MARKET_KEY[locale] || '';
}

/**
 * @typedef {object} ScheduleItem
 * @property {string} source `nav-banners`, `free-gifts` or `promo-schedule`
 * @property {string} market country code (`us`, `ca`, `mx`)
 * @property {string} where locale folder the row came from (`us/en_us`, `ca/fr_ca`, ...)
 * @property {string} label
 * @property {string} [detail]
 * @property {string} [type] optional fifth nav-banners cell: `sale`, `launch`, `info` or `hidden`
 * @property {string} [promotion] promo-schedule only: the promotion folder name
 * @property {Date|null} start null = open-ended
 * @property {Date|null} end null = open-ended
 */

const TIMEZONE_OFFSETS = {
  EDT: -4, EST: -5, CDT: -5, CST: -6, MDT: -6, MST: -7, PDT: -7, PST: -8,
};

/**
 * Parses "M/D/YYYY 9am" / "M/D/YYYY 9:30pm [TZ]"; defaults to Eastern time.
 * @param {string} dateStr
 * @returns {Date}
 */
export function parseEasternDateTime(dateStr) {
  const regex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})(?::(\d{2}))?(am|pm)(?:\s+([A-Z]{3,4}))?$/i;
  const match = String(dateStr || '').trim().match(regex);
  if (!match) throw new Error(`Invalid datetime format: ${dateStr}. Expected format: M/D/YYYY HHam/pm`);
  const [, mo, d, y, h, mi, ampm, tz] = match;
  let hours = parseInt(h, 10);
  if (ampm.toLowerCase() === 'am' && hours === 12) hours = 0;
  else if (ampm.toLowerCase() === 'pm' && hours !== 12) hours += 12;
  const minutes = mi ? parseInt(mi, 10) : 0;
  const month = parseInt(mo, 10);
  const day = parseInt(d, 10);
  const year = parseInt(y, 10);
  if (tz) {
    const offset = TIMEZONE_OFFSETS[tz.toUpperCase()];
    if (offset === undefined) throw new Error(`Unsupported timezone: ${tz}`);
    return new Date(Date.UTC(year, month - 1, day, hours - offset, minutes, 0));
  }
  return easternCivilToUtc(year, month, day, hours, minutes, 0);
}

/** Nav banner cells: empty = open-ended, invalid = throws (row is reported). */
export function parseBannerDate(text) {
  const trimmed = String(text || '').trim();
  return trimmed ? parseEasternDateTime(trimmed) : null;
}

/** Promo schedule cells: same fallback as `checkSchedule()` on main. */
export function parseScheduleDateSafe(dateStr) {
  if (!dateStr) return null;
  try {
    return parseEasternDateTime(dateStr);
  } catch {
    const fallback = new Date(dateStr);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
}

/**
 * @typedef {object} LoaderOptions
 * @property {(path: string) => Promise<Response>} [fetchContent]
 * @property {(key: string, text: string, error?: boolean, info?: { httpStatus?: number }) => void}
 *   [onStatus]
 */

/** Default content fetch: direct, uncached (a banner edit must be visible immediately). */
function defaultFetchContent(path) {
  return fetch(`${contentOrigin()}${path}`, { cache: 'no-store' });
}

/**
 * Shared prologue of the document loaders: fetch `{path}.plain.html`, report HTTP failures and
 * a missing block, and hand back the block's element.
 */
async function fetchBlock(path, key, blockClass, options) {
  const fetchContent = options.fetchContent || defaultFetchContent;
  const setStatus = options.onStatus || (() => {});
  setStatus(key, `${path}: loading…`);
  const resp = await fetchContent(`${path}.plain.html`);
  if (!resp.ok) {
    setStatus(key, `${path}: HTTP ${resp.status}`, resp.status !== 404, { httpStatus: resp.status });
    return null;
  }
  const dom = new DOMParser().parseFromString(await resp.text(), 'text/html');
  const block = dom.querySelector(`.${blockClass}`);
  if (!block) {
    setStatus(key, `${path}: no ${blockClass} block found`, true);
    return null;
  }
  return block;
}

/**
 * Nav banner rows of a locale (`alert-banners` block in `/{locale}/nav/nav-banners`).
 * Columns: start, end, content, colour and an optional type.
 * @param {string} locale e.g. `us/en_us`
 * @param {LoaderOptions} [options]
 * @returns {Promise<ScheduleItem[]>}
 */
export async function loadNavBanners(locale, options = {}) {
  const key = `nav-banners:${locale}`;
  const path = `/${locale}/nav/nav-banners`;
  const setStatus = options.onStatus || (() => {});
  const block = await fetchBlock(path, key, 'alert-banners', options);
  if (!block) return [];
  const problems = [];
  const items = [];
  [...block.children].forEach((row, index) => {
    const [startEl, endEl, contentEl, colorEl, typeEl] = [...row.children];
    const label = contentEl?.textContent.trim().replace(/\s+/g, ' ') || '(empty banner)';
    const type = typeEl?.textContent.trim().toLowerCase() || '';
    try {
      items.push({
        source: 'nav-banners',
        market: marketForLocale(locale),
        where: locale,
        label,
        detail: colorEl?.textContent.trim() ? `color: ${colorEl.textContent.trim()}` : '',
        ...(type ? { type } : {}),
        start: parseBannerDate(startEl?.textContent),
        end: parseBannerDate(endEl?.textContent),
      });
    } catch (e) {
      problems.push(`row ${index + 1}: ${e.message}`);
    }
  });
  setStatus(key, `${path}: ${items.length} banners${problems.length ? `; ${problems.join('; ')}` : ''}`, problems.length > 0);
  return items;
}

/**
 * Free-gift rows of a locale. Columns per `renderFreeGift()` in blocks/pdp/pdp.js on main.
 * @param {string} locale
 * @param {LoaderOptions} [options]
 * @returns {Promise<ScheduleItem[]>}
 */
export async function loadFreeGifts(locale, options = {}) {
  const key = `free-gifts:${locale}`;
  const path = `/${locale}/products/config/free-gifts`;
  const setStatus = options.onStatus || (() => {});
  const block = await fetchBlock(path, key, 'free-gifts', options);
  if (!block) return [];
  const problems = [];
  const items = [];
  [...block.children].forEach((row, index) => {
    const [startEl, endEl, minPriceEl, labelEl, , slugsEl] = [...row.children];
    const minPrice = (minPriceEl?.textContent || '').trim().replace(/^\$/, '');
    const slugs = (slugsEl?.textContent || '').split(',').map((s) => s.trim()).filter(Boolean);
    try {
      items.push({
        source: 'free-gifts',
        market: marketForLocale(locale),
        where: locale,
        label: labelEl?.textContent.trim() || '(no label)',
        detail: [
          minPrice ? `min price: $${minPrice}` : '',
          `products: ${slugs.length ? slugs.join(', ') : 'all'}`,
        ].filter(Boolean).join(' · '),
        start: parseBannerDate(startEl?.textContent),
        end: parseBannerDate(endEl?.textContent),
      });
    } catch (e) {
      // The PDP silently skips these rows; surface them here.
      problems.push(`row ${index + 1}: ${e.message}`);
    }
  });
  setStatus(key, `${path}: ${items.length} gifts${problems.length ? `; ${problems.join('; ')}` : ''}`, problems.length > 0);
  return items;
}

/**
 * Rows of the promo-schedule sheet (`/{locale}/promotions/promo-schedule.json`).
 * @param {string} locale
 * @param {LoaderOptions} [options]
 * @returns {Promise<ScheduleItem[]>}
 */
export async function loadPromoSchedule(locale, options = {}) {
  const key = `promo-schedule:${locale}`;
  const path = `/${locale}/promotions/promo-schedule.json`;
  const fetchContent = options.fetchContent || defaultFetchContent;
  const setStatus = options.onStatus || (() => {});
  setStatus(key, `${path}: loading…`);
  const resp = await fetchContent(path);
  if (!resp.ok) {
    setStatus(key, `${path}: HTTP ${resp.status}`, resp.status !== 404, { httpStatus: resp.status });
    return [];
  }
  const json = await resp.json();
  const rows = Array.isArray(json?.data) ? json.data : [];
  const items = rows.map((row) => ({
    source: 'promo-schedule',
    market: marketForLocale(locale),
    where: locale,
    label: String(row.Promotion || '(no promotion)'),
    promotion: String(row.Promotion || '').trim(),
    detail: `/${locale}/promotions/${row.Promotion || ''}`,
    start: parseScheduleDateSafe(row.Start),
    end: parseScheduleDateSafe(row.End),
  }));
  setStatus(key, `${path}: ${items.length} entries`);
  return items;
}
