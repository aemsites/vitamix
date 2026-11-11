/**
 * Catalog promotion `conditions` helpers: scope, disqualifiers and per-language product picks.
 * Wire format: see `CatalogPromotionConditions` in price-rules-api.js.
 */

import { countryKeyFromCatalogPath } from './price-rules-api.js';
import {
  formatProductConditionsForForm,
  parseProductConditionsInput,
  productConditionDisplayLabels,
} from './product-conditions.js';

/**
 * Form values for promotion scope and disqualifiers (comma-separated).
 *
 * @typedef {{
 *   includedProducts: string;
 *   excludedProducts: string;
 *   includedCategories: string;
 *   excludedCategories: string;
 *   disqualifyingProducts: string;
 *   disqualifyingCategories: string;
 * }} PromotionScopeForm
 */

const PROMOTION_PRODUCT_KEYS = /** @type {const} */ ([
  'includedProducts',
  'excludedProducts',
  'disqualifyingProducts',
]);
const PROMOTION_CATEGORY_KEYS = /** @type {const} */ ([
  'includedCategories',
  'excludedCategories',
  'disqualifyingCategories',
]);

/** Cart-rule-only fields the API rejects on promotions. */
const PROMOTION_FORBIDDEN_KEYS = ['requiredProducts', 'requiredCategories'];

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function categoryList(raw) {
  if (Array.isArray(raw)) return raw.map((c) => String(c ?? '').trim()).filter(Boolean);
  return String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Read promotion scope / disqualifier form values from promotion `conditions`.
 *
 * @param {Record<string, unknown> | null | undefined} conditions
 * @returns {PromotionScopeForm}
 */
export function promotionScopeFromConditions(conditions) {
  const c = conditions && typeof conditions === 'object' ? conditions : {};
  /** @type {Record<string, string>} */
  const out = {};
  PROMOTION_PRODUCT_KEYS.forEach((k) => {
    out[k] = formatProductConditionsForForm(c[k]);
  });
  PROMOTION_CATEGORY_KEYS.forEach((k) => {
    out[k] = categoryList(c[k]).join(', ');
  });
  return /** @type {PromotionScopeForm} */ (out);
}

/**
 * Build promotion `conditions` from the form. Keeps condition keys the form doesn't edit,
 * drops cart-rule-only `required*` fields.
 *
 * @param {{ minimumSubtotal?: number | null } & Partial<PromotionScopeForm>} form
 * @param {Record<string, unknown> | null | undefined} [previous] current `conditions`
 * @returns {Record<string, unknown> | undefined} undefined when no condition is set
 */
export function buildPromotionConditions(form, previous) {
  const out = previous && typeof previous === 'object' ? { ...previous } : {};
  PROMOTION_FORBIDDEN_KEYS.forEach((k) => { delete out[k]; });

  const min = form.minimumSubtotal;
  if (typeof min === 'number' && Number.isFinite(min) && min > 0) out.minimumSubtotal = min;
  else delete out.minimumSubtotal;

  PROMOTION_PRODUCT_KEYS.forEach((k) => {
    const list = parseProductConditionsInput(form[k] ?? '');
    if (list.length) out[k] = list;
    else delete out[k];
  });
  PROMOTION_CATEGORY_KEYS.forEach((k) => {
    const list = categoryList(form[k] ?? '');
    if (list.length) out[k] = list;
    else delete out[k];
  });

  return Object.keys(out).length ? out : undefined;
}

/**
 * Short scope / disqualifier summary for the promotion list.
 *
 * @param {Record<string, unknown> | null | undefined} conditions
 * @returns {string}
 */
export function promotionScopeSummary(conditions) {
  const c = conditions && typeof conditions === 'object' ? conditions : {};
  const part = (label, productsKey, categoriesKey) => {
    const items = [...new Set([
      ...categoryList(c[categoriesKey]),
      ...productConditionDisplayLabels(c[productsKey]),
    ])];
    return items.length ? `${label}: ${items.join(', ')}` : '';
  };
  return [
    part('only', 'includedProducts', 'includedCategories'),
    part('not', 'excludedProducts', 'excludedCategories'),
    part('never with', 'disqualifyingProducts', 'disqualifyingCategories'),
  ].filter(Boolean).join(' · ');
}

/**
 * Split promotion product picks into those under `market` and those under another market
 * (catalog paths carry the market prefix, so the others never match a cart line).
 *
 * @param {Partial<PromotionScopeForm>} form
 * @param {string} market us|ca|mx
 * @returns {{ form: Partial<PromotionScopeForm>, dropped: string[] }}
 */
export function splitPromotionProductPicksByMarket(form, market) {
  const next = { ...form };
  /** @type {string[]} */
  const dropped = [];
  PROMOTION_PRODUCT_KEYS.forEach((k) => {
    const tokens = String(form[k] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const keep = tokens.filter((token) => {
      const { path } = parseProductConditionsInput(token)[0];
      if (countryKeyFromCatalogPath(path) === market) return true;
      dropped.push(token);
      return false;
    });
    next[k] = keep.join(', ');
  });
  return { form: next, dropped };
}

/**
 * One market catalog (index locale): parent product path ↔ parent SKU. A SKU can be listed
 * under more than one path.
 *
 * @typedef {{ pathsBySku: Map<string, string[]>; skuByPath: Map<string, string> }} LocaleCatalog
 */

/**
 * @param {string} token `path` or `path|sku`
 * @returns {{ path: string; sku: string }}
 */
function splitProductToken(token) {
  const [entry] = parseProductConditionsInput(token);
  return { path: entry?.path || '', sku: entry?.sku || '' };
}

/** @param {string} path */
function pathUrlKey(path) {
  return path.split('/').filter(Boolean).pop() || '';
}

/**
 * Paths of the same product in the other catalogs: matched by parent SKU, preferring the
 * same url key when the SKU is listed under several paths.
 *
 * @param {string} token
 * @param {LocaleCatalog[]} catalogs
 * @returns {string[]} tokens (variant `|sku` kept), excluding the pick's own catalog
 */
function counterpartTokens(token, catalogs) {
  const { path, sku } = splitProductToken(token);
  const own = catalogs.find((c) => c.skuByPath.has(path));
  if (!own) return [];
  const parentSku = own.skuByPath.get(path);
  const key = pathUrlKey(path);
  return catalogs.filter((c) => c !== own).flatMap((c) => {
    const candidates = c.pathsBySku.get(parentSku) || [];
    const sameKey = candidates.find((p) => pathUrlKey(p) === key);
    return (sameKey ? [sameKey] : candidates).map((p) => (sku ? `${p}|${sku}` : p));
  });
}

/** @param {string} raw */
function pickTokens(raw) {
  return String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Add the same product's path in every other catalog (e.g. each language of a market).
 * Unknown picks are kept as they are.
 *
 * @param {string} raw comma-separated product picks
 * @param {LocaleCatalog[]} catalogs
 * @returns {string}
 */
export function expandProductPicksAcrossCatalogs(raw, catalogs) {
  /** @type {string[]} */
  const out = [];
  const add = (t) => { if (!out.includes(t)) out.push(t); };
  pickTokens(raw).forEach((token) => {
    add(token);
    counterpartTokens(token, catalogs).forEach(add);
  });
  return out.join(', ');
}

/**
 * Inverse of {@link expandProductPicksAcrossCatalogs} for the form: drop picks that are
 * counterparts of a pick in the first (primary) catalog.
 *
 * @param {string} raw comma-separated product picks
 * @param {LocaleCatalog[]} catalogs primary catalog first
 * @returns {string}
 */
export function collapseProductPicksAcrossCatalogs(raw, catalogs) {
  const [primary] = catalogs;
  const tokens = pickTokens(raw);
  if (!primary) return tokens.join(', ');
  const counterparts = new Set(tokens
    .filter((token) => primary.skuByPath.has(splitProductToken(token).path))
    .flatMap((token) => counterpartTokens(token, catalogs)));
  return tokens.filter((token) => !counterparts.has(token)).join(', ');
}

/**
 * Apply `fn` to each product pick field of a promotion scope form.
 *
 * @param {PromotionScopeForm} form
 * @param {(raw: string) => string} fn
 * @returns {PromotionScopeForm}
 */
export function mapPromotionProductPicks(form, fn) {
  const next = { ...form };
  PROMOTION_PRODUCT_KEYS.forEach((k) => { next[k] = fn(form[k] ?? ''); });
  return next;
}
