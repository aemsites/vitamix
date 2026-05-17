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
