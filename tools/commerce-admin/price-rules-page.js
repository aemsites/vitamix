/**
 * Cart rules + catalog promotions UI. Shapes follow **helix-commerce-api**
 * (`price-rules/catalog` → `{ promotions }`, `price-rules/cart` → JSON array).
 * Data comes only from ProductBus; failed loads show errors and empty lists.
 */
import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';
import { createDetailModalHeaderCloseAndJson } from './commerce-detail-modal-json.js';
import { mountPromoteProductionInToolbar } from './commerce-promote-production.js';
import { PB_ORG, PB_SITE } from './commerce-pbus-config.js';
import {
  catalogPathToProductUrl,
  catalogPriceStringForApi,
  catalogRulesForCountryTab,
  catalogTimestampStringForApi,
  catalogRuleToPromotionRow,
  countryKeyFromCatalogPath,
  fetchCartPriceRules,
  fetchCatalogPriceRules,
  promotionCatalogGroup,
  productUrlToCatalogPath,
  putCartPriceRules,
  putCatalogPriceRules,
} from './price-rules-api.js';
import {
  commerceGroupBadgeHtml,
  commerceMarketEmojiHtml,
  escapeHtml,
  showToast,
} from './commerce-otp-ui.js';
import {
  fetchProductsIndexForLocale,
  getParentProducts,
  getUrlKeyFromProduct,
  resolveImageUrlForLocale,
} from './pim.js';

/** @return {'both' | 'cart-rules' | 'promotions'} */
function getPrAppMode() {
  const raw = document.body?.getAttribute('data-pr-app')?.trim().toLowerCase() ?? '';
  if (raw === 'cart-rules' || raw === 'rules') return 'cart-rules';
  if (raw === 'promotions' || raw === 'promotion') return 'promotions';
  if (raw === 'both') return 'both';
  return 'both';
}

const PR_APP_MODE = getPrAppMode();

/** IANA timezone used for all date display and date-picker values. */
const ET_TIMEZONE = 'America/New_York';

/** @typedef {object} RuleRow
 * @property {string} name
 * @property {string} [id] helix rule id when loaded from API (empty for new rows)
 * @property {string} minimumValue
 * @property {string} salesAmountOff
 * @property {string} freeShipping
 * @property {string} products
 * @property {string} categories
 */
/** @typedef {object} PromotionRow
 * @property {string} start canonical UTC instant for API (or empty)
 * @property {string} end
 * @property {string} product
 * @property {string} regularPrice
 * @property {string} salePrice
 * @property {string} [startSourceText] original spreadsheet cell (shown until edited)
 * @property {string} [endSourceText]
 */
/** @typedef {object} PromotionSet
 * @property {string} id
 * @property {string} title
 * @property {PromotionRow[]} rows
 */

const COUNTRIES = /** @type {const} */ (['us', 'ca', 'mx']);

/** Display names for market tabs (no embedded pricing data). */
const COUNTRY_LABELS = /** @type {Record<(typeof COUNTRIES)[number], string>} */ ({
  us: 'United States',
  ca: 'Canada',
  mx: 'Mexico',
});

/** @param {string} ck */
function marketLabel(ck) {
  const k = String(ck || '').toLowerCase();
  if (COUNTRIES.includes(/** @type {(typeof COUNTRIES)[number]} */(k))) {
    return COUNTRY_LABELS[/** @type {(typeof COUNTRIES)[number]} */ (k)];
  }
  return k ? k.toUpperCase() : '';
}
const AREAS = /** @type {const} */ (['rules', 'promotions']);

/**
 * @type {{
 *   country: (typeof COUNTRIES)[number],
 *   area: (typeof AREAS)[number],
 *   promoListSearch: string,
 *   promoListGroupFilter: string,
 *   cartRuleSearch: string,
 *   catalogPromotions: import('./price-rules-api.js').CatalogPromotion[],
 *   catalogDataSource: 'api'|'unavailable',
 *   catalogLoadError: string,
 *   cartRulesList: import('./price-rules-api.js').HelixCartPriceRule[]|null,
 *   cartDataSource: 'api'|'unavailable',
 *   cartLoadError: string,
 * }}
 */
const state = {
  country: 'us',
  area: PR_APP_MODE === 'promotions' ? 'promotions' : 'rules',
  promoListSearch: '',
  promoListGroupFilter: '',
  cartRuleSearch: '',
  /** @type {import('./price-rules-api.js').CatalogPromotion[]} */
  catalogPromotions: [],
  /** @type {'api'|'unavailable'} */
  catalogDataSource: 'unavailable',
  catalogLoadError: '',
  /** @type {import('./price-rules-api.js').HelixCartPriceRule[] | null} */
  cartRulesList: null,
  /** @type {'api'|'unavailable'} */
  cartDataSource: 'unavailable',
  cartLoadError: '',
};

/**
 * Market tab from helix `country` on the cart rule (defaults to US when missing or unknown).
 *
 * @param {import('./price-rules-api.js').HelixCartPriceRule} rule
 * @returns {(typeof COUNTRIES)[number]}
 */
function cartRuleMarketFromRule(rule) {
  const c = rule && typeof rule.country === 'string' ? rule.country.trim().toLowerCase() : '';
  if (/^[a-z]{2}$/.test(c) && COUNTRIES.includes(/** @type {(typeof COUNTRIES)[number]} */ (c))) {
    return /** @type {(typeof COUNTRIES)[number]} */ (c);
  }
  return 'us';
}

/** @param {string} ck */
function rulesForCountryApi(ck) {
  if (state.cartDataSource !== 'api' || !Array.isArray(state.cartRulesList)) return [];
  return state.cartRulesList.filter((r) => cartRuleMarketFromRule(r) === ck);
}

/**
 * @param {import('./price-rules-api.js').HelixCartPriceRule} rule
 * @returns {RuleRow}
 */
function helixCartRuleToRuleRow(rule) {
  const c = rule.conditions && typeof rule.conditions === 'object' ? rule.conditions : {};
  const a = rule.actions && typeof rule.actions === 'object' ? rule.actions : {};
  const minRaw = c.minimumSubtotal;
  const minimumValue = minRaw != null && Number.isFinite(Number(minRaw)) && Number(minRaw) > 0
    ? String(minRaw)
    : '';
  let salesAmountOff = '';
  if (a.percentOff != null && Number.isFinite(Number(a.percentOff))) {
    salesAmountOff = `${a.percentOff}%`;
  } else if (a.fixedOff != null && Number.isFinite(Number(a.fixedOff))) {
    salesAmountOff = `$${a.fixedOff}`;
  }
  const freeShipping = a.freeShipping === true ? 'Yes' : 'No';
  const products = Array.isArray(c.products) ? c.products.join(', ') : '';
  const categories = Array.isArray(c.categories) ? c.categories.join(', ') : '';
  const hid = rule.id != null ? String(rule.id).trim() : '';
  return {
    id: hid,
    name: String(rule.name || ''),
    minimumValue,
    salesAmountOff,
    freeShipping,
    products,
    categories,
  };
}

function nextCartRulePriority(existing) {
  const ps = existing.map((r) => {
    const p = typeof r.priority === 'number' && Number.isFinite(r.priority) ? r.priority : 0;
    return Math.floor(p);
  });
  return (ps.length ? Math.max(0, ...ps) : 0) + 1;
}

/**
 * @param {string} slug
 * @param {import('./price-rules-api.js').HelixCartPriceRule[]} existing
 */
function uniqueCartRuleId(slug, existing) {
  const id = slug;
  const used = new Set(existing.map((r) => String(r.id || '')));
  if (!used.has(id)) return id;
  let n = 2;
  while (used.has(`${id}-${n}`)) n += 1;
  return `${id}-${n}`;
}

/**
 * @param {string} market
 * @param {RuleRow} row
 * @param {import('./price-rules-api.js').HelixCartPriceRule[]} existingRules
 * @param {import('./price-rules-api.js').HelixCartPriceRule | null} [preserveFrom]
 *   when set, keep id, priority, stackable, incompatibleTypes
 * @returns {import('./price-rules-api.js').HelixCartPriceRule}
 */
function ruleRowToHelixCartRule(market, row, existingRules, preserveFrom = null) {
  const slug = ruleSlugFromName(row.name);
  const id = preserveFrom?.id
    ? String(preserveFrom.id)
    : uniqueCartRuleId(slug, existingRules);
  const priority = preserveFrom != null
    && typeof preserveFrom.priority === 'number'
    && Number.isFinite(preserveFrom.priority)
    ? Math.floor(preserveFrom.priority)
    : nextCartRulePriority(existingRules);

  const minRaw = String(row.minimumValue ?? '').trim();
  const minNum = minRaw === '' ? 0 : Number(minRaw);
  const minimumSubtotal = Number.isFinite(minNum) && minNum >= 0 ? minNum : 0;

  const products = String(row.products ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const categories = String(row.categories ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  /** @type {import('./price-rules-api.js').HelixCartPriceRule['conditions']} */
  const conditions = { minimumSubtotal };
  if (products.length) conditions.products = products;
  if (categories.length) conditions.categories = categories;

  const offRaw = String(row.salesAmountOff ?? '').trim();
  let percentVal = NaN;
  let fixedVal = NaN;
  if (offRaw) {
    const pm = offRaw.match(/^(\d+(?:\.\d+)?)\s*%$/);
    if (pm) percentVal = Number(pm[1]);
    else if (offRaw.startsWith('$')) {
      const fm = offRaw.match(/\$?\s*(\d+(?:\.\d+)?)/);
      if (fm) fixedVal = Number(fm[1]);
    } else {
      const n = Number(offRaw);
      if (Number.isFinite(n)) percentVal = n;
    }
  }
  const hasPct = Number.isFinite(percentVal);
  const hasFixed = Number.isFinite(fixedVal);
  const fs = /^yes$/i.test(String(row.freeShipping || '').trim());

  /** @type {import('./price-rules-api.js').HelixCartPriceRule['actions']} */
  let actions;
  if (fs && hasPct) {
    actions = { percentOff: percentVal, fixedOff: null, freeShipping: true };
  } else if (fs && hasFixed) {
    actions = { percentOff: null, fixedOff: fixedVal, freeShipping: true };
  } else if (fs) {
    actions = { freeShipping: true };
  } else if (hasPct) {
    actions = { percentOff: percentVal };
  } else if (hasFixed) {
    actions = { fixedOff: fixedVal };
  } else {
    actions = { freeShipping: false };
  }

  /** @type {import('./price-rules-api.js').HelixCartPriceRule} */
  const out = {
    id,
    name: row.name,
    priority,
    conditions,
    actions,
    country: market,
  };
  if (preserveFrom) {
    if (typeof preserveFrom.stackable === 'boolean') out.stackable = preserveFrom.stackable;
    if (Array.isArray(preserveFrom.incompatibleTypes)) {
      out.incompatibleTypes = [...preserveFrom.incompatibleTypes];
    }
    if (typeof preserveFrom.locale === 'string' && preserveFrom.locale.trim()) {
      out.locale = preserveFrom.locale.trim();
    }
  }
  return out;
}

/** @param {string} ck */
function rulesForCountry(ck) {
  if (state.cartDataSource === 'api' && Array.isArray(state.cartRulesList)) {
    return rulesForCountryApi(ck).map(helixCartRuleToRuleRow);
  }
  return [];
}

function promotionsListSource() {
  return state.catalogPromotions;
}

async function loadCatalogFromApi() {
  try {
    const doc = await fetchCatalogPriceRules(PB_ORG, PB_SITE);
    state.catalogPromotions = Array.isArray(doc.promotions) ? doc.promotions : [];
    state.catalogDataSource = 'api';
    state.catalogLoadError = '';
  } catch (err) {
    state.catalogPromotions = [];
    state.catalogDataSource = 'unavailable';
    state.catalogLoadError = err?.message || String(err);
  }
}

async function loadCartFromApi() {
  try {
    const doc = await fetchCartPriceRules(PB_ORG, PB_SITE);
    state.cartRulesList = Array.isArray(doc.rules) ? doc.rules : [];
    state.cartDataSource = 'api';
    state.cartLoadError = '';
  } catch (err) {
    state.cartRulesList = null;
    state.cartDataSource = 'unavailable';
    state.cartLoadError = err?.message || String(err);
  }
}

/**
 * Refreshes catalog promotions from the server only. Used before add/edit/delete.
 *
 * @returns {Promise<boolean>}
 */
async function fetchCatalogFromServerOrNotify() {
  try {
    const doc = await fetchCatalogPriceRules(PB_ORG, PB_SITE);
    state.catalogPromotions = Array.isArray(doc.promotions) ? doc.promotions : [];
    state.catalogDataSource = 'api';
    state.catalogLoadError = '';
    return true;
  } catch (err) {
    const msg = err?.message || String(err);
    state.catalogLoadError = msg;
    showToast(`Could not load catalog promotions from the server: ${msg}`, 'error');
    render();
    return false;
  }
}

/**
 * Refreshes cart rules from the server only. Used before adding a rule.
 *
 * @returns {Promise<boolean>}
 */
async function fetchCartRulesFromServerOrNotify() {
  try {
    const doc = await fetchCartPriceRules(PB_ORG, PB_SITE);
    state.cartRulesList = Array.isArray(doc.rules) ? doc.rules : [];
    state.cartDataSource = 'api';
    state.cartLoadError = '';
    return true;
  } catch (err) {
    const msg = err?.message || String(err);
    state.cartLoadError = msg;
    showToast(`Could not load cart rules from the server: ${msg}`, 'error');
    render();
    return false;
  }
}

/**
 * Refresh from server, remove one rule by id, PUT the rest.
 *
 * @param {string} ruleId
 * @returns {Promise<boolean>} true if deleted and saved
 */
async function deleteCartRuleById(ruleId) {
  const ok = await fetchCartRulesFromServerOrNotify();
  if (!ok) return false;
  const fresh = Array.isArray(state.cartRulesList) ? state.cartRulesList : [];
  const next = fresh.filter((r) => String(r.id) !== String(ruleId));
  if (next.length === fresh.length) {
    showToast('Rule not found after refresh.', 'error');
    render();
    return false;
  }
  try {
    await putCartPriceRules(PB_ORG, PB_SITE, next);
    state.cartRulesList = next;
    state.cartDataSource = 'api';
    state.cartLoadError = '';
    showToast('Cart rule deleted', 'success');
    return true;
  } catch (err) {
    showToast(err?.message || 'Delete failed', 'error');
    return false;
  }
}

/**
 * @param {string} slug
 * @param {import('./price-rules-api.js').CatalogPromotion[]} promotions
 */
function uniquePromotionId(slug, promotions) {
  const id = slug;
  const used = new Set(promotions.map((p) => String(p.id || '')));
  if (!used.has(id)) return id;
  let n = 2;
  while (used.has(`${id}-${n}`)) n += 1;
  return `${id}-${n}`;
}

/**
 * US-style spreadsheet datetimes (e.g. <code>4/9/2026 12am</code>) → ISO 8601 for helix.
 * Passes through values that already look like ISO datetimes.
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeDateForCatalogApi(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  /** @type {string} */
  let candidate = s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    candidate = `${s}T00:00:00Z`;
  } else if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const us = parseUsSpreadsheetDateTime(s);
    candidate = us || s;
  }
  const out = catalogTimestampStringForApi(candidate);
  return out;
}

/**
 * Convert Eastern civil time components → UTC `Date`.
 * Tries both EST (−05:00) and EDT (−04:00) offsets and picks the one whose round-trip
 * through `America/New_York` matches the original components (handles DST transitions correctly).
 *
 * @param {number} year
 * @param {number} mo   1-based month
 * @param {number} day
 * @param {number} h
 * @param {number} mi
 * @param {number} sec
 * @returns {Date}
 */
function easternCivilToUtc(year, mo, day, h, mi, sec) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const base = `${pad(year, 4)}-${pad(mo)}-${pad(day)}T${pad(h)}:${pad(mi)}:${pad(sec)}`;
  const etFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const get = (parts, type) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  const match = ['-04:00', '-05:00'].map((offset) => {
    const candidate = new Date(`${base}${offset}`);
    if (Number.isNaN(candidate.getTime())) return null;
    const parts = etFmt.formatToParts(candidate);
    if (
      get(parts, 'year') === year && get(parts, 'month') === mo && get(parts, 'day') === day
      && get(parts, 'hour') === h && get(parts, 'minute') === mi && get(parts, 'second') === sec
    ) return candidate;
    return null;
  }).find(Boolean);
  if (match) return match;
  return new Date(`${base}-05:00`); // fallback EST
}

/**
 * Convert a UTC ISO string to the `YYYY-MM-DDTHH:mm` format expected by
 * `<input type="datetime-local">`, expressed in US Eastern time (ET_TIMEZONE).
 *
 * @param {string} iso
 * @returns {string}
 */
function isoToDatetimeLocalValue(iso) {
  const s = String(iso || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/**
 * Parse `<input type="datetime-local">` value as **US Eastern** civil time → UTC ISO for the API.
 *
 * The datetime-local picker shows Eastern time (set via `isoToDatetimeLocalValue`), so we
 * must interpret the `YYYY-MM-DDTHH:mm` value in `America/New_York`, not browser-local time.
 *
 * @param {string} localValue
 * @returns {string}
 */
function datetimeLocalValueToIso(localValue) {
  const v = String(localValue || '').trim();
  if (!v) return '';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const year = Number(m[1]);
    const mo = Number(m[2]);
    const day = Number(m[3]);
    const h = Number(m[4]);
    const mi = Number(m[5]);
    const sec = m[6] !== undefined ? Number(m[6]) : 0;
    const dt = easternCivilToUtc(year, mo, day, h, mi, sec);
    if (Number.isNaN(dt.getTime())) return '';
    return catalogTimestampStringForApi(dt);
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return catalogTimestampStringForApi(d);
}

/** Display a UTC ISO instant in US Eastern time (ET_TIMEZONE). @param {string} iso */
function formatIsoForSaleLineView(iso) {
  const s = String(iso || '').trim();
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('en-US', {
    timeZone: ET_TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/** Numeric string for hidden fields / display (no currency symbol). */
function priceDigitsForUi(raw) {
  const t = String(raw ?? '').trim();
  if (!t || t === '—') return '';
  return catalogPriceStringForApi(raw);
}

/**
 * @param {string} raw path or full URL
 * @returns {string}
 */
function resolveProductUrlForRow(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith('/')) return catalogPathToProductUrl(t);
  return t;
}

/**
 * US spreadsheet `M/D/YYYY` (optional time + am/pm). Interpreted as **US Eastern** civil time,
 * then converted to UTC for the API.
 *
 * @param {string} text
 * @returns {string|null} canonical UTC string or null if not parseable
 */
function parseUsSpreadsheetDateTime(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(.*)$/i);
  if (!m) return null;
  const month = parseInt(m[1], 10) - 1;
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  const restRaw = String(m[4] || '').trim();
  const restLower = restRaw.toLowerCase();
  const isPm = /pm/.test(restLower);
  const isAm = /am/.test(restLower);
  /** `\b(am|pm)\b` misses `12am` (no boundary between `2` and `a`). Strip letters instead. */
  const rest = restRaw.replace(/(am|pm)/gi, '').replace(/\s+/g, ' ').trim();
  let hh = 0;
  let mi = 0;
  let sec = 0;
  if (rest) {
    const tm = rest.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?$/);
    if (!tm) return null;
    hh = parseInt(tm[1], 10);
    mi = parseInt(tm[2] || '0', 10);
    sec = parseInt(tm[3] || '0', 10);
  }
  /** Inclusive “through 11:59pm” end-of-day in Eastern time. */
  const isEndOfDay1159pm = isPm && /\b11\s*:\s*59\b/i.test(restRaw);
  if (isEndOfDay1159pm) sec = 59;
  if (isPm && hh < 12) hh += 12;
  if (isAm && hh === 12) hh = 0;
  // `month` is 0-based from parseInt above; easternCivilToUtc expects 1-based month.
  const d = easternCivilToUtc(year, month + 1, day, hh, mi, sec);
  if (Number.isNaN(d.getTime())) return null;
  return catalogTimestampStringForApi(d);
}

/** @param {string} line */
function isSaleLinesTsvHeaderLine(line) {
  const s = String(line || '').toLowerCase();
  return /\bstart\b/.test(s) && /\bend\b/.test(s) && /\bproduct\b/.test(s);
}

/** @param {unknown} c */
function cleanSaleLinesTsvCell(c) {
  return String(c ?? '').replace(/^\uFEFF/, '').replace(/\u00a0/g, ' ').trim();
}

/**
 * Tab-separated rows: Start, End, Product, Regular Price, Sale Price (header optional).
 *
 * @param {string} text
 * @returns {PromotionRow[]}
 */
function parseSaleLinesTsv(text) {
  /** @type {PromotionRow[]} */
  const rows = [];
  const rawLines = String(text || '').split(/\r?\n/);
  let startIdx = 0;
  if (rawLines.length && isSaleLinesTsvHeaderLine(rawLines[0])) startIdx = 1;
  rawLines.slice(startIdx).forEach((line) => {
    if (!String(line).trim()) return;
    const cols = line.split('\t');
    if (cols.length < 5) return;
    const startRaw = cleanSaleLinesTsvCell(cols[0]);
    const endRaw = cleanSaleLinesTsvCell(cols[1]);
    const product = cleanSaleLinesTsvCell(cols[2]);
    const regularRaw = cleanSaleLinesTsvCell(cols[3]);
    const salePrice = cleanSaleLinesTsvCell(cols[4]);
    if (!product || !salePrice) return;
    const startNorm = normalizeDateForCatalogApi(startRaw);
    const endNorm = normalizeDateForCatalogApi(endRaw);
    rows.push({
      start: startNorm,
      end: endNorm,
      ...(startRaw ? { startSourceText: startRaw } : {}),
      ...(endRaw ? { endSourceText: endRaw } : {}),
      product,
      regularPrice: regularRaw || '—',
      salePrice,
    });
  });
  return rows;
}

/**
 * String-key map from rule `custom` (helix).
 *
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
function catalogCustomStringMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  Object.entries(raw).forEach(([k, v]) => {
    if (v == null) return;
    out[k] = typeof v === 'string' ? v : String(v);
  });
  return out;
}

/**
 * @param {PromotionRow[]} rows
 * @param {string} group Calendar / grouping label stored on each rule as `custom.group`
 * @param {import('./price-rules-api.js').CatalogPriceRule[] | undefined} [preserveFromRules]
 *   rules for this market before edit — merged by `path` so extra `custom` keys (e.g. `debug`)
 *   and `variants` survive Save
 * @returns {import('./price-rules-api.js').CatalogPriceRule[]}
 */
function promotionRowsToCatalogRules(rows, group, preserveFromRules) {
  const g = String(group || '').trim() || String(new Date().getFullYear());
  /** @type {Map<string, import('./price-rules-api.js').CatalogPriceRule>} */
  const prevByPath = new Map(
    (preserveFromRules || []).filter((r) => r && r.path).map((r) => [String(r.path), r]),
  );
  return rows.map((row) => {
    const path = productUrlToCatalogPath(row.product);
    if (!path) throw new Error('Each sale line needs a valid product URL');
    const price = catalogPriceStringForApi(row.salePrice);
    const prevRule = prevByPath.get(path);
    /** @type {import('./price-rules-api.js').CatalogPriceRule} */
    const rule = { path, price };
    const start = normalizeDateForCatalogApi(String(row.start || '').trim());
    const end = normalizeDateForCatalogApi(String(row.end || '').trim());
    if (start) rule.start = start;
    if (end) rule.end = end;
    const reg = String(row.regularPrice || '').trim();
    const regDigits = reg && reg !== '—' ? catalogPriceStringForApi(reg) : '';
    const custom = { ...catalogCustomStringMap(prevRule?.custom) };
    custom.group = g;
    if (regDigits) custom.regularPrice = regDigits;
    else delete custom.regularPrice;
    rule.custom = custom;

    if (prevRule?.variants && typeof prevRule.variants === 'object' && !Array.isArray(prevRule.variants)) {
      try {
        rule.variants = structuredClone(prevRule.variants);
      } catch {
        rule.variants = /** @type {typeof prevRule.variants} */ ({ ...prevRule.variants });
      }
    }
    return rule;
  }).filter((r) => r.path);
}

/** @param {HTMLDialogElement} dlg */
function readPromotionMarketFromForm(dlg) {
  const v = String(dlg.querySelector('#pr-promo-form-market')?.value ?? '').trim().toLowerCase();
  if (!COUNTRIES.includes(/** @type {(typeof COUNTRIES)[number]} */(v))) {
    throw new Error('Select a valid market');
  }
  return /** @type {(typeof COUNTRIES)[number]} */ (v);
}

/** @param {HTMLDialogElement} dlg */
function promotionDialogMarketSafe(dlg) {
  try {
    return readPromotionMarketFromForm(dlg);
  } catch {
    return /** @type {(typeof COUNTRIES)[number]} */ ('us');
  }
}

/**
 * @param {HTMLDialogElement} dlg
 */
function refreshPromotionSaleLinesVisuals(dlg) {
  dlg.querySelectorAll('tr[data-pr-promo-line]').forEach((tr) => {
    if (tr instanceof HTMLTableRowElement) {
      fillHiddenDatesFromDisplayedCellsIfEmpty(tr);
      syncPromotionSaleRowView(tr);
    }
  });
  hydratePromotionTableThumbs(dlg, promotionDialogMarketSafe(dlg)).catch(() => {});
}

/** @param {HTMLDialogElement} dlg */
function readPromotionLineRowsFromDom(dlg) {
  /** @type {PromotionRow[]} */
  const out = [];
  dlg.querySelectorAll('[data-pr-promo-line]').forEach((line) => {
    const product = String(line.querySelector('.pr-promo-h-product')?.value ?? '').trim();
    const saleDigits = String(line.querySelector('.pr-promo-h-sale')?.value ?? '').trim();
    const regDigits = String(line.querySelector('.pr-promo-h-regular')?.value ?? '').trim();
    let start = String(line.querySelector('.pr-promo-h-start')?.value ?? '').trim();
    let end = String(line.querySelector('.pr-promo-h-end')?.value ?? '').trim();
    if (!start) {
      const ps = line.getAttribute('data-pr-start-paste');
      if (ps) start = normalizeDateForCatalogApi(ps);
    }
    if (!start) {
      const txt = String(
        line.querySelector('.pr-promo-cell[data-field="start"] .pr-promo-cell-view')?.textContent ?? '',
      ).trim();
      if (txt && txt !== '—') start = normalizeDateForCatalogApi(txt);
    }
    if (!end) {
      const pe = line.getAttribute('data-pr-end-paste');
      if (pe) end = normalizeDateForCatalogApi(pe);
    }
    if (!end) {
      const txt = String(
        line.querySelector('.pr-promo-cell[data-field="end"] .pr-promo-cell-view')?.textContent ?? '',
      ).trim();
      if (txt && txt !== '—') end = normalizeDateForCatalogApi(txt);
    }
    if (!product && !saleDigits && !regDigits && !start && !end) return;
    if (!product || !saleDigits) {
      throw new Error('Each non-empty sale line needs a product path or URL and a sale price');
    }
    out.push({
      product,
      regularPrice: regDigits || '—',
      salePrice: saleDigits,
      start,
      end,
    });
  });
  return out;
}

/**
 * Repair rows where start/end ISO never reached hidden inputs: paste attrs, then visible cell text.
 *
 * @param {HTMLTableRowElement} tr
 */
function fillHiddenDatesFromDisplayedCellsIfEmpty(tr) {
  const hS = /** @type {HTMLInputElement | null} */ (tr.querySelector('.pr-promo-h-start'));
  const hE = /** @type {HTMLInputElement | null} */ (tr.querySelector('.pr-promo-h-end'));
  const pasteS = tr.getAttribute('data-pr-start-paste');
  const pasteE = tr.getAttribute('data-pr-end-paste');
  const viewS = tr.querySelector('.pr-promo-cell[data-field="start"] .pr-promo-cell-view');
  const viewE = tr.querySelector('.pr-promo-cell[data-field="end"] .pr-promo-cell-view');
  const viewTxtS = String(viewS?.textContent ?? '').trim();
  const viewTxtE = String(viewE?.textContent ?? '').trim();

  /**
   * @param {HTMLInputElement | null} h
   * @param {string | null} paste
   * @param {string} viewTxt
   */
  function fillOne(h, paste, viewTxt) {
    if (!h || String(h.value).trim()) return;
    const candidates = [paste, viewTxt].filter((x) => x && x !== '—');
    const iso = candidates
      .map((raw) => normalizeDateForCatalogApi(String(raw)))
      .find((v) => v);
    if (iso) h.value = iso;
  }

  fillOne(hS, pasteS, viewTxtS);
  fillOne(hE, pasteE, viewTxtE);
}

/**
 * @param {HTMLTableRowElement} tr
 */
function syncPromotionSaleRowView(tr) {
  const hStart = /** @type {HTMLInputElement | null} */ (tr.querySelector('.pr-promo-h-start'));
  const hEnd = /** @type {HTMLInputElement | null} */ (tr.querySelector('.pr-promo-h-end'));
  const hProduct = /** @type {HTMLInputElement | null} */ (tr.querySelector('.pr-promo-h-product'));
  const hReg = /** @type {HTMLInputElement | null} */ (tr.querySelector('.pr-promo-h-regular'));
  const hSale = /** @type {HTMLInputElement | null} */ (tr.querySelector('.pr-promo-h-sale'));
  const vStart = tr.querySelector('.pr-promo-cell[data-field="start"] .pr-promo-cell-view');
  const vEnd = tr.querySelector('.pr-promo-cell[data-field="end"] .pr-promo-cell-view');
  const pathEl = tr.querySelector('.pr-promo-path-text');
  const vReg = tr.querySelector('.pr-promo-cell[data-field="regular"] .pr-promo-cell-view');
  const vSale = tr.querySelector('.pr-promo-cell[data-field="sale"] .pr-promo-cell-view');
  const pasteStart = tr.getAttribute('data-pr-start-paste');
  const pasteEnd = tr.getAttribute('data-pr-end-paste');
  if (vStart) {
    vStart.textContent = pasteStart != null && pasteStart !== ''
      ? pasteStart
      : formatIsoForSaleLineView(hStart?.value || '');
  }
  if (vEnd) {
    vEnd.textContent = pasteEnd != null && pasteEnd !== ''
      ? pasteEnd
      : formatIsoForSaleLineView(hEnd?.value || '');
  }
  const path = productUrlToCatalogPath(hProduct?.value || '');
  if (pathEl) pathEl.textContent = path || '—';
  if (vReg) vReg.textContent = hReg?.value?.trim() ? hReg.value : '—';
  if (vSale) vSale.textContent = hSale?.value?.trim() ? hSale.value : '—';
}

/**
 * @param {HTMLDialogElement} dlg
 * @param {(typeof COUNTRIES)[number]} countryKey
 */
async function hydratePromotionTableThumbs(dlg, countryKey) {
  const rows = /** @type {PromotionRow[]} */ ([]);
  dlg.querySelectorAll('tr[data-pr-promo-line]').forEach((tr) => {
    const u = String(tr.querySelector('.pr-promo-h-product')?.value ?? '').trim();
    if (u) {
      rows.push({
        product: u,
        start: '',
        end: '',
        regularPrice: '',
        salePrice: '',
      });
    }
  });
  const map = rows.length ? await buildThumbUrlMapForPromotionRows(rows, countryKey) : new Map();
  dlg.querySelectorAll('tr[data-pr-promo-line]').forEach((tr) => {
    const u = String(tr.querySelector('.pr-promo-h-product')?.value ?? '').trim();
    const cell = tr.querySelector('.pr-promo-thumb-cell');
    if (!cell) return;
    if (!u) {
      cell.innerHTML = '<span class="pim-thumb-placeholder" aria-hidden="true"></span>';
      return;
    }
    const src = map.get(u) || '';
    cell.innerHTML = src
      ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" width="48" height="48" class="pim-thumb-img" />`
      : '<span class="pim-thumb-placeholder" aria-hidden="true"></span>';
  });
}

/** @param {HTMLDialogElement} dlg */
function closePromotionSaleLineCellEdits(dlg) {
  dlg.querySelectorAll('.pr-promo-cell-edit').forEach((el) => {
    /** @type {HTMLElement} */ (el).hidden = true;
  });
  dlg.querySelectorAll('.pr-promo-cell-view').forEach((v) => {
    v.classList.remove('pr-promo-cell-view-active');
  });
}

/** Blur any open sale-line editor so values commit before save. */
function blurOpenPromotionSaleLineEditors(dlg) {
  const ae = document.activeElement;
  if (
    ae instanceof HTMLElement
    && dlg.contains(ae)
    && ae.closest('.pr-promo-cell-edit')
  ) {
    ae.blur();
  }
}

/**
 * Before PUT: for **open** start/end editors, copy datetime-local → hidden ISO; for **closed**
 * cells, keep hidden inputs as the source of truth (canonicalize only). Closed `<input
 * type="datetime-local">` controls sit inside `[hidden]` editors — Chrome often leaves
 * `input.value` empty after programmatic assignment, so reading them cleared TSV/import dates on
 * Save. Flush open product / regular / sale editors into hidden fields.
 *
 * Uses `element.hidden` (not `:not([hidden])`) so open editors are detected reliably.
 *
 * @param {HTMLDialogElement} dlg
 */
function commitPromotionSaleLineFieldsBeforeSave(dlg) {
  dlg.querySelectorAll('tr[data-pr-promo-line]').forEach((line) => {
    if (line instanceof HTMLTableRowElement) fillHiddenDatesFromDisplayedCellsIfEmpty(line);
  });
  dlg.querySelectorAll('tr[data-pr-promo-line]').forEach((line) => {
    if (!(line instanceof HTMLTableRowElement)) return;
    const startEdit = line.querySelector('.pr-promo-cell[data-field="start"] .pr-promo-cell-edit');
    const endEdit = line.querySelector('.pr-promo-cell[data-field="end"] .pr-promo-cell-edit');
    const hS = /** @type {HTMLInputElement | null} */ (line.querySelector('.pr-promo-h-start'));
    const hE = /** @type {HTMLInputElement | null} */ (line.querySelector('.pr-promo-h-end'));
    const inpS = /** @type {HTMLInputElement | null} */ (line.querySelector('.pr-promo-input-start'));
    const inpE = /** @type {HTMLInputElement | null} */ (line.querySelector('.pr-promo-input-end'));

    const startClosed = startEdit instanceof HTMLElement && startEdit.hidden;
    const endClosed = endEdit instanceof HTMLElement && endEdit.hidden;

    if (startClosed && inpS && hS) {
      inpS.value = isoToDatetimeLocalValue(hS.value);
    }
    if (endClosed && inpE && hE) {
      inpE.value = isoToDatetimeLocalValue(hE.value);
    }

    if (inpS && hS) {
      if (startClosed) {
        /** Inputs inside `[hidden]` editors often don’t round-trip in Chrome — keep hidden ISO. */
        const t = hS.value.trim();
        const norm = t ? normalizeDateForCatalogApi(t) : '';
        hS.value = norm;
      } else {
        const prevStart = hS.value;
        const nextStart = datetimeLocalValueToIso(inpS.value);
        if (!inpS.value.trim()) {
          hS.value = '';
          line.removeAttribute('data-pr-start-paste');
        } else if (nextStart) {
          hS.value = nextStart;
          line.removeAttribute('data-pr-start-paste');
        } else {
          hS.value = prevStart;
        }
      }
    }
    if (inpE && hE) {
      if (endClosed) {
        const t = hE.value.trim();
        const norm = t ? normalizeDateForCatalogApi(t) : '';
        hE.value = norm;
      } else {
        const prevEnd = hE.value;
        const nextEnd = datetimeLocalValueToIso(inpE.value);
        if (!inpE.value.trim()) {
          hE.value = '';
          line.removeAttribute('data-pr-end-paste');
        } else if (nextEnd) {
          hE.value = nextEnd;
          line.removeAttribute('data-pr-end-paste');
        } else {
          hE.value = prevEnd;
        }
      }
    }
    syncPromotionSaleRowView(line);
  });

  dlg.querySelectorAll('.pr-promo-cell-edit').forEach((edit) => {
    if (!(edit instanceof HTMLElement) || edit.hidden) return;
    const cell = edit.closest('.pr-promo-cell');
    const tr = edit.closest('tr[data-pr-promo-line]');
    if (!cell || !tr || !(tr instanceof HTMLTableRowElement)) return;
    const field = cell.getAttribute('data-field');
    const inp = /** @type {HTMLInputElement | null} */ (edit.querySelector('input'));
    if (!field || !inp) return;
    if (field === 'start' || field === 'end') return;

    if (field === 'product') {
      const h = tr.querySelector('.pr-promo-h-product');
      if (h && 'value' in h) /** @type {HTMLInputElement} */ (h).value = resolveProductUrlForRow(inp.value);
    } else if (field === 'regular') {
      const h = tr.querySelector('.pr-promo-h-regular');
      if (h && 'value' in h) /** @type {HTMLInputElement} */ (h).value = priceDigitsForUi(inp.value);
    } else if (field === 'sale') {
      const h = tr.querySelector('.pr-promo-h-sale');
      if (h && 'value' in h) /** @type {HTMLInputElement} */ (h).value = priceDigitsForUi(inp.value);
    }
    edit.hidden = true;
    cell.querySelector('.pr-promo-cell-view')?.classList.remove('pr-promo-cell-view-active');
    syncPromotionSaleRowView(tr);
  });
  hydratePromotionTableThumbs(dlg, promotionDialogMarketSafe(dlg)).catch(() => {});
}

/**
 * @param {HTMLDialogElement} dlg
 */
function wirePromotionSaleLineTableCells(dlg) {
  if (dlg.dataset.prPromoSaleCellsWired === '1') return;
  dlg.dataset.prPromoSaleCellsWired = '1';

  const tbody = dlg.querySelector('#pr-promo-form-lines-tbody');
  if (!tbody) return;

  const safeMarket = () => {
    try {
      return readPromotionMarketFromForm(dlg);
    } catch {
      return /** @type {(typeof COUNTRIES)[number]} */ ('us');
    }
  };

  const rehydrateThumbs = () => {
    hydratePromotionTableThumbs(dlg, safeMarket()).catch(() => {});
  };

  dlg.querySelector('#pr-promo-form-market')?.addEventListener('change', rehydrateThumbs);

  tbody.addEventListener('mousedown', (e) => {
    const tr = /** @type {HTMLElement | null} */ (e.target)?.closest('tr[data-pr-promo-line]');
    if (!tr || /** @type {HTMLElement} */ (e.target).closest('[data-pr-promo-line-remove]')) return;
    tbody.querySelectorAll('tr[data-pr-promo-line]').forEach((r) => r.classList.remove('pr-promo-line-selected'));
    tr.classList.add('pr-promo-line-selected');
  });

  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    const view = el.closest('.pr-promo-cell-view');
    if (!view) return;
    e.preventDefault();
    view.click();
  });

  tbody.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.closest('[data-pr-promo-line-remove]')) return;
    const view = t.closest('.pr-promo-cell-view');
    if (!view) return;
    const cell = view.closest('.pr-promo-cell');
    const tr = view.closest('tr[data-pr-promo-line]');
    if (!cell || !tr || !(tr instanceof HTMLTableRowElement)) return;
    const field = cell.getAttribute('data-field');
    if (!field) return;
    e.preventDefault();
    closePromotionSaleLineCellEdits(dlg);
    const edit = cell.querySelector('.pr-promo-cell-edit');
    const inp = /** @type {HTMLInputElement | null} */ (edit?.querySelector('input'));
    if (!edit || !inp) return;
    if (field === 'start') {
      inp.value = isoToDatetimeLocalValue(
        /** @type {HTMLInputElement} */(tr.querySelector('.pr-promo-h-start')).value,
      );
    } else if (field === 'end') {
      inp.value = isoToDatetimeLocalValue(
        /** @type {HTMLInputElement} */(tr.querySelector('.pr-promo-h-end')).value,
      );
    } else if (field === 'product') {
      const full = /** @type {HTMLInputElement} */ (tr.querySelector('.pr-promo-h-product')).value;
      inp.value = productUrlToCatalogPath(full) || full;
    } else if (field === 'regular') {
      inp.value = /** @type {HTMLInputElement} */ (tr.querySelector('.pr-promo-h-regular')).value;
    } else if (field === 'sale') {
      inp.value = /** @type {HTMLInputElement} */ (tr.querySelector('.pr-promo-h-sale')).value;
    }
    /** @type {HTMLElement} */ (edit).hidden = false;
    view.classList.add('pr-promo-cell-view-active');
    inp.focus();
  });

  tbody.addEventListener('focusout', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    const cell = t.closest('.pr-promo-cell');
    const tr = t.closest('tr[data-pr-promo-line]');
    if (!cell || !tr || !(tr instanceof HTMLTableRowElement)) return;
    const rt = /** @type {Node | null} */ (e.relatedTarget);
    if (rt && cell.contains(rt)) return;
    const field = cell.getAttribute('data-field');
    const edit = cell.querySelector('.pr-promo-cell-edit');
    if (!field || !edit || /** @type {HTMLElement} */ (edit).hidden) return;

    if (field === 'start') {
      /** @type {HTMLInputElement} */ (tr.querySelector('.pr-promo-h-start')).value = datetimeLocalValueToIso(t.value);
      tr.removeAttribute('data-pr-start-paste');
    } else if (field === 'end') {
      /** @type {HTMLInputElement} */ (tr.querySelector('.pr-promo-h-end')).value = datetimeLocalValueToIso(t.value);
      tr.removeAttribute('data-pr-end-paste');
    } else if (field === 'product') {
      /** @type {HTMLInputElement} */ (tr.querySelector('.pr-promo-h-product')).value = resolveProductUrlForRow(t.value);
    } else if (field === 'regular') {
      /** @type {HTMLInputElement} */ (tr.querySelector('.pr-promo-h-regular')).value = priceDigitsForUi(t.value);
    } else if (field === 'sale') {
      /** @type {HTMLInputElement} */ (tr.querySelector('.pr-promo-h-sale')).value = priceDigitsForUi(t.value);
    }
    /** @type {HTMLElement} */ (edit).hidden = true;
    cell.querySelector('.pr-promo-cell-view')?.classList.remove('pr-promo-cell-view-active');
    syncPromotionSaleRowView(tr);
    rehydrateThumbs();
  });
}

/**
 * @param {PromotionRow} r
 * @param {number} index
 */
function promotionFormTableRowHtml(r, index) {
  const productUrl = resolveProductUrlForRow(String(r.product || '').trim());
  const path = productUrlToCatalogPath(productUrl);
  const startPrimary = String(r.start ?? '').trim();
  const endPrimary = String(r.end ?? '').trim();
  const startPaste = String(r.startSourceText ?? '').trim();
  const endPaste = String(r.endSourceText ?? '').trim();
  /**
   * If parse-time normalization left `start`/`end` empty, derive ISO from pasted
   * spreadsheet text so hidden inputs match the grid.
   */
  let startIso = startPrimary && startPrimary !== '—' ? normalizeDateForCatalogApi(startPrimary) : '';
  if (!startIso && startPaste) startIso = normalizeDateForCatalogApi(startPaste);
  let endIso = endPrimary && endPrimary !== '—' ? normalizeDateForCatalogApi(endPrimary) : '';
  if (!endIso && endPaste) endIso = normalizeDateForCatalogApi(endPaste);
  const saleDigits = priceDigitsForUi(r.salePrice);
  const regDigits = priceDigitsForUi(
    r.regularPrice === '—' || r.regularPrice == null ? '' : String(r.regularPrice),
  );
  const startPasteAttr = startPaste ? ` data-pr-start-paste="${escapeHtml(startPaste)}"` : '';
  const endPasteAttr = endPaste ? ` data-pr-end-paste="${escapeHtml(endPaste)}"` : '';
  const startViewLabel = startPaste || formatIsoForSaleLineView(startIso);
  const endViewLabel = endPaste || formatIsoForSaleLineView(endIso);
  return `<tr class="pr-promo-sale-row" data-pr-promo-line data-pr-promo-line-idx="${index}"${startPasteAttr}${endPasteAttr}>
    <td class="pr-promo-sale-col-del">
      <button type="button" class="coupons-btn pr-promo-line-remove-btn" data-pr-promo-line-remove aria-label="Remove row">×</button>
    </td>
    <td class="pr-promo-line-num">${index + 1}</td>
    <td class="pr-promo-cell" data-field="start">
      <input type="hidden" class="pr-promo-h-start" value="${escapeHtml(startIso)}" />
      <div class="pr-promo-cell-view" tabindex="0" role="button">${escapeHtml(startViewLabel)}</div>
      <div class="pr-promo-cell-edit" hidden>
        <input type="datetime-local" class="pr-promo-input-start" step="60" />
      </div>
    </td>
    <td class="pr-promo-cell" data-field="end">
      <input type="hidden" class="pr-promo-h-end" value="${escapeHtml(endIso)}" />
      <div class="pr-promo-cell-view" tabindex="0" role="button">${escapeHtml(endViewLabel)}</div>
      <div class="pr-promo-cell-edit" hidden>
        <input type="datetime-local" class="pr-promo-input-end" step="60" />
      </div>
    </td>
    <td class="pr-promo-cell pr-promo-cell-wide" data-field="product">
      <input type="hidden" class="pr-promo-h-product" value="${escapeHtml(productUrl)}" />
      <div class="pr-promo-cell-view pr-promo-product-view" tabindex="0" role="button">
        <span class="pr-promo-thumb-cell"></span>
        <code class="pr-promo-path-text">${path ? escapeHtml(path) : '—'}</code>
      </div>
      <div class="pr-promo-cell-edit" hidden>
        <input type="text" class="pr-promo-input-product" placeholder="/us/en_us/products/… or https://…" />
      </div>
    </td>
    <td class="pr-promo-cell" data-field="regular">
      <input type="hidden" class="pr-promo-h-regular" value="${escapeHtml(regDigits)}" />
      <div class="pr-promo-cell-view" tabindex="0" role="button">${regDigits ? escapeHtml(regDigits) : '—'}</div>
      <div class="pr-promo-cell-edit" hidden>
        <input type="text" class="pr-promo-input-regular" inputmode="decimal" placeholder="449.95" />
      </div>
    </td>
    <td class="pr-promo-cell" data-field="sale">
      <input type="hidden" class="pr-promo-h-sale" value="${escapeHtml(saleDigits)}" />
      <div class="pr-promo-cell-view" tabindex="0" role="button">${saleDigits ? escapeHtml(saleDigits) : '—'}</div>
      <div class="pr-promo-cell-edit" hidden>
        <input type="text" class="pr-promo-input-sale" inputmode="decimal" placeholder="429.95" />
      </div>
    </td>
  </tr>`;
}

function promotionSaleLinesTableWrapHtml(linesHtml) {
  return `<div class="pr-promo-form-lines-wrap">
    <div class="pr-promo-form-lines-scroll">
      <table class="pr-data-table pr-promo-sale-grid" aria-label="Sale lines">
        <thead>
          <tr>
            <th scope="col" class="pr-promo-sale-col-del"><span class="pim-sr-only">Remove</span></th>
            <th scope="col" class="pr-promo-sale-col-num">#</th>
            <th scope="col">Start</th>
            <th scope="col">End</th>
            <th scope="col">Product path</th>
            <th scope="col">Regular</th>
            <th scope="col">Sale</th>
          </tr>
        </thead>
        <tbody id="pr-promo-form-lines-tbody">${linesHtml}</tbody>
      </table>
    </div>
    <details class="pr-promo-tsv-import">
      <summary>Import from spreadsheet (TSV)</summary>
      <p class="coupons-field-hint" style="margin-top:8px">Paste tab-separated columns in order:
        <strong>Start</strong>, <strong>End</strong>, <strong>Product</strong>, <strong>Regular Price</strong>, <strong>Sale Price</strong>.
        Include the header row from Excel if you like — it is ignored automatically.
        Dates use <strong>US</strong> <code>M/D/YYYY</code> with optional <code>12am</code>/<code>11:59pm</code>-style times: they are read as <strong>US Eastern time (ET)</strong>, converted to <strong>UTC</strong> for the API, and the pasted text stays visible in the grid until you edit that cell. <code>11:59pm</code> is treated as the last second of that minute (ET). Prices may include <code>$</code>; values are normalized to plain numbers for the API.</p>
      <textarea id="pr-promo-tsv-paste" class="pr-promo-tsv-textarea" rows="7" spellcheck="false" placeholder="Start&#9;End&#9;Product&#9;Regular Price&#9;Sale Price"></textarea>
      <div class="pr-promo-tsv-actions">
        <button type="button" class="coupons-btn coupons-btn-primary" data-pr-promo-tsv-replace>Replace rows from paste</button>
        <button type="button" class="coupons-btn" data-pr-promo-tsv-append>Append rows from paste</button>
        <button type="button" class="coupons-btn" data-pr-promo-tsv-clear>Clear box</button>
      </div>
    </details>
  </div>`;
}

/**
 * @param {(typeof COUNTRIES)[number]} initialMarket
 * @param {PromotionRow[]} lines
 * @param {{ edit?: boolean, promoId?: string }} [opts]
 */
function promotionEditFormInnerHtml(initialMarket, lines, opts = {}) {
  const edit = Boolean(opts.edit);
  const promoId = opts.promoId ? String(opts.promoId) : '';
  const optsHtml = COUNTRIES.map((key) => {
    const label = marketLabel(key).trim() || key.toUpperCase();
    const sel = key === initialMarket ? ' selected' : '';
    return `<option value="${escapeHtml(key)}"${sel}>${escapeHtml(label)}</option>`;
  }).join('');
  const marketDis = edit ? ' disabled' : '';
  const idBlock = edit && promoId
    ? `<div class="coupons-field coupons-field-full">
        <label>Promotion id <span class="coupons-field-hint">(fixed)</span></label>
        <p class="pr-cart-rule-id-display"><code>${escapeHtml(promoId)}</code></p>
      </div>`
    : '';
  const seed = lines.length
    ? lines
    : [{
      product: '',
      salePrice: '',
      regularPrice: '',
      start: '',
      end: '',
    }];
  const linesHtml = seed.map((r, i) => promotionFormTableRowHtml(r, i)).join('');
  return `
    <p class="coupons-page-lead" style="margin:0 0 12px;font-size:14px;color:#6d7175">
    ${edit
    ? 'Edit sale lines for this market. Lines for other markets on the same promotion are left unchanged. Click a cell to edit; start/end use a US Eastern (ET) date/time picker (saved as UTC ISO 8601). Prices are numbers only (no <code>$</code>) for the API.'
    : 'New promotion for one market. Click a cell to edit sale lines; start/end use US Eastern (ET) time. Product column shows the storefront path and a thumbnail from the catalog index when the URL resolves. Prices are numbers only (no <code>$</code>) for the API.'}
    </p>
    <div class="coupons-form-grid">
      ${idBlock}
      <div class="coupons-field coupons-field-full">
        <label for="pr-promo-form-market">Market</label>
        <select id="pr-promo-form-market" required${marketDis}>${optsHtml}</select>
    ${edit
    ? '<p class="coupons-field-hint">Paths in sale lines must stay under this market\'s storefront.</p>'
    : '<p class="coupons-field-hint">Promotion <code>id</code> is a slug from the title (unique across all promotions). Market is stored in the <code>country</code> field.</p>'}
      </div>
      <div class="coupons-field coupons-field-full">
        <label for="pr-promo-form-name">Promotion title</label>
        <input type="text" id="pr-promo-form-name" autocomplete="off" required placeholder="e.g. Spring sale" />
      </div>
      <div class="coupons-field">
        <label for="pr-promo-form-group">Group <span class="coupons-field-hint">(e.g. calendar year)</span></label>
        <input type="text" id="pr-promo-form-group" inputmode="text" placeholder="2026" />
      </div>
    </div>
    <div class="pr-promo-form-lines-header">
      <h3 class="pr-promo-form-lines-title">Sale lines</h3>
      <button type="button" class="coupons-btn" data-pr-promo-line-add>Add row</button>
    </div>
    ${promotionSaleLinesTableWrapHtml(linesHtml)}`;
}

/**
 * @param {HTMLDialogElement} dlg
 */
function refreshPromotionLineIndices(dlg) {
  const lines = dlg.querySelectorAll('[data-pr-promo-line]');
  lines.forEach((line, i) => {
    line.setAttribute('data-pr-promo-line-idx', String(i));
    const num = line.querySelector('.pr-promo-line-num');
    if (num) num.textContent = String(i + 1);
    const rm = line.querySelector('[data-pr-promo-line-remove]');
    if (rm) {
      rm.disabled = lines.length <= 1;
      if (lines.length <= 1) rm.setAttribute('aria-disabled', 'true');
      else rm.removeAttribute('aria-disabled');
    }
  });
}

/**
 * @param {HTMLDialogElement} dlg
 */
function wirePromotionFormDynamicLines(dlg) {
  const linesHost = dlg.querySelector('#pr-promo-form-lines-tbody');
  dlg.querySelector('[data-pr-promo-line-add]')?.addEventListener('click', () => {
    if (!linesHost) return;
    const idx = linesHost.querySelectorAll('[data-pr-promo-line]').length;
    linesHost.insertAdjacentHTML(
      'beforeend',
      promotionFormTableRowHtml(
        {
          product: '',
          salePrice: '',
          regularPrice: '',
          start: '',
          end: '',
        },
        idx,
      ),
    );
    refreshPromotionLineIndices(dlg);
    refreshPromotionSaleLinesVisuals(dlg);
  });
  linesHost?.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (!t.closest('[data-pr-promo-line-remove]')) return;
    const line = t.closest('[data-pr-promo-line]');
    const all = linesHost?.querySelectorAll('[data-pr-promo-line]') ?? [];
    if (!line || all.length <= 1) return;
    line.remove();
    refreshPromotionLineIndices(dlg);
    refreshPromotionSaleLinesVisuals(dlg);
  });
}

/**
 * @param {HTMLDialogElement} dlg
 */
function wirePromotionTsvImport(dlg) {
  const ta = /** @type {HTMLTextAreaElement | null} */ (dlg.querySelector('#pr-promo-tsv-paste'));
  dlg.querySelector('[data-pr-promo-tsv-clear]')?.addEventListener('click', () => {
    if (ta) ta.value = '';
  });
  const applyParsed = (parsed, mode) => {
    const tbody = dlg.querySelector('#pr-promo-form-lines-tbody');
    if (!tbody) return;
    if (!parsed.length) {
      showToast('No valid rows found (need 5 tab-separated columns per line).', 'error');
      return;
    }
    if (mode === 'replace') {
      tbody.innerHTML = parsed.map((r, i) => promotionFormTableRowHtml(r, i)).join('');
    } else {
      const startIdx = tbody.querySelectorAll('[data-pr-promo-line]').length;
      const html = parsed.map((r, i) => promotionFormTableRowHtml(r, startIdx + i)).join('');
      tbody.insertAdjacentHTML('beforeend', html);
    }
    refreshPromotionLineIndices(dlg);
    refreshPromotionSaleLinesVisuals(dlg);
    showToast(`${mode === 'replace' ? 'Replaced with' : 'Appended'} ${parsed.length} row(s)`, 'success');
  };
  dlg.querySelector('[data-pr-promo-tsv-replace]')?.addEventListener('click', () => {
    try {
      const parsed = parseSaleLinesTsv(ta?.value ?? '');
      applyParsed(parsed, 'replace');
    } catch (err) {
      showToast(err?.message || 'Import failed', 'error');
    }
  });
  dlg.querySelector('[data-pr-promo-tsv-append]')?.addEventListener('click', () => {
    try {
      const parsed = parseSaleLinesTsv(ta?.value ?? '');
      applyParsed(parsed, 'append');
    } catch (err) {
      showToast(err?.message || 'Import failed', 'error');
    }
  });
}

/**
 * @param {import('./price-rules-api.js').CatalogPromotion[]} promotions
 */
async function putCatalogPromotionsDocument(promotions) {
  await putCatalogPriceRules(PB_ORG, PB_SITE, { promotions });

  // Confirm the write by reading back — pass cache:'no-store' so the browser does not
  // serve a pre-PUT cached response.  The CORS proxy (fcors.org) can silently drop the
  // PUT body and the API then returns an empty/stale document; the read-back lets us
  // detect that case and surface a real error instead of a false "Promotion added" toast.
  let returned;
  try {
    const doc = await fetchCatalogPriceRules(PB_ORG, PB_SITE, { cache: 'no-store' });
    returned = Array.isArray(doc.promotions) ? doc.promotions : [];
  } catch (getErr) {
    // GET failed — fall back to the submitted snapshot so the UI still reflects the
    // intended state.  The PUT itself succeeded so we do not re-throw.
    state.catalogPromotions = promotions;
    state.catalogDataSource = 'api';
    state.catalogLoadError = getErr?.message || String(getErr);
    return;
  }

  // Detect silent write failure: every ID we submitted must appear in the server response.
  // If any are absent the proxy most likely dropped the request body (PUT → no-op GET).
  const submittedIds = new Set(promotions.map((p) => String(p.id)));
  const missing = [...submittedIds].filter((id) => !returned.some((r) => String(r.id) === id));
  if (missing.length) {
    // Update state to the actual server reality before throwing so the list is accurate.
    state.catalogPromotions = returned;
    state.catalogDataSource = 'api';
    state.catalogLoadError = '';
    throw new Error(
      `The request was accepted but the data was not saved — ${missing.length} promotion${missing.length === 1 ? '' : 's'} missing from the server response after PUT. `
      + 'The CORS proxy may not be forwarding the request body. Check the browser Network tab.',
    );
  }

  state.catalogPromotions = returned;
  state.catalogDataSource = 'api';
  state.catalogLoadError = '';
}

/**
 * Throw a descriptive error if any rules have an `end` already in the past.
 *
 * The server silently strips expired rules on PUT and removes any promotion that
 * ends up with zero rules — turning a successful-looking save into a phantom
 * "Promotion added" with nothing in the list.  This pre-flight check surfaces that
 * as a visible error before the request is even sent.
 *
 * @param {import('./price-rules-api.js').CatalogPriceRule[]} rules
 */
function assertNoExpiredRuleEnds(rules) {
  const now = Date.now();
  const expired = rules.filter((r) => r.end && new Date(r.end).getTime() <= now);
  if (!expired.length) return;
  const paths = expired.map((r) => {
    const d = new Date(/** @type {string} */(r.end));
    return `${r.path} (ended ${d.toLocaleDateString('en-US', { timeZone: ET_TIMEZONE })})`;
  });
  const allExpired = expired.length === rules.length;
  throw new Error(
    `${expired.length} of ${rules.length} sale line${expired.length === 1 ? '' : 's'} `
    + `ha${expired.length === 1 ? 's' : 've'} an end date in the past. `
    + `The server will discard ${allExpired ? 'all of them, leaving an empty promotion that is immediately removed' : 'those lines'}. `
    + `Update the end dates before saving.\n${paths.join('\n')}`,
  );
}

/**
 * @param {string} promoId
 * @returns {Promise<boolean>}
 */
async function deletePromotionById(promoId) {
  const ok = await fetchCatalogFromServerOrNotify();
  if (!ok) return false;
  const fresh = Array.isArray(state.catalogPromotions) ? state.catalogPromotions : [];
  const next = fresh.filter((p) => String(p.id) !== String(promoId));
  if (next.length === fresh.length) {
    showToast('Promotion not found after refresh.', 'error');
    render();
    return false;
  }
  try {
    await putCatalogPromotionsDocument(next);
    showToast('Promotion deleted', 'success');
    return true;
  } catch (err) {
    showToast(err?.message || 'Delete failed', 'error');
    return false;
  }
}

async function openPromotionAddDialog() {
  const ok = await fetchCatalogFromServerOrNotify();
  if (!ok) return;

  const initial = COUNTRIES.includes(state.country) ? state.country : 'us';
  const dialog = document.createElement('dialog');
  dialog.className = 'coupons-dialog coupons-dialog-wide pr-promo-form-dialog';
  dialog.innerHTML = `
    <div class="coupons-dialog-inner">
      <h2>Add promotion</h2>
      ${promotionEditFormInnerHtml(initial, [], { edit: false })}
      <div class="coupons-dialog-actions">
        <button type="button" class="coupons-btn" data-pr-promo-form-cancel>Cancel</button>
        <button type="button" class="coupons-btn coupons-btn-primary" data-pr-promo-form-submit>Add promotion</button>
      </div>
    </div>`;
  document.body.appendChild(dialog);
  const groupEl = dialog.querySelector('#pr-promo-form-group');
  if (groupEl && 'value' in groupEl) /** @type {HTMLInputElement} */ (groupEl).value = String(new Date().getFullYear());

  wirePromotionFormDynamicLines(dialog);
  wirePromotionTsvImport(dialog);
  wirePromotionSaleLineTableCells(dialog);
  refreshPromotionLineIndices(dialog);
  refreshPromotionSaleLinesVisuals(dialog);

  const close = () => {
    dialog.close();
    dialog.remove();
  };
  wireDialogEscapeDismiss(dialog, close);
  dialog.querySelector('[data-pr-promo-form-cancel]')?.addEventListener('click', close);
  dialog.querySelector('[data-pr-promo-form-submit]')?.addEventListener('click', async () => {
    try {
      commitPromotionSaleLineFieldsBeforeSave(dialog);
      blurOpenPromotionSaleLineEditors(dialog);
      closePromotionSaleLineCellEdits(dialog);
      const market = readPromotionMarketFromForm(dialog);
      const name = String(dialog.querySelector('#pr-promo-form-name')?.value ?? '').trim();
      if (!name) throw new Error('Promotion title is required');
      const group = String(dialog.querySelector('#pr-promo-form-group')?.value ?? '').trim()
        || String(new Date().getFullYear());
      const lineRows = readPromotionLineRowsFromDom(dialog);
      if (!lineRows.length) throw new Error('Add at least one sale line');
      const rulesNew = promotionRowsToCatalogRules(lineRows, group);
      for (let i = 0; i < rulesNew.length; i += 1) {
        if (countryKeyFromCatalogPath(rulesNew[i].path) !== market) {
          throw new Error(
            `Sale line ${i + 1}: URL path must match the selected market (${market.toUpperCase()})`,
          );
        }
      }
      assertNoExpiredRuleEnds(rulesNew);
      const existing = Array.isArray(state.catalogPromotions) ? state.catalogPromotions : [];
      const slug = ruleSlugFromName(name);
      const id = uniquePromotionId(slug, existing);
      const next = [...existing, {
        id,
        name,
        country: market,
        rules: rulesNew,
      }];
      await putCatalogPromotionsDocument(next);
      showToast('Promotion added', 'success');
      close();
      render();
    } catch (err) {
      showToast(err?.message || 'Failed to add promotion', 'error');
    }
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  dialog.showModal();
}

/**
 * @param {string} countryKey
 * @param {string} promoId
 */
async function openPromotionEditDialog(countryKey, promoId) {
  const ok = await fetchCatalogFromServerOrNotify();
  if (!ok) return;

  const fresh = Array.isArray(state.catalogPromotions) ? state.catalogPromotions : [];
  const promo = fresh.find((p) => String(p.id) === String(promoId));
  if (!promo) {
    showToast('That promotion was not found after refresh.', 'error');
    render();
    return;
  }
  const rulesCo = catalogRulesForCountryTab(promo, countryKey);
  const ck = /** @type {(typeof COUNTRIES)[number]} */ (
    COUNTRIES.includes(/** @type {(typeof COUNTRIES)[number]} */(countryKey)) ? countryKey : 'us'
  );
  const rows = rulesCo.map(catalogRuleToPromotionRow);
  const groupGuess = promotionCatalogGroup(promo, ck);

  const dialog = document.createElement('dialog');
  dialog.className = 'coupons-dialog coupons-dialog-wide pr-promo-form-dialog';
  dialog.innerHTML = `
    <div class="coupons-dialog-inner">
      <h2>Edit promotion</h2>
      ${promotionEditFormInnerHtml(ck, rows, { edit: true, promoId })}
      <div class="pr-cart-rule-edit-dialog-actions">
        <button type="button" class="coupons-btn coupons-btn-danger" data-pr-promo-form-delete>Delete promotion…</button>
        <div class="pr-cart-rule-edit-actions-end">
          <button type="button" class="coupons-btn" data-pr-promo-form-cancel>Cancel</button>
          <button type="button" class="coupons-btn coupons-btn-primary" data-pr-promo-form-submit>Save changes</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(dialog);
  const nameEl = dialog.querySelector('#pr-promo-form-name');
  if (nameEl && 'value' in nameEl) /** @type {HTMLInputElement} */ (nameEl).value = promo.name || '';
  const groupEl = dialog.querySelector('#pr-promo-form-group');
  if (groupEl && 'value' in groupEl) /** @type {HTMLInputElement} */ (groupEl).value = groupGuess;

  wirePromotionFormDynamicLines(dialog);
  wirePromotionTsvImport(dialog);
  wirePromotionSaleLineTableCells(dialog);
  refreshPromotionLineIndices(dialog);
  refreshPromotionSaleLinesVisuals(dialog);

  const close = () => {
    dialog.close();
    dialog.remove();
  };
  wireDialogEscapeDismiss(dialog, close);
  dialog.querySelector('[data-pr-promo-form-cancel]')?.addEventListener('click', close);
  dialog.querySelector('[data-pr-promo-form-delete]')?.addEventListener('click', async () => {
    if (!window.confirm(`Delete promotion "${promo.name || promoId}" (${promoId})? This cannot be undone.`)) return;
    try {
      if (await deletePromotionById(promoId)) {
        close();
        render();
      }
    } catch (err) {
      showToast(err?.message || 'Delete failed', 'error');
    }
  });
  dialog.querySelector('[data-pr-promo-form-submit]')?.addEventListener('click', async () => {
    try {
      commitPromotionSaleLineFieldsBeforeSave(dialog);
      blurOpenPromotionSaleLineEditors(dialog);
      closePromotionSaleLineCellEdits(dialog);
      const market = readPromotionMarketFromForm(dialog);
      const name = String(dialog.querySelector('#pr-promo-form-name')?.value ?? '').trim();
      if (!name) throw new Error('Promotion title is required');
      const group = String(dialog.querySelector('#pr-promo-form-group')?.value ?? '').trim()
        || String(new Date().getFullYear());
      const lineRows = readPromotionLineRowsFromDom(dialog);
      const list = Array.isArray(state.catalogPromotions) ? state.catalogPromotions : [];
      const idx = list.findIndex((p) => String(p.id) === String(promoId));
      if (idx === -1) {
        showToast('Promotion disappeared during edit. Refresh and try again.', 'error');
        close();
        render();
        return;
      }
      const prev = list[idx];
      const prevMarketRules = catalogRulesForCountryTab(prev, market);
      const rulesNew = lineRows.length
        ? promotionRowsToCatalogRules(lineRows, group, prevMarketRules)
        : [];
      for (let i = 0; i < rulesNew.length; i += 1) {
        if (countryKeyFromCatalogPath(rulesNew[i].path) !== market) {
          throw new Error(
            `Sale line ${i + 1}: URL path must match this market (${market.toUpperCase()})`,
          );
        }
      }
      assertNoExpiredRuleEnds(rulesNew);
      const onTab = new Set(catalogRulesForCountryTab(prev, market));
      const rulesOther = (prev.rules || []).filter((r) => !onTab.has(r));
      const merged = [...rulesOther, ...rulesNew];
      if (!merged.length) {
        throw new Error(
          'This would remove all sale lines. Delete the promotion instead, or keep at least one line.',
        );
      }
      const next = list.slice();
      next[idx] = {
        ...prev,
        name,
        country: market,
        rules: merged,
      };
      await putCatalogPromotionsDocument(next);
      showToast('Promotion updated', 'success');
      close();
      render();
    } catch (err) {
      showToast(err?.message || 'Failed to update promotion', 'error');
    }
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  dialog.showModal();
}

/**
 * Market pre-select (same pattern as new-coupon country, without year).
 * @param {(typeof COUNTRIES)[number]} initialMarket
 * @param {boolean} [marketLocked] when true, market cannot be changed (edit mode)
 */
function cartRuleNewMarketFieldsHtml(initialMarket, marketLocked = false) {
  const sk = COUNTRIES.includes(initialMarket) ? initialMarket : 'us';
  const opts = COUNTRIES.map((key) => {
    const label = marketLabel(key).trim() || key.toUpperCase();
    const sel = key === sk ? ' selected' : '';
    return `<option value="${escapeHtml(key)}"${sel}>${escapeHtml(label)}</option>`;
  }).join('');
  const dis = marketLocked ? ' disabled' : '';
  const hint = marketLocked
    ? '<p class="coupons-field-hint">Market is fixed on this rule (<code>country</code> on the saved object).</p>'
    : '<p class="coupons-field-hint">Rule <code>id</code> is a slug from the name. Market is stored in the <code>country</code> field (helix-commerce-api cart rules are one shared array per site).</p>';
  return `
      <div class="coupons-field coupons-field-full">
        <label for="pr-cart-add-market">Market</label>
        <select id="pr-cart-add-market" required${dis}>${opts}</select>
        ${hint}
      </div>`;
}

/**
 * @param {(typeof COUNTRIES)[number]} initialMarket
 * @param {{ marketLocked?: boolean, ruleId?: string }} [formOptions]
 */
function cartRuleAddFormHtml(initialMarket, formOptions = {}) {
  const { marketLocked = false, ruleId = '' } = formOptions;
  const marketBlock = cartRuleNewMarketFieldsHtml(initialMarket, marketLocked);
  const idBlock = ruleId
    ? `<div class="coupons-field coupons-field-full">
        <label>Rule id <span class="coupons-field-hint">(fixed)</span></label>
        <p class="pr-cart-rule-id-display"><code>${escapeHtml(ruleId)}</code></p>
      </div>`
    : '';
  const lead = marketLocked
    ? 'Latest rules were loaded from the server. Change fields below — rule <code>id</code> and priority cannot be changed here; use <strong>Delete rule</strong> to remove.'
    : 'Server data was just refreshed. Choose a market (stored as <code>country</code>), then describe the rule — <code>PUT …/price-rules/cart</code> sends the full rules array.';
  return `
    <p class="coupons-page-lead" style="margin:0 0 12px;font-size:14px;color:#6d7175">
      ${lead}
    </p>
    <div class="coupons-form-grid">
      ${idBlock}
      ${marketBlock}
      <div class="coupons-field coupons-field-full">
        <label for="pr-cart-add-name">Rule name</label>
        <input type="text" id="pr-cart-add-name" autocomplete="off" required placeholder="e.g. Free shipping threshold" />
      </div>
      <div class="coupons-field">
        <label for="pr-cart-add-min">Minimum cart ($)</label>
        <input type="text" id="pr-cart-add-min" inputmode="decimal" placeholder="150 or leave empty" />
      </div>
      <div class="coupons-field">
        <label for="pr-cart-add-off">Amount off</label>
        <input type="text" id="pr-cart-add-off" placeholder="25% or blank" />
      </div>
      <div class="coupons-field">
        <label for="pr-cart-add-freeship">Free shipping</label>
        <select id="pr-cart-add-freeship">
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
      </div>
      <div class="coupons-field coupons-field-full">
        <label for="pr-cart-add-products">Products scope (optional)</label>
        <input type="text" id="pr-cart-add-products" placeholder="HH Only" />
      </div>
      <div class="coupons-field coupons-field-full">
        <label for="pr-cart-add-categories">Categories scope (optional)</label>
        <input type="text" id="pr-cart-add-categories" placeholder="Ascent" />
      </div>
    </div>`;
}

/**
 * @param {HTMLDialogElement} dlg
 * @param {RuleRow} row
 */
function applyCartRuleFormPrefill(dlg, row) {
  const setVal = (sel, v) => {
    const el = dlg.querySelector(sel);
    if (el && 'value' in el) /** @type {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} */ (el).value = v;
  };
  setVal('#pr-cart-add-name', row.name || '');
  setVal('#pr-cart-add-min', row.minimumValue != null ? String(row.minimumValue) : '');
  setVal('#pr-cart-add-off', row.salesAmountOff != null ? String(row.salesAmountOff) : '');
  setVal('#pr-cart-add-freeship', /^yes$/i.test(String(row.freeShipping || '').trim()) ? 'yes' : 'no');
  setVal('#pr-cart-add-products', row.products || '');
  setVal('#pr-cart-add-categories', row.categories || '');
}

/**
 * @param {HTMLDialogElement} dlg
 * @returns {RuleRow}
 */
function readCartRuleAddForm(dlg) {
  const name = dlg.querySelector('#pr-cart-add-name')?.value?.trim();
  if (!name) throw new Error('Rule name is required');
  const fs = dlg.querySelector('#pr-cart-add-freeship')?.value === 'yes' ? 'Yes' : 'No';
  return {
    id: '',
    name,
    minimumValue: dlg.querySelector('#pr-cart-add-min')?.value?.trim() || '',
    salesAmountOff: dlg.querySelector('#pr-cart-add-off')?.value?.trim() || '',
    freeShipping: fs,
    products: dlg.querySelector('#pr-cart-add-products')?.value?.trim() || '',
    categories: dlg.querySelector('#pr-cart-add-categories')?.value?.trim() || '',
  };
}

/**
 * @param {HTMLDialogElement} dlg
 * @returns {(typeof COUNTRIES)[number]}
 */
function readCartRuleMarketKeyFromForm(dlg) {
  const v = String(dlg.querySelector('#pr-cart-add-market')?.value ?? '').trim().toLowerCase();
  if (!COUNTRIES.includes(/** @type {(typeof COUNTRIES)[number]} */(v))) {
    throw new Error('Select a valid market');
  }
  return /** @type {(typeof COUNTRIES)[number]} */ (v);
}

/**
 * @param {string} [defaultMarketKey] initial Market select (defaults to list `state.country`)
 */
async function openCartRuleAddDialog(defaultMarketKey) {
  const ok = await fetchCartRulesFromServerOrNotify();
  if (!ok) return;

  let initial = typeof defaultMarketKey === 'string' ? defaultMarketKey.trim().toLowerCase() : state.country;
  if (!COUNTRIES.includes(/** @type {(typeof COUNTRIES)[number]} */(initial))) {
    initial = COUNTRIES.includes(state.country) ? state.country : 'us';
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'coupons-dialog coupons-dialog-wide pr-cart-rule-add-dialog';
  dialog.innerHTML = `
    <div class="coupons-dialog-inner">
      <h2>Add cart rule</h2>
      ${cartRuleAddFormHtml(/** @type {(typeof COUNTRIES)[number]} */(initial))}
      <div class="coupons-dialog-actions">
        <button type="button" class="coupons-btn" data-pr-cart-add-cancel>Cancel</button>
        <button type="button" class="coupons-btn coupons-btn-primary" data-pr-cart-add-submit>Add rule</button>
      </div>
    </div>`;
  document.body.appendChild(dialog);

  const close = () => {
    dialog.close();
    dialog.remove();
  };
  wireDialogEscapeDismiss(dialog, close);
  dialog.querySelector('[data-pr-cart-add-cancel]')?.addEventListener('click', close);
  dialog.querySelector('[data-pr-cart-add-submit]')?.addEventListener('click', async () => {
    try {
      const countryKey = readCartRuleMarketKeyFromForm(dialog);
      const row = readCartRuleAddForm(dialog);
      const existing = Array.isArray(state.cartRulesList) ? state.cartRulesList : [];
      const apiRule = ruleRowToHelixCartRule(countryKey, row, existing);
      const next = [...existing, apiRule];
      await putCartPriceRules(PB_ORG, PB_SITE, next);
      state.cartRulesList = next;
      state.cartDataSource = 'api';
      state.cartLoadError = '';
      showToast('Cart rule added', 'success');
      close();
      render();
    } catch (err) {
      showToast(err?.message || 'Failed to add rule', 'error');
    }
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  dialog.showModal();
}

/**
 * @param {string} ruleId helix cart rule id
 */
async function openCartRuleEditDialog(ruleId) {
  const ok = await fetchCartRulesFromServerOrNotify();
  if (!ok) return;

  const list = Array.isArray(state.cartRulesList) ? state.cartRulesList : [];
  const idx = list.findIndex((r) => String(r.id) === String(ruleId));
  if (idx === -1) {
    showToast('That rule was not found after refresh.', 'error');
    render();
    return;
  }
  const apiRule = list[idx];
  const market = cartRuleMarketFromRule(apiRule);
  const row = helixCartRuleToRuleRow(apiRule);

  const dialog = document.createElement('dialog');
  dialog.className = 'coupons-dialog coupons-dialog-wide pr-cart-rule-add-dialog';
  dialog.innerHTML = `
    <div class="coupons-dialog-inner">
      <h2>Edit cart rule</h2>
      ${cartRuleAddFormHtml(market, { marketLocked: true, ruleId: apiRule.id })}
      <div class="pr-cart-rule-edit-dialog-actions">
        <button type="button" class="coupons-btn coupons-btn-danger" data-pr-cart-rule-delete>Delete rule…</button>
        <div class="pr-cart-rule-edit-actions-end">
          <button type="button" class="coupons-btn" data-pr-cart-add-cancel>Cancel</button>
          <button type="button" class="coupons-btn coupons-btn-primary" data-pr-cart-add-submit>Save changes</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(dialog);
  applyCartRuleFormPrefill(dialog, row);

  const close = () => {
    dialog.close();
    dialog.remove();
  };
  wireDialogEscapeDismiss(dialog, close);
  dialog.querySelector('[data-pr-cart-add-cancel]')?.addEventListener('click', close);
  dialog.querySelector('[data-pr-cart-rule-delete]')?.addEventListener('click', async () => {
    if (!window.confirm(`Delete cart rule "${apiRule.name || ruleId}" (${ruleId})? This cannot be undone.`)) return;
    try {
      if (await deleteCartRuleById(ruleId)) {
        close();
        render();
      }
    } catch (err) {
      showToast(err?.message || 'Delete failed', 'error');
    }
  });
  dialog.querySelector('[data-pr-cart-add-submit]')?.addEventListener('click', async () => {
    try {
      const fresh = Array.isArray(state.cartRulesList) ? state.cartRulesList : [];
      const idxFresh = fresh.findIndex((r) => String(r.id) === String(ruleId));
      if (idxFresh === -1) {
        showToast('Rule disappeared during edit. Refresh and try again.', 'error');
        close();
        render();
        return;
      }
      const fixedMarket = cartRuleMarketFromRule(fresh[idxFresh]);
      const newRow = readCartRuleAddForm(dialog);
      const others = fresh.filter((_, i) => i !== idxFresh);
      const updated = ruleRowToHelixCartRule(fixedMarket, newRow, others, fresh[idxFresh]);
      const next = fresh.slice();
      next[idxFresh] = updated;
      await putCartPriceRules(PB_ORG, PB_SITE, next);
      state.cartRulesList = next;
      state.cartDataSource = 'api';
      state.cartLoadError = '';
      showToast('Cart rule updated', 'success');
      close();
      render();
    } catch (err) {
      showToast(err?.message || 'Failed to update rule', 'error');
    }
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  dialog.showModal();
}

/**
 * Auth boot runs in a prior module, but wait until `commerce-admin-auth-ok` is on
 * `documentElement` before calling ProductBus (avoids racing the class toggle).
 */
async function waitForCommerceAuthReady() {
  if (document.documentElement.classList.contains('commerce-admin-auth-ok')) {
    return;
  }
  await new Promise((resolve) => {
    let n = 0;
    const t = setInterval(() => {
      if (document.documentElement.classList.contains('commerce-admin-auth-ok')) {
        clearInterval(t);
        resolve(undefined);
      } else {
        n += 1;
        if (n > 320) {
          clearInterval(t);
          resolve(undefined);
        }
      }
    }, 32);
  });
}

async function initPricingSources() {
  await waitForCommerceAuthReady();
  const tasks = [];
  if (PR_APP_MODE === 'promotions') tasks.push(loadCatalogFromApi());
  else if (PR_APP_MODE === 'cart-rules') tasks.push(loadCartFromApi());
  else tasks.push(loadCatalogFromApi(), loadCartFromApi());
  await Promise.all(tasks);
}

/**
 * @param {PromotionRow[]} rows
 * @param {Map<string, string>} [thumbByProductUrl] - storefront product URL → catalog thumb URL
 */
function promotionTableHtml(rows, thumbByProductUrl) {
  if (!rows.length) {
    return '<p class="pr-empty">No rows in this promotion.</p>';
  }
  const thumbs = thumbByProductUrl && thumbByProductUrl.size ? thumbByProductUrl : null;
  const labelTh = ['Start', 'End', 'Product', 'Regular Price', 'Sale Price']
    .map((h) => `<th scope="col">${escapeHtml(h)}</th>`)
    .join('');
  const th = `<th class="pim-col-thumb" scope="col"><span class="pim-sr-only">Image</span></th>${labelTh}`;
  const body = rows
    .map((r) => {
      const href = escapeHtml(r.product);
      const imgSrc = thumbs?.get(r.product) || '';
      const thumbCell = imgSrc
        ? `<img src="${escapeHtml(imgSrc)}" alt="" loading="lazy" width="48" height="48" class="pim-thumb-img" />`
        : '<span class="pim-thumb-placeholder" aria-hidden="true"></span>';
      return `<tr>
        <td class="pim-col-thumb pr-promo-table-thumb">${thumbCell}</td>
        <td>${escapeHtml(formatIsoForSaleLineView(r.start))}</td>
        <td>${escapeHtml(formatIsoForSaleLineView(r.end))}</td>
        <td><a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a></td>
        <td>${escapeHtml(r.regularPrice)}</td>
        <td>${escapeHtml(r.salePrice)}</td>
      </tr>`;
    })
    .join('');
  return `<div class="pr-table-wrap"><table class="pr-data-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/**
 * @typedef {object} PromoListRow
 * @property {string} countryKey
 * @property {string} countryLabel
 * @property {string} group list/filter label from `custom.group`
 * @property {string} id
 * @property {string} title
 * @property {number} rowCount
 * @property {PromotionRow[]} rows
 */

/** All promotion sets for the current country (flat list). */
function allPromotionRowsForCountry() {
  const ck = state.country;
  const label = marketLabel(ck) || ck;
  const promotions = promotionsListSource();
  /** @type {PromoListRow[]} */
  const rows = [];
  promotions.forEach((p) => {
    const rulesForCo = catalogRulesForCountryTab(p, ck);
    if (!rulesForCo.length) return;
    const group = promotionCatalogGroup(p, ck);
    rows.push({
      countryKey: ck,
      countryLabel: label,
      group,
      id: p.id,
      title: p.name,
      rowCount: rulesForCo.length,
      rows: rulesForCo.map(catalogRuleToPromotionRow),
    });
  });
  return rows;
}

function filteredPromotionRows() {
  let list = allPromotionRowsForCountry();
  const gf = state.promoListGroupFilter.trim();
  if (gf) list = list.filter((r) => r.group === gf);
  const q = state.promoListSearch.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (r) => r.title.toLowerCase().includes(q) || r.id.toLowerCase().includes(q),
    );
  }
  return list;
}

function promotionGroupFilterOptionsHtml() {
  const groups = [...new Set(allPromotionRowsForCountry().map((r) => r.group))].sort(
    (a, b) => String(b).localeCompare(String(a), undefined, { numeric: true }),
  );
  const curG = state.promoListGroupFilter.trim();
  const allSel = !curG ? ' selected' : '';
  const opts = [`<option value=""${allSel}>All groups</option>`].concat(
    groups.map((g) => {
      const sel = g === curG ? ' selected' : '';
      return `<option value="${escapeHtml(g)}"${sel}>${escapeHtml(g)}</option>`;
    }),
  );
  return opts.join('');
}

function closePromotionDetailDialog() {
  document.querySelector('dialog.pr-promo-detail-dialog')?.remove();
}

function promoMarketTagHtml(countryKey) {
  const m = String(countryKey || '').toLowerCase();
  const labels = { us: 'US', ca: 'CA', mx: 'MX' };
  const classes = { us: 'coupons-tag-us', ca: 'coupons-tag-ca', mx: 'coupons-tag-mx' };
  const label = labels[m];
  if (!label) return '<span class="coupons-tag coupons-tag-muted">—</span>';
  return `<span class="coupons-tag ${classes[m]}">${label}</span>`;
}

function promoPillHtml(label, on) {
  const cl = on ? 'coupons-pill coupons-pill-on' : 'coupons-pill coupons-pill-off';
  return `<span class="${cl}">${escapeHtml(label)}</span>`;
}

function ruleSlugFromName(name) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return s.slice(0, 56) || 'rule';
}

function closeCartRuleDetailDialog() {
  document.querySelector('dialog.pr-cart-rule-dialog')?.remove();
}

function closeAllPricingDetailDialogs() {
  closePromotionDetailDialog();
  closeCartRuleDetailDialog();
}

function wireCartRuleDetailDialog(dialog) {
  const shut = () => {
    dialog.close();
    dialog.remove();
  };
  wireDialogEscapeDismiss(dialog, shut);
  dialog.querySelector('[data-pr-cart-rule-modal-done]')?.addEventListener('click', shut);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) shut();
  });
}

/**
 * @param {string} countryKey
 * @param {string} countryLabel
 * @param {RuleRow} rule
 * @param {string} [helixRuleId] stable rule id when loaded from API
 */
function cartRuleDetailModalInnerHtml(countryKey, countryLabel, rule, helixRuleId = '') {
  const slug = ruleSlugFromName(rule.name);
  const path = helixRuleId ? String(helixRuleId) : `${countryKey.toUpperCase()} / rules / ${slug}`;
  const minDisplay = rule.minimumValue != null && String(rule.minimumValue).trim() !== ''
    ? `$${String(rule.minimumValue).trim()}`
    : 'None';
  const offDisplay = rule.salesAmountOff != null && String(rule.salesAmountOff).trim() !== ''
    ? String(rule.salesAmountOff).trim()
    : '—';
  const fs = /^yes$/i.test(String(rule.freeShipping || '').trim());
  const hasMin = Boolean(rule.minimumValue != null && String(rule.minimumValue).trim() !== '');
  const hasOff = Boolean(rule.salesAmountOff != null && String(rule.salesAmountOff).trim() !== '');
  let heroMain = '—';
  let heroSub = 'Cart price rule';
  if (hasOff) {
    heroMain = offDisplay;
    heroSub = 'off qualifying subtotal';
  } else if (fs && hasMin) {
    heroMain = `≥ ${minDisplay}`;
    heroSub = 'cart for free shipping';
  } else if (fs) {
    heroMain = 'Free shipping';
    heroSub = 'benefit on qualifying orders';
  }

  const scopeParts = [rule.products, rule.categories]
    .map((x) => (x != null ? String(x).trim() : ''))
    .filter(Boolean);
  const scopeTags = scopeParts.length
    ? scopeParts.map((p) => `<span class="coupons-mini-tag">${escapeHtml(p)}</span>`).join('')
    : '<span class="coupons-muted">Default scope</span>';

  const pills = [
    promoPillHtml('Free shipping', fs),
    promoPillHtml('Order minimum', hasMin),
    promoPillHtml('Percent / amount off', hasOff),
  ].join('');

  return `
    <div class="coupons-modal-head">
      <div class="coupons-modal-badges">
        ${promoMarketTagHtml(countryKey)}
        <span class="coupons-tag coupons-tag-slug">${escapeHtml(slug)}</span>
      </div>
      <h2 class="coupons-modal-title">${escapeHtml(rule.name)}</h2>
      <p class="coupons-modal-idline"><code>${escapeHtml(path)}</code></p>
    </div>
    <div class="coupons-modal-hero">
      <div class="coupons-modal-hero-inner">
        <span class="coupons-modal-hero-kicker">Primary effect</span>
        <span class="coupons-modal-hero-value">${escapeHtml(heroMain)}</span>
        <span class="coupons-modal-hero-note">${escapeHtml(heroSub)}</span>
      </div>
    </div>
    <div class="coupons-modal-stats" role="list">
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Market</span><span class="coupons-modal-stat-value">${escapeHtml(countryLabel)}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Minimum cart</span><span class="coupons-modal-stat-value">${escapeHtml(minDisplay)}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Amount off</span><span class="coupons-modal-stat-value">${escapeHtml(offDisplay)}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Free shipping</span><span class="coupons-modal-stat-value">${escapeHtml(fs ? 'Yes' : 'No')}</span></div>
    </div>
    <div class="coupons-modal-pills" aria-label="Rule flags">${pills}</div>
    <section class="coupons-modal-section">
      <h3 class="coupons-modal-section-title">Product / category scope</h3>
      <div class="coupons-modal-tags">${scopeTags}</div>
    </section>`;
}

function openCartRuleDetailModal(countryKey, ruleIndex) {
  const rules = rulesForCountry(countryKey);
  const rule = rules[ruleIndex];
  if (!rule) return;
  const apiRules = rulesForCountryApi(countryKey);
  const apiRule = state.cartDataSource === 'api' ? apiRules[ruleIndex] : null;
  const countryLabel = marketLabel(countryKey) || countryKey;
  closeCartRuleDetailDialog();
  const humanHtml = cartRuleDetailModalInnerHtml(countryKey, countryLabel, rule, apiRule?.id || '');
  const dialog = document.createElement('dialog');
  dialog.className = 'pr-cart-rule-dialog coupons-detail-dialog';

  const toolbar = document.createElement('div');
  toolbar.className = 'commerce-detail-modal-toolbar';
  const scroll = document.createElement('div');
  scroll.className = 'coupons-detail-dialog-scroll';

  const bodyHost = document.createElement('div');
  const shut = () => {
    dialog.close();
    dialog.remove();
  };
  const toolbarMain = document.createElement('div');
  toolbarMain.className = 'commerce-detail-modal-toolbar-main';
  mountPromoteProductionInToolbar(toolbarMain, {
    org: PB_ORG,
    site: PB_SITE,
    entityKind: 'cart-rule',
    getPayload: () => ({
      country: countryKey,
      ruleIndex,
      rule,
      apiRule,
      cartRules: state.cartDataSource === 'api' && Array.isArray(state.cartRulesList)
        ? state.cartRulesList
        : null,
    }),
  });
  const header = createDetailModalHeaderCloseAndJson({
    bodyHost,
    getHumanNode() {
      const w = document.createElement('div');
      w.innerHTML = humanHtml;
      return w;
    },
    getJsonValue: () => apiRule || rule,
    onClose: shut,
  });
  toolbar.append(toolbarMain, header.headerRight);
  header.resetToHuman();

  scroll.append(bodyHost);
  const footer = document.createElement('footer');
  footer.className = 'coupons-modal-footer';
  const deleteBtn = apiRule?.id
    ? '<button type="button" class="coupons-btn coupons-btn-danger" data-pr-cart-rule-modal-delete>Delete…</button> '
    : '';
  const editBtn = apiRule?.id
    ? '<button type="button" class="coupons-btn" data-pr-cart-rule-modal-edit>Edit…</button> '
    : '';
  footer.innerHTML = `${deleteBtn}${editBtn}<button type="button" class="coupons-btn coupons-btn-primary" data-pr-cart-rule-modal-done>Done</button>`;
  dialog.append(toolbar, scroll, footer);
  document.body.appendChild(dialog);
  wireCartRuleDetailDialog(dialog);
  footer.querySelector('[data-pr-cart-rule-modal-delete]')?.addEventListener('click', async () => {
    const id = apiRule?.id;
    if (!id) return;
    if (!window.confirm(`Delete cart rule "${rule.name}" (${id})? This cannot be undone.`)) return;
    try {
      if (await deleteCartRuleById(id)) {
        shut();
        render();
      }
    } catch (err) {
      showToast(err?.message || 'Delete failed', 'error');
    }
  });
  footer.querySelector('[data-pr-cart-rule-modal-edit]')?.addEventListener('click', () => {
    const id = apiRule?.id;
    if (!id) return;
    shut();
    openCartRuleEditDialog(id).catch((err) => {
      showToast(err?.message || 'Could not open editor', 'error');
    });
  });
  dialog.showModal();
}

function renderCartRulesOverview() {
  const ck = state.country;
  const rules = rulesForCountry(ck);
  const q = state.cartRuleSearch.trim().toLowerCase();
  const ruleSearchMatch = (r) => {
    const hay = [
      r.name,
      r.id,
      r.minimumValue,
      r.salesAmountOff,
      r.freeShipping,
      r.products,
      r.categories,
    ]
      .map((x) => String(x ?? '').toLowerCase())
      .join(' ');
    return hay.includes(q);
  };
  const filtered = !q ? rules : rules.filter(ruleSearchMatch);
  const searchVal = escapeHtml(state.cartRuleSearch);

  let tbodyHtml;
  if (!rules.length) {
    tbodyHtml = '<tr><td colspan="7" class="pr-empty-cell">No cart rules for this country.</td></tr>';
  } else if (!filtered.length) {
    tbodyHtml = '<tr><td colspan="7" class="pr-empty-cell">No rules match your search.</td></tr>';
  } else {
    tbodyHtml = filtered
      .map((r) => {
        const idx = rules.indexOf(r);
        const min = r.minimumValue != null && String(r.minimumValue).trim() !== ''
          ? `$${escapeHtml(String(r.minimumValue))}`
          : '—';
        const off = r.salesAmountOff != null && String(r.salesAmountOff).trim() !== ''
          ? escapeHtml(String(r.salesAmountOff))
          : '—';
        const ship = /^yes$/i.test(String(r.freeShipping || '').trim()) ? 'Yes' : 'No';
        const scope = [r.products, r.categories]
          .map((x) => (x != null ? String(x).trim() : ''))
          .filter(Boolean)
          .join(' · ') || '—';
        const scopeShort = scope.length > 56 ? `${escapeHtml(scope.slice(0, 53))}…` : escapeHtml(scope);
        const ruleId = (r.id && String(r.id).trim()) || ruleSlugFromName(r.name);
        const label = `Open rule ${r.name}`;
        return `<tr class="pr-promo-grid-row pr-cart-rule-row" role="button" tabindex="0" aria-label="${escapeHtml(label)}"
            data-pr-cart-rule-open data-pr-country="${escapeHtml(ck)}" data-pr-rule-idx="${idx}">
            <td class="pr-promo-col-title">${escapeHtml(r.name)}</td>
            <td><code class="pr-promo-id-code">${escapeHtml(ruleId)}</code></td>
            <td>${min}</td>
            <td>${off}</td>
            <td>${ship}</td>
            <td class="pr-cart-rule-scope">${scopeShort}</td>
            <td class="pr-cart-rule-col-market">${commerceMarketEmojiHtml(ck)}</td>
          </tr>`;
      })
      .join('');
  }

  const cartErr = state.cartLoadError
    ? `<p class="pr-api-hint pr-api-hint-error" role="status">${escapeHtml(state.cartLoadError)}</p>`
    : '';

  return `${cartErr}
    <div class="pr-promo-toolbar pim-toolbar pr-promo-toolbar-with-actions">
      <input type="search" id="pr-cart-rule-search" class="pim-search pr-promo-search-wide" placeholder="Search title, id, min, off, scope…" aria-label="Search cart rules" value="${searchVal}" />
      <div class="pr-promo-api-actions">
        <button type="button" class="coupons-btn coupons-btn-primary" data-pr-cart-add>Add cart rule…</button>
      </div>
      <span class="pim-count pr-promo-count">${filtered.length} rule${filtered.length === 1 ? '' : 's'}</span>
    </div>
    <div class="pr-promo-table-wrap pim-list-wrapper">
      <table class="pr-data-table pr-promo-grid-table" aria-label="Cart rules">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Id</th>
            <th scope="col">Min cart</th>
            <th scope="col">Off</th>
            <th scope="col">Free ship</th>
            <th scope="col">Scope</th>
            <th scope="col" class="pr-cart-rule-col-market">Market</th>
          </tr>
        </thead>
        <tbody>${tbodyHtml}</tbody>
      </table>
    </div>`;
}

function catalogLocaleFromVitamixProductUrl(productUrl) {
  try {
    const u = new URL(productUrl);
    const m = u.pathname.match(/\/(us|ca|mx)\/([a-z]{2}_[a-z]{2})\//i);
    if (m) return `${m[1].toLowerCase()}/${m[2].toLowerCase()}`;
  } catch {
    /* ignore */
  }
  return '';
}

function pickCatalogLocaleForPromotionRows(rows, countryKey) {
  const locales = rows.map((r) => catalogLocaleFromVitamixProductUrl(r.product)).filter(Boolean);
  if (locales.length) {
    const counts = new Map();
    locales.forEach((loc) => {
      counts.set(loc, (counts.get(loc) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  if (countryKey === 'ca') return 'ca/en_ca';
  if (countryKey === 'mx') return 'us/en_us';
  return 'us/en_us';
}

function urlKeyFromVitamixProductUrl(productUrl) {
  try {
    const u = new URL(productUrl);
    const marker = '/products/';
    const i = u.pathname.indexOf(marker);
    if (i === -1) return '';
    return u.pathname.slice(i + marker.length).replace(/\/$/, '');
  } catch {
    return '';
  }
}

/**
 * @param {PromotionRow[]} rows
 * @param {string} countryKey
 * @returns {Promise<Map<string, string>>}
 */
async function buildThumbUrlMapForPromotionRows(rows, countryKey) {
  const map = new Map();
  if (!rows.length) return map;
  const locale = pickCatalogLocaleForPromotionRows(rows, countryKey);
  try {
    const json = await fetchProductsIndexForLocale(locale);
    const raw = Array.isArray(json) ? json : (json?.data ?? []);
    const data = Array.isArray(raw) ? raw : [];
    const parents = getParentProducts(data);
    const byUrlKey = new Map();
    parents.forEach((p) => {
      const k = getUrlKeyFromProduct(p);
      if (!k || !p.image) return;
      byUrlKey.set(String(k).toLowerCase(), resolveImageUrlForLocale(locale, p.image));
    });
    rows.forEach((r) => {
      const slug = urlKeyFromVitamixProductUrl(r.product);
      const src = slug ? byUrlKey.get(String(slug).toLowerCase()) : '';
      if (src) map.set(r.product, src);
    });
  } catch (err) {
    /* eslint-disable-next-line no-console -- intentional: index/CORS failures are non-fatal */
    console.warn('[commerce-admin/promotions] catalog index for thumbnails failed', {
      locale,
      message: err?.message || String(err),
    });
  }
  return map;
}

/** @param {unknown} value sale line start/end (ISO or em dash) */
function promotionRowInstantMs(value) {
  const s = String(value ?? '').trim();
  if (!s || s === '—') return NaN;
  const t = Date.parse(s);
  return Number.isNaN(t) ? NaN : t;
}

/** @param {number} ms */
function formatPromotionDurationMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const days = Math.round(ms / 86400000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.round(ms / 3600000);
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const mins = Math.max(1, Math.round(ms / 60000));
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}

const PR_PROMO_CAL_MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Seven calendar month labels spanning three months before `date` through three months after
 * (same window as `blocks/alert-banners` `createTimeline`).
 *
 * @param {Date} date
 */
function promotionCalendarSixMonthWindow(date) {
  const currentMonth = date.getMonth();
  const currentYear = date.getFullYear();

  let startMonth = currentMonth - 3;
  let startYear = currentYear;
  if (startMonth < 0) {
    startMonth += 12;
    startYear -= 1;
  }
  const rangeStart = new Date(startYear, startMonth, 1);

  let endMonth = currentMonth + 3;
  let endYear = currentYear;
  if (endMonth > 11) {
    endMonth -= 12;
    endYear += 1;
  }
  const rangeEnd = new Date(endYear, endMonth + 1, 0, 23, 59, 59, 999);

  const rangeDuration = rangeEnd.getTime() - rangeStart.getTime();

  /** @type {{ month: number, year: number, name: string }[]} */
  const displayMonths = [];
  let m = startMonth;
  let y = startYear;
  for (let i = 0; i < 7; i += 1) {
    displayMonths.push({ month: m, year: y, name: PR_PROMO_CAL_MONTH_NAMES[m] });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }

  return {
    rangeStart,
    rangeEnd,
    rangeDuration,
    displayMonths,
    startYear,
    endYear,
  };
}

/**
 * Earliest parseable start; latest parseable end, or `null` end when any sale line lacks a
 * parseable end (open-ended, clamped to the visible window for drawing).
 *
 * @param {PromotionRow[]} rows
 * @returns {{ minStart: Date, maxEnd: Date | null } | null}
 */
function promotionWindowForTimeline(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let minS = Infinity;
  let maxE = -Infinity;
  let allEnds = true;
  rows.forEach((r) => {
    const s = promotionRowInstantMs(r?.start);
    const e = promotionRowInstantMs(r?.end);
    if (!Number.isNaN(s)) minS = Math.min(minS, s);
    if (!Number.isNaN(e)) maxE = Math.max(maxE, e);
    else allEnds = false;
  });
  if (minS === Infinity) return null;
  if (!allEnds) return { minStart: new Date(minS), maxEnd: null };
  if (maxE === -Infinity || maxE < minS) return null;
  return { minStart: new Date(minS), maxEnd: new Date(maxE) };
}

/**
 * @param {Date} minStart
 * @param {Date | null} maxEnd
 * @param {Date} date
 */
function promotionRangePastFuture(minStart, maxEnd, date) {
  const afterStart = minStart <= date;
  const beforeEnd = !maxEnd || maxEnd >= date;
  if (afterStart && beforeEnd) return 'current';
  if (minStart > date) return 'future';
  return 'past';
}

/** Promotions overview (`promotions.html`): calendar strip between page title and country tabs. */
function renderPromotionsOverviewCalendarHtml() {
  const now = new Date();
  const win = promotionCalendarSixMonthWindow(now);

  const yearLabel = win.startYear === win.endYear
    ? String(win.startYear)
    : `${win.startYear}–${win.endYear}`;

  const monthsRowHtml = win.displayMonths
    .map(({ name }) => `<div class="pr-promo-cal-month">${escapeHtml(name)}</div>`)
    .join('');

  const list = filteredPromotionRows().slice().sort((a, b) => {
    const wa = promotionWindowForTimeline(a.rows);
    const wb = promotionWindowForTimeline(b.rows);
    const ta = wa ? wa.minStart.getTime() : 0;
    const tb = wb ? wb.minStart.getTime() : 0;
    return ta - tb;
  });

  const { rangeStart, rangeEnd, rangeDuration } = win;
  const rangeStartMs = rangeStart.getTime();
  const rangeEndMs = rangeEnd.getTime();

  let selectedDone = false;
  /** @type {string[]} */
  const rowsHtmlParts = [];

  list.forEach((r) => {
    const w = promotionWindowForTimeline(r.rows);
    if (!w) return;

    const startTime = w.minStart.getTime();
    const endTime = w.maxEnd ? w.maxEnd.getTime() : rangeEndMs;

    const visibleStart = Math.max(startTime, rangeStartMs);
    const visibleEnd = Math.min(endTime, rangeEndMs);

    if (visibleEnd < rangeStartMs || visibleStart > rangeEndMs) return;

    const leftPercent = ((visibleStart - rangeStartMs) / rangeDuration) * 100;
    const rawWidth = ((visibleEnd - visibleStart) / rangeDuration) * 100;
    const widthPercent = Math.max(rawWidth, 0.35);

    const pf = promotionRangePastFuture(w.minStart, w.maxEnd, now);
    let cls = 'current';
    if (pf === 'past') cls = 'past';
    else if (pf === 'future') cls = 'future';
    let selected = '';
    if (cls === 'current' && !selectedDone) {
      selected = ' pr-promo-cal-bar-selected';
      selectedDone = true;
    }

    const fullStart = formatIsoForSaleLineView(w.minStart.toISOString());
    const fullEnd = w.maxEnd ? formatIsoForSaleLineView(w.maxEnd.toISOString()) : 'open-ended';
    const dur = w.maxEnd
      ? formatPromotionDurationMs(w.maxEnd.getTime() - w.minStart.getTime())
      : '';
    const tip = dur ? `${fullStart} → ${fullEnd} (${dur})` : `${fullStart} → ${fullEnd}`;

    /** @type {string[]} */
    const barClasses = [`pr-promo-cal-bar pr-promo-cal-bar-${cls}${selected}`];
    if (startTime < rangeStartMs) barClasses.push('pr-promo-cal-bar-open-start');
    if (!w.maxEnd || w.maxEnd.getTime() > rangeEndMs) barClasses.push('pr-promo-cal-bar-open-end');

    rowsHtmlParts.push(
      `<div class="pr-promo-cal-row">
        <div class="pr-promo-cal-track">
          <div class="${barClasses.join(' ')}" style="left:${Math.max(0, leftPercent)}%;width:${Math.min(100, widthPercent)}%" title="${escapeHtml(`${r.title} — ${tip}`)}"></div>
        </div>
      </div>`,
    );
  });

  let bodyRowsHtml;
  if (rowsHtmlParts.length) {
    bodyRowsHtml = rowsHtmlParts.join('');
  } else if (!allPromotionRowsForCountry().length) {
    bodyRowsHtml = `<div class="pr-promo-cal-row pr-promo-cal-row-empty" role="status">
        <p class="pr-promo-cal-empty-msg">No catalog promotions for this market in this view.</p>
      </div>`;
  } else if (!list.length) {
    bodyRowsHtml = `<div class="pr-promo-cal-row pr-promo-cal-row-empty" role="status">
        <p class="pr-promo-cal-empty-msg">No promotions match your filters; adjust search or group to see spans.</p>
      </div>`;
  } else {
    bodyRowsHtml = `<div class="pr-promo-cal-row pr-promo-cal-row-empty" role="status">
        <p class="pr-promo-cal-empty-msg">No promotions in this list overlap this six-month window, or none have parseable sale dates.</p>
      </div>`;
  }

  let nowHtml = '';
  const nowMs = now.getTime();
  if (nowMs >= rangeStartMs && nowMs <= rangeEndMs) {
    const nowPercent = ((nowMs - rangeStartMs) / rangeDuration) * 100;
    const d = now.getMonth() + 1;
    const day = now.getDate();
    nowHtml = `<div class="pr-promo-cal-now" style="left:${nowPercent}%">
        <span class="pr-promo-cal-now-label">${d}/${day}</span>
        <span class="pim-sr-only">Today</span>
      </div>`;
  }

  return `<div class="pr-promo-cal" role="region" aria-label="Promotion sale spans across seven months">
    <div class="pr-promo-cal-inner">
      <div class="pr-promo-cal-header">
        <div class="pr-promo-cal-year">${escapeHtml(yearLabel)}</div>
        <div class="pr-promo-cal-months">${monthsRowHtml}</div>
      </div>
      <div class="pr-promo-cal-body">
        ${nowHtml}
        <div class="pr-promo-cal-rows">${bodyRowsHtml}</div>
      </div>
    </div>
  </div>`;
}

/**
 * @param {string} countryKey
 * @param {string} groupLabel display label from rule <code>custom.group</code>
 * @param {string} countryLabel
 * @param {PromotionSet} set
 * @param {Map<string, string>} thumbByProductUrl
 */
function promotionDetailModalInnerHtml(
  countryKey,
  groupLabel,
  countryLabel,
  set,
  thumbByProductUrl,
) {
  const { id } = set;
  const fullPath = `${countryKey.toUpperCase()} / promotions / ${groupLabel} / ${id}`;
  const rows = Array.isArray(set.rows) ? set.rows : [];
  const n = rows.length;
  const starts = rows.map((r) => r.start);
  const ends = rows.map((r) => r.end);
  const uniformDates = n > 0 && new Set(starts).size === 1 && new Set(ends).size === 1;
  const heroMain = uniformDates ? formatIsoForSaleLineView(String(starts[0])) : String(n);
  const heroSub = uniformDates
    ? `through ${formatIsoForSaleLineView(String(ends[0]))} · ${n} product line${n === 1 ? '' : 's'}`
    : 'sale line entries in this promotion (dates vary per row)';
  const uniqProducts = new Set(rows.map((r) => r.product)).size;
  const pills = [
    promoPillHtml('Multi-line', n > 1),
    promoPillHtml('Uniform window', uniformDates),
  ].join('');

  return `
    <div class="coupons-modal-head">
      <div class="coupons-modal-badges">
        ${promoMarketTagHtml(countryKey)}
        ${commerceGroupBadgeHtml(groupLabel)}
        <span class="coupons-tag coupons-tag-slug">${escapeHtml(id)}</span>
      </div>
      <h2 class="coupons-modal-title">${escapeHtml(set.title)}</h2>
      <p class="coupons-modal-idline"><code>${escapeHtml(fullPath)}</code></p>
    </div>
    <div class="coupons-modal-hero">
      <div class="coupons-modal-hero-inner">
        <span class="coupons-modal-hero-kicker">${uniformDates ? 'Sale window' : 'Sale lines'}</span>
        <span class="coupons-modal-hero-value">${escapeHtml(heroMain)}</span>
        <span class="coupons-modal-hero-note">${escapeHtml(heroSub)}</span>
      </div>
    </div>
    <div class="coupons-modal-stats" role="list">
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Market</span><span class="coupons-modal-stat-value">${escapeHtml(countryLabel)}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Group</span><span class="coupons-modal-stat-value">${commerceGroupBadgeHtml(groupLabel)}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Sale lines</span><span class="coupons-modal-stat-value">${String(n)}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Unique products</span><span class="coupons-modal-stat-value">${String(uniqProducts)}</span></div>
    </div>
    <div class="coupons-modal-pills" aria-label="Promotion shape">${pills}</div>
    <section class="coupons-modal-section">
      <h3 class="coupons-modal-section-title">Sale line table</h3>
      ${promotionTableHtml(rows, thumbByProductUrl)}
    </section>`;
}

/**
 * @param {HTMLDialogElement} dialog
 * @param {() => void} shut same close handler as modal header JSON `onClose`
 */
function wirePromotionDetailDialog(dialog, shut) {
  wireDialogEscapeDismiss(dialog, shut);
  dialog.querySelector('[data-pr-promo-modal-done]')?.addEventListener('click', shut);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) shut();
  });
}

/**
 * @param {string} countryKey
 * @param {string} promoId
 */
async function openPromotionDetailModal(countryKey, promoId) {
  const catalogPromo = promotionsListSource().find((p) => p.id === promoId);
  if (!catalogPromo) return;
  const rulesForCo = catalogRulesForCountryTab(catalogPromo, countryKey);
  if (!rulesForCo.length) return;
  const displayGroup = promotionCatalogGroup(catalogPromo, countryKey);
  /** @type {PromotionSet} */
  const set = {
    id: catalogPromo.id,
    title: catalogPromo.name,
    rows: rulesForCo.map(catalogRuleToPromotionRow),
  };
  const countryLabel = marketLabel(countryKey) || countryKey;
  closePromotionDetailDialog();
  const rows = Array.isArray(set.rows) ? set.rows : [];
  const thumbByProductUrl = await buildThumbUrlMapForPromotionRows(rows, countryKey);
  const humanHtml = promotionDetailModalInnerHtml(
    countryKey,
    displayGroup,
    countryLabel,
    set,
    thumbByProductUrl,
  );
  const dialog = document.createElement('dialog');
  dialog.className = 'pr-promo-detail-dialog coupons-detail-dialog';

  const toolbar = document.createElement('div');
  toolbar.className = 'commerce-detail-modal-toolbar';
  const scroll = document.createElement('div');
  scroll.className = 'coupons-detail-dialog-scroll';

  const bodyHost = document.createElement('div');
  const shut = () => {
    dialog.close();
    dialog.remove();
  };
  const toolbarMain = document.createElement('div');
  toolbarMain.className = 'commerce-detail-modal-toolbar-main';
  mountPromoteProductionInToolbar(toolbarMain, {
    org: PB_ORG,
    site: PB_SITE,
    entityKind: 'promotion',
    getPayload: () => ({
      country: countryKey,
      group: displayGroup,
      promotion: catalogPromo,
    }),
  });
  const header = createDetailModalHeaderCloseAndJson({
    bodyHost,
    getHumanNode() {
      const w = document.createElement('div');
      w.innerHTML = humanHtml;
      return w;
    },
    getJsonValue: () => catalogPromo,
    onClose: shut,
  });
  toolbar.append(toolbarMain, header.headerRight);
  header.resetToHuman();

  scroll.append(bodyHost);
  const footer = document.createElement('footer');
  footer.className = 'coupons-modal-footer';
  const canMutate = state.catalogDataSource === 'api';
  const deleteBtn = canMutate
    ? '<button type="button" class="coupons-btn coupons-btn-danger" data-pr-promo-modal-delete>Delete…</button> '
    : '';
  const editBtn = canMutate
    ? '<button type="button" class="coupons-btn" data-pr-promo-modal-edit>Edit…</button> '
    : '';
  footer.innerHTML = `${deleteBtn}${editBtn}<button type="button" class="coupons-btn coupons-btn-primary" data-pr-promo-modal-done>Done</button>`;
  dialog.append(toolbar, scroll, footer);
  document.body.appendChild(dialog);
  wirePromotionDetailDialog(dialog, shut);
  footer.querySelector('[data-pr-promo-modal-delete]')?.addEventListener('click', async () => {
    if (!canMutate) return;
    if (!window.confirm(`Delete promotion "${catalogPromo.name || promoId}" (${promoId})? This cannot be undone.`)) return;
    try {
      if (await deletePromotionById(promoId)) {
        shut();
        render();
      }
    } catch (err) {
      showToast(err?.message || 'Delete failed', 'error');
    }
  });
  footer.querySelector('[data-pr-promo-modal-edit]')?.addEventListener('click', () => {
    if (!canMutate) return;
    shut();
    openPromotionEditDialog(countryKey, promoId).catch((err) => {
      showToast(err?.message || 'Could not open editor', 'error');
    });
  });
  dialog.showModal();
}

function renderPromotionsListPanel() {
  const list = filteredPromotionRows();
  const searchVal = escapeHtml(state.promoListSearch);
  const hasPromos = allPromotionRowsForCountry().length > 0;

  let tbodyHtml;
  if (!hasPromos) {
    tbodyHtml = '<tr><td colspan="5" class="pr-empty-cell">No catalog promotions for this country (empty API list or no matching paths).</td></tr>';
  } else if (!list.length) {
    tbodyHtml = '<tr><td colspan="5" class="pr-empty-cell">No promotions match your filters.</td></tr>';
  } else {
    tbodyHtml = list
      .map((r) => {
        const label = `Open promotion ${r.title}`;
        return `<tr class="pr-promo-grid-row" role="button" tabindex="0" aria-label="${escapeHtml(label)}"
            data-pr-promo-open data-pr-country="${escapeHtml(r.countryKey)}" data-pr-id="${escapeHtml(r.id)}">
            <td class="pr-promo-col-title">${escapeHtml(r.title)}</td>
            <td><code class="pr-promo-id-code">${escapeHtml(r.id)}</code></td>
            <td>${r.rowCount}</td>
            <td class="pr-promo-col-group">${commerceGroupBadgeHtml(r.group)}</td>
            <td class="pr-promo-col-market">${commerceMarketEmojiHtml(r.countryKey)}</td>
          </tr>`;
      })
      .join('');
  }

  const catalogErr = state.catalogLoadError
    ? `<p class="pr-api-hint pr-api-hint-error" role="status">${escapeHtml(state.catalogLoadError)}</p>`
    : '';

  return `${catalogErr}
    <div class="pr-promo-toolbar pim-toolbar pr-promo-toolbar-with-actions">
      <input type="search" id="pr-promo-search" class="pim-search pr-promo-search-wide" placeholder="Search title or promotion id…" aria-label="Search promotions" value="${searchVal}" />
      <div class="pr-promo-api-actions">
        <button type="button" class="coupons-btn coupons-btn-primary" data-pr-promo-add>Add promotion…</button>
      </div>
      <div class="pr-promo-toolbar-right">
        <div class="pr-promo-filter-field">
          <label class="pr-promo-filter-label" for="pr-promo-group">Group</label>
          <select id="pr-promo-group" class="pim-index-select pr-promo-year-select" aria-label="Filter by group">
            ${promotionGroupFilterOptionsHtml()}
          </select>
        </div>
        <span class="pim-count pr-promo-count">${list.length} promotion${list.length === 1 ? '' : 's'}</span>
      </div>
    </div>
    <div class="pr-promo-table-wrap pim-list-wrapper">
      <table class="pr-data-table pr-promo-grid-table" aria-label="Promotions">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Id</th>
            <th scope="col">Rows</th>
            <th scope="col" class="pr-promo-col-group">Group</th>
            <th scope="col" class="pr-promo-col-market">Market</th>
          </tr>
        </thead>
        <tbody>${tbodyHtml}</tbody>
      </table>
    </div>`;
}

function renderMockBanner() {
  const couponsLink = '<a href="coupons.html">Open Coupons</a> for code-based discounts (R2 / ProductBus API).';
  const cartLine = PR_APP_MODE !== 'promotions'
    ? '<strong>Cart rules</strong> load from <code>GET …/price-rules/cart</code> as a JSON array (helix-commerce-api).'
    : '';
  const promoLine = PR_APP_MODE !== 'cart-rules'
    ? '<strong>Catalog promotions</strong> load from <code>GET …/price-rules/catalog</code> '
    + 'as <code>{ promotions: CatalogPromotion[] }</code>.'
    : '';
  if (PR_APP_MODE === 'cart-rules' || PR_APP_MODE === 'promotions') {
    return '';
  }
  return `<div class="price-rules-mock-banner">${cartLine} ${promoLine} ${couponsLink}</div>`;
}

function renderCountryTabs() {
  return COUNTRIES.map((key) => {
    const sel = key === state.country ? 'true' : 'false';
    const label = marketLabel(key);
    return `<button type="button" class="pr-tab" role="tab" aria-selected="${sel}" data-pr-country="${key}">${escapeHtml(label)}</button>`;
  }).join('');
}

function renderAreaTabs() {
  const labels = { rules: 'Rules', promotions: 'Promotions' };
  return AREAS.map((key) => {
    const sel = key === state.area ? 'true' : 'false';
    return `<button type="button" class="pr-tab" role="tab" aria-selected="${sel}" data-pr-area="${key}">${escapeHtml(labels[key])}</button>`;
  }).join('');
}

function renderPromotionsPanel() {
  return `<h2 class="pr-section-title">Promotions</h2>
    ${renderPromotionsListPanel()}`;
}

/** Promotions page (`promotions.html`): list only — page `h1` already names the tool. */
function renderPromotionsStandaloneMount() {
  return renderPromotionsListPanel();
}

function renderRulesPanel() {
  const heading = PR_APP_MODE === 'cart-rules' ? 'Cart Rules' : 'Rules';
  return `<h2 class="pr-section-title">${escapeHtml(heading)}</h2>
    ${renderCartRulesOverview()}
    <p class="pr-section-hint" style="margin-top:16px">Coupon <strong>programs</strong> (types, codes, batches) live in
      <a href="coupons.html">Coupons</a> — ProductBus <code>…/coupons/types</code> and <code>…/coupons</code>.</p>`;
}

/** Cart rules page (`cart-rules.html`): overview only; the page title is the main heading. */
function renderCartRulesStandaloneMount() {
  return renderCartRulesOverview();
}

function renderRulesBlockForPage() {
  return PR_APP_MODE === 'cart-rules' ? renderCartRulesStandaloneMount() : renderRulesPanel();
}

function render() {
  const mount = document.getElementById('price-rules-mount');
  if (!mount) return;

  const panels = {
    rules: renderRulesBlockForPage(),
    promotions: PR_APP_MODE === 'promotions' ? renderPromotionsStandaloneMount() : renderPromotionsPanel(),
  };

  const areaTabsHtml = PR_APP_MODE === 'both'
    ? `<div class="pr-area-tabs" role="tablist" aria-label="Pricing data type">${renderAreaTabs()}</div>`
    : '';

  mount.innerHTML = `
    ${renderMockBanner()}
    <div class="pr-country-tabs" role="tablist" aria-label="Country">${renderCountryTabs()}</div>
    ${areaTabsHtml}
    <div class="pr-panel" role="tabpanel">${panels[state.area]}</div>
  `;

  const promoTimelineRoot = document.getElementById('pr-promo-overview-timeline-root');
  if (promoTimelineRoot) {
    if (PR_APP_MODE === 'promotions') {
      promoTimelineRoot.innerHTML = renderPromotionsOverviewCalendarHtml();
      promoTimelineRoot.removeAttribute('hidden');
    } else {
      promoTimelineRoot.innerHTML = '';
      promoTimelineRoot.setAttribute('hidden', '');
    }
  }

  mount.querySelectorAll('[data-pr-country]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-pr-country');
      if (!key || key === state.country) return;
      state.country = /** @type {(typeof COUNTRIES)[number]} */ (key);
      state.promoListSearch = '';
      state.promoListGroupFilter = '';
      state.cartRuleSearch = '';
      closeAllPricingDetailDialogs();
      render();
    });
  });

  if (PR_APP_MODE === 'both') {
    mount.querySelectorAll('[data-pr-area]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-pr-area');
        if (!key || key === state.area) return;
        state.area = /** @type {typeof state.area} */ (key);
        render();
      });
    });
  }

  if (state.area === 'rules') {
    const crSearch = mount.querySelector('#pr-cart-rule-search');
    if (crSearch) {
      crSearch.addEventListener('input', () => {
        state.cartRuleSearch = crSearch.value;
        const start = crSearch.selectionStart;
        const end = crSearch.selectionEnd;
        render();
        const next = document.getElementById('pr-cart-rule-search');
        if (next) {
          next.focus();
          if (typeof start === 'number' && typeof end === 'number') {
            next.setSelectionRange(start, end);
          }
        }
      });
    }
    const openRuleFromRow = (row) => {
      const ck = row.getAttribute('data-pr-country') || '';
      const idxRaw = row.getAttribute('data-pr-rule-idx');
      const idx = idxRaw != null ? Number(idxRaw) : NaN;
      if (!ck || Number.isNaN(idx)) return;
      openCartRuleDetailModal(ck, idx);
    };
    mount.querySelectorAll('tr.pr-cart-rule-row[data-pr-cart-rule-open]').forEach((row) => {
      row.addEventListener('click', () => {
        openRuleFromRow(row);
      });
      row.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openRuleFromRow(row);
        }
      });
    });

    mount.querySelector('[data-pr-cart-add]')?.addEventListener('click', () => {
      openCartRuleAddDialog(state.country).catch((err) => {
        showToast(err?.message || 'Could not open add rule', 'error');
      });
    });
  }

  if (state.area === 'promotions') {
    const search = mount.querySelector('#pr-promo-search');
    if (search) {
      search.addEventListener('input', () => {
        state.promoListSearch = search.value;
        const start = search.selectionStart;
        const end = search.selectionEnd;
        render();
        const next = document.getElementById('pr-promo-search');
        if (next) {
          next.focus();
          if (typeof start === 'number' && typeof end === 'number') {
            next.setSelectionRange(start, end);
          }
        }
      });
    }
    mount.querySelector('#pr-promo-group')?.addEventListener('change', (e) => {
      const t = /** @type {HTMLSelectElement} */ (e.target);
      state.promoListGroupFilter = t.value;
      render();
    });

    const openFromRow = (row) => {
      const ck = row.getAttribute('data-pr-country') || '';
      const id = row.getAttribute('data-pr-id') || '';
      if (!ck || !id) return;
      openPromotionDetailModal(ck, id).catch((err) => {
        /* eslint-disable-next-line no-console -- modal/index failures */
        console.warn('[commerce-admin/promotions] open promotion modal failed', {
          message: err?.message || String(err),
        });
      });
    };

    mount.querySelectorAll('tr.pr-promo-grid-row[data-pr-promo-open]').forEach((row) => {
      row.addEventListener('click', () => {
        openFromRow(row);
      });
      row.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openFromRow(row);
        }
      });
    });

    mount.querySelector('[data-pr-promo-add]')?.addEventListener('click', () => {
      openPromotionAddDialog().catch((err) => {
        showToast(err?.message || 'Could not open add promotion', 'error');
      });
    });
  }
}

initPricingSources()
  .then(() => render())
  .catch((err) => {
    /* eslint-disable-next-line no-console -- boot fallback */
    console.warn('[commerce-admin/price-rules] init failed', err);
    render();
  });
