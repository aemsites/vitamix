/**
 * Single source of truth for the shopper's applied coupon list.
 *
 * The Commerce API accepts multiple coupons per order: `couponCode` and
 * `couponSource` are `string | string[]` (max 5), where the source array is
 * index-aligned with the code array. The order of the two arrays must be
 * identical between `/orders/preview` and `/orders`, or the estimate token's
 * consistency hash will not match — so this module keeps the list in a stable,
 * insertion-ordered form and every request builder derives its coupon fields
 * from it.
 *
 * Storage: the ordered list lives under `checkout_coupons` as JSON
 * `[{ code, source }]`. The legacy scalar keys (`checkout_coupon_code` = first
 * code, `checkout_coupon_source` = first source when 'auto') are kept in sync so
 * readers that predate multi-coupon (analytics instrumentation, the affiliate
 * `COUPON` URL helper, Playwright seeds) keep working unchanged.
 */

const COUPONS_KEY = 'checkout_coupons';
const LEGACY_CODE_KEY = 'checkout_coupon_code';
const LEGACY_SOURCE_KEY = 'checkout_coupon_source';
const AFFILIATE_CODE_KEY = 'checkout_affiliate_code';
const AFFILIATE_INELIGIBLE_KEY = 'checkout_affiliate_ineligible';

// Characters the Commerce API accepts in a coupon code. The `+` is valid but was
// absent from the historical coupon import (which uppercased and mapped every
// other special char — `*`, `#`, etc. — to `_` via /[^A-Z0-9\-_]/g), so codes at
// rest never contain it. We normalize the same way here but keep `+` in the set,
// so a `+` a shopper types is sent through unchanged while legacy special chars
// still collapse to `_` and match the imported codes.
const COUPON_NON_CHARSET = /[^A-Z0-9\-_+]/g;

/**
 * Normalizes a coupon code to the API-accepted character set: uppercased, with
 * any character outside [A-Z0-9-_+] replaced by `_`. Mirrors the historical
 * import so shopper-entered codes match what is stored. Display values are left
 * untouched — only the value sent to the API is normalized.
 *
 * @param {string} raw - The coupon code as entered/displayed
 * @returns {string}
 */
export function normalizeCouponCode(raw) {
  return String(raw).toUpperCase().replace(COUPON_NON_CHARSET, '_');
}

/** Coupon rejection codes with a dedicated shopper-facing message. */
export const COUPON_ERROR_CODES = new Set([
  'coupon_invalid_format', 'coupon_not_found', 'coupon_inactive', 'coupon_expired',
  'coupon_exhausted', 'coupon_country_mismatch', 'coupon_minimum_not_met',
  'coupon_product_not_eligible', 'coupon_manual_entry_rejected', 'unauthorized',
]);

/** Rejection code for a coupon that applies to no item in the cart. */
export const COUPON_PRODUCT_NOT_ELIGIBLE = 'coupon_product_not_eligible';

const API_ERROR_PREFIX = 'ADOBE_COMMERCE_';

/** Max coupons accepted by the API. Enforced client-side to avoid a 400. */
export const MAX_COUPONS = 5;
/** Source value marking a storefront auto/verified coupon (ID.me / affiliate). */
export const AUTO_COUPON_SOURCE = 'auto';
const MANUAL_COUPON_SOURCE = 'manual';

/**
 * Normalises a source value to 'auto' or 'manual'.
 * @param {string|undefined} source
 * @returns {'auto'|'manual'}
 */
function normalizeSource(source) {
  return source === AUTO_COUPON_SOURCE ? AUTO_COUPON_SOURCE : MANUAL_COUPON_SOURCE;
}

/**
 * Cleans a coupon list: drops blanks, trims codes, de-duplicates
 * case-insensitively (first occurrence wins, order preserved) and caps at
 * MAX_COUPONS.
 * @param {Array<{code: string, source?: string}>} list
 * @returns {Array<{code: string, source: 'auto'|'manual'}>}
 */
function normalize(list) {
  const seen = new Set();
  const out = [];
  (Array.isArray(list) ? list : []).forEach((entry) => {
    const code = (entry?.code || '').trim();
    if (!code) return;
    const key = code.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ code, source: normalizeSource(entry?.source) });
  });
  return out.slice(0, MAX_COUPONS);
}

/**
 * Mirrors the first entry into the legacy scalar keys so pre-multi-coupon
 * readers still see a coupon. The source key is only written when 'auto'
 * (matching the previous convention where a manual coupon had no source key).
 * @param {Array<{code: string, source: string}>} list
 */
function syncLegacyScalars(list) {
  const first = list[0];
  if (!first) {
    sessionStorage.removeItem(LEGACY_CODE_KEY);
    sessionStorage.removeItem(LEGACY_SOURCE_KEY);
    return;
  }
  sessionStorage.setItem(LEGACY_CODE_KEY, first.code);
  if (first.source === AUTO_COUPON_SOURCE) {
    sessionStorage.setItem(LEGACY_SOURCE_KEY, AUTO_COUPON_SOURCE);
  } else {
    sessionStorage.removeItem(LEGACY_SOURCE_KEY);
  }
}

/**
 * Returns the ordered coupon list. Falls back to the legacy scalar keys when
 * the array key is absent, so a coupon written by an older code path (affiliate
 * URL param, test seed) is still honoured.
 * @returns {Array<{code: string, source: 'auto'|'manual'}>}
 */
export function getCoupons() {
  const raw = sessionStorage.getItem(COUPONS_KEY);
  if (raw) {
    try {
      return normalize(JSON.parse(raw));
    } catch {
      // fall through to the legacy scalars
    }
  }
  const code = sessionStorage.getItem(LEGACY_CODE_KEY);
  if (code) {
    return normalize([{ code, source: sessionStorage.getItem(LEGACY_SOURCE_KEY) }]);
  }
  return [];
}

/**
 * Persists a coupon list (normalised) and syncs the legacy scalars.
 * @param {Array<{code: string, source?: string}>} list
 * @returns {Array<{code: string, source: 'auto'|'manual'}>} the stored list
 */
export function setCoupons(list) {
  const normalized = normalize(list);
  if (normalized.length) {
    sessionStorage.setItem(COUPONS_KEY, JSON.stringify(normalized));
  } else {
    sessionStorage.removeItem(COUPONS_KEY);
  }
  syncLegacyScalars(normalized);
  return normalized;
}

/**
 * Appends a coupon (de-duplicated case-insensitively; an existing code keeps its
 * original position and source).
 * @param {string} code
 * @param {string} [source='manual']
 * @returns {Array<{code: string, source: 'auto'|'manual'}>}
 */
export function addCoupon(code, source = MANUAL_COUPON_SOURCE) {
  return setCoupons([...getCoupons(), { code, source }]);
}

/**
 * Sets the single manually-entered coupon, replacing any prior manual entry
 * while preserving auto (ID.me / affiliate) coupons and their order. Passing an
 * empty code just clears the manual entry.
 * @param {string} code
 * @returns {Array<{code: string, source: 'auto'|'manual'}>}
 */
export function setManualCoupon(code) {
  const kept = getCoupons().filter((c) => c.source === AUTO_COUPON_SOURCE);
  const trimmed = (code || '').trim();
  if (trimmed) kept.push({ code: trimmed, source: MANUAL_COUPON_SOURCE });
  return setCoupons(kept);
}

/**
 * Removes a coupon by code (case-insensitive).
 * @param {string} code
 * @returns {Array<{code: string, source: 'auto'|'manual'}>}
 */
export function removeCoupon(code) {
  const key = (code || '').trim().toLowerCase();
  return setCoupons(getCoupons().filter((c) => c.code.toLowerCase() !== key));
}

/** Clears all coupon state (array key + legacy scalars). */
export function clearCoupons() {
  sessionStorage.removeItem(COUPONS_KEY);
  sessionStorage.removeItem(LEGACY_CODE_KEY);
  sessionStorage.removeItem(LEGACY_SOURCE_KEY);
}

/**
 * The manually-entered coupon code, if any (drives the text input).
 * @returns {string}
 */
export function getManualCoupon() {
  return getCoupons().find((c) => c.source !== AUTO_COUPON_SOURCE)?.code || '';
}

/**
 * The auto/verified coupons (drive the removable pills).
 * @returns {Array<{code: string, source: 'auto'}>}
 */
export function getAutoCoupons() {
  return getCoupons().filter((c) => c.source === AUTO_COUPON_SOURCE);
}

/**
 * Builds the `couponCode`/`couponSource` request fields for an order/estimate
 * body. A single coupon is sent as a scalar (preserving the legacy single-string
 * contract, incl. its 422 behaviour); multiple coupons are sent as index-aligned
 * arrays. A manual source is omitted for the single-coupon case (the API treats
 * an omitted source as 'manual'); the multi-coupon array always sends an explicit
 * source per code so the two arrays stay parallel.
 * @returns {{ couponCode?: string|string[], couponSource?: string|string[] }}
 */
export function getCouponRequestFields() {
  const coupons = getCoupons();
  if (!coupons.length) return {};
  if (coupons.length === 1) {
    const [only] = coupons;
    return {
      couponCode: only.code,
      ...(only.source === AUTO_COUPON_SOURCE ? { couponSource: only.source } : {}),
    };
  }
  return {
    couponCode: coupons.map((c) => c.code),
    couponSource: coupons.map((c) => c.source),
  };
}

/**
 * Records the coupon code an affiliate link was landed with. Kept separately
 * from the coupon list so it is still reported when the coupon itself is
 * removed or does not apply to the order.
 * @param {string} code
 */
export function setAffiliateCode(code) {
  const trimmed = (code || '').trim();
  if (!trimmed) return;
  sessionStorage.setItem(AFFILIATE_CODE_KEY, trimmed);
  sessionStorage.removeItem(AFFILIATE_INELIGIBLE_KEY);
}

/**
 * @returns {string} The affiliate coupon code, or '' when none was recorded
 */
export function getAffiliateCode() {
  try {
    return sessionStorage.getItem(AFFILIATE_CODE_KEY) || '';
  } catch {
    return '';
  }
}

/** Clears the affiliate coupon code. */
export function clearAffiliateCode() {
  sessionStorage.removeItem(AFFILIATE_CODE_KEY);
  sessionStorage.removeItem(AFFILIATE_INELIGIBLE_KEY);
}

/**
 * @param {string} code
 * @returns {boolean} Whether `code` is the recorded affiliate coupon code
 */
export function isAffiliateCode(code) {
  const affiliateCode = getAffiliateCode();
  return !!affiliateCode && !!code
    && normalizeCouponCode(code.trim()) === normalizeCouponCode(affiliateCode);
}

/**
 * Removes the affiliate coupon from the coupon list after it was rejected, and
 * keeps it on display as a not-eligible code. The affiliate code itself is
 * still sent with the order.
 */
export function markAffiliateIneligible() {
  setCoupons(getCoupons().filter((c) => !isAffiliateCode(c.code)));
  sessionStorage.setItem(AFFILIATE_INELIGIBLE_KEY, 'true');
}

/**
 * @returns {string} The affiliate code to display as not eligible, or ''
 */
export function getIneligibleAffiliateCode() {
  try {
    if (!sessionStorage.getItem(AFFILIATE_INELIGIBLE_KEY)) return '';
  } catch {
    return '';
  }
  const code = getAffiliateCode();
  // Shown as a regular coupon while it is still in the coupon list.
  if (!code || getCoupons().some((c) => isAffiliateCode(c.code))) return '';
  return code;
}

/**
 * Hides the not-eligible affiliate code from display. The affiliate code is
 * still sent with the order.
 */
export function dismissIneligibleAffiliate() {
  sessionStorage.removeItem(AFFILIATE_INELIGIBLE_KEY);
}

/**
 * Resolves a Commerce API error to a coupon rejection code (e.g.
 * `coupon_not_found`), or null when the error is not a coupon rejection.
 * @param {{body?: {code?: string}, code?: string, errorHeader?: string}} err
 * @returns {string|null}
 */
export function getCouponErrorCode(err) {
  const apiCode = err?.body?.code || err?.code || '';
  if (apiCode.startsWith(API_ERROR_PREFIX)) {
    const key = apiCode.slice(API_ERROR_PREFIX.length).toLowerCase();
    if (COUPON_ERROR_CODES.has(key)) return key;
  }
  return COUPON_ERROR_CODES.has(err?.errorHeader) ? err.errorHeader : null;
}

/**
 * Drops a lone coupon rejected with `errorCode`. An affiliate coupon that does
 * not apply to the cart stays on display as not eligible instead.
 * @param {string} errorCode - Coupon rejection code from getCouponErrorCode
 * @returns {boolean} Whether the rejected coupon was the not-eligible affiliate
 */
export function dropRejectedCoupon(errorCode) {
  const [lone] = getCoupons();
  if (errorCode === COUPON_PRODUCT_NOT_ELIGIBLE && isAffiliateCode(lone?.code)) {
    markAffiliateIneligible();
    return true;
  }
  clearCoupons();
  return false;
}

/**
 * Handles `couponStatus[]` from a multi-coupon response: a rejected affiliate
 * coupon is removed from the list and kept on display as not eligible.
 * @param {Array<{code: string, status: string}>} couponStatus
 * @returns {boolean} Whether the affiliate coupon was marked not eligible
 */
export function handleAffiliateStatus(couponStatus) {
  const rejected = (couponStatus || []).some(
    (e) => e?.status === 'rejected_invalid' && isAffiliateCode(e.code),
  );
  if (rejected) markAffiliateIneligible();
  return rejected;
}

/**
 * Resolves a `couponStatus[]` entry status to a shopper-facing message. The API
 * withholds the reason for `rejected_invalid` (to prevent code enumeration), so
 * the copy is generic per status. Returns '' for `applied` / unknown statuses.
 * @param {string} status
 * @param {{couponRejectedInvalid?: string, couponRejectedNotCombinable?: string}} strings
 * @returns {string}
 */
export function getStatusMessage(status, strings = {}) {
  if (status === 'rejected_invalid') return strings.couponRejectedInvalid || '';
  if (status === 'rejected_not_combinable') return strings.couponRejectedNotCombinable || '';
  return '';
}
