import { authFetch } from './auth-api.js';
import { getConfig } from './commerce-config.js';

/* eslint-disable no-console -- VITAMIX_ACCOUNT_API_* payload logs for copy/paste integration */

/**
 * Base URL for customer-scoped APIs:
 * `{apiOrigin}/customers/{email}` (apiOrigin is e.g. …/aemsites/sites/vitamix).
 *
 * @param {string} customerEmail
 * @returns {string}
 */
export function getCustomerApiBase(customerEmail) {
  const origin = getConfig().apiOrigin.replace(/\/$/, '');
  return `${origin}/customers/${encodeURIComponent(customerEmail)}`;
}

/**
 * Logs a fixed tag line then the raw response body string for copy/paste.
 *
 * @param {string} tag
 * @param {Response} resp
 * @returns {Promise<unknown>} Parsed JSON or null
 */
async function readResponseAndLog(tag, resp) {
  const text = await resp.text();
  console.log(tag);
  console.log(`HTTP_${resp.status}`);
  console.log(text);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * GET logged-in customer record.
 * @param {string} customerEmail
 * @returns {Promise<unknown>}
 */
export async function getLoggedInCustomer(customerEmail) {
  const url = getCustomerApiBase(customerEmail);
  const resp = await authFetch(url, { method: 'GET' });
  return readResponseAndLog('VITAMIX_ACCOUNT_API_CUSTOMER', resp);
}

/**
 * GET customer addresses list.
 * @param {string} customerEmail
 * @returns {Promise<unknown>}
 */
export async function getCustomerAddresses(customerEmail) {
  const url = `${getCustomerApiBase(customerEmail)}/addresses`;
  const resp = await authFetch(url, { method: 'GET' });
  return readResponseAndLog('VITAMIX_ACCOUNT_API_ADDRESSES', resp);
}

/**
 * GET single address (stub for future UI).
 * @param {string} customerEmail
 * @param {string} addressId
 * @returns {Promise<unknown>}
 */
export async function getCustomerAddressById(customerEmail, addressId) {
  const url = `${getCustomerApiBase(customerEmail)}/addresses/${encodeURIComponent(addressId)}`;
  const resp = await authFetch(url, { method: 'GET' });
  return readResponseAndLog('VITAMIX_ACCOUNT_API_ADDRESS_BY_ID', resp);
}

/**
 * DELETE address (stub for future UI).
 * @param {string} customerEmail
 * @param {string} addressId
 * @returns {Promise<unknown>}
 */
export async function deleteCustomerAddress(customerEmail, addressId) {
  const url = `${getCustomerApiBase(customerEmail)}/addresses/${encodeURIComponent(addressId)}`;
  const resp = await authFetch(url, { method: 'DELETE' });
  return readResponseAndLog('VITAMIX_ACCOUNT_API_ADDRESS_DELETE', resp);
}

/**
 * POST new address (stub for future UI).
 * @param {string} customerEmail
 * @param {Record<string, unknown>} body
 * @returns {Promise<unknown>}
 */
export async function createCustomerAddress(customerEmail, body) {
  const url = `${getCustomerApiBase(customerEmail)}/addresses`;
  const resp = await authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponseAndLog('VITAMIX_ACCOUNT_API_ADDRESS_CREATE', resp);
}

/**
 * GET customer orders list.
 * @param {string} customerEmail
 * @returns {Promise<unknown>}
 */
export async function getCustomerOrders(customerEmail) {
  const url = `${getCustomerApiBase(customerEmail)}/orders`;
  const resp = await authFetch(url, { method: 'GET' });
  return readResponseAndLog('VITAMIX_ACCOUNT_API_ORDERS', resp);
}

/**
 * GET single order (stub; id may be numeric or friendly per API).
 * @param {string} customerEmail
 * @param {string} orderId
 * @returns {Promise<unknown>}
 */
export async function getCustomerOrderById(customerEmail, orderId) {
  const url = `${getCustomerApiBase(customerEmail)}/orders/${encodeURIComponent(orderId)}`;
  const resp = await authFetch(url, { method: 'GET' });
  return readResponseAndLog('VITAMIX_ACCOUNT_API_ORDER_BY_ID', resp);
}

/**
 * Fetches customer, addresses, and orders in parallel for the account drawer.
 *
 * @param {string} customerEmail
 * @returns {Promise<{ customer: unknown, addresses: unknown, orders: unknown }>}
 */
export async function fetchAccountBundle(customerEmail) {
  const [customer, addresses, orders] = await Promise.all([
    getLoggedInCustomer(customerEmail),
    getCustomerAddresses(customerEmail),
    getCustomerOrders(customerEmail),
  ]);
  return { customer, addresses, orders };
}

/** @param {unknown} payload */
function normalizeAddressArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const o = /** @type {Record<string, unknown>} */ (payload);
    if (Array.isArray(o.addresses)) return o.addresses;
    if (Array.isArray(o.items)) return o.items;
    if (Array.isArray(o.data)) return o.data;
  }
  return [];
}

/** @param {unknown} payload */
function normalizeOrderArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const o = /** @type {Record<string, unknown>} */ (payload);
    if (Array.isArray(o.orders)) return o.orders;
    if (Array.isArray(o.items)) return o.items;
    if (Array.isArray(o.data)) return o.data;
  }
  return [];
}

/**
 * @param {Record<string, unknown>} addr
 * @returns {{ badge: string, lines: string[] }}
 */
function mapAddressToDisplay(addr) {
  const id = addr.id != null ? String(addr.id) : '';
  const badgeParts = [];
  if (addr.default === true || addr.isDefault === true) badgeParts.push('Default');
  if (id) badgeParts.push(id);
  const badge = badgeParts.join(' · ') || 'Address';
  const name = typeof addr.name === 'string' ? addr.name : '';
  const line1 = typeof addr.address1 === 'string' ? addr.address1 : '';
  const line2 = [addr.city, addr.state, addr.zip].filter((x) => x != null && String(x).length).join(', ');
  const country = typeof addr.country === 'string' ? addr.country : '';
  const lines = [name, line1, line2, country].filter((x) => String(x).length);
  return { badge, lines: lines.length ? lines : [JSON.stringify(addr)] };
}

function pickOrderTotal(order) {
  if (order.total != null) return String(order.total);
  if (order.grandTotal != null) return String(order.grandTotal);
  if (order.totalDue != null) return String(order.totalDue);
  return '—';
}

/**
 * @param {Record<string, unknown>} order
 * @param {{ placed?: string, total?: string }} orderLabels
 */
function mapOrderToDisplay(order, orderLabels) {
  const id = order.friendlyId || order.orderId || order.id || order.number || '—';
  const date = order.createdAt || order.created_at || order.date || order.placedAt || '—';
  const total = pickOrderTotal(order);
  return {
    id: String(id),
    date: String(date),
    total: String(total),
    placedLabel: orderLabels.placed || 'Placed',
    totalLabel: orderLabels.total || 'Total',
  };
}

/**
 * Builds label/value rows from a customer object (best-effort; API shape may vary).
 *
 * @param {unknown} customer
 * @param {string} fallbackEmail
 * @returns {Array<{ label: string, value: string }>}
 */
function buildInfoRowsFromCustomer(customer, fallbackEmail) {
  if (!customer || typeof customer !== 'object') return [];
  const c = /** @type {Record<string, unknown>} */ (customer);
  const rows = [];
  const push = (label, val) => {
    if (val != null && String(val).length) rows.push({ label, value: String(val) });
  };
  push('Email', c.email ?? fallbackEmail);
  const name = typeof c.name === 'string' ? c.name
    : [c.firstName, c.lastName].filter((x) => x != null && String(x).length).join(' ');
  push('Name', name);
  push('Phone', c.phone ?? c.telephone);
  push('Customer ID', c.id ?? c.customerId ?? c.uid);
  push('Preferred language', c.locale ?? c.language);
  push('Account status', c.status ?? c.state);
  return rows.filter((r) => r.value.length);
}

/**
 * Updates overview + information panels when customer JSON is available.
 *
 * @param {HTMLElement} widget
 * @param {unknown} customer
 * @param {string} email
 */
function applyCustomerToWidget(widget, customer, email) {
  const information = widget.querySelector('.account-panel[data-section="information"]');
  if (!information) return;
  const rows = buildInfoRowsFromCustomer(customer, email);
  if (!rows.length) return;
  const container = information.querySelector('.account-mock-rows');
  if (!container) return;
  container.innerHTML = '';
  rows.forEach((row) => {
    const wrap = document.createElement('div');
    wrap.className = 'account-mock-row';
    const lab = document.createElement('span');
    lab.className = 'account-mock-label';
    lab.textContent = row.label;
    const val = document.createElement('span');
    val.className = 'account-mock-value';
    val.textContent = row.value;
    wrap.append(lab, val);
    container.append(wrap);
  });
}

/**
 * @param {HTMLElement} widget
 * @param {unknown} addressesPayload
 */
function applyAddressesToWidget(widget, addressesPayload) {
  const listEl = widget.querySelector('.account-address-list');
  if (!listEl) return;
  const raw = normalizeAddressArray(addressesPayload);
  if (!raw.length) return;
  const mapped = raw
    .filter((x) => x && typeof x === 'object')
    .map((x) => mapAddressToDisplay(/** @type {Record<string, unknown>} */ (x)));
  listEl.innerHTML = '';
  mapped.forEach((addr) => {
    const li = document.createElement('li');
    li.className = 'account-address-item';
    const badge = document.createElement('div');
    badge.className = 'account-address-badge';
    badge.textContent = addr.badge;
    const lines = document.createElement('p');
    lines.className = 'account-address-lines';
    lines.textContent = addr.lines.join('\n');
    li.append(badge, lines);
    listEl.append(li);
  });
}

/**
 * @param {HTMLElement} widget
 * @param {unknown} ordersPayload
 * @param {{ placed?: string, total?: string }} orderMockLabels
 */
function applyOrdersToWidget(widget, ordersPayload, orderMockLabels) {
  const list = widget.querySelector('.account-order-mock-list');
  if (!list) return;
  const raw = normalizeOrderArray(ordersPayload);
  if (!raw.length) return;
  list.innerHTML = '';
  raw.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const o = mapOrderToDisplay(/** @type {Record<string, unknown>} */ (item), orderMockLabels);
    const li = document.createElement('li');
    li.className = 'account-order-mock-item';
    const idEl = document.createElement('span');
    idEl.className = 'account-order-mock-id';
    idEl.textContent = o.id;
    const meta = document.createElement('div');
    meta.className = 'account-order-mock-meta';
    const s1 = document.createElement('span');
    s1.textContent = `${o.placedLabel}: ${o.date}`;
    const s2 = document.createElement('span');
    s2.textContent = `${o.totalLabel}: ${o.total}`;
    meta.append(s1, s2);
    li.append(idEl, meta);
    list.append(li);
  });
}

/** If API wraps payload in `{ data: ... }`, unwrap one level. */
function unwrapPayload(payload) {
  if (payload == null) return payload;
  if (typeof payload === 'object' && 'data' in payload && payload.data !== undefined) {
    return /** @type {Record<string, unknown>} */ (payload).data;
  }
  return payload;
}

/**
 * After fetchAccountBundle, maps API payloads onto the account widget DOM.
 *
 * @param {HTMLElement} widget
 * @param {{ customer: unknown, addresses: unknown, orders: unknown }} data
 * @param {{ orderMock?: { placed?: string, total?: string } }} [copySlice]
 */
export function applyAccountDataToWidget(widget, data, copySlice = {}) {
  const email = /** @type {HTMLParagraphElement | null} */ (widget.querySelector('.account-email-muted'))?.textContent?.trim() || '';

  let customer = unwrapPayload(data.customer);
  if (Array.isArray(customer) && customer.length === 1) {
    [customer] = customer;
  }

  const addresses = unwrapPayload(data.addresses);
  const orders = unwrapPayload(data.orders);

  if (customer && typeof customer === 'object') {
    applyCustomerToWidget(widget, customer, email);
  }
  if (addresses != null) {
    applyAddressesToWidget(widget, addresses);
  }
  if (orders != null) {
    applyOrdersToWidget(widget, orders, copySlice.orderMock || {});
  }
}
