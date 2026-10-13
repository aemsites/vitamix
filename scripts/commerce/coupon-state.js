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

// Chars outside the API coupon charset are replaced with `_`.
const COUPON_NON_CHARSET = /[^A-Z0-9\-_+]/g;

/**
 * Normalizes a coupon code for the API: uppercased, with any character outside
 * [A-Z0-9-_+] replaced by `_`. Display values are left untouched.
 * @param {string} raw - The coupon code as entered/displayed
 * @returns {string}
 */
export function normalizeCouponCode(raw) {
  return String(raw).toUpperCase().replace(COUPON_NON_CHARSET, '_');
}

/** Coupon rejection codes with a dedicated shopper-facing message. */
const COUPON_ERROR_CODES = new Set([
  'coupon_invalid_format', 'coupon_not_found', 'coupon_inactive', 'coupon_expired',
  'coupon_exhausted', 'coupon_country_mismatch', 'coupon_minimum_not_met',
  'coupon_product_not_eligible', 'coupon_manual_entry_rejected',
]);

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

let affiliateIneligible = false;

/**
 * Records the coupon code an affiliate link was landed with. It stays in the
 * coupon list for the session and is sent with the order whether or not it
 * applies.
 * @param {string} code
 */
export function setAffiliateCode(code) {
  const trimmed = (code || '').trim();
  if (trimmed) sessionStorage.setItem(AFFILIATE_CODE_KEY, trimmed);
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
  affiliateIneligible = false;
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
 * Reads the stored coupon list. Falls back to the legacy scalar keys when the
 * array key is absent, so a coupon written by an older code path (affiliate URL
 * param, test seed) is still honoured.
 * @returns {Array<{code: string, source: 'auto'|'manual'}>}
 */
function readStoredCoupons() {
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
 * Returns the ordered coupon list. The affiliate coupon code, when recorded,
 * is always included as an auto coupon.
 * @returns {Array<{code: string, source: 'auto'|'manual'}>}
 */
export function getCoupons() {
  const coupons = readStoredCoupons();
  const affiliateCode = getAffiliateCode();
  if (!affiliateCode) return coupons;
  const index = coupons.findIndex((c) => isAffiliateCode(c.code));
  if (index >= 0) {
    coupons[index] = { ...coupons[index], source: AUTO_COUPON_SOURCE };
    return coupons;
  }
  return [
    ...coupons.slice(0, MAX_COUPONS - 1),
    { code: affiliateCode, source: AUTO_COUPON_SOURCE },
  ];
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
 * The auto/verified coupons (drive the coupon pills).
 * @returns {Array<{code: string, source: 'auto'}>}
 */
export function getAutoCoupons() {
  return getCoupons().filter((c) => c.source === AUTO_COUPON_SOURCE);
}

/**
 * Builds the `couponCode`/`couponSource` request fields for an order/estimate
 * body. A single non-affiliate coupon is sent as a scalar (a rejected code
 * fails the request with a 422); otherwise the codes are sent as index-aligned
 * arrays (rejected codes are reported in `couponStatus`). A manual source is
 * omitted for the scalar case (the API treats an omitted source as 'manual').
 * @returns {{ couponCode?: string|string[], couponSource?: string|string[] }}
 */
export function getCouponRequestFields() {
  const coupons = getCoupons();
  if (!coupons.length) return {};
  // Affiliate code is always sent as an array.
  if (coupons.length === 1 && !isAffiliateCode(coupons[0].code)) {
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
 * Records whether the affiliate coupon applied, from a pricing response's
 * `couponStatus[]`. Responses without an entry for it leave the state as is.
 * @param {Array<{code: string, status: string}>} couponStatus
 */
export function updateAffiliateStatus(couponStatus) {
  const entry = (couponStatus || []).find((e) => isAffiliateCode(e?.code));
  if (entry) affiliateIneligible = entry.status === 'rejected_invalid';
}

/**
 * @returns {boolean} Whether the last pricing response rejected the affiliate
 *   coupon as not applicable to the cart
 */
export function isAffiliateIneligible() {
  return affiliateIneligible && !!getAffiliateCode();
}

/**
 * Resolves a Commerce API error to a coupon rejection code (e.g.
 * `coupon_not_found`), or null when the error is not a coupon rejection.
 * @param {{body?: {code?: string}, code?: string, errorHeader?: string}} err
 * @returns {string|null}
 */
export function getCouponErrorCode(err) {
  const apiCode = [err?.body?.code, err?.code].find((c) => typeof c === 'string') || '';
  if (apiCode.startsWith(API_ERROR_PREFIX)) {
    const key = apiCode.slice(API_ERROR_PREFIX.length).toLowerCase();
    if (COUPON_ERROR_CODES.has(key)) return key;
  }
  return COUPON_ERROR_CODES.has(err?.errorHeader) ? err.errorHeader : null;
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
