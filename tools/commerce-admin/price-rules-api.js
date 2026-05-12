/**
 * ProductBus catalog + cart price rules (commerce-admin).
 *
 * Shapes match **helix-commerce-api**
 * (`src/schemas/PriceRules.js`, `src/routes/price-rules/*-handler.js`):
 * - **Catalog** `GET/PUT …/price-rules/catalog`:
 *   JSON object `{ promotions: CatalogPromotion[] }` (not a bare array).
 *   Each `CatalogPriceRule` requires `path`, `price` (string or number; server stores string).
 *   Optional `start` / `end` must be **ISO 8601** timestamps.
 *   Optional `custom` is string values only.
 *   Optional `variants` maps sku → `{ sku, price, start?, end?, custom? }`.
 * - **Cart** `GET/PUT …/price-rules/cart`: JSON **array** of cart rules (`CartPriceRulesSchema`).
 */
import { apiFetch } from './commerce-otp-api.js';

/** @typedef {Record<string, string>} PriceRuleCustomData */

/**
 * Variant line on a catalog rule (helix `VariantPriceRule`).
 *
 * @typedef {object} HelixVariantPriceRule
 * @property {string} sku
 * @property {string|number} price
 * @property {string} [start]
 * @property {string} [end]
 * @property {PriceRuleCustomData} [custom]
 */

/**
 * @typedef {object} CatalogPriceRule
 * @property {string} path
 * @property {string|number} price
 * @property {string} [start] ISO 8601 when present (helix `ISOTimestamp`)
 * @property {string} [end] ISO 8601 when present
 * @property {PriceRuleCustomData} [custom]
 * @property {Record<string, HelixVariantPriceRule>} [variants]
 */

/**
 * @typedef {object} CatalogPromotion
 * @property {string} id
 * @property {string} name
 * @property {CatalogPriceRule[]} rules
 */

/**
 * @typedef {object} CatalogPriceRulesDocument
 * @property {CatalogPromotion[]} promotions
 */

/**
 * Cart rule `conditions` / `actions` (see helix `src/schemas/PriceRules.js`).
 *
 * @typedef {object} HelixCartPriceRuleConditions
 * @property {number} [minimumSubtotal]
 * @property {string[]} [products]
 * @property {string[]} [categories]
 */

/**
 * @typedef {object} HelixCartPriceRuleActions
 * @property {number|null} [percentOff]
 * @property {number|null} [fixedOff]
 * @property {boolean} [freeShipping]
 */

/**
 * @typedef {object} HelixCartPriceRule
 * @property {string} id
 * @property {string} name
 * @property {number} priority
 * @property {HelixCartPriceRuleConditions} conditions
 * @property {HelixCartPriceRuleActions} actions
 * @property {boolean} [stackable]
 * @property {string[]} [incompatibleTypes]
 */

/**
 * Normalized cart rules in the admin (GET returns a raw array on the wire).
 *
 * @typedef {object} CartPriceRulesDocument
 * @property {HelixCartPriceRule[]} rules
 */

const STOREFRONT_ORIGIN = 'https://www.vitamix.com';

async function readRespError(resp) {
  return resp.headers.get('x-error')
    || (await resp.text().catch(() => '')).trim()
    || `HTTP ${resp.status}`;
}

/**
 * Normalize GET …/price-rules/catalog JSON to `{ promotions }` (helix wire shape).
 *
 * @param {unknown} data
 * @returns {CatalogPriceRulesDocument}
 */
export function normalizeCatalogPriceRulesGetResponse(data) {
  const asObj = /** @type {{ promotions?: unknown }} */ (data);
  if (
    data && typeof data === 'object' && !Array.isArray(data)
    && Array.isArray(asObj.promotions)
  ) {
    return {
      promotions: /** @type {CatalogPromotion[]} */ (
        /** @type {{ promotions: CatalogPromotion[] }} */ (data).promotions
      ),
    };
  }
  if (
    data
    && typeof data === 'object'
    && /** @type {{ data?: unknown }} */ (data).data != null
    && typeof /** @type {{ data?: unknown }} */ (data).data === 'object'
    && Array.isArray(/** @type {{ data?: { promotions?: unknown } }} */(data).data?.promotions)
  ) {
    return {
      promotions: /** @type {CatalogPromotion[]} */ (
        /** @type {{ data: { promotions: CatalogPromotion[] } }} */ (data).data.promotions
      ),
    };
  }
  return { promotions: [] };
}

/**
 * Coerce a storefront display price to a string `parseFloat` accepts
 * (helix PUT validates numeric price).
 *
 * @param {string|number} raw
 * @returns {string}
 */
export function catalogPriceStringForApi(raw) {
  const s = String(raw ?? '').trim();
  if (s === '' || s === '—') return '0';
  const m = s.match(/-?\d[\d,]*\.?\d*/);
  if (!m) return '0';
  const n = parseFloat(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : '0';
}

/**
 * UTC instant for helix `CatalogPriceRule` / variant `start` & `end` (JSON Schema `pattern`).
 * Emits `YYYY-MM-DDTHH:mm:ssZ` with no fractional seconds — avoids `400` "pattern" failures
 * from `.000Z` or non-ISO text.
 *
 * @param {string|Date} raw
 * @returns {string} empty string if missing or unparseable
 */
export function catalogTimestampStringForApi(raw) {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return '';
    return raw.toISOString().replace(/\.\d+Z$/, 'Z');
  }
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

/**
 * @param {string} org
 * @param {string} site
 * @param {RequestInit} [fetchOptions] Extra fetch options
 *   (e.g. `{ cache: 'no-store' }` after a PUT).
 * @returns {Promise<CatalogPriceRulesDocument>}
 */
export async function fetchCatalogPriceRules(org, site, fetchOptions) {
  const resp = await apiFetch(org, site, 'price-rules/catalog', {
    method: 'GET',
    ...fetchOptions,
  });
  if (!resp.ok) throw new Error(await readRespError(resp));
  const data = await resp.json();
  return normalizeCatalogPriceRulesGetResponse(data);
}

/**
 * @param {string} org
 * @param {string} site
 * @param {CatalogPriceRulesDocument} body — must be `{ promotions: [...] }` per helix
 *   (not a JSON array).
 */
export async function putCatalogPriceRules(org, site, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.promotions)) {
    throw new Error('Catalog price rules PUT expects an object { promotions: Promotion[] }');
  }
  const resp = await apiFetch(org, site, 'price-rules/catalog', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await readRespError(resp));
}

/**
 * Parse GET …/price-rules/cart JSON into `{ rules }` (wire format is a JSON array
 * per helix-commerce-api).
 *
 * @param {unknown} data
 * @returns {CartPriceRulesDocument}
 */
export function normalizeCartRulesGetResponse(data) {
  if (Array.isArray(data)) {
    return { rules: /** @type {HelixCartPriceRule[]} */ (data) };
  }
  if (
    data && typeof data === 'object'
    && Array.isArray(/** @type {{ rules?: unknown }} */ (data).rules)
  ) {
    const typed = /** @type {{ rules: HelixCartPriceRule[] }} */ (data);
    return { rules: /** @type {HelixCartPriceRule[]} */ (typed.rules) };
  }
  if (
    data
    && typeof data === 'object'
    && /** @type {{ data?: unknown }} */ (data).data != null
    && Array.isArray(/** @type {{ data?: unknown }} */(data).data)
  ) {
    const typed = /** @type {{ data: HelixCartPriceRule[] }} */ (data);
    return { rules: /** @type {HelixCartPriceRule[]} */ (typed.data) };
  }
  return { rules: [] };
}

/**
 * @param {string} org
 * @param {string} site
 * @returns {Promise<CartPriceRulesDocument>}
 */
export async function fetchCartPriceRules(org, site) {
  const resp = await apiFetch(org, site, 'price-rules/cart', { method: 'GET' });
  if (!resp.ok) throw new Error(await readRespError(resp));
  const data = await resp.json();
  return normalizeCartRulesGetResponse(data);
}

/**
 * @param {string} org
 * @param {string} site
 * @param {HelixCartPriceRule[] | CartPriceRulesDocument} body — array on the wire,
 *   or `{ rules }` for convenience
 */
export async function putCartPriceRules(org, site, body) {
  const rules = Array.isArray(body) ? body : body?.rules;
  if (!Array.isArray(rules)) {
    throw new Error('Cart price rules PUT expects a JSON array of rules (or { rules: [...] })');
  }
  const resp = await apiFetch(org, site, 'price-rules/cart', {
    method: 'PUT',
    body: JSON.stringify(rules),
  });
  if (!resp.ok) throw new Error(await readRespError(resp));
}

/** @param {string} path */
export function countryKeyFromCatalogPath(path) {
  const p = String(path || '').toLowerCase();
  if (p.startsWith('/us/')) return 'us';
  if (p.startsWith('/ca/')) return 'ca';
  if (p.startsWith('/mx/')) return 'mx';
  return '';
}

/**
 * @param {string} productUrl
 * @returns {string} pathname only, e.g. /us/en_us/products/foo
 */
export function productUrlToCatalogPath(productUrl) {
  try {
    const u = new URL(String(productUrl));
    const path = u.pathname.replace(/\/$/, '') || u.pathname;
    return path;
  } catch {
    const s = String(productUrl || '').trim();
    if (s.startsWith('/')) return s.replace(/\/$/, '') || s;
    return '';
  }
}

/**
 * @param {string} path
 * @returns {string} display URL for tables / links
 */
export function catalogPathToProductUrl(path) {
  const p = String(path || '').trim();
  if (!p) return '';
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  return `${STOREFRONT_ORIGIN}${p.startsWith('/') ? p : `/${p}`}`;
}

/**
 * Map a catalog rule to a table row (UI).
 *
 * @param {CatalogPriceRule} rule
 * @returns {object} PromotionRow-compatible object
 */
export function catalogRuleToPromotionRow(rule) {
  const custom = rule.custom && typeof rule.custom === 'object' ? rule.custom : {};
  const regular = custom.regularPrice != null && String(custom.regularPrice).trim() !== ''
    ? String(custom.regularPrice)
    : '—';
  return {
    start: rule.start != null && String(rule.start).trim() !== '' ? String(rule.start) : '—',
    end: rule.end != null && String(rule.end).trim() !== '' ? String(rule.end) : '—',
    product: catalogPathToProductUrl(rule.path),
    regularPrice: regular,
    salePrice: rule.price != null ? String(rule.price) : '—',
  };
}

/**
 * @param {CatalogPromotion} promo
 * @param {string} countryKey
 * @returns {string}
 */
export function inferPromotionYear(promo, countryKey) {
  const rules = (promo.rules || []).filter((r) => countryKeyFromCatalogPath(r.path) === countryKey);
  const fromCustom = rules.map((r) => r.custom?.year).find(Boolean);
  if (fromCustom) return String(fromCustom);
  const yFromStart = rules
    .map((r) => String(r.start || '').match(/(20\d{2})/))
    .find((m) => m);
  return yFromStart ? yFromStart[1] : String(new Date().getFullYear());
}
