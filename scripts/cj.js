/**
 * Commission Junction (CJ) affiliate conversion reporting.
 *
 * Called by the order-complete block once it has the confirmed order. CJ's Universal Tag
 * expects the conversion payload for every completed order — affiliate-sourced or not —
 * so this builds `window.cj.order` and ensures the tag is present to transmit it. Orders
 * with no affiliate click ID simply omit `cjeventOrder`.
 *
 * Dependency-free: the site serves unbundled source, so this adds a single request
 * alongside the block's existing imports rather than extending the chain.
 */

/** CJ Universal Tag ID. Identical across environments. */
const CJ_TAG_ID = '11931';

/** CJ advertiser (enterprise) ID. Identical across environments. */
const CJ_ENTERPRISE_ID = '1541135';

/** Action tracker IDs are environment-specific so non-production orders stay separate. */
const CJ_ACTION_TRACKER_IDS = {
  prod: '392823',
  stage: '427761',
};

/**
 * Production is exactly `www.vitamix.com`. Every other host — the bare apex, test, uat,
 * aem.page/aem.live previews and localhost — reports against the stage action tracker.
 */
const CJ_PROD_HOST = 'www.vitamix.com';

/** Element id CJ's tag uses to locate its own script when resolving its origin. */
const CJ_TAG_ELEMENT_ID = 'cjapitag';

/** localStorage key CJ's Universal Tag reads and writes. Holds the raw click ID. */
const CJEVENT_KEY = 'cjevent';

/** Capture timestamp, stored separately so CJEVENT_KEY holds only CJ's own value. */
const CJEVENT_TS_KEY = 'cjevent_captured';

/**
 * Click-ID retention window, matching the 13 months CJ uses for its own cookie. CJ
 * applies the attribution window server-side; this bound just avoids keeping the
 * identifier in the browser indefinitely.
 */
export const CJEVENT_MAX_AGE_MS = 395 * 24 * 60 * 60 * 1000;

let cjConversionFired = false;

/**
 * @param {...any} args
 * @returns {void}
 */
function debug(...args) {
  if (window.location.hostname === 'localhost' || window.location.search.includes('instrumentation=debug')) {
    // eslint-disable-next-line no-console
    console.log('[cj]', ...args);
  }
}

/**
 * Reads a cookie, URI-decoding it the way CJ's tag does.
 * @param {string} name - Cookie name
 * @returns {string} Decoded value, or '' when absent
 */
function readCookie(name) {
  const prefix = `${name}=`;
  const match = document.cookie.split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  if (!match) return '';
  const raw = match.slice(prefix.length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Resolves the affiliate click ID for the current visitor.
 *
 * Prefers the value captured from the landing-page URL (see `setAffiliateCoupon` in
 * scripts.js), then the cookies CJ's own tag writes (`cjevent_dc`, `cjevent_sc`) and the
 * Magento cookie endpoint (`cje`). Entries past the retention window are removed.
 * @returns {string} The click ID, or '' when none is available
 */
export function getCjevent() {
  try {
    let value = localStorage.getItem(CJEVENT_KEY);
    let ts = Number(localStorage.getItem(CJEVENT_TS_KEY)) || 0;

    // Earlier releases stored `{ value, ts }` here; normalise to CJ's raw format.
    if (value && value.startsWith('{')) {
      const parsed = JSON.parse(value);
      value = parsed?.value || '';
      ts = Number(parsed?.ts) || 0;
      if (value) {
        localStorage.setItem(CJEVENT_KEY, value);
        localStorage.setItem(CJEVENT_TS_KEY, String(ts || Date.now()));
      } else {
        localStorage.removeItem(CJEVENT_KEY);
      }
    }

    if (value) {
      if (!ts || Date.now() - ts <= CJEVENT_MAX_AGE_MS) return value;
      localStorage.removeItem(CJEVENT_KEY);
      localStorage.removeItem(CJEVENT_TS_KEY);
    }
  } catch {
    // Storage unavailable or holding unexpected content — fall through to cookies.
  }

  return readCookie('cje') || readCookie('cjevent_dc') || readCookie('cjevent_sc');
}

/**
 * @returns {string} The action tracker ID for the current host
 */
function getActionTrackerId() {
  return window.location.hostname === CJ_PROD_HOST
    ? CJ_ACTION_TRACKER_IDS.prod
    : CJ_ACTION_TRACKER_IDS.stage;
}

/**
 * @param {number|string} value
 * @returns {number} Value rounded to 2dp, or 0 when not numeric
 */
function round2(value) {
  const num = parseFloat(value);
  if (Number.isNaN(num)) return 0;
  return Math.round(num * 100) / 100;
}

/**
 * ISO country for the order, from the locale segment of the path (us | ca).
 * @returns {string}
 */
function getCustomerCountry() {
  const locale = window.location.pathname.split('/').filter(Boolean)[0] || 'us';
  return locale.toUpperCase();
}

/**
 * @param {object} context Analytics context from the order-complete block
 * @returns {string}
 */
function getCurrencyCode(context) {
  const fromOrder = context?.order?.currencyCode
    || context?.preview?.currencyCode
    || context?.order?.currency
    || context?.preview?.currency;
  if (fromOrder) return String(fromOrder);
  return getCustomerCountry() === 'CA' ? 'CAD' : 'USD';
}

/**
 * CJ line items: top-level lines only, unit price before discount, with the per-line
 * discount included only when non-zero. Mirrors the Magento payload.
 * @param {object[]} items
 * @returns {object[]}
 */
function buildCjItems(items = []) {
  return items
    .map((item) => {
      const entry = {
        itemId: String(item?.sku || '').trim(),
        quantity: Number(item?.quantity ?? item?.qty ?? 0) || 0,
        unitPrice: round2(item?.price?.final ?? item?.price ?? item?.unitPrice ?? 0),
      };
      const discount = Math.abs(round2(item?.discount ?? item?.discountAmount ?? 0));
      if (discount) entry.discount = discount;
      return entry;
    })
    .filter((item) => item.itemId && item.quantity > 0);
}

/**
 * Builds the `window.cj.order` conversion payload.
 *
 * `amount` is the item subtotal excluding tax and shipping and before discounts, with
 * the discount reported separately — matching the Magento implementation.
 * @param {object} context Analytics context dispatched by the order-complete block
 * @returns {object|null} Payload, or null when order data is not yet available
 */
export function buildCjOrder(context) {
  const { order, preview } = context || {};

  const orderId = String(
    order?.friendlyId || order?.number || order?.orderNumber || context?.orderId || '',
  ).trim();
  if (!orderId) return null;

  const items = buildCjItems(
    context?.displayItems?.length ? context.displayItems : order?.items,
  );
  if (!items.length) return null;

  const estimates = order?.estimates;
  const subtotal = estimates
    ? (order.items?.reduce(
      (acc, item) => acc + parseFloat(item.price?.final || 0) * item.quantity,
      0,
    ) ?? 0)
    : parseFloat(preview?.subtotal || 0);
  const discounts = estimates ? (estimates.discounts || []) : (preview?.discounts || []);
  const discountAmount = discounts.reduce(
    (sum, discount) => sum + (Math.abs(parseFloat(discount?.amount)) || 0),
    0,
  );
  const tax = parseFloat(estimates ? (estimates.tax?.amount || 0) : (preview?.taxAmount || 0));

  const cjOrder = {
    enterpriseId: CJ_ENTERPRISE_ID,
    actionTrackerId: getActionTrackerId(),
    orderId,
    currency: getCurrencyCode(context),
    amount: round2(subtotal),
    taxAmount: round2(tax),
    discount: round2(discountAmount),
    customerCountry: getCustomerCountry(),
    pageType: 'conversionConfirmation',
    items,
  };

  const coupon = context?.couponCode || order?.couponCode || '';
  if (coupon) cjOrder.coupon = String(coupon);

  // Sent only when present: CJ expects the key to be absent rather than empty.
  const cjevent = getCjevent();
  if (cjevent) cjOrder.cjeventOrder = cjevent;

  return cjOrder;
}

/**
 * Adds CJ's Universal Tag. No-ops when the tag is already on the page.
 * @returns {void}
 */
function loadCjTag() {
  if (document.getElementById(CJ_TAG_ELEMENT_ID)) return;
  const script = document.createElement('script');
  script.id = CJ_TAG_ELEMENT_ID;
  script.src = `https://www.mczbf.com/tags/${CJ_TAG_ID}/tag.js`;
  script.async = true;
  document.head.appendChild(script);
}

/**
 * Publishes the conversion payload and ensures CJ's tag is present to transmit it.
 *
 * CJ deduplicates by order ID on its side, so a page refresh is already safe; the
 * sessionStorage key simply avoids re-sending on every reload.
 * @param {object} context Analytics context from the order-complete block
 * @returns {boolean} Whether the conversion was published
 */
export function fireCjConversion(context) {
  if (cjConversionFired) return false;

  const cjOrder = buildCjOrder(context);
  if (!cjOrder) return false;

  const trackingKey = `cj_conversion_${cjOrder.orderId}`;
  try {
    if (sessionStorage.getItem(trackingKey)) {
      cjConversionFired = true;
      debug('already reported', cjOrder.orderId);
      return false;
    }
  } catch {
    // Storage unavailable — CJ's order ID deduplication still applies.
  }

  window.cj = window.cj || {};
  window.cj.order = cjOrder;
  loadCjTag();

  cjConversionFired = true;
  try {
    sessionStorage.setItem(trackingKey, 'true');
  } catch {
    // Non-fatal: the conversion has already been published.
  }
  debug('reported', cjOrder);
  return true;
}

/**
 * Reports a confirmed order to CJ.
 * @param {object} context Order context from the order-complete block
 * @returns {boolean} Whether the conversion was published
 */
export function reportCjConversion(context) {
  try {
    return fireCjConversion(context);
  } catch (error) {
    debug('reporting failed', error);
    return false;
  }
}
