import { createOptimizedPicture } from '../../scripts/aem.js';
import { authFetch } from '../../scripts/auth-api.js';
import { formatPrice, getConfig } from '../../scripts/commerce-config.js';
import { FORMS_ENDPOINT, getLocaleAndLanguage } from '../../scripts/scripts.js';
import sortAccountOrdersNewestFirst from './order-sort.js';
import {
  loadOrderStatusCopy,
  performOrderStatusLookup,
  renderOrderStatusResult,
  renderOrderStatusDefinitions,
} from '../forms/order-status-lookup.js';

/**
 * GET URL for the signed-in user's forms profile (customer + newsletter opt-in status).
 * @returns {string}
 */
function getFormsProfileUrl() {
  const { locale, language } = getLocaleAndLanguage();
  return `${FORMS_ENDPOINT}/${locale}/${language}/forms/profile`;
}

/**
 * GET forms profile: customer record + newsletter opt-in status (requires Bearer token).
 *
 * @returns {Promise<{
 *   customer: unknown,
 *   profile: {
 *     emailOptInStatus?: boolean,
 *     smsOptInStatus?: boolean,
 *     emailAddress?: string,
 *     mobile?: string | null,
 *   } | null,
 * }>}
 */
export async function fetchFormsProfile() {
  const url = getFormsProfileUrl();
  const resp = await authFetch(url, { method: 'GET' });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Profile request failed (${resp.status})`);
  }
  if (!text.trim()) {
    return { customer: null, profile: null };
  }
  let payload = JSON.parse(text);
  if (payload && typeof payload === 'object' && 'data' in payload && payload.data !== undefined) {
    payload = payload.data;
  }
  const root = payload && typeof payload === 'object' ? /** @type {Record<string, unknown>} */ (payload) : {};
  /**
   * @type {{
   *   emailOptInStatus?: boolean,
   *   smsOptInStatus?: boolean,
   *   emailAddress?: string,
   *   mobile?: string | null,
   * } | null}
   */
  const profile = root.profile && typeof root.profile === 'object'
    ? root.profile
    : null;
  return {
    customer: root.customer ?? null,
    profile,
  };
}

/**
 * Base URL for customer-scoped APIs:
 * `{apiOrigin}/customers/{encodedEmail}` (apiOrigin is e.g. …/aemsites/sites/vitamix).
 * The email path segment is URL-encoded (e.g. `@` → `%40`) per RFC 3986.
 *
 * @param {string} customerEmail
 * @returns {string}
 */
export function getCustomerApiBase(customerEmail) {
  const origin = getConfig().apiOrigin.replace(/\/$/, '');
  return `${origin}/customers/${encodeURIComponent(customerEmail)}`;
}

/**
 * Reads response body and parses JSON when present.
 *
 * @param {Response} resp
 * @param {{ throwIfNotOk?: boolean }} [options]
 * @returns {Promise<unknown>} Parsed JSON or null
 */
async function readResponse(resp, options = {}) {
  const text = await resp.text();
  if (options.throwIfNotOk && !resp.ok) {
    throw new Error(`Request failed (${resp.status})`);
  }
  if (!text.trim()) {
    return null;
  }
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
  return readResponse(resp);
}

/**
 * GET customer addresses list.
 * @param {string} customerEmail
 * @returns {Promise<unknown>}
 */
export async function getCustomerAddresses(customerEmail) {
  const url = `${getCustomerApiBase(customerEmail)}/addresses`;
  const resp = await authFetch(url, { method: 'GET' });
  return readResponse(resp);
}

/**
 * GET single address by id.
 * @param {string} customerEmail
 * @param {string} addressId
 * @returns {Promise<unknown>}
 */
export async function getCustomerAddressById(customerEmail, addressId) {
  const url = `${getCustomerApiBase(customerEmail)}/addresses/${encodeURIComponent(addressId)}`;
  const resp = await authFetch(url, { method: 'GET' });
  return readResponse(resp);
}

/**
 * DELETE address.
 * @param {string} customerEmail
 * @param {string} addressId
 * @returns {Promise<unknown>}
 */
export async function deleteCustomerAddress(customerEmail, addressId) {
  const url = `${getCustomerApiBase(customerEmail)}/addresses/${encodeURIComponent(addressId)}`;
  const resp = await authFetch(url, { method: 'DELETE' });
  return readResponse(resp, { throwIfNotOk: true });
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
  return readResponse(resp, { throwIfNotOk: true });
}

/**
 * PUT replace customer address.
 * @param {string} customerEmail
 * @param {string} addressId
 * @param {Record<string, unknown>} body
 * @returns {Promise<unknown>}
 */
export async function updateCustomerAddress(customerEmail, addressId, body) {
  const url = `${getCustomerApiBase(customerEmail)}/addresses/${encodeURIComponent(addressId)}`;
  const resp = await authFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse(resp, { throwIfNotOk: true });
}

/**
 * GET customer orders list.
 * @param {string} customerEmail
 * @returns {Promise<unknown>}
 */
export async function getCustomerOrders(customerEmail) {
  const url = `${getCustomerApiBase(customerEmail)}/orders`;
  const resp = await authFetch(url, { method: 'GET' });
  return readResponse(resp);
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
  return readResponse(resp, { throwIfNotOk: true });
}

/**
 * Fetches customer and orders for the account drawer.
 *
 * Addresses are intentionally excluded so the drawer can open quickly; they are loaded lazily
 * when the customer opens the Addresses tab.
 *
 * @param {string} customerEmail
 * @returns {Promise<{ customer: unknown }>}
 */
export async function fetchAccountBundle(customerEmail) {
  const customer = await getLoggedInCustomer(customerEmail);
  return { customer };
}

/** @param {unknown} iso */
function formatIsoForUi(iso) {
  if (iso == null || iso === '') return '—';
  const s = typeof iso === 'string' ? iso : String(iso);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
}

/**
 * API returns `{ "customer": { ... } }` at the root of the customer GET response.
 *
 * @param {unknown} payload
 * @returns {unknown}
 */
function unwrapCustomerResponse(payload) {
  const afterData = (payload && typeof payload === 'object' && 'data' in payload
    && /** @type {Record<string, unknown>} */ (payload).data !== undefined)
    ? /** @type {Record<string, unknown>} */ (payload).data
    : payload;
  if (afterData && typeof afterData === 'object' && 'customer' in afterData
    && /** @type {Record<string, unknown>} */ (afterData).customer != null) {
    return /** @type {Record<string, unknown>} */ (afterData).customer;
  }
  return afterData;
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

/**
 * Turns ISO 3166-1 alpha-2 codes (e.g. `us`, `CA`) into a region name in the store language
 * (from URL path, same as {@link getLocaleAndLanguage}).
 *
 * @param {unknown} raw
 * @returns {string}
 */
function formatCountryLabel(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  const iso = s.length === 2 && /^[a-zA-Z]{2}$/.test(s) ? s.toUpperCase() : null;
  if (!iso) return s;

  let uiLocale = 'en-US';
  try {
    const { language } = getLocaleAndLanguage(true, true);
    if (language && typeof language === 'string') uiLocale = language;
  } catch {
    /* no window */
  }

  if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
    try {
      const label = new Intl.DisplayNames([uiLocale], { type: 'region' }).of(iso);
      if (label && typeof label === 'string') return label;
    } catch {
      /* bad locale tag */
    }
  }
  return iso;
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
 * @param {Record<string, string>} [addressBookCopy]
 * @returns {{ badge: string, lines: string[] }}
 */
function mapAddressToDisplay(addr, addressBookCopy = {}) {
  const defBadge = addressBookCopy.defaultBadge || 'Default';
  const id = addr.id != null ? String(addr.id) : '';
  const hasStreet = typeof addr.address1 === 'string' && addr.address1.length > 0;

  /* List endpoint: { id, email, isDefault } only — hydrate before display when possible */
  if (!hasStreet && id) {
    const isDef = addr.isDefault === true;
    const badge = isDef ? defBadge : '';
    const emailLine = typeof addr.email === 'string' ? addr.email : '';
    const lines = [emailLine].filter((x) => String(x).length);
    return {
      badge,
      lines: lines.length ? lines : [addressBookCopy.listSummaryFallback || 'Address'],
    };
  }

  const badgeParts = [];
  if (addr.isDefault === true) badgeParts.push(defBadge);
  const badge = badgeParts.join(' · ');
  const name = typeof addr.name === 'string' ? addr.name : '';
  const line1 = typeof addr.address1 === 'string' ? addr.address1 : '';
  const line2 = [addr.city, addr.state, addr.zip].filter((x) => x != null && String(x).length).join(', ');
  const countryRaw = typeof addr.country === 'string' ? addr.country : '';
  const country = countryRaw ? formatCountryLabel(countryRaw) : '';
  const lines = [name, line1, line2, country].filter((x) => String(x).length);
  return { badge, lines: lines.length ? lines : [JSON.stringify(addr)] };
}

/**
 * @param {HTMLElement} widget
 * @param {unknown} customer
 * @param {string} email
 * @param {Record<string, unknown>} copy
 */
function applyOverviewPanel(widget, customer, email, copy) {
  const overview = widget.querySelector('.account-panel[data-section="overview"]');
  if (!overview) return;
  const container = overview.querySelector('.account-overview-rows');
  if (!container) return;
  container.innerHTML = '';
  const ov = /** @type {Record<string, string>} */ (copy.overviewLabels || {});
  const countries = /** @type {Record<string, string>} */ (copy.countries || {});
  const lc = String(
    /** @type {{ accountLocale?: string }} */ (copy).accountLocale
    || (typeof window !== 'undefined'
      ? (window.location.pathname.split('/').filter(Boolean)[0] || 'us')
      : 'us'),
  ).toLowerCase();

  const pushRow = (label, value) => {
    if (value == null || String(value).length === 0) return;
    const wrap = document.createElement('div');
    wrap.className = 'account-mock-row';
    const lab = document.createElement('span');
    lab.className = 'account-mock-label';
    lab.textContent = label;
    const val = document.createElement('span');
    val.className = 'account-mock-value';
    val.textContent = String(value);
    wrap.append(lab, val);
    container.append(wrap);
  };

  if (customer && typeof customer === 'object') {
    const c = /** @type {Record<string, unknown>} */ (customer);
    const name = typeof c.name === 'string' ? c.name
      : [c.firstName, c.lastName].filter((x) => x != null && String(x).length).join(' ');
    if (name) pushRow(ov.displayName || 'Name', name);
    if (email) pushRow(ov.email || 'Email', email);
    if (c.createdAt) pushRow(ov.memberSince || 'Member since', formatIsoForUi(c.createdAt));
    if (c.status != null || c.state != null) {
      pushRow(ov.accountStatus || 'Account status', String(c.status ?? c.state));
    }
  }
  const regionLabel = countries[lc] || lc.toUpperCase();
  pushRow(ov.storeRegion || 'Store region', regionLabel);
}

function pickOrderTotal(order) {
  if (order.total != null) return order.total;
  if (order.grandTotal != null) return order.grandTotal;
  if (order.totalDue != null) return order.totalDue;
  const payment = order.payment && typeof order.payment === 'object'
    ? /** @type {Record<string, unknown>} */ (order.payment)
    : null;
  if (payment?.amount != null) return payment.amount;
  return null;
}

/**
 * @param {Record<string, unknown>} order
 * @returns {string}
 */
function getOrderCurrency(order) {
  const payment = order.payment && typeof order.payment === 'object'
    ? /** @type {Record<string, unknown>} */ (order.payment)
    : null;
  return String(order.currency || order.currencyCode || payment?.currency || 'USD');
}

/**
 * @param {Record<string, unknown>} order
 * @returns {string}
 */
function formatOrderTotalDisplay(order) {
  const total = pickOrderTotal(order);
  if (total == null || total === '') return '—';
  const amount = typeof total === 'number' ? total : Number(total);
  if (Number.isFinite(amount)) return formatPrice(amount, getOrderCurrency(order));
  return String(total);
}

/**
 * Last segment after the final `-` (e.g. `…661Z-K1770KLK` → `K1770KLK`). If there is no hyphen,
 * returns the trimmed string unchanged.
 *
 * @param {string} raw
 * @returns {string}
 */
export function getOrderNumberTailSegment(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const i = s.lastIndexOf('-');
  if (i === -1) return s;
  const tail = s.slice(i + 1).trim();
  return tail || s;
}

/**
 * Short order number for UI: tail segment, uppercased, hyphen after the first 4 characters
 * when longer (e.g. `ydm3csej` → `YDM3-CSEJ`).
 *
 * @param {string} raw
 * @returns {string}
 */
export function formatOrderNumberForDisplay(raw) {
  const tail = getOrderNumberTailSegment(raw);
  const u = tail.toUpperCase();
  if (u.length <= 4) return u;
  return `${u.slice(0, 4)}-${u.slice(4)}`;
}

/**
 * @param {unknown} raw
 * @param {Record<string, string>} statusLabels
 * @returns {string}
 */
function formatOrderStatus(raw, statusLabels = {}) {
  if (raw == null || raw === '') return '—';
  const key = String(raw).trim();
  if (!key) return '—';
  if (statusLabels[key]) return statusLabels[key];
  return key
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @param {Record<string, unknown>} order
 * @param {{
 *   placed?: string,
 *   total?: string,
 *   state?: string,
 *   statuses?: Record<string, string>,
 * }} orderLabels
 */
function mapOrderToDisplay(order, orderLabels) {
  const fetchId = order.id || order.friendlyId || order.orderId || order.number || '—';
  const displaySource = order.friendlyId || order.orderId || order.number || order.orderNumber
    || order.id || fetchId;
  const dateRaw = order.createdAt || order.created_at || order.date || order.placedAt;
  const dateDisplay = formatIsoForUi(dateRaw);
  const state = formatOrderStatus(order.state, orderLabels.statuses || {});
  const orderId = String(fetchId);
  const displayOrderNumber = order.friendlyId || order.orderId || order.number || order.orderNumber
    ? String(displaySource)
    : formatOrderNumberForDisplay(String(displaySource));
  return {
    orderId,
    displayOrderNumber,
    metaFirst: `${orderLabels.placed || 'Placed'}: ${dateDisplay}`,
    status: `${orderLabels.state || 'Status'}: ${state}`,
    total: formatOrderTotalDisplay(order),
  };
}

/**
 * Builds label/value rows from a customer object (best-effort; API shape may vary).
 *
 * @param {unknown} customer
 * @param {string} fallbackEmail
 * @param {Record<string, string>} [labels]
 * @returns {Array<{ label: string, value: string }>}
 */
function buildInfoRowsFromCustomer(customer, fallbackEmail, labels = {}) {
  if (!customer || typeof customer !== 'object') return [];
  const c = /** @type {Record<string, unknown>} */ (customer);
  const rows = [];
  const push = (key, val) => {
    const label = labels[key];
    if (!label || val == null || !String(val).length) return;
    rows.push({ label, value: String(val) });
  };
  push('email', c.email ?? fallbackEmail);
  const name = typeof c.name === 'string' ? c.name
    : [c.firstName, c.lastName].filter((x) => x != null && String(x).length).join(' ');
  push('name', name);
  push('phone', c.phone ?? c.telephone);
  push('customerId', c.id ?? c.customerId ?? c.uid);
  push('preferredLanguage', c.locale ?? c.language);
  push('accountStatus', c.status ?? c.state);
  if (c.createdAt) push('created', formatIsoForUi(c.createdAt));
  if (c.updatedAt) push('updated', formatIsoForUi(c.updatedAt));
  return rows.filter((r) => r.value.length);
}

/**
 * Updates the information panel when customer JSON is available.
 *
 * @param {HTMLElement} widget
 * @param {unknown} customer
 * @param {string} email
 * @param {Record<string, unknown>} copy
 */
function applyCustomerToWidget(widget, customer, email, copy) {
  const information = widget.querySelector('.account-panel[data-section="information"]');
  if (!information) return;
  const labels = /** @type {Record<string, string>} */ (copy.customerInfo || {});
  const rows = buildInfoRowsFromCustomer(customer, email, labels);
  const container = information.querySelector('.account-mock-rows');
  if (!container) return;
  container.innerHTML = '';
  if (!rows.length) return;
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
 * @param {unknown} ordersPayload
 * @param {{ placed?: string, total?: string, state?: string }} orderMockLabels
 * @param {Record<string, unknown>} copy
 */
export function applyOrdersToWidget(widget, ordersPayload, orderMockLabels, copy = {}) {
  const list = widget.querySelector('.account-order-mock-list');
  const emptyEl = widget.querySelector('.account-orders-empty');
  if (!list) return;
  list.innerHTML = '';
  const raw = sortAccountOrdersNewestFirst(normalizeOrderArray(ordersPayload));
  if (!raw.length) {
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = String(copy.ordersEmpty || 'No orders yet.');
    }
    return;
  }
  if (emptyEl) emptyEl.hidden = true;
  raw
    .filter((item) => item && typeof item === 'object')
    .forEach((item) => {
      const o = mapOrderToDisplay(/** @type {Record<string, unknown>} */ (item), orderMockLabels);
      const li = document.createElement('li');
      li.className = 'account-order-mock-row';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'account-order-mock-item';
      btn.dataset.orderId = o.orderId;
      const summary = document.createElement('div');
      summary.className = 'account-order-mock-summary';
      const idEl = document.createElement('span');
      idEl.className = 'account-order-mock-id';
      idEl.textContent = o.displayOrderNumber;
      idEl.title = o.orderId;
      const totalEl = document.createElement('span');
      totalEl.className = 'account-order-mock-total';
      totalEl.textContent = o.total;
      summary.append(idEl, totalEl);
      const meta = document.createElement('div');
      meta.className = 'account-order-mock-meta';
      const s1 = document.createElement('span');
      s1.textContent = o.metaFirst;
      const s2 = document.createElement('span');
      s2.className = 'account-order-mock-status';
      s2.textContent = o.status;
      meta.append(s1, s2);
      btn.append(summary, meta);
      li.append(btn);
      list.append(li);
    });
}

/** If API wraps payload in `{ data: ... }`, unwrap one level. */
export function unwrapPayload(payload) {
  if (payload == null) return payload;
  if (typeof payload === 'object' && 'data' in payload && payload.data !== undefined) {
    return /** @type {Record<string, unknown>} */ (payload).data;
  }
  return payload;
}

/**
 * Single-order GET may return `{ "order": { ... } }` or a bare object.
 *
 * @param {unknown} payload
 * @returns {unknown}
 */
function unwrapOrderDetail(payload) {
  const afterData = unwrapPayload(payload);
  if (afterData && typeof afterData === 'object' && 'order' in afterData
    && /** @type {Record<string, unknown>} */ (afterData).order != null) {
    return /** @type {Record<string, unknown>} */ (afterData).order;
  }
  return afterData;
}

/**
 * @param {Record<string, unknown>} order
 * @returns {string}
 */
function getOrderDetailLookupId(order) {
  return String(order.friendlyId || order.id || order.orderId || order.number || '');
}

/**
 * Fetch full order records for list rows so the account panel can display friendlyId, totals,
 * and createdAt from the authoritative order payload instead of only link metadata.
 *
 * @param {unknown[]} items
 * @param {string} customerEmail
 * @returns {Promise<unknown[]>}
 */
async function hydrateAccountOrderListItems(items, customerEmail) {
  if (!customerEmail || !Array.isArray(items)) return items;
  return Promise.all(items.map(async (item) => {
    if (!item || typeof item !== 'object') return item;
    const stub = /** @type {Record<string, unknown>} */ (item);
    const lookupId = getOrderDetailLookupId(stub);
    if (!lookupId) return stub;
    try {
      const payload = await getCustomerOrderById(customerEmail, lookupId);
      const detail = unwrapOrderDetail(payload);
      if (detail && typeof detail === 'object') {
        return { ...stub, .../** @type {Record<string, unknown>} */(detail) };
      }
    } catch {
      /* keep the list metadata if a detail request fails */
    }
    return stub;
  }));
}

/**
 * @param {HTMLElement} widget
 * @param {unknown} ordersPayload
 * @param {Record<string, unknown>} [copy]
 * @returns {Promise<void>}
 */
export async function renderAccountOrderList(widget, ordersPayload, copy = {}) {
  const emailEl = widget.querySelector('.account-email-muted');
  const customerEmail = (emailEl?.textContent || '').trim();
  let raw = normalizeOrderArray(ordersPayload);
  if (customerEmail && raw.length) {
    raw = await hydrateAccountOrderListItems(raw, customerEmail);
  }
  applyOrdersToWidget(widget, sortAccountOrdersNewestFirst(raw), copy.orderMock || {}, copy);
}

/**
 * GET single-address response may be `{ "address": { ... } }`.
 *
 * @param {unknown} payload
 * @returns {unknown}
 */
export function unwrapAddressDetail(payload) {
  const d = unwrapPayload(payload);
  if (d && typeof d === 'object' && 'address' in d
    && /** @type {Record<string, unknown>} */ (d).address != null) {
    return /** @type {Record<string, unknown>} */ (d).address;
  }
  return d;
}

/**
 * When the addresses list API returns stubs only (`id`, `email`, `isDefault`), fetch each
 * full record so the list can show a normal postal summary.
 *
 * @param {unknown[]} items
 * @param {string} customerEmail
 * @returns {Promise<unknown[]>}
 */
async function hydrateAccountAddressListItems(items, customerEmail) {
  if (!customerEmail || !Array.isArray(items)) return items;
  return Promise.all(
    items.map(async (item) => {
      if (!item || typeof item !== 'object') return item;
      const stub = /** @type {Record<string, unknown>} */ (item);
      const id = stub.id != null ? String(stub.id) : '';
      const street = typeof stub.address1 === 'string' ? stub.address1.trim() : '';
      if (!id || street) return stub;
      try {
        const payload = await getCustomerAddressById(customerEmail, id);
        const detail = unwrapAddressDetail(payload);
        if (detail && typeof detail === 'object') {
          const d = /** @type {Record<string, unknown>} */ (detail);
          return { ...d, ...stub, id: stub.id ?? d.id };
        }
      } catch {
        /* keep stub for minimal display */
      }
      return stub;
    }),
  );
}

/**
 * @param {HTMLElement} widget
 * @param {unknown} addressesPayload
 * @param {Record<string, unknown>} [copy]
 * @returns {Promise<void>}
 */
export async function renderAccountAddressList(widget, addressesPayload, copy = {}) {
  const listEl = widget.querySelector('.account-address-list');
  const emptyEl = widget.querySelector('.account-address-empty');
  const ab = /** @type {Record<string, string>} */ (copy.addressBook || {});
  if (!listEl) return;
  listEl.innerHTML = '';
  let raw = normalizeAddressArray(addressesPayload);
  if (!raw.length) {
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = ab.emptyList || 'No saved addresses yet.';
    }
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  const emailEl = widget.querySelector('.account-email-muted');
  const customerEmail = (emailEl?.textContent || '').trim();
  const needsHydration = raw.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const a = /** @type {Record<string, unknown>} */ (item);
    const id = a.id != null ? String(a.id) : '';
    const street = typeof a.address1 === 'string' ? a.address1.trim() : '';
    return Boolean(id && !street);
  });
  if (customerEmail && needsHydration) {
    raw = await hydrateAccountAddressListItems(raw, customerEmail);
  }

  raw
    .filter((x) => x && typeof x === 'object')
    .forEach((item) => {
      const addr = /** @type {Record<string, unknown>} */ (item);
      const mapped = mapAddressToDisplay(addr, ab);
      const li = document.createElement('li');
      li.className = 'account-address-item';
      const aid = addr.id != null ? String(addr.id) : '';
      li.dataset.addressId = aid;
      /** @type {any} */ (li).accountAddressRaw = addr;

      const head = document.createElement('div');
      head.className = 'account-address-item-head';
      const badge = document.createElement('div');
      badge.className = 'account-address-badge';
      badge.textContent = mapped.badge;
      if (!mapped.badge) badge.hidden = true;
      const actions = document.createElement('div');
      actions.className = 'account-address-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'button link-style account-address-edit';
      editBtn.textContent = ab.edit || 'Edit';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'button link-style account-address-delete';
      delBtn.textContent = '×';
      delBtn.setAttribute('aria-label', ab.remove || 'Remove');
      delBtn.title = ab.remove || 'Remove';
      actions.append(editBtn, delBtn);
      head.append(badge, actions);

      const lines = document.createElement('p');
      lines.className = 'account-address-lines';
      lines.textContent = mapped.lines.join('\n');
      li.append(head, lines);
      listEl.append(li);
    });
}

/**
 * @param {HTMLElement} widget
 * @param {unknown} addressesPayload
 * @param {Record<string, unknown>} [copy]
 */
async function applyAddressesToWidget(widget, addressesPayload, copy = {}) {
  await renderAccountAddressList(widget, addressesPayload, copy);
}

/**
 * @param {Record<string, unknown>} addr
 * @returns {string}
 */
function formatOrderAddressBlock(addr) {
  if (!addr || typeof addr !== 'object') return '';
  const a = /** @type {Record<string, unknown>} */ (addr);
  const lines = [
    typeof a.name === 'string' ? a.name : '',
    typeof a.address1 === 'string' ? a.address1 : '',
    typeof a.address2 === 'string' ? a.address2 : '',
  ].filter(Boolean);
  const cityLine = [a.city, a.state, a.zip]
    .filter((x) => x != null && String(x).length)
    .join(', ');
  if (cityLine) lines.push(cityLine);
  if (a.country != null && String(a.country).length) {
    lines.push(formatCountryLabel(String(a.country)));
  }
  return lines.join('\n');
}

/**
 * @param {Record<string, unknown>} order
 * @param {Record<string, string>} od
 * @returns {string}
 */
function buildOrderPaymentLine(order, od) {
  const rootMethod = order.paymentMethod != null ? String(order.paymentMethod) : '';
  const pay = order.payment;
  if (!pay || typeof pay !== 'object') {
    return rootMethod;
  }
  const p = /** @type {Record<string, unknown>} */ (pay);
  const method = p.method != null ? String(p.method) : '';
  const last4 = p.cardLastFour != null ? String(p.cardLastFour) : '';
  let cardPart = '';
  if (last4) {
    const tpl = od.paymentCard;
    cardPart = tpl && tpl.includes('{{lastFour}}')
      ? tpl.replace('{{lastFour}}', last4)
      : `Card ending ${last4}`;
  }
  const tail = [method, cardPart].filter(Boolean).join(' · ');
  if (!tail) return rootMethod;
  return rootMethod ? `${rootMethod} · ${tail}` : tail;
}

/**
 * @param {Record<string, unknown>} item
 * @param {string} currencyCode
 * @param {string} qtyLabel
 * @returns {HTMLElement}
 */
function buildReadOnlyOrderLineItem(item, currencyCode, qtyLabel) {
  const qty = Number(item.quantity) || 0;
  const priceObj = item.price;
  const finalStr = priceObj && typeof priceObj === 'object' && priceObj != null && 'final' in priceObj
    ? String(/** @type {{ final?: unknown }} */ (priceObj).final)
    : String(item.price ?? '0');
  const unit = parseFloat(finalStr) || 0;
  const lineTotal = unit * qty;

  const el = document.createElement('div');
  el.className = 'cart-item';

  const imgWrap = document.createElement('div');
  imgWrap.className = 'cart-item-image';
  const imageUrl = typeof item.imageUrl === 'string' ? item.imageUrl : '';
  if (imageUrl) {
    const name = typeof item.name === 'string' ? item.name : '';
    imgWrap.appendChild(createOptimizedPicture(imageUrl, name, true));
  }

  const details = document.createElement('div');
  details.className = 'cart-item-details';
  const nameP = document.createElement('p');
  nameP.className = 'cart-item-name';
  const productUrl = typeof item.productUrl === 'string' ? item.productUrl : '';
  const displayName = typeof item.name === 'string' ? item.name : String(item.sku || '');
  if (productUrl) {
    const a = document.createElement('a');
    a.textContent = displayName;
    try {
      a.href = new URL(productUrl).pathname;
    } catch {
      a.href = productUrl;
    }
    nameP.appendChild(a);
  } else {
    nameP.textContent = displayName;
  }
  const qtyP = document.createElement('p');
  qtyP.className = 'cart-item-variant';
  const sku = item.sku != null ? String(item.sku) : '';
  qtyP.textContent = sku ? `${qtyLabel} ${qty} · SKU ${sku}` : `${qtyLabel} ${qty}`;
  details.append(nameP, qtyP);

  const right = document.createElement('div');
  right.className = 'cart-item-right';
  const priceEl = document.createElement('div');
  priceEl.className = 'cart-item-price';
  priceEl.textContent = formatPrice(lineTotal, currencyCode);
  right.appendChild(priceEl);
  if (qty > 1) {
    const each = document.createElement('div');
    each.className = 'cart-item-per-unit';
    each.textContent = `${formatPrice(unit, currencyCode)} each`;
    right.appendChild(each);
  }

  el.append(imgWrap, details, right);
  return el;
}

/**
 * Best merchant order number to use for an order-status lookup.
 *
 * @param {Record<string, unknown>} order
 * @returns {string}
 */
function getOrderStatusLookupNumber(order) {
  return String(
    order.friendlyId || order.number || order.orderNumber || order.orderId || order.id || '',
  );
}

/**
 * Appends an on-demand "Check status" control to the order detail readout. The status result and
 * status definitions are only rendered after the customer clicks, since the lookup can be slow.
 *
 * @param {HTMLElement} container
 * @param {Record<string, unknown>} order
 * @param {Record<string, string>} od - orderDetail copy slice
 */
function renderOrderStatusAction(container, order, od) {
  const lookupNumber = getOrderStatusLookupNumber(order);
  if (!lookupNumber) return;

  const wrap = document.createElement('div');
  wrap.className = 'account-order-status';

  const actionRow = document.createElement('div');
  actionRow.className = 'account-order-status-action';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'button emphasis account-order-status-check';
  btn.textContent = od.checkStatus || 'Check status';
  const loading = document.createElement('span');
  loading.className = 'account-order-status-loading';
  loading.hidden = true;
  loading.setAttribute('role', 'status');
  loading.setAttribute('aria-live', 'polite');
  loading.textContent = od.checkingStatus || 'Checking order…';
  actionRow.append(btn, loading);

  const resultEl = document.createElement('div');
  resultEl.className = 'account-order-status-result';
  resultEl.hidden = true;
  const definitionsEl = document.createElement('div');
  definitionsEl.className = 'account-order-status-definitions';
  definitionsEl.hidden = true;
  const errEl = document.createElement('p');
  errEl.className = 'account-order-status-error';
  errEl.hidden = true;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    loading.hidden = false;
    errEl.hidden = true;
    errEl.textContent = '';
    resultEl.hidden = true;
    definitionsEl.hidden = true;
    try {
      const { language } = getLocaleAndLanguage();
      const lang = (language || 'en_us').split('_')[0];
      const copy = await loadOrderStatusCopy(lang);
      const result = await performOrderStatusLookup(lookupNumber);
      renderOrderStatusResult(result, copy, resultEl);
      renderOrderStatusDefinitions(copy, definitionsEl);
      resultEl.hidden = false;
      definitionsEl.hidden = false;
    } catch {
      errEl.hidden = false;
      errEl.textContent = od.statusError || 'Could not check the order status. Please try again.';
    } finally {
      loading.hidden = true;
      btn.disabled = false;
    }
  });

  wrap.append(actionRow, errEl, resultEl, definitionsEl);
  container.append(wrap);
}

/**
 * Renders checkout-style order summary (shared `order-summary` + `cart-item` classes).
 *
 * @param {HTMLElement} container
 * @param {Record<string, unknown>} order
 * @param {{
 *   orderMock?: { placed?: string, state?: string },
 *   orderDetail?: Record<string, string>,
 * }} [copySlice]
 */
function renderOrderDetailReadout(container, order, copySlice = {}) {
  container.innerHTML = '';
  if (!order || typeof order !== 'object') return;

  const o = /** @type {Record<string, unknown>} */ (order);
  const od = /** @type {Record<string, string>} */ (copySlice.orderDetail || {});
  /** @type {{ placed?: string, state?: string, statuses?: Record<string, string> }} */
  const om = copySlice.orderMock || {};
  const s = getConfig().getStrings();

  const meta = document.createElement('div');
  meta.className = 'account-order-detail-meta account-mock-rows';

  const pushMetaRow = (label, value) => {
    if (value == null || String(value).length === 0) return;
    const wrap = document.createElement('div');
    wrap.className = 'account-mock-row';
    const lab = document.createElement('span');
    lab.className = 'account-mock-label';
    lab.textContent = label;
    const val = document.createElement('span');
    val.className = 'account-mock-value';
    val.textContent = String(value);
    wrap.append(lab, val);
    meta.append(wrap);
  };

  const placedRaw = o.createdAt ?? o.placedAt;
  if (placedRaw) {
    pushMetaRow(om.placed || od.placedOn || 'Placed', formatIsoForUi(placedRaw));
  }
  if (o.state != null) {
    pushMetaRow(om.state || od.status || 'Status', formatOrderStatus(o.state, om.statuses || {}));
  }

  const items = Array.isArray(o.items) ? o.items.filter((x) => x && typeof x === 'object') : [];
  const firstPrice = items[0] && /** @type {Record<string, unknown>} */ (items[0]).price;
  const currency = firstPrice && typeof firstPrice === 'object' && firstPrice != null && 'currency' in firstPrice
    ? String(/** @type {{ currency?: unknown }} */ (firstPrice).currency || 'USD')
    : 'USD';

  let subtotalNum = 0;
  items.forEach((raw) => {
    const it = /** @type {Record<string, unknown>} */ (raw);
    const q = Number(it.quantity) || 0;
    const pObj = it.price;
    const finalStr = pObj && typeof pObj === 'object' && pObj != null && 'final' in pObj
      ? String(/** @type {{ final?: unknown }} */ (pObj).final)
      : String(it.price ?? '0');
    const unit = parseFloat(finalStr) || 0;
    subtotalNum += unit * q;
  });

  const estimates = o.estimates && typeof o.estimates === 'object'
    ? /** @type {Record<string, unknown>} */ (o.estimates)
    : {};
  const discounts = Array.isArray(estimates.discounts) ? estimates.discounts : [];
  const freeShip = discounts.some((d) => d && typeof d === 'object'
    && /** @type {Record<string, unknown>} */ (d).freeShipping === true);
  const shipMeta = estimates.shippingMethod && typeof estimates.shippingMethod === 'object'
    ? /** @type {Record<string, unknown>} */ (estimates.shippingMethod)
    : null;
  const rateRaw = shipMeta?.rate;
  const rateNum = typeof rateRaw === 'number' ? rateRaw : parseFloat(String(rateRaw ?? NaN));
  let shipAmount = 0;
  let shipText = '—';
  if (freeShip) {
    shipText = s.free;
    shipAmount = 0;
  } else if (Number.isFinite(rateNum)) {
    shipAmount = rateNum;
    shipText = formatPrice(rateNum, currency);
  }

  const taxObj = estimates.tax && typeof estimates.tax === 'object'
    ? /** @type {Record<string, unknown>} */ (estimates.tax)
    : null;
  const taxNum = taxObj != null
    ? parseFloat(String(taxObj.totalTax ?? taxObj.amount ?? NaN))
    : NaN;
  const taxText = Number.isFinite(taxNum) ? formatPrice(taxNum, currency) : '—';
  const taxAmount = Number.isFinite(taxNum) ? taxNum : 0;

  const totalNum = subtotalNum + shipAmount + taxAmount;

  const summaryRoot = document.createElement('div');
  summaryRoot.className = 'order-summary';
  summaryRoot.innerHTML = `
    <div class="order-summary-header">
      <h3></h3>
    </div>
    <div class="order-summary-content">
      <div class="order-summary-items"></div>
      <div class="order-summary-totals">
        <div class="order-summary-row">
          <span class="od-lbl-sub"></span>
          <span class="od-val-sub"></span>
        </div>
        <div class="order-summary-row">
          <span class="od-lbl-ship"></span>
          <span class="od-val-ship"></span>
        </div>
        <div class="order-summary-row">
          <span class="od-lbl-tax"></span>
          <span class="od-val-tax"></span>
        </div>
        <div class="order-summary-row order-summary-final">
          <strong class="od-lbl-total"></strong>
          <div class="order-summary-final-amount">
            <span class="currency"></span>
            <strong class="od-val-total"></strong>
          </div>
        </div>
      </div>
    </div>
  `;

  const h3 = summaryRoot.querySelector('h3');
  if (h3) h3.textContent = s.orderSummary;

  const lblSub = summaryRoot.querySelector('.od-lbl-sub');
  const valSub = summaryRoot.querySelector('.od-val-sub');
  const lblShip = summaryRoot.querySelector('.od-lbl-ship');
  const valShip = summaryRoot.querySelector('.od-val-ship');
  const lblTax = summaryRoot.querySelector('.od-lbl-tax');
  const valTax = summaryRoot.querySelector('.od-val-tax');
  const lblTotal = summaryRoot.querySelector('.od-lbl-total');
  const valTotal = summaryRoot.querySelector('.od-val-total');
  const curEl = summaryRoot.querySelector('.currency');

  if (lblSub) lblSub.textContent = s.subtotal;
  if (valSub) valSub.textContent = formatPrice(subtotalNum, currency);
  if (lblShip) lblShip.textContent = s.shipping;
  if (valShip) valShip.textContent = shipText;
  if (lblTax) lblTax.textContent = s.estimatedTaxes;
  if (valTax) valTax.textContent = taxText;
  if (lblTotal) lblTotal.textContent = s.total;
  if (valTotal) valTotal.textContent = formatPrice(totalNum, currency);
  if (curEl) curEl.textContent = currency;

  const itemsRoot = summaryRoot.querySelector('.order-summary-items');
  const qtyLabel = `${od.qty || 'Qty.'} `;
  if (itemsRoot) {
    items.forEach((raw) => {
      const lineItem = /** @type {Record<string, unknown>} */ (raw);
      const row = buildReadOnlyOrderLineItem(lineItem, currency, qtyLabel.trim());
      itemsRoot.appendChild(row);
    });
  }

  const addrWrap = document.createElement('div');
  addrWrap.className = 'account-order-detail-addresses';

  const shipBody = formatOrderAddressBlock(
    o.shipping && typeof o.shipping === 'object' ? /** @type {Record<string, unknown>} */ (o.shipping) : {},
  );
  const billBody = formatOrderAddressBlock(
    o.billing && typeof o.billing === 'object' ? /** @type {Record<string, unknown>} */ (o.billing) : {},
  );

  if (shipBody) {
    const sec = document.createElement('div');
    sec.className = 'account-order-detail-address-block';
    const h = document.createElement('h6');
    h.className = 'account-order-detail-address-title';
    h.textContent = od.shippingAddress || 'Shipping address';
    const p = document.createElement('p');
    p.className = 'account-address-lines';
    p.textContent = shipBody;
    sec.append(h, p);
    addrWrap.append(sec);
  }
  if (billBody) {
    const sec = document.createElement('div');
    sec.className = 'account-order-detail-address-block';
    const h = document.createElement('h6');
    h.className = 'account-order-detail-address-title';
    h.textContent = od.billingAddress || 'Billing address';
    const p = document.createElement('p');
    p.className = 'account-address-lines';
    p.textContent = billBody;
    sec.append(h, p);
    addrWrap.append(sec);
  }

  const payLine = buildOrderPaymentLine(o, od);

  container.append(meta, summaryRoot);
  if (addrWrap.childElementCount) {
    container.append(addrWrap);
  }
  if (payLine) {
    const foot = document.createElement('div');
    foot.className = 'account-order-detail-foot account-mock-rows';
    const wrap = document.createElement('div');
    wrap.className = 'account-mock-row';
    const lab = document.createElement('span');
    lab.className = 'account-mock-label';
    lab.textContent = od.payment || 'Payment';
    const val = document.createElement('span');
    val.className = 'account-mock-value';
    val.textContent = payLine;
    wrap.append(lab, val);
    foot.append(wrap);
    container.append(foot);
  }

  // Status check lives at the very bottom, after order summary, addresses, and payment.
  renderOrderStatusAction(container, o, od);
}

/**
 * One-time: order row opens detail panel, fetches GET …/orders/:id, logs payloads, shows readout.
 * Customer email is read from `.account-email-muted` on each click so it stays in sync with the UI.
 *
 * @param {HTMLElement} widget
 * @param {{ orderMock?: object, orderDetail?: Record<string, string> }} [copySlice]
 */
export function wireOrderDetailInteractions(widget, copySlice = {}) {
  if (widget.dataset.orderDetailWired === '1') return;
  widget.dataset.orderDetailWired = '1';

  const ordersPanel = widget.querySelector('.account-panel[data-section="orders"]');
  if (!ordersPanel) return;

  const listPanel = ordersPanel.querySelector('.account-orders-list-panel');
  const detailPanel = ordersPanel.querySelector('.account-order-detail-panel');
  const list = ordersPanel.querySelector('.account-order-mock-list');
  const back = ordersPanel.querySelector('.account-order-detail-back');
  const heading = ordersPanel.querySelector('.account-order-detail-heading');
  const readout = ordersPanel.querySelector('.account-order-detail-readout');
  const errEl = ordersPanel.querySelector('.account-order-detail-error');
  const od = copySlice.orderDetail || {};

  if (back) back.textContent = od.back || '← All orders';

  const showList = () => {
    if (listPanel) listPanel.hidden = false;
    if (detailPanel) detailPanel.hidden = true;
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = '';
    }
  };

  const showDetail = () => {
    if (listPanel) listPanel.hidden = true;
    if (detailPanel) detailPanel.hidden = false;
  };

  back?.addEventListener('click', showList);

  const mo = new MutationObserver(() => {
    if (ordersPanel.hidden) showList();
  });
  mo.observe(ordersPanel, { attributes: true, attributeFilter: ['hidden'] });

  list?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button.account-order-mock-item');
    if (!btn) return;
    const { orderId } = btn.dataset;
    const emailEl = widget.querySelector('.account-email-muted');
    const customerEmail = (emailEl?.textContent || '').trim();
    if (!orderId || !customerEmail) return;

    showDetail();
    if (heading) {
      heading.textContent = formatOrderNumberForDisplay(orderId);
      heading.title = orderId;
    }
    if (readout) {
      readout.innerHTML = '';
      const loadP = document.createElement('p');
      loadP.className = 'account-order-detail-loading';
      loadP.textContent = od.loading || 'Loading…';
      readout.append(loadP);
    }
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = '';
    }

    try {
      const payload = await getCustomerOrderById(customerEmail, orderId);
      const display = unwrapOrderDetail(payload);
      if (readout && display && typeof display === 'object') {
        const orderRecord = /** @type {Record<string, unknown>} */ (display);
        renderOrderDetailReadout(readout, orderRecord, copySlice);
      } else if (readout) {
        readout.innerHTML = '';
      }
    } catch (err) {
      if (readout) readout.innerHTML = '';
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = od.error || (err instanceof Error ? err.message : String(err));
      }
    }
  });
}

/**
 * After fetchAccountBundle, maps API payloads onto the account widget DOM.
 *
 * @param {HTMLElement} widget
 * @param {{ customer: unknown, addresses?: unknown, orders?: unknown }} data
 * @param {{
 *   orderMock?: { placed?: string, total?: string, state?: string },
 *   orderDetail?: Record<string, string>,
 * }} [copySlice]
 */
export async function applyAccountDataToWidget(widget, data, copySlice = {}) {
  const email = /** @type {HTMLParagraphElement | null} */ (widget.querySelector('.account-email-muted'))?.textContent?.trim() || '';

  let customer = unwrapCustomerResponse(data.customer);
  if (Array.isArray(customer) && customer.length === 1) {
    [customer] = customer;
  }

  const hasAddresses = Object.prototype.hasOwnProperty.call(data, 'addresses');
  const addresses = hasAddresses ? unwrapPayload(data.addresses) : undefined;
  const hasOrders = Object.prototype.hasOwnProperty.call(data, 'orders');
  const orders = hasOrders ? unwrapPayload(data.orders) : undefined;

  if (customer && typeof customer === 'object') {
    applyOverviewPanel(widget, customer, email, copySlice);
    applyCustomerToWidget(widget, customer, email, copySlice);
  } else {
    applyOverviewPanel(widget, null, email, copySlice);
  }
  if (hasAddresses && addresses != null) {
    await applyAddressesToWidget(widget, addresses, copySlice);
  }
  if (hasOrders && orders != null) {
    applyOrdersToWidget(widget, orders, copySlice.orderMock || {}, copySlice);
  }
}
