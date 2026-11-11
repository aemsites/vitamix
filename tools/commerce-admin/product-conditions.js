/**
 * Product condition helpers for commerce-admin (cart rules + coupon types).
 * Wire format: `string[] | { path: string; sku?: string }[]` (helix-commerce-api).
 */

import { productUrlToCatalogPath } from './price-rules-api.js';

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

/**
 * Short scope / disqualifier summary for the promotion list.
 *
 * @param {Record<string, unknown> | null | undefined} conditions
 * @returns {string}
 */
export function promotionScopeSummary(conditions) {
  const c = conditions && typeof conditions === 'object' ? conditions : {};
  const part = (label, productsKey, categoriesKey) => {
    const items = [
      ...categoryList(c[categoriesKey]),
      ...productConditionDisplayLabels(c[productsKey]),
    ];
    return items.length ? `${label}: ${items.join(', ')}` : '';
  };
  return [
    part('only', 'includedProducts', 'includedCategories'),
    part('not', 'excludedProducts', 'excludedCategories'),
    part('never with', 'disqualifyingProducts', 'disqualifyingCategories'),
  ].filter(Boolean).join(' · ');
}
