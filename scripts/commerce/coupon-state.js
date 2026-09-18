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
