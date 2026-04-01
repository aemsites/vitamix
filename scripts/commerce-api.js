import { ORDERS_API_ORIGIN } from './scripts.js';

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
 *
 * @param {string} path - API path relative to ORDERS_API_ORIGIN (e.g. '/orders')
 * @param {Object} body - Request payload, serialised as JSON
 * @returns {Promise<Object>} Parsed JSON response body
 * @throws {CommerceApiError} If the response status is not 2xx
 */
async function post(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = sessionStorage.getItem('auth_token');
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(`${ORDERS_API_ORIGIN}${path}`, {
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
  return post('/orders/preview', orderBody);
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
  return post('/orders', orderBody);
}

/**
 * Initiates a Chase card payment for a placed order.
 * The idempotency key ensures that retrying the same request (e.g. after a
 * network failure) does not result in a duplicate charge.
 *
 * @param {string} orderId - The order ID returned by `createOrder`
 * @param {string} idempotencyKey - A unique key for this payment attempt (e.g. a UUID)
 * @returns {Promise<{ orderId: string, paymentAttemptId: string, status: string,
 *   action: string, redirectUrl: string }>}
 * @throws {CommerceApiError}
 */
export async function initiatePayment(orderId, idempotencyKey) {
  return post(`/orders/${orderId}/payments`, {
    provider: 'chase',
    paymentMethod: 'card',
    idempotencyKey,
  });
}
