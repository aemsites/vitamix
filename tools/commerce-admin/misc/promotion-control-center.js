import {
  fetchCatalogPriceRules,
  catalogRulesForCountryTab,
  catalogRuleToPromotionRows,
  productUrlToCatalogPath,
  promotionMinimumSubtotal,
} from '../price-rules-api.js';
import { PB_ORG, PB_SITE } from '../commerce-pbus-config.js';
import { getApiEnvironment } from '../commerce-otp-api.js';
import waitForCommerceAuthReady from '../commerce-wait-auth-ready.js';
import { easternCivilToUtc, formatInstantInEastern } from '../commerce-eastern-time.js';

const CONTENT_ORIGIN = `https://main--vitamix--aemsites.aem.${getApiEnvironment() === 'prod' ? 'live' : 'page'}`;
const CORS_PROXY = 'https://fcors.org/?url=';
const CORS_KEY = '&key=Mg23N96GgR8O3NjU';
const STOREFRONT_ORIGIN = 'https://www.vitamix.com';
const PRODUCTION_REQUEST_INTERVAL = 3000;
let productionRequestQueue = Promise.resolve();
let lastProductionRequestAt = 0;

const MARKETS = [
  { key: 'us', label: 'US', locales: ['us/en_us'] },
  { key: 'ca', label: 'CA', locales: ['ca/en_us', 'ca/fr_ca'] },
];

const SOURCES = [
  { key: 'commerce', label: 'Commerce promotions', color: '#7b1fa2' },
  { key: 'nav-banners', label: 'Nav banners', color: '#ef6c00' },
  { key: 'promo-schedule', label: 'Promo schedule', color: '#00897b' },
  { key: 'free-gifts', label: 'Free gifts', color: '#c2185b' },
];

const HOUR = 3600000;
const DAY = 24 * HOUR;
const MIN_ZOOM_MS = HOUR;
const TICK_UNITS = [
  { kind: 'hour', n: 1, ms: HOUR },
  { kind: 'hour', n: 3, ms: 3 * HOUR },
  { kind: 'hour', n: 6, ms: 6 * HOUR },
  { kind: 'hour', n: 12, ms: 12 * HOUR },
  { kind: 'day', n: 1, ms: DAY },
  { kind: 'day', n: 2, ms: 2 * DAY },
  { kind: 'day', n: 7, ms: 7 * DAY },
  { kind: 'month', n: 1, ms: 30 * DAY },
  { kind: 'month', n: 3, ms: 91 * DAY },
  { kind: 'month', n: 12, ms: 365 * DAY },
];
const MAX_TICKS = 16;
const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  weekday: 'short',
  hourCycle: 'h23',
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const timelineEl = document.querySelector('#pcc-timeline');
const detailsEl = document.querySelector('#pcc-details');
const rangeEl = document.querySelector('#pcc-range');
const statusList = document.querySelector('#pcc-status-list');
const backButton = document.querySelector('#pcc-zoom-back');

/**
 * @typedef {object} ScheduleItem
 * @property {string} source
 * @property {string} market
 * @property {string} where locale or country shown in the label
 * @property {string} label
 * @property {string} [detail]
 * @property {Date|null} start null = open-ended
 * @property {Date|null} end null = open-ended
 */

const state = {
  /** @type {Record<string, ScheduleItem[]>} */
  items: {},
  /** @type {string[]} page paths whose `schedule` metadata is `promo-schedule` */
  scheduledPages: [],
  /** @type {Map<string, { status?: number, lastModified?: string, error?: string }>} */
  pageChecks: new Map(),
  /** @type {Map<string, Promise<object[]>>} production product index data by locale/category */
  productionIndexes: new Map(),
  /** @type {Map<string, Promise<object>>} production PDP data by product path */
  productionProducts: new Map(),
  /** @type {Map<string, { text: string, error?: boolean }>} */
  status: new Map(),
  sources: new Set(SOURCES.map((s) => s.key)),
  markets: new Set(MARKETS.map((m) => m.key)),
  view: defaultView(),
  /** @type {{ start: number, end: number }[]} */
  history: [],
  /** @type {number|null} boundary instant selected via its label */
  focusBoundary: null,
  pending: 0,
  itemIds: new WeakMap(),
  nextItemId: 1,
};

/** Eastern civil components (month 1-based) of an instant. */
function etCivil(ms) {
  const parts = Object.fromEntries(
    ET_PARTS.formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour) % 24,
    wd: WEEKDAYS.indexOf(parts.weekday),
  };
}

/** Normalizes overflowing civil fields (e.g. day 32, hour 25) via UTC arithmetic. */
function normalizeCivil(y, mo, d, h) {
  const n = new Date(Date.UTC(y, mo - 1, d, h));
  return {
    y: n.getUTCFullYear(), mo: n.getUTCMonth() + 1, d: n.getUTCDate(), h: n.getUTCHours(),
  };
}

function civilToMs(c) {
  return easternCivilToUtc(c.y, c.mo, c.d, c.h, 0, 0).getTime();
}

function defaultView(date = new Date()) {
  const today = etCivil(date.getTime());
  const start = civilToMs({ ...today, h: 0 });
  const end = civilToMs(normalizeCivil(today.y, today.mo + 1, today.d, 0));
  return { start, end };
}

/* ---------- parsing (ported from main: scripts/scripts.js) ---------- */

const TIMEZONE_OFFSETS = {
  EDT: -4, EST: -5, CDT: -5, CST: -6, MDT: -6, MST: -7, PDT: -7, PST: -8,
};

/**
 * Parses "M/D/YYYY 9am" / "M/D/YYYY 9:30pm [TZ]"; defaults to Eastern time.
 * @param {string} dateStr
 * @returns {Date}
 */
function parseEasternDateTime(dateStr) {
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
function parseBannerDate(text) {
  const trimmed = String(text || '').trim();
  return trimmed ? parseEasternDateTime(trimmed) : null;
}

/** Promo schedule cells: same fallback as `checkSchedule()` on main. */
function parseScheduleDateSafe(dateStr) {
  if (!dateStr) return null;
  try {
    return parseEasternDateTime(dateStr);
  } catch {
    const fallback = new Date(dateStr);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
}

/* ---------- loading ---------- */

async function fetchContent(path) {
  const url = `${CONTENT_ORIGIN}${path}`;
  try {
    return await fetch(url, { cache: 'no-store' });
  } catch {
    // Direct fetch blocked (CORS); retry through the proxy used elsewhere in commerce-admin.
    return fetch(CORS_PROXY + encodeURIComponent(url) + CORS_KEY, { cache: 'no-store' });
  }
}

function marketForLocale(locale) {
  return locale.split('/')[0];
}

function setStatus(key, text, error = false) {
  state.status.set(key, { text, error });
  renderStatus();
}

async function loadNavBanners(locale) {
  const key = `nav-banners:${locale}`;
  const path = `/${locale}/nav/nav-banners`;
  setStatus(key, `${path}: loading…`);
  const resp = await fetchContent(`${path}.plain.html`);
  if (!resp.ok) {
    setStatus(key, `${path}: HTTP ${resp.status}`, resp.status !== 404);
    return [];
  }
  const dom = new DOMParser().parseFromString(await resp.text(), 'text/html');
  const block = dom.querySelector('.alert-banners');
  if (!block) {
    setStatus(key, `${path}: no alert-banners block found`, true);
    return [];
  }
  const problems = [];
  const items = [];
  [...block.children].forEach((row, index) => {
    const [startEl, endEl, contentEl, colorEl] = [...row.children];
    const label = contentEl?.textContent.trim().replace(/\s+/g, ' ') || '(empty banner)';
    try {
      items.push({
        source: 'nav-banners',
        market: marketForLocale(locale),
        where: locale,
        label,
        detail: colorEl?.textContent.trim() ? `color: ${colorEl.textContent.trim()}` : '',
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

/** Columns per `renderFreeGift()` in blocks/pdp/pdp.js on main. */
async function loadFreeGifts(locale) {
  const key = `free-gifts:${locale}`;
  const path = `/${locale}/products/config/free-gifts`;
  setStatus(key, `${path}: loading…`);
  const resp = await fetchContent(`${path}.plain.html`);
  if (!resp.ok) {
    setStatus(key, `${path}: HTTP ${resp.status}`, resp.status !== 404);
    return [];
  }
  const dom = new DOMParser().parseFromString(await resp.text(), 'text/html');
  const block = dom.querySelector('.free-gifts');
  if (!block) {
    setStatus(key, `${path}: no free-gifts block found`, true);
    return [];
  }
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

async function loadPromoSchedule(locale) {
  const key = `promo-schedule:${locale}`;
  const path = `/${locale}/promotions/promo-schedule.json`;
  setStatus(key, `${path}: loading…`);
  const resp = await fetchContent(path);
  if (!resp.ok) {
    setStatus(key, `${path}: HTTP ${resp.status}`, resp.status !== 404);
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

/** Earliest start / latest end across rule lines; any undated line makes that side open-ended. */
function catalogWindow(rules) {
  let minStart = Infinity;
  let maxEnd = -Infinity;
  let openStart = false;
  let openEnd = false;
  rules.forEach((rule) => {
    const s = Date.parse(rule.start || '');
    const e = Date.parse(rule.end || '');
    if (Number.isNaN(s)) openStart = true; else minStart = Math.min(minStart, s);
    if (Number.isNaN(e)) openEnd = true; else maxEnd = Math.max(maxEnd, e);
    Object.values(rule.variants || {}).forEach((v) => {
      const vs = Date.parse(v.start || '');
      const ve = Date.parse(v.end || '');
      if (!Number.isNaN(vs)) minStart = Math.min(minStart, vs);
      if (!Number.isNaN(ve)) maxEnd = Math.max(maxEnd, ve);
    });
  });
  return {
    start: openStart || minStart === Infinity ? null : new Date(minStart),
    end: openEnd || maxEnd === -Infinity ? null : new Date(maxEnd),
  };
}

async function loadCommercePromotions() {
  const key = 'commerce';
  setStatus(key, 'Commerce promotions: waiting for sign-in…');
  if (!(await waitForCommerceAuthReady(PB_ORG, PB_SITE))) {
    setStatus(key, 'Commerce promotions: not signed in', true);
    return [];
  }
  setStatus(key, 'Commerce promotions: loading…');
  const doc = await fetchCatalogPriceRules(PB_ORG, PB_SITE, { cache: 'no-store' });
  const items = [];
  (doc.promotions || []).forEach((promo) => {
    MARKETS.forEach((market) => {
      const rules = catalogRulesForCountryTab(promo, market.key);
      if (!rules.length) return;
      const group = rules.find((r) => r.custom?.group)?.custom.group;
      items.push({
        source: 'commerce',
        market: market.key,
        where: market.key,
        label: promo.name || promo.id,
        detail: [promo.id, group, `${rules.length} lines`].filter(Boolean).join(' · '),
        promo,
        rules,
        ...catalogWindow(rules),
      });
    });
  });
  setStatus(key, `Commerce promotions (${getApiEnvironment() === 'prod' ? 'production' : 'staging'}): ${items.length} promotion/market spans`);
  return items;
}

function runLoader(key, loader) {
  state.pending += 1;
  return loader()
    .then((items) => { state.items[key] = items; })
    .catch((e) => {
      state.items[key] = [];
      setStatus(key, `${key}: ${e.message}`, true);
    })
    .finally(() => {
      state.pending -= 1;
      renderTimeline();
    });
}

async function loadScheduledPages() {
  const key = 'promo-schedule:metadata';
  setStatus(key, '/metadata.json: loading…');
  try {
    const resp = await fetchContent('/metadata.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    state.scheduledPages = rows
      .filter((row) => String(row.schedule || '').trim() === 'promo-schedule')
      .map((row) => String(row.URL || '').trim())
      .filter((url) => url.startsWith('/') && !url.includes('*'));
    setStatus(key, `/metadata.json: ${state.scheduledPages.length} pages with schedule = promo-schedule`);
  } catch (e) {
    state.scheduledPages = [];
    setStatus(key, `/metadata.json: ${e.message}`, true);
  }
  renderTimeline();
}

/** Status + last-modified of a content path via the fcors header reveal. */
async function checkPage(path) {
  const url = `${CONTENT_ORIGIN}${path}`;
  const resp = await fetch(`${CORS_PROXY}${encodeURIComponent(url)}${CORS_KEY}&reveal=headers`, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`proxy HTTP ${resp.status}`);
  const json = await resp.json();
  const headers = Array.isArray(json?.headers) ? json.headers : [];
  const lastModified = headers.find((h) => String(h.name).toLowerCase() === 'last-modified')?.value;
  return { status: Number(json?.status), lastModified };
}

function loadAll() {
  state.items = {};
  state.status.clear();
  state.pageChecks.clear();
  state.productionIndexes.clear();
  state.productionProducts.clear();
  loadScheduledPages();
  const locales = MARKETS.flatMap((m) => m.locales);
  runLoader('commerce', loadCommercePromotions);
  locales.forEach((locale) => {
    runLoader(`nav-banners:${locale}`, () => loadNavBanners(locale));
    runLoader(`promo-schedule:${locale}`, () => loadPromoSchedule(locale));
    runLoader(`free-gifts:${locale}`, () => loadFreeGifts(locale));
  });
  // After loaders start so a deep-linked `at` isn't dropped before data arrives.
  renderTimeline();
}

/* ---------- rendering ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDuration(ms) {
  const days = ms / DAY;
  if (days >= 21) return `${Math.round(days / 7)} weeks`;
  if (days >= 1) return `${Math.round(days)} days`;
  const hours = ms / HOUR;
  if (hours >= 1) return `${Math.round(hours)} hours`;
  return `${Math.max(1, Math.round(ms / 60000))} minutes`;
}

function formatRangeDate(ms) {
  return new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function scheduleItemId(item) {
  if (!state.itemIds.has(item)) {
    state.itemIds.set(item, String(state.nextItemId));
    state.nextItemId += 1;
  }
  return state.itemIds.get(item);
}

function pickTickUnit(rangeMs) {
  return TICK_UNITS.find((u) => rangeMs / u.ms <= MAX_TICKS) || TICK_UNITS[TICK_UNITS.length - 1];
}

function alignTick(ms, unit) {
  const c = etCivil(ms);
  if (unit.kind === 'hour') return { ...c, h: Math.floor(c.h / unit.n) * unit.n };
  if (unit.kind === 'day') return normalizeCivil(c.y, c.mo, unit.n === 7 ? c.d - c.wd : c.d, 0);
  return {
    y: c.y, mo: Math.floor((c.mo - 1) / unit.n) * unit.n + 1, d: 1, h: 0,
  };
}

function nextTick(c, unit) {
  if (unit.kind === 'hour') return normalizeCivil(c.y, c.mo, c.d, c.h + unit.n);
  if (unit.kind === 'day') return normalizeCivil(c.y, c.mo, c.d + unit.n, c.h);
  return normalizeCivil(c.y, c.mo + unit.n, c.d, c.h);
}

function hourLabel(h) {
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
}

function tickLabel(c, unit, first) {
  if (unit.kind === 'month') {
    if (unit.n === 12) return String(c.y);
    return first || c.mo === 1 ? `${MONTH_NAMES[c.mo - 1]} ${c.y}` : MONTH_NAMES[c.mo - 1];
  }
  if (unit.kind === 'day') return `${c.mo}/${c.d}`;
  if (first || c.h === 0) return `${c.mo}/${c.d}, ${hourLabel(c.h)}`;
  return hourLabel(c.h);
}

function buildTicks(view) {
  const unit = pickTickUnit(view.end - view.start);
  const ticks = [];
  let lastMs = -Infinity;
  for (let c = alignTick(view.start, unit); civilToMs(c) <= view.end; c = nextTick(c, unit)) {
    const ms = civilToMs(c);
    // DST gaps can map two civil hours to the same instant.
    if (ms >= view.start && ms > lastMs) {
      ticks.push({ ms, label: tickLabel(c, unit, !ticks.length) });
      lastMs = ms;
    }
  }
  return ticks;
}

function pct(ms, view) {
  return ((ms - view.start) / (view.end - view.start)) * 100;
}

function itemStatus(item, now) {
  if (item.start && item.start.getTime() > now) return 'future';
  if (item.end && item.end.getTime() < now) return 'past';
  return 'current';
}

const LOCALE_ORDER = MARKETS.flatMap((m) => m.locales);

/** Rank of a locale (`us/en_us`) or bare country (`us`, for commerce) in LOCALE_ORDER. */
function localeRank(where) {
  return LOCALE_ORDER.findIndex((l) => l === where || l.startsWith(`${where}/`));
}

function visibleItems(view) {
  const sourceIndex = (item) => SOURCES.findIndex((s) => s.key === item.source);
  return Object.values(state.items).flat()
    .filter((item) => state.sources.has(item.source) && state.markets.has(item.market))
    .filter((item) => {
      const s = item.start ? item.start.getTime() : -Infinity;
      const e = item.end ? item.end.getTime() : Infinity;
      return e >= view.start && s <= view.end;
    })
    .sort((a, b) => (a.start?.getTime() ?? -Infinity) - (b.start?.getTime() ?? -Infinity)
      || sourceIndex(a) - sourceIndex(b)
      || localeRank(a.where) - localeRank(b.where));
}

function itemTooltip(item) {
  const source = SOURCES.find((s) => s.key === item.source).label;
  const start = item.start ? formatInstantInEastern(item.start.toISOString()) : 'open';
  const end = item.end ? formatInstantInEastern(item.end.toISOString()) : 'open';
  const dur = item.start && item.end ? ` (${formatDuration(item.end - item.start)})` : '';
  return [`${source} · ${item.where.toUpperCase()}`, item.label, `${start} → ${end}${dur}`, item.detail]
    .filter(Boolean).join('\n');
}

function renderRow(item, view, now) {
  const row = el('div', 'pcc-row');
  row.dataset.itemId = scheduleItemId(item);
  const label = el('div', 'pcc-label');
  label.title = itemTooltip(item);
  const swatch = el('span', 'pcc-swatch');
  swatch.style.background = SOURCES.find((s) => s.key === item.source).color;
  label.append(
    swatch,
    el('span', 'pcc-where', item.where.toUpperCase()),
    el('span', 'pcc-name', item.label),
  );

  const track = el('div', 'pcc-track');
  const invalid = item.start && item.end && item.end < item.start;
  if (invalid) {
    track.append(el('span', 'pcc-invalid', 'End is before start'));
  } else {
    const s = item.start ? item.start.getTime() : view.start;
    const e = item.end ? item.end.getTime() : view.end;
    const left = Math.max(0, pct(s, view));
    const right = Math.min(100, pct(e, view));
    const bar = el('div', `pcc-bar pcc-bar-${item.source} pcc-bar-${itemStatus(item, now)}`);
    const openStart = !item.start || s < view.start;
    const openEnd = !item.end || e > view.end;
    if (openStart) bar.classList.add('pcc-bar-open-start');
    if (openEnd) bar.classList.add('pcc-bar-open-end');
    const focus = state.focusBoundary;
    const dimmed = focus === null
      ? openStart || openEnd
      : item.start?.getTime() !== focus && item.end?.getTime() !== focus;
    if (dimmed) {
      bar.classList.add('pcc-bar-partial');
      row.classList.add('pcc-row-partial');
    }
    bar.style.left = `${left}%`;
    bar.style.width = `${Math.max(right - left, 0.2)}%`;
    bar.title = itemTooltip(item);
    track.append(bar);
  }
  row.append(label, track);
  return row;
}

function formatBoundaryEastern(ms) {
  return new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/** Unique start/end instants inside the view, with the items that start or end there. */
function collectBoundaries(items, view) {
  const map = new Map();
  const add = (date, kind, item) => {
    const ms = date?.getTime();
    if (ms === undefined || ms < view.start || ms > view.end) return;
    if (!map.has(ms)) map.set(ms, { ms, starts: [], ends: [] });
    map.get(ms)[kind].push(item.label);
  };
  items.forEach((item) => {
    if (item.start && item.end && item.end < item.start) return;
    add(item.start, 'starts', item);
    add(item.end, 'ends', item);
  });
  return [...map.values()].sort((a, b) => a.ms - b.ms);
}

function plotWidth() {
  const labelWidth = parseFloat(getComputedStyle(timelineEl).getPropertyValue('--pcc-label-w')) || 0;
  return Math.max(1, timelineEl.clientWidth - labelWidth - 12);
}

/** Places boundary labels in stacked lanes so they don't overlap. */
function renderBoundaries(boundaries, view, grid) {
  const strip = el('div', 'pcc-boundary-strip');
  const width = plotWidth();
  const laneEnds = [];
  boundaries.forEach((b) => {
    const selected = state.focusBoundary === b.ms;
    const line = el('div', `pcc-boundary-line${selected ? ' pcc-boundary-selected' : ''}`);
    line.style.left = `${pct(b.ms, view)}%`;
    grid.append(line);

    const text = formatBoundaryEastern(b.ms);
    const x = (pct(b.ms, view) / 100) * width;
    const w = text.length * 6 + 10;
    const alignRight = x + w > width;
    const left = alignRight ? x - w : x;
    let lane = laneEnds.findIndex((end) => end <= left);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = left + w + 4;

    const label = el('button', `pcc-boundary-label${alignRight ? ' pcc-boundary-label-right' : ''}${selected ? ' pcc-boundary-selected' : ''}`, text);
    label.type = 'button';
    label.setAttribute('aria-pressed', String(selected));
    label.addEventListener('click', () => {
      state.focusBoundary = selected ? null : b.ms;
      renderTimeline();
      syncUrl();
    });
    label.style.left = `${left}px`;
    label.style.top = `${lane * 16}px`;
    label.title = [
      b.starts.length ? `Starts: ${b.starts.join(', ')}` : '',
      b.ends.length ? `Ends: ${b.ends.join(', ')}` : '',
      selected ? 'Click to clear selection' : 'Click to select these rows',
    ].filter(Boolean).join('\n');
    strip.append(label);
  });
  strip.style.height = `${Math.max(1, laneEnds.length) * 16}px`;

  const row = el('div', 'pcc-row pcc-boundary-row');
  row.append(el('div', 'pcc-label pcc-label-head', 'Starts / ends (ET)'), strip);
  return row;
}

function renderTimeline() {
  const { view } = state;
  const now = Date.now();
  const span = formatDuration(view.end - view.start);
  rangeEl.textContent = `${formatRangeDate(view.start)} – ${formatRangeDate(view.end)} (${span})`;
  backButton.disabled = !state.history.length;

  const ticks = buildTicks(view);
  const grid = el('div', 'pcc-plot pcc-grid');
  const axis = el('div', 'pcc-axis');
  ticks.forEach((tick) => {
    const line = el('div', 'pcc-gridline');
    line.style.left = `${pct(tick.ms, view)}%`;
    grid.append(line);
    const label = el('div', 'pcc-tick', tick.label);
    label.style.left = `${pct(tick.ms, view)}%`;
    axis.append(label);
  });

  const header = el('div', 'pcc-row pcc-header');
  header.append(el('div', 'pcc-label pcc-label-head', 'Schedule (ET)'), axis);

  const rows = el('div', 'pcc-rows');
  const items = visibleItems(view);
  const boundaries = collectBoundaries(items, view);
  if (state.pending === 0 && state.focusBoundary !== null
    && !boundaries.some((b) => b.ms === state.focusBoundary)) {
    state.focusBoundary = null;
    syncUrl(true);
  }
  const boundaryRow = renderBoundaries(boundaries, view, grid);
  items.forEach((item) => rows.append(renderRow(item, view, now)));
  if (!items.length) {
    const loading = [...state.status.values()].some((s) => s.text.endsWith('…'));
    rows.append(el('p', 'pcc-empty', loading ? 'Loading schedules…' : 'No schedules in this timeframe.'));
  }

  const overlay = el('div', 'pcc-plot pcc-overlay');
  if (now >= view.start && now <= view.end) {
    const marker = el('div', 'pcc-now');
    marker.style.left = `${pct(now, view)}%`;
    marker.append(el('span', 'pcc-now-label', 'Now'));
    overlay.append(marker);
  }
  overlay.append(el('div', 'pcc-selection'));

  timelineEl.replaceChildren(grid, header, boundaryRow, rows, overlay);
  const focus = state.focusBoundary;
  if (focus === null) {
    renderDetails(items.filter((item) => !isInvalid(item) && !isPartial(item, view)), 'fully within the window');
  } else {
    renderDetails(
      items.filter((item) => item.start?.getTime() === focus || item.end?.getTime() === focus),
      `starting or ending ${formatBoundaryEastern(focus)}`,
    );
  }
}

function isInvalid(item) {
  return Boolean(item.start && item.end && item.end < item.start);
}

/** Matches the dimmed (arrowed) bars: open-ended or extending past the view. */
function isPartial(item, view) {
  return !item.start || !item.end
    || item.start.getTime() < view.start || item.end.getTime() > view.end;
}

function formatEt(value) {
  const s = String(value ?? '').trim();
  return !s || s === '—' ? '—' : formatInstantInEastern(s);
}

function appendCells(tr, values) {
  values.forEach((value) => {
    if (value instanceof HTMLTableCellElement) {
      tr.append(value);
      return;
    }
    const td = el('td');
    if (value instanceof Node) td.append(value); else td.textContent = value;
    tr.append(td);
  });
}

function amountOff(regular, sale) {
  const r = parseFloat(String(regular).replace(/[^0-9.]/g, ''));
  const s = parseFloat(String(sale).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(r) || !Number.isFinite(s) || r <= 0) return '';
  return `$${(r - s).toFixed(2)} (${Math.round(((r - s) / r) * 100)}%)`;
}

function fetchProductionUrl(url) {
  const request = productionRequestQueue.then(async () => {
    const delay = Math.max(0, PRODUCTION_REQUEST_INTERVAL - (Date.now() - lastProductionRequestAt));
    if (delay) {
      await new Promise((resolve) => {
        setTimeout(resolve, delay);
      });
    }
    lastProductionRequestAt = Date.now();
    return fetch(`${CORS_PROXY}${encodeURIComponent(url)}${CORS_KEY}`, { cache: 'no-store' });
  });
  productionRequestQueue = request.then(() => undefined, () => undefined);
  return request;
}

function loadProductionIndex(locale, category) {
  const key = `${locale}:${category}`;
  if (!state.productionIndexes.has(key)) {
    const folder = category === 'commercial' ? 'commercial/' : '';
    const url = `${STOREFRONT_ORIGIN}/${locale}/products/${folder}index.json?include=all`;
    const request = fetchProductionUrl(url).then(async (resp) => {
      if (!resp.ok) throw new Error(`Index HTTP ${resp.status}`);
      const json = await resp.json();
      const rows = Array.isArray(json) ? json : json?.data;
      if (!Array.isArray(rows)) throw new Error('Invalid product index response');
      return rows;
    });
    state.productionIndexes.set(key, request);
  }
  return state.productionIndexes.get(key);
}

function loadProductionProduct(path) {
  if (!state.productionProducts.has(path)) {
    const request = fetchProductionUrl(`${STOREFRONT_ORIGIN}${path}`).then(async (resp) => {
      if (!resp.ok) throw new Error(`PDP HTTP ${resp.status}`);
      return resp.text();
    });
    state.productionProducts.set(path, request);
  }
  return state.productionProducts.get(path);
}

function productIndexMatch(rows, path, sku) {
  const matchesPath = (row) => {
    try {
      return new URL(row.url, STOREFRONT_ORIGIN).pathname.replace(/\/$/, '') === path.replace(/\/$/, '');
    } catch {
      return false;
    }
  };
  return rows.find((row) => String(row.sku || '') === String(sku || '') && matchesPath(row))
    || rows.find(matchesPath);
}

function jsonLdProduct(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const scripts = [...doc.querySelectorAll('script[type="application/ld+json"]')];
  const products = scripts.flatMap((script) => {
    try {
      const data = JSON.parse(script.textContent);
      const values = Array.isArray(data) ? data : [data];
      return values.flatMap((entry) => entry?.['@graph'] || [entry]);
    } catch {
      return [];
    }
  });
  return products.find((entry) => {
    const type = entry?.['@type'];
    return type === 'Product' || (Array.isArray(type) && type.includes('Product'));
  });
}

function productJsonLdPrice(product, sku) {
  const offers = Array.isArray(product?.offers)
    ? product.offers
    : [product?.offers].filter(Boolean);
  const offer = offers.find((entry) => String(entry.sku || '') === String(sku || ''))
    || (offers.length === 1 ? offers[0] : null)
    || (!sku ? offers[0] : null);
  return offer ? { value: offer.price, currency: offer.priceCurrency } : null;
}

function formatProductionPrice(value) {
  if (value == null || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toFixed(2)
    : String(value);
}

function priceCents(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '—') return null;
  const number = Number(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function markCheckedPrice(cell, current, row) {
  cell.classList.remove('pcc-price-match-sale', 'pcc-price-mismatch');
  const cents = priceCents(current);
  if (cents === null) return;
  if (cents === priceCents(row.dataset.salePrice)) {
    cell.classList.add('pcc-price-match-sale');
  } else if (cents !== priceCents(row.dataset.regularPrice)) {
    cell.classList.add('pcc-price-mismatch');
  }
}

async function validateCommerceCard(item, card, button) {
  card.classList.add('pcc-production-validated');
  button.disabled = true;
  button.textContent = 'Validating…';
  const rows = [...card.querySelectorAll('tbody tr[data-product-path]')];
  const jobs = rows.map(async (row) => {
    const { productPath: path, sku } = row.dataset;
    const indexCell = row.querySelector('.pcc-current-index-price');
    const pdpCell = row.querySelector('.pcc-current-pdp-price');
    try {
      const segments = path.split('/').filter(Boolean);
      const locale = segments.slice(0, 2).join('/');
      const category = segments[2] === 'products' && segments[3] === 'commercial'
        ? 'commercial'
        : 'products';
      const indexRows = await loadProductionIndex(locale, category);
      const indexProduct = productIndexMatch(indexRows, path, sku);
      indexCell.textContent = indexProduct
        ? formatProductionPrice(
          indexProduct.price ?? indexProduct.regularPrice,
        )
        : 'Not in index';
      if (!indexProduct) indexCell.classList.add('pcc-check-error');
      else markCheckedPrice(indexCell, indexProduct.price ?? indexProduct.regularPrice, row);

      const html = await loadProductionProduct(path);
      const product = jsonLdProduct(html);
      const pdpPrice = productJsonLdPrice(product, sku);
      pdpCell.textContent = pdpPrice
        ? formatProductionPrice(pdpPrice.value)
        : 'No matching JSON-LD offer';
      if (!pdpPrice) pdpCell.classList.add('pcc-check-error');
      else markCheckedPrice(pdpCell, pdpPrice.value, row);
    } catch (error) {
      indexCell.textContent ||= error.message;
      pdpCell.textContent ||= error.message;
      indexCell.classList.add('pcc-check-error');
      pdpCell.classList.add('pcc-check-error');
    }
  });
  await Promise.all(jobs);
  button.textContent = 'Validated production';
  button.disabled = false;
}

function renderCommerceDetail(item) {
  const body = el('div', 'pcc-detail-body');
  const lines = item.rules.flatMap(catalogRuleToPromotionRows)
    .map((row) => ({ ...row, path: productUrlToCatalogPath(row.product) || row.product }))
    .sort((a, b) => a.path.localeCompare(b.path) || String(a.sku || '').localeCompare(String(b.sku || '')));
  const products = new Set(lines.map((l) => l.path)).size;
  const minSubtotal = promotionMinimumSubtotal(item.promo);
  body.append(el('p', 'pcc-detail-meta', [
    `ID: ${item.promo.id}`,
    `${products} products`,
    `${lines.length} sale lines`,
    minSubtotal ? `Minimum cart: $${minSubtotal}` : '',
  ].filter(Boolean).join(' · ')));

  const table = el('table', 'pcc-detail-table');
  const headRow = el('tr');
  [
    'Product', 'Variant SKU', 'Regular', 'Sale', 'Current PLP price',
    'Current PDP price', 'Off', 'Start (ET)', 'End (ET)',
  ].forEach((h) => {
    const isProductionPrice = h === 'Current PLP price' || h === 'Current PDP price';
    const th = el('th', isProductionPrice ? 'pcc-production-price-column' : '');
    if (isProductionPrice) {
      th.append(el('span', '', 'Current'), document.createElement('br'), document.createTextNode(h.slice(8)));
    } else {
      th.textContent = h;
    }
    th.scope = 'col';
    headRow.append(th);
  });
  table.append(el('thead'));
  table.tHead.append(headRow);
  const tbody = el('tbody');
  lines.forEach((line) => {
    const tr = el('tr');
    tr.dataset.productPath = line.path;
    tr.dataset.sku = line.sku || '';
    tr.dataset.salePrice = line.salePrice;
    tr.dataset.regularPrice = line.regularPrice;
    const link = el('a', '', line.path);
    link.href = line.product;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    appendCells(tr, [
      link,
      line.sku || '',
      line.regularPrice,
      line.salePrice,
      el('td', 'pcc-current-index-price pcc-production-price-column', 'Not checked'),
      el('td', 'pcc-current-pdp-price pcc-production-price-column', 'Not checked'),
      amountOff(line.regularPrice, line.salePrice),
      formatEt(line.start),
      formatEt(line.end),
    ]);
    tbody.append(tr);
  });
  table.append(tbody);
  const scroll = el('div', 'pcc-detail-scroll');
  scroll.append(table);
  body.append(scroll);
  return body;
}

function fillPageCheckCells(result, statusCell, modifiedCell) {
  if (result.error) {
    statusCell.textContent = result.error;
    statusCell.className = 'pcc-check-error';
    return;
  }
  statusCell.textContent = String(result.status);
  statusCell.className = result.status === 200 ? 'pcc-check-ok' : 'pcc-check-error';
  const modified = result.status === 200 && result.lastModified
    ? new Date(result.lastModified)
    : null;
  if (modified && !Number.isNaN(modified.getTime())) {
    modifiedCell.textContent = `${formatDuration(Math.max(0, Date.now() - modified))} ago`;
    modifiedCell.title = formatInstantInEastern(modified.toISOString());
  } else {
    modifiedCell.textContent = '—';
  }
}

function contentLink(path) {
  const link = el('a', '', path);
  link.href = `${CONTENT_ORIGIN}${path}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function scheduledPagesForLocale(item) {
  return [...new Set(state.scheduledPages.filter((url) => url.startsWith(`/${item.where}/`)))];
}

/** Promotion page paths per `checkSchedule()` on main. */
function renderPromoScheduleDetail(item) {
  const body = el('div', 'pcc-detail-body');
  if (!item.promotion) {
    body.append(el('p', 'pcc-detail-meta', 'No promotion name in this schedule row.'));
    return body;
  }
  const promotionBase = `/${item.where}/promotions/${item.promotion}`;
  const pages = scheduledPagesForLocale(item);
  body.append(el('p', 'pcc-detail-meta', `${pages.length} pages with schedule = promo-schedule in ${item.where}`));
  if (!pages.length) return body;

  const table = el('table', 'pcc-detail-table');
  table.append(el('thead'));
  const headRow = el('tr');
  ['Page', 'Promotion page', 'Status', 'Last modified', ''].forEach((h, index) => {
    const actionColumn = index === 4;
    const th = el('th', actionColumn ? 'pcc-production-action-cell' : '', h);
    th.scope = 'col';
    if (actionColumn) th.setAttribute('aria-label', 'Production validation action');
    headRow.append(th);
  });
  table.tHead.append(headRow);
  const tbody = el('tbody');
  pages.forEach((page) => {
    const pagePath = page.split('/').filter(Boolean).slice(2).join('/');
    const promoPath = pagePath ? `${promotionBase}/${pagePath}` : `${promotionBase}/`;
    const statusCell = el('td', '', 'checking…');
    const modifiedCell = el('td', '', '');
    const tr = el('tr');
    appendCells(tr, [contentLink(page), contentLink(promoPath)]);
    tr.append(statusCell, modifiedCell);
    const actionCell = el('td', 'pcc-production-action-cell');
    const actionButton = el('button', 'pcc-validate-production pcc-row-production-action', 'Validate production');
    actionButton.type = 'button';
    actionButton.addEventListener('click', () => {
      window.open(`${STOREFRONT_ORIGIN}${page}`, '_blank', 'noopener,noreferrer');
    });
    actionCell.append(actionButton);
    tr.append(actionCell);
    tbody.append(tr);

    if (!state.pageChecks.has(promoPath)) {
      state.pageChecks.set(promoPath, checkPage(promoPath).catch((e) => ({ error: e.message })));
    }
    state.pageChecks.get(promoPath)
      .then((result) => fillPageCheckCells(result, statusCell, modifiedCell));
  });
  table.append(tbody);
  const scroll = el('div', 'pcc-detail-scroll');
  scroll.append(table);
  body.append(scroll);
  return body;
}

const DETAIL_RENDERERS = {
  commerce: renderCommerceDetail,
  'promo-schedule': renderPromoScheduleDetail,
};

function renderProductionAction(item, card) {
  const button = el('button', 'pcc-validate-production', 'Validate production');
  button.type = 'button';
  if (item.source === 'commerce') {
    button.addEventListener('click', () => validateCommerceCard(item, card, button));
  } else {
    button.addEventListener('click', () => {
      window.open(`${STOREFRONT_ORIGIN}/${item.where}/`, '_blank', 'noopener,noreferrer');
    });
  }
  return button;
}

function editTargetForItem(item) {
  if (item.source === 'commerce') {
    const params = new URLSearchParams({ market: item.market, id: item.promo.id });
    return `../promotions.html?${params}`;
  }
  if (item.source === 'nav-banners') {
    return `https://da.live/edit#/aemsites/vitamix/${item.where}/nav/nav-banners`;
  }
  const paths = {
    'promo-schedule': '/promotions/promo-schedule',
    'free-gifts': '/products/config/free-gifts',
  };
  return `https://da.live/sheet#/aemsites/vitamix/${item.where}${paths[item.source]}`;
}

function renderEditAction(item) {
  const button = el('button', 'pcc-edit-detail', 'Edit');
  button.type = 'button';
  button.addEventListener('click', () => {
    window.open(editTargetForItem(item), '_blank', 'noopener,noreferrer');
  });
  return button;
}

function renderDetails(items, scope) {
  const heading = el('h2', '', `Details (${items.length} ${scope})`);
  const cards = items.map((item) => {
    const card = el('article', `pcc-detail pcc-detail-${item.source}`);
    card.dataset.itemId = scheduleItemId(item);
    card.tabIndex = -1;
    const head = el('header', 'pcc-detail-head');
    const swatch = el('span', 'pcc-swatch');
    const source = SOURCES.find((s) => s.key === item.source);
    swatch.style.background = source.color;
    head.append(
      renderEditAction(item),
      swatch,
      el('span', 'pcc-where', `${source.label} · ${item.where.toUpperCase()}`),
      el('h3', '', item.label),
    );
    if (item.source !== 'promo-schedule') head.append(renderProductionAction(item, card));
    const startText = item.start ? formatEt(item.start.toISOString()) : 'open';
    const endText = item.end ? formatEt(item.end.toISOString()) : 'open';
    const dur = item.start && item.end ? ` (${formatDuration(item.end - item.start)})` : '';
    const span = `${startText} → ${endText}${dur}`;
    card.append(head, el('p', 'pcc-detail-when', span));
    const renderer = DETAIL_RENDERERS[item.source];
    if (renderer) card.append(renderer(item));
    else if (item.detail) card.append(el('p', 'pcc-detail-meta', item.detail));
    return card;
  });
  if (!cards.length) cards.push(el('p', 'pcc-empty-details', `No schedules ${scope}.`));
  detailsEl.replaceChildren(heading, ...cards);
}

function renderStatus() {
  const rank = (key) => {
    const [source, where = ''] = key.split(':');
    return [SOURCES.findIndex((s) => s.key === source), localeRank(where)];
  };
  const entries = [...state.status.entries()].sort(([a], [b]) => {
    const [sa, la] = rank(a);
    const [sb, lb] = rank(b);
    return sa - sb || la - lb;
  });
  statusList.replaceChildren(...entries.map(([key, { text, error }]) => {
    const li = el('li', error ? 'pcc-status-error' : '');
    const swatch = el('span', 'pcc-swatch');
    swatch.style.background = SOURCES.find((s) => key.startsWith(s.key)).color;
    li.append(swatch, el('span', '', text));
    return li;
  }));
}

function renderFilters() {
  const build = (container, list, set, withColor) => {
    list.forEach((entry) => {
      const label = el('label', 'pcc-filter');
      const input = el('input');
      input.type = 'checkbox';
      input.checked = set.has(entry.key);
      input.addEventListener('change', () => {
        if (input.checked) set.add(entry.key); else set.delete(entry.key);
        renderTimeline();
      });
      label.append(input);
      if (withColor) {
        const swatch = el('span', 'pcc-swatch');
        swatch.style.background = entry.color;
        label.append(swatch);
      }
      label.append(el('span', '', entry.label));
      container.append(label);
    });
  };
  build(document.querySelector('#pcc-source-filters'), SOURCES, state.sources, true);
  build(document.querySelector('#pcc-market-filters'), MARKETS, state.markets, false);
}

/* ---------- zoom ---------- */

function setView(start, end, pushHistory = true) {
  let s = start;
  let e = end;
  if (e - s < MIN_ZOOM_MS) {
    const mid = (s + e) / 2;
    s = mid - MIN_ZOOM_MS / 2;
    e = mid + MIN_ZOOM_MS / 2;
  }
  if (pushHistory) state.history.push(state.view);
  state.view = { start: Math.round(s), end: Math.round(e) };
  renderTimeline();
  syncUrl();
}

function toIso(ms) {
  return new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
}

/** Reads `from`, `to` (view) and `at` (selected boundary) ISO query params. */
function applyUrlState() {
  const params = new URLSearchParams(window.location.search);
  const from = Date.parse(params.get('from') || '');
  const to = Date.parse(params.get('to') || '');
  const at = Date.parse(params.get('at') || '');
  state.view = Number.isFinite(from) && Number.isFinite(to) && to > from
    ? { start: from, end: to }
    : defaultView();
  state.focusBoundary = Number.isFinite(at) ? at : null;
}

function syncUrl(replace = false) {
  const url = new URL(window.location.href);
  url.searchParams.set('from', toIso(state.view.start));
  url.searchParams.set('to', toIso(state.view.end));
  if (state.focusBoundary === null) url.searchParams.delete('at');
  else url.searchParams.set('at', toIso(state.focusBoundary));
  if (url.href === window.location.href) return;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
}

let drag = null;

function plotRect() {
  return timelineEl.querySelector('.pcc-overlay').getBoundingClientRect();
}

function xToMs(x, rect) {
  const ratio = Math.min(1, Math.max(0, (x - rect.left) / rect.width));
  return state.view.start + ratio * (state.view.end - state.view.start);
}

function scrollToItemDetail(x, y) {
  const bar = document.elementFromPoint(x, y)?.closest('.pcc-bar');
  const itemId = bar?.closest('.pcc-row')?.dataset.itemId;
  if (!itemId) return;
  const card = detailsEl.querySelector(`[data-item-id="${itemId}"]`);
  if (!card) return;
  card.classList.add('pcc-detail-target');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.focus({ preventScroll: true });
  setTimeout(() => card.classList.remove('pcc-detail-target'), 1400);
}

timelineEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.pcc-boundary-label')) return;
  if (e.button !== 0) return;
  const rect = plotRect();
  if (e.clientX < rect.left || e.clientX > rect.right) return;
  drag = { x0: e.clientX, rect };
  timelineEl.setPointerCapture(e.pointerId);
  timelineEl.classList.add('pcc-dragging');
  e.preventDefault();
});

timelineEl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const { rect } = drag;
  const a = Math.min(Math.max(Math.min(drag.x0, e.clientX), rect.left), rect.right);
  const b = Math.min(Math.max(Math.max(drag.x0, e.clientX), rect.left), rect.right);
  const selection = timelineEl.querySelector('.pcc-selection');
  selection.style.display = 'block';
  selection.style.left = `${a - rect.left}px`;
  selection.style.width = `${b - a}px`;
  selection.textContent = `${formatRangeDate(xToMs(a, rect))} – ${formatRangeDate(xToMs(b, rect))}`;
});

function endDrag(e, apply) {
  if (!drag) return;
  const { x0, rect } = drag;
  drag = null;
  timelineEl.classList.remove('pcc-dragging');
  const selection = timelineEl.querySelector('.pcc-selection');
  if (selection) selection.style.display = 'none';
  if (apply && Math.abs(e.clientX - x0) >= 6) {
    const a = xToMs(Math.min(x0, e.clientX), rect);
    const b = xToMs(Math.max(x0, e.clientX), rect);
    setView(a, b);
  } else if (apply) {
    scrollToItemDetail(e.clientX, e.clientY);
  }
}

timelineEl.addEventListener('pointerup', (e) => endDrag(e, true));
timelineEl.addEventListener('pointercancel', (e) => endDrag(e, false));

backButton.addEventListener('click', () => {
  const prev = state.history.pop();
  if (prev) setView(prev.start, prev.end, false);
});

document.querySelector('#pcc-zoom-out').addEventListener('click', () => {
  const { start, end } = state.view;
  const half = end - start;
  setView(start - half / 2, end + half / 2);
});

document.querySelector('#pcc-zoom-reset').addEventListener('click', () => {
  state.history = [];
  const { start, end } = defaultView();
  setView(start, end, false);
});

document.querySelector('#pcc-reload').addEventListener('click', loadAll);

let resizeFrame = 0;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.focusBoundary !== null) {
    state.focusBoundary = null;
    renderTimeline();
    syncUrl();
  }
});
window.addEventListener('popstate', () => {
  applyUrlState();
  renderTimeline();
});
// Boundary labels are laid out in px, so re-render when the width changes (incl. hidden -> shown).
let lastTimelineWidth = timelineEl.clientWidth;
new ResizeObserver(() => {
  const width = timelineEl.clientWidth;
  if (width === lastTimelineWidth) return;
  lastTimelineWidth = width;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(renderTimeline);
}).observe(timelineEl);

document.querySelector('#pcc-content-host').textContent = new URL(CONTENT_ORIGIN).host;
renderFilters();
applyUrlState();
loadAll();
