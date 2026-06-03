import { getConfig } from './commerce-config.js';
import { AUTH_TOKEN_KEY } from './auth-api.js';
import { mintRecaptchaToken, RECAPTCHA_ACTIONS, RECAPTCHA_HEADER } from './recaptcha.js';
import { getLocaleAndLanguage, loggedFetch } from './scripts.js';
import { logApiError, logNetworkError } from './operations-log.js';

/**
 * Error thrown when the Commerce API returns a non-2xx response.
 * Carries the HTTP status code and the parsed response body so callers
 * can inspect the error detail without re-parsing the response.
 */
class CommerceApiError extends Error {
  constructor(status, body, errorHeader) {
    super(body?.message || `API error ${status}`);
    this.status = status;
    this.body = body;
    this.errorHeader = errorHeader || null;
  }
}

/**
 * Makes an authenticated POST request to the Commerce API.
 * Attaches a Bearer token from sessionStorage if one is present, so orders
 * created while a user is logged in are associated with their account.
 * When `recaptchaAction` is provided AND no Bearer token is available,
 * mints a reCAPTCHA Enterprise token and attaches it as `X-Recaptcha-Token`.
 * Bypass if authenticated.
 *
 * @param {string} path - API path relative to ORDERS_API_ORIGIN (e.g. '/orders')
 * @param {Object} body - Request payload, serialised as JSON
 * @param {string} [recaptchaAction] - One of RECAPTCHA_ACTIONS, or undefined to skip
 * @returns {Promise<Object>} Parsed JSON response body
 * @throws {CommerceApiError} If the response status is not 2xx
 */
async function post(path, body, recaptchaAction) {
  const headers = { 'Content-Type': 'application/json' };
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;

  if (recaptchaAction && !token) {
    const recaptchaToken = await mintRecaptchaToken(recaptchaAction);
    if (recaptchaToken) headers[RECAPTCHA_HEADER] = recaptchaToken;
  }

  let resp;
  let data;
  try {
    resp = await loggedFetch(`${getConfig().apiOrigin}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    data = await resp.json();
  } catch (err) {
    logNetworkError({
      method: 'POST', path, error: err, requestBody: body,
    });
    throw err;
  }
  if (!resp.ok) {
    logApiError({
      method: 'POST', path, status: resp.status, responseBody: data, requestBody: body,
    });
    throw new CommerceApiError(resp.status, data, resp.headers.get('x-error'));
  }
  return data;
}

/**
 * Fetches available shipping rates for a given destination and cart contents.
 * Used to populate the shipping method selector on the checkout form before
 * the order is previewed or placed.
 *
 * @param {string} country - ISO 3166-1 alpha-2 country code (e.g. 'ca', 'us')
 * @param {string} state - State or province code (e.g. 'QC', 'CA')
 * @param {Array<{sku: string, path: string, quantity: number, price: Object}>} items
 *   Cart items in API format
 * @param {string} [couponCode] - coupon code; free-shipping discounts apply when provided
 * @param {string} [couponSource] - coupon source, for verified/auto-applied coupons
 * @returns {Promise<{ rates: Array<{ id: string, label: string, rate: string }> }>}
 * @throws {CommerceApiError}
 */
export async function estimateShipping(country, state, items, couponCode, couponSource) {
  return post('/estimate/shipping', {
    country,
    shipping: { country, state },
    items,
    ...(couponCode ? { couponCode } : {}),
    ...(couponCode && couponSource ? { couponSource } : {}),
  });
}

/**
 * Validates a coupon code and returns the resulting discounts without requiring
 * a shipping method. Backed by POST /estimate/price — throws CommerceApiError
 * with errorHeader set to the coupon error code on any validation failure.
 *
 * @param {string} country - ISO 3166-1 alpha-2 country code (e.g. 'us', 'ca')
 * @param {Array} items - Cart items in API format
 * @param {string} couponCode - The coupon code to validate
 * @param {string} [couponSource] - coupon source, for verified/auto-applied coupons
 * @returns {Promise<{ subtotal: number, discounts: Array, orderDiscountTotal: number }>}
 * @throws {CommerceApiError}
 */
export async function estimatePrice(country, items, couponCode, couponSource) {
  return post('/estimate/price', {
    country,
    items,
    couponCode,
    ...(couponCode && couponSource ? { couponSource } : {}),
  });
}

/**
 * Fetches fully computed totals for all shipping methods at an address during Apple Pay
 * express checkout. Called inside `onshippingcontactselected` where only a partial address
 * (city, state, country, zip — no street) is available.
 *
 * @param {string} country - ISO 3166-1 alpha-2 country code (e.g. 'us', 'ca')
 * @param {string} state - State or province code (e.g. 'QC', 'CA')
 * @param {string} zip - Postal/ZIP code
 * @param {Array<{sku: string, path: string, quantity: number, price: Object}>} items
 * @returns {Promise<{ subtotal: number, shippingMethods: Array<Object> }>}
 * @throws {CommerceApiError}
 */
export async function estimateExpressCheckout(country, state, zip, items) {
  return post('/estimate/order', {
    country,
    shipping: { country, state, zip },
    items,
  });
}

/**
 * Previews an order to lock in tax, discounts, and shipping cost, and
 * obtain an `estimateToken` that must be included when placing the order.
 * Call this after the user selects a shipping method and before payment.
 *
 * @param {Object} orderBody - Full order body including customer, shipping, items,
 *   and shippingMethod.id
 * @returns {Promise<{ subtotal: number, taxAmount: number, taxRate: number,
 *   shippingMethod: Object, discounts: Array, total: number, estimateToken: string }>}
 * @throws {CommerceApiError}
 */
export async function previewOrder(orderBody) {
  return post('/orders/preview', orderBody, RECAPTCHA_ACTIONS.ORDERS_PREVIEW);
}

/**
 * Places an order. The request body must include the `estimateToken` returned
 * by `previewOrder` to confirm the quoted totals. If the user is logged in,
 * the order is automatically associated with their account via the Bearer token.
 *
 * @param {Object} orderBody - Full order body including customer, shipping, items,
 *   shippingMethod, and estimateToken
 * @returns {Promise<{ order: Object }>}
 * @throws {CommerceApiError}
 */
export async function createOrder(orderBody) {
  return post('/orders', orderBody, RECAPTCHA_ACTIONS.ORDERS_CREATE);
}

/**
 * Initiates a payment for a placed order.
 * The idempotency key ensures that retrying the same request (e.g. after a
 * network failure) does not result in a duplicate charge.
 *
 * @param {string} orderId - The order ID returned by `createOrder`
 * @param {string} idempotencyKey - A unique key for this payment attempt (e.g. a UUID)
 * @param {string} [fraudToken] - Optional fraud provider session token
 * @param {string} [provider='chase'] - Payment provider ('chase', 'paypal', 'chase-wallet')
 * @param {string} [paymentMethod='card'] - Payment method ('card', 'paypal', 'apple-pay')
 * @param {Object} [extra={}] - Additional provider-specific fields (e.g. token, billingContact)
 * @returns {Promise<{ orderId: string, paymentAttemptId: string, status: string,
 *   action?: string, redirectUrl?: string, transactionId?: string, reason?: string }>}
 * @throws {CommerceApiError}
 */
export async function initiatePayment(orderId, idempotencyKey, fraudToken, provider = 'chase', paymentMethod = 'card', extra = {}) {
  return post(`/orders/${orderId}/payments`, {
    provider,
    paymentMethod,
    idempotencyKey,
    ...(fraudToken ? { fraudToken } : {}),
    ...extra,
  });
}

/**
 * Makes an authenticated HTTP request to the Commerce API.
 * Attaches a Bearer token from sessionStorage when present.
 * No reCAPTCHA support — PayPal session endpoints are Cloudflare-rate-limited.
 *
 * @param {string} path - API path relative to config.apiOrigin
 * @param {object|null} body - Request payload; omitted when null
 * @param {string} method - HTTP verb (GET, POST, PATCH, etc.)
 * @returns {Promise<object>} Parsed JSON response body
 * @throws {CommerceApiError} If the response status is not 2xx
 */
async function request(path, body, method) {
  const headers = {};
  if (body !== null) headers['Content-Type'] = 'application/json';
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;

  let resp;
  let data;
  try {
    resp = await fetch(`${getConfig().apiOrigin}${path}`, {
      method,
      headers,
      ...(body !== null ? { body: JSON.stringify(body) } : {}),
    });
    data = await resp.json();
  } catch (err) {
    logNetworkError({
      method, path, error: err, requestBody: body,
    });
    throw err;
  }
  if (!resp.ok) {
    logApiError({
      method, path, status: resp.status, responseBody: data, requestBody: body,
    });
    throw new CommerceApiError(resp.status, data, resp.headers.get('x-error'));
  }
  return data;
}

/**
 * Creates a PayPal order via the commerce API session endpoint.
 * Called in the PayPal SDK's createOrder callback before a shipping address is known.
 *
 * @param {Array<object>} items - Cart line items in API format
 * @param {object} config - Commerce config with getLocale(), getLanguage(), currency
 * @returns {Promise<{paypalOrderId: string}>}
 * @throws {CommerceApiError}
 */
export async function createPayPalSession(items, config) {
  const currency = typeof config.currency === 'function'
    ? config.currency(config.getLocale())
    : config.currency;
  const { locale: country, language: locale } = getLocaleAndLanguage(false, true);
  return request('/payments/paypal/session', {
    items,
    currency,
    country,
    locale,
  }, 'POST');
}

/**
 * Patches a PayPal order with updated shipping address or selected option data.
 * Called in onShippingAddressChange and onShippingOptionsChange SDK callbacks.
 *
 * @param {string} paypalOrderId - PayPal order ID from createPayPalSession
 * @param {object} data - Patch payload ({ type, address?, items?,
 *   selectedOptionId?, total?, taxAmount?, shippingRate? })
 * @returns {Promise<object>} API response
 * @throws {CommerceApiError}
 */
export async function patchPayPalSession(paypalOrderId, data) {
  return request(`/payments/paypal/session/${paypalOrderId}`, data, 'PATCH');
}

/**
 * Retrieves the normalized payer and shipping details from a completed PayPal order.
 * Called in onApprove after the buyer has authenticated.
 *
 * @param {string} paypalOrderId - PayPal order ID from createPayPalSession
 * @param {string} [country] - Store country code for provider config resolution
 * @param {string} [locale] - Store locale for provider config resolution
 * @returns {Promise<{payer: object, shippingAddress: object,
 *   selectedOptionId: string|undefined}>}
 * @throws {CommerceApiError}
 */
export async function getPayPalSession(paypalOrderId, country, locale) {
  const params = new URLSearchParams();
  if (country) params.set('country', country);
  if (locale) params.set('locale', locale);
  const qs = params.size ? `?${params}` : '';
  return request(`/payments/paypal/session/${paypalOrderId}${qs}`, null, 'GET');
}

/**
 * Requests an Apple Pay merchant session from the Commerce API.
 * Called inside `ApplePaySession.onvalidatemerchant` — the API makes a mutual-TLS
 * POST to Apple's gateway and returns the opaque merchant session object.
 *
 * @param {string} validationUrl - The URL provided by Apple in the onvalidatemerchant event
 * @param {string} [country] - ISO country code (e.g. 'us', 'ca') for provider config resolution
 * @param {string} [locale] - BCP-47 locale string (e.g. 'en-US') for provider config resolution
 * @returns {Promise<{ merchantSession: Object }>}
 * @throws {CommerceApiError}
 */
export async function validateApplePayMerchant(validationUrl, country, locale) {
  return post('/payments/apple-pay/validate-merchant', {
    validationUrl,
    ...(country ? { country } : {}),
    ...(locale ? { locale } : {}),
  });
}

/**
 * Fetches a single order by order ID and customer email.
 * No authentication required — knowing the email and order ID is sufficient
 * proof for guest order lookups (post-checkout confirmation, order status).
 *
 * @param {string} email - Customer email address
 * @param {string} orderId - The order ID returned by createOrder
 * @returns {Promise<{ order: Object }>}
 * @throws {CommerceApiError} If order not found or email doesn't match
 */
export async function getOrder(email, orderId) {
  return request(`/customers/${email}/orders/${orderId}`, null, 'GET');
}

/**
 * Normalises a checkout:preview payload into scalar price values.
 * @param {Object} preview
 * @param {number} cartSubtotal - fallback when preview.subtotal is absent
 * @returns {{ subtotal: number, taxAmount: number, shippingRate: number, total: number }}
 */
export function parsePreview(preview, cartSubtotal) {
  const subtotal = parseFloat(preview.subtotal) || cartSubtotal;
  const taxAmount = parseFloat(preview.taxAmount) || 0;
  const rawRate = preview.shippingMethod?.rate ?? 0;
  const discounts = preview.discounts ?? [];
  const hasFreeShipping = discounts.some((d) => d.freeShipping);
  const shippingRate = hasFreeShipping ? 0 : rawRate;
  const total = parseFloat(preview.total) || (subtotal + taxAmount + shippingRate);
  return {
    subtotal, taxAmount, shippingRate, total, discounts,
  };
}
