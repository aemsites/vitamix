import { getConfig } from './commerce-config.js';
import { AUTH_TOKEN_KEY } from './auth-api.js';
import { mintRecaptchaToken, RECAPTCHA_ACTIONS, RECAPTCHA_HEADER } from './recaptcha.js';

/**
 * Error thrown when the Commerce API returns a non-2xx response.
 * Carries the HTTP status code and the parsed response body so callers
 * can inspect the error detail without re-parsing the response.
 */
class CommerceApiError extends Error {
  constructor(status, body) {
    super(body?.message || `API error ${status}`);
    this.status = status;
    this.body = body;
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

  const resp = await fetch(`${getConfig().apiOrigin}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new CommerceApiError(resp.status, data);
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
 * @returns {Promise<{ rates: Array<{ id: string, label: string, rate: number }> }>}
 * @throws {CommerceApiError}
 */
export async function estimateShipping(country, state, items) {
  return post('/estimate/shipping', {
    country,
    shipping: { country, state },
    items,
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
 * Normalises a checkout:preview payload into scalar price values.
 * @param {Object} preview
 * @param {number} cartSubtotal - fallback when preview.subtotal is absent
 * @returns {{ subtotal: number, taxAmount: number, shippingRate: number, total: number }}
 */
export function parsePreview(preview, cartSubtotal) {
  const subtotal = parseFloat(preview.subtotal) || cartSubtotal;
  const taxAmount = parseFloat(preview.taxAmount) || 0;
  const rawRate = preview.shippingMethod?.rate ?? 0;
  const hasFreeShipping = (preview.discounts ?? []).some((d) => d.freeShipping);
  const shippingRate = hasFreeShipping ? 0 : rawRate;
  const total = parseFloat(preview.total) || (subtotal + taxAmount + shippingRate);
  return {
    subtotal, taxAmount, shippingRate, total,
  };
}
