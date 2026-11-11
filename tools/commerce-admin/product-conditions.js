/**
 * Product condition helpers for commerce-admin (cart rules + coupon types).
 * Wire format: `string[] | { path: string; sku?: string }[]` (helix-commerce-api).
 */

import { countryKeyFromCatalogPath, productUrlToCatalogPath } from './price-rules-api.js';

/**
 * @typedef {{ path: string; sku?: string }} ProductCondition
 */

/**
 * @param {unknown} entry
 * @returns {string}
 */
export function formatProductConditionEntry(entry) {
  if (typeof entry === 'string') {
    const t = entry.trim();
    return t;
  }
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const o = /** @type {{ path?: unknown; sku?: unknown }} */ (entry);
    const path = o.path != null ? String(o.path).trim() : '';
    if (!path) return '';
    const sku = o.sku != null ? String(o.sku).trim() : '';
    return sku ? `${path}|${sku}` : path;
  }
  return '';
}

/**
 * Comma-separated form value from API product condition arrays.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function formatProductConditionsForForm(raw) {
  if (!Array.isArray(raw)) return '';
  return raw.map(formatProductConditionEntry).filter(Boolean).join(', ');
}

/**
 * Short label for tables / tags (path tail + optional SKU).
 *
 * @param {unknown} entry
 * @returns {string}
 */
export function productConditionDisplayLabel(entry) {
  const token = formatProductConditionEntry(entry);
  if (!token) return '';
  const pipe = token.indexOf('|');
  const path = pipe > 0 ? token.slice(0, pipe) : token;
  const sku = pipe > 0 ? token.slice(pipe + 1) : '';
  const parts = path.split('/').filter(Boolean);
  const tail = parts.length ? parts[parts.length - 1] : path;
  return sku ? `${tail} (${sku})` : tail;
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function productConditionDisplayLabels(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(productConditionDisplayLabel).filter(Boolean);
}

/**
 * Parse comma-separated admin input into API product conditions.
 * Each token is a catalog path or URL; use `path|sku` for variant-level targeting.
 *
 * @param {string} raw
 * @returns {ProductCondition[]}
 */
export function parseProductConditionsInput(raw) {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => {
      const pipe = token.indexOf('|');
      if (pipe > 0) {
        const pathPart = token.slice(0, pipe).trim();
        const sku = token.slice(pipe + 1).trim();
        const path = productUrlToCatalogPath(pathPart) || pathPart;
        return sku ? { path, sku } : { path };
      }
      const path = productUrlToCatalogPath(token) || token;
      return { path };
    });
}

/**
 * Read product conditions from helix cart rule conditions (new + legacy field names).
 *
 * @param {Record<string, unknown>} conditions
 * @returns {{
 *   requiredProducts: string;
 *   excludedProducts: string;
 *   requiredCategories: string;
 *   excludedCategories: string;
 * }}
 */
export function cartRuleProductScopeFromConditions(conditions) {
  const c = conditions && typeof conditions === 'object' ? conditions : {};
  const reqProd = c.requiredProducts ?? c.products;
  const exProd = c.excludedProducts;
  const reqCat = c.requiredCategories ?? c.categories;
  const exCat = c.excludedCategories;
  return {
    requiredProducts: formatProductConditionsForForm(reqProd),
    excludedProducts: formatProductConditionsForForm(exProd),
    requiredCategories: Array.isArray(reqCat) ? reqCat.join(', ') : '',
    excludedCategories: Array.isArray(exCat) ? exCat.join(', ') : '',
  };
}

/**
 * @param {Record<string, unknown>} conditions
 * @param {{
 *   requiredProducts: string;
 *   excludedProducts: string;
 *   requiredCategories: string;
 *   excludedCategories: string;
 * }} row
 * @returns {Record<string, unknown>}
 */
export function applyCartRuleProductScopeToConditions(conditions, row) {
  const out = { ...conditions };
  delete out.products;
  delete out.categories;

  const requiredProducts = parseProductConditionsInput(row.requiredProducts);
  const excludedProducts = parseProductConditionsInput(row.excludedProducts);
  const requiredCategories = String(row.requiredCategories ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const excludedCategories = String(row.excludedCategories ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (requiredProducts.length) out.requiredProducts = requiredProducts;
  else delete out.requiredProducts;
  if (excludedProducts.length) out.excludedProducts = excludedProducts;
  else delete out.excludedProducts;
  if (requiredCategories.length) out.requiredCategories = requiredCategories;
  else delete out.requiredCategories;
  if (excludedCategories.length) out.excludedCategories = excludedCategories;
  else delete out.excludedCategories;

  return out;
}

/**
 * One-line scope summary for cart rule list / search.
 *
 * @param {{
 *   requiredProducts?: string;
 *   excludedProducts?: string;
 *   requiredCategories?: string;
 *   excludedCategories?: string;
 * }} row
 * @returns {string}
 */
export function cartRuleScopeSummary(row) {
  const parts = [];
  const rp = String(row.requiredProducts ?? '').trim();
  const ep = String(row.excludedProducts ?? '').trim();
  const rc = String(row.requiredCategories ?? '').trim();
  const ec = String(row.excludedCategories ?? '').trim();
  if (rp) parts.push(`req prod: ${rp}`);
  if (ep) parts.push(`excl prod: ${ep}`);
  if (rc) parts.push(`req cat: ${rc}`);
  if (ec) parts.push(`excl cat: ${ec}`);
  return parts.join(' · ') || '';
}

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

/** Second-language index prefix → primary-language prefix of the same market. */
const SECOND_LANGUAGE_PREFIXES = /** @type {Record<string, string>} */ ({
  '/ca/fr_ca/': '/ca/en_us/',
});

/** @param {unknown} entry */
function entryPath(entry) {
  return formatProductConditionEntry(entry).split('|')[0];
}

/**
 * Drop second-language copies of picks when the primary language has picks too
 * (for display: those copies are added on save).
 *
 * @param {unknown[]} entries product conditions or form tokens
 * @returns {unknown[]}
 */
export function primaryLanguagePicks(entries) {
  const paths = entries.map(entryPath);
  return entries.filter((entry) => {
    const prefix = Object.keys(SECOND_LANGUAGE_PREFIXES)
      .find((p) => entryPath(entry).startsWith(p));
    return !prefix || !paths.some((p) => p.startsWith(SECOND_LANGUAGE_PREFIXES[prefix]));
  });
}

/**
 * Group product picks by region (`us`, `ca`, …); picks under any other region go to `other`.
 *
 * @param {string} raw comma-separated product picks
 * @param {readonly string[]} regions
 * @returns {Record<string, string>} comma-separated picks per region, plus `other`
 */
export function splitProductPicksByRegion(raw, regions) {
  /** @type {Record<string, string[]>} */
  const out = Object.fromEntries([...regions, 'other'].map((r) => [r, []]));
  String(raw ?? '').split(',').map((t) => t.trim()).filter(Boolean)
    .forEach((token) => {
      const region = countryKeyFromCatalogPath(entryPath(token));
      out[regions.includes(region) ? region : 'other'].push(token);
    });
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join(', ')]));
}

/**
 * Short scope / disqualifier summary for the promotion list. Products are grouped by region.
 *
 * @param {Record<string, unknown> | null | undefined} conditions
 * @returns {string}
 */
export function promotionScopeSummary(conditions) {
  const c = conditions && typeof conditions === 'object' ? conditions : {};
  const part = (label, productsKey, categoriesKey) => {
    /** @type {Map<string, Set<string>>} */
    const byRegion = new Map();
    const products = Array.isArray(c[productsKey]) ? c[productsKey] : [];
    primaryLanguagePicks(products).forEach((entry) => {
      const region = countryKeyFromCatalogPath(entryPath(entry)).toUpperCase() || '?';
      if (!byRegion.has(region)) byRegion.set(region, new Set());
      byRegion.get(region).add(productConditionDisplayLabel(entry));
    });
    const items = [
      ...new Set(categoryList(c[categoriesKey])),
      ...[...byRegion].map(([region, labels]) => `${region}: ${[...labels].join(', ')}`),
    ];
    return items.length ? `${label}: ${items.join(', ')}` : '';
  };
  return [
    part('only', 'includedProducts', 'includedCategories'),
    part('not', 'excludedProducts', 'excludedCategories'),
    part('never with', 'disqualifyingProducts', 'disqualifyingCategories'),
  ].filter(Boolean).join(' · ');
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
