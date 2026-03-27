import { ORDERS_API_ORIGIN } from './scripts.js';

class CommerceApiError extends Error {
  constructor(status, body) {
    super(body?.message || `API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function post(path, body) {
  const resp = await fetch(`${ORDERS_API_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new CommerceApiError(resp.status, data);
  }
  return data;
}

/**
 * Fetch available shipping rates for a given address and items.
 * @param {string} country
 * @param {string} state
 * @param {Array} items - Items in API format (sku, path, quantity, price)
 * @returns {Promise<{rates: Array}>}
 */
export async function estimateShipping(country, state, items) {
  return post('/estimate/shipping', {
    country,
    shipping: { country, state },
    items,
  });
}

/**
 * Preview an order to lock in estimates and get an estimateToken.
 * @param {Object} orderBody - Full order body including shippingMethod.id
 * @returns {Promise<{subtotal, taxAmount, taxRate, shippingMethod, discounts, total, estimateToken}>}
 */
export async function previewOrder(orderBody) {
  return post('/orders/preview', orderBody);
}

/**
 * Create an order.
 * @param {Object} orderBody - Full order body including estimateToken
 * @returns {Promise<{order: Object}>}
 */
export async function createOrder(orderBody) {
  return post('/orders', orderBody);
}

/**
 * Initiate payment for an order.
 * @param {string} orderId
 * @param {string} idempotencyKey
 * @returns {Promise<{orderId, paymentAttemptId, status, action, redirectUrl}>}
 */
export async function initiatePayment(orderId, idempotencyKey) {
  return post(`/orders/${orderId}/payments`, {
    provider: 'chase',
    paymentMethod: 'card',
    idempotencyKey,
  });
}
