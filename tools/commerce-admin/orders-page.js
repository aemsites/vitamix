/**
 * Orders list — ProductBus API (helix productbus-admin/orders.js pattern).
 * Row opens a detail dialog (human-readable order + journal); Edit saves via PUT / PATCH.
 */
import { apiFetch, getApiEnvironment } from './commerce-otp-api.js';
import waitForCommerceAuthReady from './commerce-wait-auth-ready.js';
import { putOrPatchResource } from './commerce-resource-save.js';
import { openOrderContactEditDialog } from './order-contact-edit-dialog.js';
import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';
import { createDetailModalHeaderCloseAndJson } from './commerce-detail-modal-json.js';
import { PB_ORG, PB_SITE } from './commerce-pbus-config.js';
import { escapeHtml, showToast } from './commerce-otp-ui.js';
import { highlightMatch } from './search-highlight.js';

function getUrlParam(key) {
  return new URLSearchParams(window.location.search).get(key) || '';
}

function setUrlParams(updates) {
  const url = new URL(window.location.href);
  Object.entries(updates).forEach(([k, v]) => {
    if (v != null && String(v).trim() !== '') url.searchParams.set(k, String(v).trim());
    else url.searchParams.delete(k);
  });
  window.history.replaceState({}, '', url);
}

async function readRespError(resp) {
  return resp.headers.get('x-error')
    || (await resp.text().catch(() => '')).trim()
    || `HTTP ${resp.status}`;
}

/** Person / org name from a billing or shipping address object (ProductBus-style payloads). */
function addressDisplayName(addr) {
  if (!addr || typeof addr !== 'object') return '';
  if (typeof addr.name === 'string' && addr.name.trim()) return addr.name.trim();
  const fn = addr.firstName || addr.first_name || '';
  const ln = addr.lastName || addr.last_name || '';
  const joined = [fn, ln].map((s) => String(s).trim()).filter(Boolean).join(' ');
  if (joined) return joined;
  if (addr.company && String(addr.company).trim()) return String(addr.company).trim();
  return '';
}

function billingName(o) {
  const addr = o.billingAddress || o.billing || o.billing_address || null;
  let n = addressDisplayName(addr);
  if (!n && o.customer && typeof o.customer === 'object') {
    n = addressDisplayName(o.customer);
  }
  if (!n && o.customMetadata?.billingName) {
    n = String(o.customMetadata.billingName).trim();
  }
  return n || '—';
}

function shippingName(o) {
  const addr = o.shippingAddress || o.shipping || o.shipping_address || null;
  let n = addressDisplayName(addr);
  if (!n && o.customMetadata?.shippingName) {
    n = String(o.customMetadata.shippingName).trim();
  }
  return n || '—';
}

/** Non-empty gift message on the order root (ProductBus checkout payloads). */
function orderGiftMessage(o) {
  if (!o || typeof o !== 'object') return '';
  const msg = o.giftMessage;
  if (msg == null) return '';
  return String(msg).trim();
}

/** Short id for UI: `friendlyId`, else suffix after `…Z-` in timestamp-prefixed ProductBus ids. */
function orderIdForDisplay(order) {
  if (!order || typeof order !== 'object') return '';
  const fid = order.friendlyId;
  if (fid != null && String(fid).trim() !== '') return String(fid).trim();
  const raw = order.id;
  if (raw == null || String(raw).trim() === '') return '';
  const s = String(raw).trim();
  const m = s.match(/(?:\.\d+)?Z-(.+)$/i);
  if (m && m[1].length > 0) return m[1];
  return s;
}

/** Lowercase a-z0-9 only — matches pasted ids with spaces, dashes, colons, etc. */
function normalizeOrderIdKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Compact short id for display (normalized, uppercase). */
function formatOrderIdChunks(shortId) {
  const compact = normalizeOrderIdKey(shortId);
  if (!compact) return '—';
  return compact.toUpperCase();
}

function highlightOrderIdCell(formattedDisplay, compactForMatch, query) {
  const q = String(query || '').trim();
  const nq = normalizeOrderIdKey(q);
  if (!q) return escapeHtml(formattedDisplay);
  if (nq && normalizeOrderIdKey(compactForMatch).includes(nq)) {
    return `<mark class="pim-highlight">${escapeHtml(formattedDisplay)}</mark>`;
  }
  return highlightMatch(formattedDisplay, q);
}

/** Text search on id, email, state, billing/shipping names. */
function filterByQuery(orders, q) {
  if (!q) return orders;
  const needle = q.toLowerCase();
  const nNeedle = normalizeOrderIdKey(q);
  return orders.filter((o) => {
    if (nNeedle && normalizeOrderIdKey(o.id).includes(nNeedle)) return true;
    if (nNeedle && normalizeOrderIdKey(String(o.friendlyId || '')).includes(nNeedle)) return true;
    if (nNeedle && normalizeOrderIdKey(orderIdForDisplay(o)).includes(nNeedle)) return true;
    if ((o.email || '').toLowerCase().includes(needle)) return true;
    if ((o.customer?.email || '').toLowerCase().includes(needle)) return true;
    if ((o.customMetadata?.customerEmail || '').toLowerCase().includes(needle)) return true;
    if ((o.state || '').toLowerCase().includes(needle)) return true;
    const bill = billingName(o);
    const ship = shippingName(o);
    if (bill !== '—' && bill.toLowerCase().includes(needle)) return true;
    if (ship !== '—' && ship.toLowerCase().includes(needle)) return true;
    const market = orderMarketLabel(o);
    if (market !== '—' && market.toLowerCase().includes(needle)) return true;
    return false;
  });
}

function filterByState(orders, state) {
  if (!state) return orders;
  const s = state.toLowerCase();
  return orders.filter((o) => (o.state || 'pending').toLowerCase() === s);
}

function sortByCreated(orders, sort) {
  const arr = [...orders];
  arr.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return sort === 'oldest' ? ta - tb : tb - ta;
  });
  return arr;
}

function uniqueStates(orders) {
  const set = new Set();
  orders.forEach((o) => {
    set.add((o.state && String(o.state)) || 'pending');
  });
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * First state present in `states` that maps to the "completed" badge class
 * (e.g. `payment_completed`, `completed`, `fulfilled`) — used to default the
 * State filter to completed orders instead of "All states". Falls back to ''
 * (All states) when no completed-like state is present in the loaded data.
 * @param {string[]} states
 * @returns {string}
 */
function defaultCompletedState(states) {
  return states.find((s) => orderStateBadgeClass(s) === 'orders-badge-success') || '';
}

/** The API has no free-text search — full email addresses route to the customer-orders endpoint. */
function looksLikeEmail(s) {
  return /^\S+@\S+\.\S+$/.test(s);
}

/** Market-prefixed order/friendly ids: om/oc (US/Canada), omuat/ocuat (their UAT stores). */
const ORDER_ID_PREFIXES = ['omuat', 'ocuat', 'om', 'oc'];

/**
 * True for a bare friendlyId (`omuat8282037655`) or a full order id
 * (`2026-08-05T10-06-51.529Z-omuat8282037655`) — the friendlyId is always the
 * last `-`-separated segment of the full id, so checking it covers both shapes.
 */
function looksLikeOrderId(s) {
  if (!s || /\s/.test(s)) return false;
  const lastSegment = s.split('-').pop();
  const compact = normalizeOrderIdKey(lastSegment);
  return ORDER_ID_PREFIXES.some((prefix) => compact.startsWith(prefix));
}

/** Local midnight `Date` for "today" — date math stays local until the final UTC convert. */
function todayLocalMidnight() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addMonthsLocal(date, delta) {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + delta);
  return d;
}

function addDaysLocal(date, delta) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + delta);
  return d;
}

/** `<input type="date">` value (`YYYY-MM-DD`) from a local-midnight `Date`. */
function toDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local-midnight `Date` for a `YYYY-MM-DD` `<input type="date">` value. */
function fromDateInputValue(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Swap `from`/`to` when reversed, then clamp the span to 12 months by pulling `from` forward.
 * @param {Date} from
 * @param {Date} to
 * @returns {{ from: Date, to: Date }}
 */
function normalizeDateRange(from, to) {
  let lo = from;
  let hi = to;
  if (lo > hi) {
    [lo, hi] = [hi, lo];
  }
  const earliestAllowed = addMonthsLocal(hi, -12);
  if (lo < earliestAllowed) lo = earliestAllowed;
  return { from: lo, to: hi };
}

/** Local-midnight `from`/`to` dates → UTC ISO `since`/`until` instants (`until` is exclusive). */
function dateRangeToUtcQuery(from, to) {
  return { since: from.toISOString(), until: addDaysLocal(to, 1).toISOString() };
}

/** Deep clone JSON-like value and drop keys whose names start with `card` (API removes these). */
function omitCardStarKeys(value) {
  if (Array.isArray(value)) return value.map(omitCardStarKeys);
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
      if (k.startsWith('card')) return;
      out[k] = omitCardStarKeys(v);
    });
    return out;
  }
  return value;
}

async function fetchOrderJournal(orderId) {
  const path = `orders/journal?orderId=${encodeURIComponent(orderId)}`;
  const resp = await apiFetch(PB_ORG, PB_SITE, path, { method: 'GET' });
  if (!resp.ok) throw new Error(await readRespError(resp));
  return resp.json();
}

/**
 * Single-order GET bodies are sometimes `{ order: { id, … } }` with no top-level `id`.
 * Align with order-contact-edit-dialog `getOrderNode` + common id field names.
 */
function resolveOrderId(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const candidates = [payload];
  if (payload.order && typeof payload.order === 'object') {
    candidates.push(payload.order);
  }
  const rawId = candidates
    .map((node) => node.id ?? node.orderId)
    .find((id) => id != null && String(id).trim() !== '');
  return rawId != null ? String(rawId).trim() : '';
}

function getOrderNodeForDisplay(payload) {
  if (payload?.order && typeof payload.order === 'object') return payload.order;
  if (payload && typeof payload === 'object') return payload;
  return null;
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

/** Distinct badge colors for list + detail (not only success vs default). */
export function orderStateBadgeClass(state) {
  const s = String(state || 'pending').toLowerCase().replace(/\s+/g, '_');
  if (s === 'completed' || s === 'payment_completed' || s === 'fulfilled') return 'orders-badge-success';
  if (s === 'payment_cancelled' || s === 'cancelled' || s === 'canceled' || s === 'abandoned') return 'orders-badge-danger';
  if (s === 'failed' || s === 'payment_failed' || s === 'error') return 'orders-badge-error';
  if (s === 'pending' || s === 'created' || s === 'draft' || s === 'new') return 'orders-badge-pending';
  if (s.includes('process')) return 'orders-badge-processing';
  if (s.includes('authoriz') || s === 'payment_authorized' || s === 'authorized') return 'orders-badge-authorized';
  if (s.includes('ship') || s.includes('fulfill') || s === 'shipped') return 'orders-badge-shipping';
  if (s.includes('refund')) return 'orders-badge-refund';
  return 'orders-badge-neutral';
}

function isValidTimestamp(value) {
  if (value == null || value === '') return false;
  const t = new Date(value).getTime();
  return !Number.isNaN(t);
}

function syncStatusCell(o, query) {
  const { syncError, syncedAt } = o;
  if (syncError != null) {
    const text = typeof syncError === 'object' ? JSON.stringify(syncError) : String(syncError);
    return `<span class="orders-badge orders-badge-danger">${highlightMatch(text, query)}</span>`;
  }
  if (isValidTimestamp(syncedAt)) {
    const title = escapeHtml(new Date(syncedAt).toLocaleString());
    return `<span class="orders-sync-icon orders-sync-icon-success" role="img" aria-label="Synced" title="Synced ${title}">`
      + '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">'
      + '<path fill="currentColor" d="M6.2 11.3 3.1 8.2l1.1-1.1 2 2 4.6-4.6 1.1 1.1z"/>'
      + '</svg></span>';
  }
  const state = String(o.state || '').toLowerCase().replace(/\s+/g, '_');
  if (state === 'payment_cancelled' || state === 'payment_processing') {
    return '—';
  }
  return '<span class="orders-sync-icon orders-sync-icon-pending" role="img" aria-label="Sync pending" title="Sync pending">'
    + '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">'
    + '<path fill="currentColor" d="M8 1.5A6.5 6.5 0 1 0 14.5 8 6.51 6.51 0 0 0 8 1.5zm0 11.7A5.2 5.2 0 1 1 13.2 8 5.2 5.2 0 0 1 8 13.2zm.65-8.45h-1.3v3.6l3.05 1.83.65-1.07-2.4-1.43z"/>'
    + '</svg></span>';
}

function orderCountryTagClass(country) {
  const c = String(country || '').toLowerCase();
  if (c === 'us') return 'coupons-tag-us';
  if (c === 'ca') return 'coupons-tag-ca';
  if (c === 'mx') return 'coupons-tag-mx';
  return 'coupons-tag-muted';
}

/**
 * Format market code and language for display (e.g. CA · EN, CA · FR, US, MX).
 * @param {object} o order object
 * @returns {string}
 */
export function orderMarketLabel(o) {
  const country = String(o?.country || '').trim().toUpperCase();
  if (!country) return '—';
  if (country === 'CA') {
    const loc = String(o?.locale || '').trim().toLowerCase();
    return loc.startsWith('fr') ? 'CA · FR' : 'CA · EN';
  }
  return country;
}

/**
 * Visual badge HTML for an order's market (e.g. CA · EN, CA · FR, US).
 * @param {object} o order object
 * @param {string} [query] optional search query to highlight
 * @returns {string} HTML string
 */
export function orderMarketBadgeHtml(o, query = '') {
  const label = orderMarketLabel(o);
  if (label === '—') return '—';
  const c = String(o?.country || '').trim().toLowerCase();
  let modifier = 'orders-market-badge-muted';
  if (c === 'us') modifier = 'orders-market-badge-us';
  else if (c === 'ca') {
    const loc = String(o?.locale || '').trim().toLowerCase();
    modifier = loc.startsWith('fr') ? 'orders-market-badge-ca-fr' : 'orders-market-badge-ca-en';
  } else if (c === 'mx') modifier = 'orders-market-badge-mx';
  const highlighted = query ? highlightMatch(label, query) : escapeHtml(label);
  return `<span class="orders-market-badge ${modifier}">${highlighted}</span>`;
}

/**
 * Stable filter/select key for an order's market: `us`, `ca-en`, `ca-fr`, `mx`,
 * or the lowercase country when it isn't one of the known three. Empty when
 * the order has no `country`.
 * @param {object} o order object
 * @returns {string}
 */
export function orderMarketKey(o) {
  const country = String(o?.country || '').trim().toLowerCase();
  if (!country) return '';
  if (country === 'ca') {
    const loc = String(o?.locale || '').trim().toLowerCase();
    return loc.startsWith('fr') ? 'ca-fr' : 'ca-en';
  }
  return country;
}

/** Orders whose market key matches `marketKey` (all orders when empty/falsy).
 * A bare `ca` matches both `ca-en` and `ca-fr` ("CA · All").
 */
export function filterByMarket(orders, marketKey) {
  if (!marketKey) return orders;
  if (marketKey === 'ca') {
    return orders.filter((o) => String(o?.country || '').trim().toLowerCase() === 'ca');
  }
  return orders.filter((o) => orderMarketKey(o) === marketKey);
}

/**
 * Distinct `{ key, label }` markets present in `orders`, sorted by label. When both CA store
 * views are present, a combined `ca` ("CA · All") option is added alongside `ca-en`/`ca-fr` so
 * Canada can be filtered as a whole.
 * @param {object[]} orders
 * @returns {{ key: string, label: string }[]}
 */
export function uniqueMarkets(orders) {
  const map = new Map();
  orders.forEach((o) => {
    const key = orderMarketKey(o);
    if (!key || map.has(key)) return;
    map.set(key, orderMarketLabel(o));
  });
  if (map.has('ca-en') || map.has('ca-fr')) {
    map.set('ca', 'CA · All');
  }
  return [...map.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

function fillMarketSelect(select, markets, current) {
  select.innerHTML = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All markets';
  select.appendChild(all);
  markets.forEach(({ key, label }) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    select.appendChild(opt);
  });
  if (current) {
    const match = [...select.options].find(
      (o) => o.value && o.value.toLowerCase() === String(current).toLowerCase(),
    );
    if (match) select.value = match.value;
  }
}

/**
 * Local `YYYY-MM-DD` day key for a `Date` (matches `toDateInputValue`).
 * @param {Date} date
 * @returns {string}
 */
function dayKeyFromDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Numeric order amount for revenue aggregation: prefers `total`, falls back to `subtotal`. */
function orderAmount(o) {
  const raw = o?.total != null && String(o.total).trim() !== '' ? o.total : o?.subtotal;
  const n = Number(raw);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Static market → currency mapping for chart labels only (cosmetic display,
 * not settlement math — revenue view is only ever enabled for a single
 * market, so this is unambiguous).
 */
const MARKET_CURRENCY = {
  us: 'USD', ca: 'CAD', 'ca-en': 'CAD', 'ca-fr': 'CAD', mx: 'MXN',
};

/**
 * @param {string} marketKey e.g. `us`, `ca-en`, `ca-fr`, `mx`
 * @returns {string} ISO currency code, or '' when unknown/not a specific market
 */
export function currencyForMarketKey(marketKey) {
  return MARKET_CURRENCY[marketKey] || '';
}

/** Sunday-start local week-start `Date` for a given local `Date`. */
function weekStartLocal(date) {
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return addDaysLocal(midnight, -midnight.getDay());
}

/** Local period-start `Date` (day midnight, or Sunday-start week) for a given `Date`. */
function periodStartLocal(date, granularity) {
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return granularity === 'week' ? weekStartLocal(midnight) : midnight;
}

const PERIOD_STEP_DAYS = { day: 1, week: 7 };
const MAX_CHART_PERIODS = 1200;

/**
 * Stacking order for state segments within a bar, bottom → top (matches the
 * STATE column badge classes from {@link orderStateBadgeClass}).
 */
const STATE_STACK_ORDER = [
  'orders-badge-success',
  'orders-badge-pending',
  'orders-badge-processing',
  'orders-badge-authorized',
  'orders-badge-shipping',
  'orders-badge-info',
  'orders-badge-danger',
  'orders-badge-error',
  'orders-badge-refund',
  'orders-badge-neutral',
];

/**
 * Chart segment fill colors — a medium tone blended from each STATE column
 * badge's pale background and darker text color. The pure pale background
 * alone reads as near-white on a large solid chart fill (a large flat area of
 * a color looks lighter than a small badge chip of the same color, especially
 * without dark text riding on top of it), so this splits the difference:
 * still soft/pastel, but visible as a distinct color.
 */
const STATE_BAR_COLORS = {
  'orders-badge-success': '#78ae9e',
  'orders-badge-info': '#81a3d7',
  'orders-badge-danger': '#c48c7c',
  'orders-badge-error': '#da8a84',
  'orders-badge-pending': '#c4ac7e',
  'orders-badge-processing': '#9c83ca',
  'orders-badge-authorized': '#70acaf',
  'orders-badge-shipping': '#82aa84',
  'orders-badge-refund': '#c2799e',
  'orders-badge-neutral': '#9a9c9d',
};

/** Chart segment color for an order state, matching its STATE column badge. */
function stateBarColor(badgeClass) {
  return STATE_BAR_COLORS[badgeClass] || STATE_BAR_COLORS['orders-badge-neutral'];
}

/**
 * Ascending, zero-filled period-bucketed order counts + revenue for the chart,
 * broken down per order state (`byState`) so the chart can render a stacked
 * bar using the same colors as the STATE column badges. When the state filter
 * has narrowed `orders` to a single state, `byState` naturally has one entry
 * and the bar renders as a single solid color — no special-casing needed.
 *
 * When `bounds` (`{ since, until }`, UTC ISO instants with `until` exclusive —
 * the same shape produced by `dateRangeToUtcQuery`) is given, every local
 * period in that window is included so the trend has no gaps, even when some
 * periods have zero orders. Without `bounds` (e.g. an exact order-id lookup,
 * which isn't tied to a date-range control), buckets span only the earliest
 * to latest `createdAt` period actually present in `orders`.
 *
 * @param {object[]} orders already filtered by search/state/market
 * @param {{ since: string, until: string } | null} [bounds]
 * @param {'day'|'week'} [granularity]
 * @returns {{
 *   periodStart: string, count: number, amount: number,
 *   byState: { state: string, badgeClass: string, count: number, amount: number }[],
 * }[]}
 */
export function ordersPerPeriodBuckets(orders, bounds = null, granularity = 'day') {
  const step = PERIOD_STEP_DAYS[granularity] || 1;
  /** periodKey -> stateKey -> { state, badgeClass, count, amount } */
  const byPeriodState = new Map();
  let minPeriod = null;
  let maxPeriod = null;
  orders.forEach((o) => {
    if (!o?.createdAt) return;
    const d = new Date(o.createdAt);
    if (Number.isNaN(d.getTime())) return;
    const period = periodStartLocal(d, granularity);
    const key = dayKeyFromDate(period);
    const rawState = String(o?.state || 'pending').trim() || 'pending';
    const stateKey = rawState.toLowerCase();
    if (!byPeriodState.has(key)) byPeriodState.set(key, new Map());
    const stateMap = byPeriodState.get(key);
    const entry = stateMap.get(stateKey) || {
      state: rawState, badgeClass: orderStateBadgeClass(rawState), count: 0, amount: 0,
    };
    entry.count += 1;
    entry.amount += orderAmount(o);
    stateMap.set(stateKey, entry);
    if (!minPeriod || period < minPeriod) minPeriod = period;
    if (!maxPeriod || period > maxPeriod) maxPeriod = period;
  });

  let startPeriod;
  let endPeriod;
  if (bounds && bounds.since && bounds.until) {
    const sinceD = new Date(bounds.since);
    startPeriod = periodStartLocal(sinceD, granularity);
    const untilD = new Date(bounds.until);
    const untilDay = new Date(untilD.getFullYear(), untilD.getMonth(), untilD.getDate());
    endPeriod = periodStartLocal(addDaysLocal(untilDay, -1), granularity);
  } else if (minPeriod && maxPeriod) {
    startPeriod = minPeriod;
    endPeriod = maxPeriod;
  } else {
    return [];
  }

  const out = [];
  let cursor = startPeriod;
  let guard = 0;
  while (cursor <= endPeriod && guard < MAX_CHART_PERIODS) {
    const key = dayKeyFromDate(cursor);
    const stateMap = byPeriodState.get(key);
    const byState = stateMap
      ? [...stateMap.values()].sort((a, b) => {
        const ia = STATE_STACK_ORDER.indexOf(a.badgeClass);
        const ib = STATE_STACK_ORDER.indexOf(b.badgeClass);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      })
      : [];
    const count = byState.reduce((sum, s) => sum + s.count, 0);
    const amount = byState.reduce((sum, s) => sum + s.amount, 0);
    out.push({
      periodStart: key, count, amount, byState,
    });
    cursor = addDaysLocal(cursor, step);
    guard += 1;
  }
  return out;
}

const CHART_MAX_LABELS = 12;

/** Short display label (`Jan 5`) for a `YYYY-MM-DD` period-start day, in the browser's locale. */
function chartPeriodLabel(periodStart) {
  const [y, m, d] = periodStart.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Full period span for tooltips/aria: the day itself, or `Sep 1–Sep 7` for a week. */
function chartPeriodRangeLabel(periodStart, granularity) {
  if (granularity !== 'week') return chartPeriodLabel(periodStart);
  const [y, m, d] = periodStart.split('-').map(Number);
  const end = addDaysLocal(new Date(y, m - 1, d), 6);
  const endKey = dayKeyFromDate(end);
  return `${chartPeriodLabel(periodStart)}–${chartPeriodLabel(endKey)}`;
}

/** `$1,234.56 CAD` (or without a trailing code when the currency is unknown). */
function formatChartAmount(amount, currencyCode) {
  const n = Number(amount) || 0;
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currencyCode ? `$${formatted} ${currencyCode}` : `$${formatted}`;
}

/**
 * Human-friendly label for a raw order state (`payment_processing` → `payment processing`).
 */
function chartStateLabel(state) {
  return String(state || 'pending').replace(/_/g, ' ');
}

/**
 * Render the orders chart as an HTML string (ascending by period; zero-value
 * periods shown as empty columns). Each bar is a stack of per-state segments
 * colored the same as the STATE column badges (a period with only one state
 * present — e.g. the state filter narrowed to one value — naturally renders
 * as a single solid-color bar). Labels a bounded subset of bars to avoid
 * crowding — always the first and last, evenly spaced in between.
 * @param {{
 *   periodStart: string, count: number, amount: number,
 *   byState: { state: string, badgeClass: string, count: number, amount: number }[],
 * }[]} buckets ascending
 * @param {{ granularity?: 'day'|'week', metric?: 'orders'|'revenue', currencyCode?: string }}
 *   [opts]
 * @returns {string} HTML
 */
export function ordersPerPeriodChartHtml(buckets, opts = {}) {
  const granularity = opts.granularity === 'week' ? 'week' : 'day';
  const metric = opts.metric === 'revenue' ? 'revenue' : 'orders';
  const currencyCode = opts.currencyCode || '';
  if (!buckets.length) {
    return '<p class="orders-chart-empty">No orders in the current view.</p>';
  }
  const bucketValue = (b) => (metric === 'revenue' ? b.amount : b.count);
  const stateValue = (s) => (metric === 'revenue' ? s.amount : s.count);
  const stateValueText = (s) => (metric === 'revenue'
    ? formatChartAmount(s.amount, currencyCode)
    : `${s.count} order${s.count === 1 ? '' : 's'}`);
  const max = Math.max(1, ...buckets.map(bucketValue));
  const step = Math.max(1, Math.ceil(buckets.length / CHART_MAX_LABELS));
  const totalCount = buckets.reduce((sum, b) => sum + b.count, 0);
  const totalAmount = buckets.reduce((sum, b) => sum + b.amount, 0);
  const bars = buckets.map((b, i) => {
    const value = bucketValue(b);
    const heightPct = value <= 0 ? 0 : Math.max(Math.round((value / max) * 100), 4);
    const shortLabel = chartPeriodLabel(b.periodStart);
    const rangeLabel = chartPeriodRangeLabel(b.periodStart, granularity);
    const showLabel = i % step === 0 || i === buckets.length - 1;
    const byState = Array.isArray(b.byState) ? b.byState : [];
    const valueText = metric === 'revenue'
      ? formatChartAmount(b.amount, currencyCode)
      : `${b.count} order${b.count === 1 ? '' : 's'}`;
    const breakdownText = byState.length > 1
      ? ` (${byState.map((s) => `${chartStateLabel(s.state)}: ${stateValueText(s)}`).join(', ')})`
      : '';
    const a11yLabel = `${rangeLabel}: ${valueText}${breakdownText}`;
    /* Reserve the label row for every column (hidden when unlabeled) so bar tracks
       stay the same height across the row — avoids the old absolute-offset label
       poking past the chart's box and forcing a scrollbar. */
    const labelAttrs = showLabel ? '' : ' aria-hidden="true" style="visibility:hidden"';
    const segmentsHtml = value > 0 ? byState.map((s) => {
      const sv = stateValue(s);
      if (sv <= 0) return '';
      const segPct = Math.max(Math.round((sv / value) * 100), 0);
      const segLabel = `${chartStateLabel(s.state)}: ${stateValueText(s)}`;
      return `<div class="orders-chart-bar-segment" style="height:${segPct}%;`
        + `background:${stateBarColor(s.badgeClass)}" title="${escapeHtml(segLabel)}"></div>`;
    }).join('') : '';
    return '<div class="orders-chart-bar-col">'
       + '<div class="orders-chart-bar-track">'
       + `<div class="orders-chart-bar" style="height:${heightPct}%" tabindex="0" role="img"`
       + ` aria-label="${escapeHtml(a11yLabel)}" title="${escapeHtml(a11yLabel)}">${segmentsHtml}</div>`
       + '</div>'
       + `<span class="orders-chart-bar-label"${labelAttrs}>${escapeHtml(shortLabel)}</span>`
       + '</div>';
  }).join('');
  const summaryValue = metric === 'revenue'
    ? formatChartAmount(totalAmount, currencyCode)
    : `${totalCount} order${totalCount === 1 ? '' : 's'}`;
  const periodWord = granularity === 'week' ? 'week' : 'day';
  const metricWord = metric === 'revenue' ? 'Revenue' : 'Orders';
  const summary = `${metricWord} per ${periodWord}: ${summaryValue} across ${buckets.length} `
    + `${periodWord}${buckets.length === 1 ? '' : 's'}.`;
  return `<p class="pim-sr-only">${escapeHtml(summary)}</p><div class="orders-chart">${bars}</div>`;
}

function summarizeOrderSubtotalLine(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return '—';
  let sum = 0;
  let cur = '';
  list.forEach((item) => {
    const p = item?.price;
    if (!p || p.final == null || p.final === '') return;
    const n = Number(p.final);
    if (!Number.isNaN(n)) sum += n;
    if (!cur && p.currency) cur = String(p.currency);
  });
  if (!cur && list[0]?.price?.currency) cur = String(list[0].price.currency);
  return `${sum.toFixed(2)} ${cur}`.trim() || '—';
}

/**
 * Prefer `payment.amount` (+ `payment.currency`) when the charge total is present;
 * otherwise sum line-item `price.final` (same as legacy “Subtotal (lines)”).
 */
function summarizeOrderMonetaryTotal(o) {
  const pay = o?.payment;
  if (pay && typeof pay === 'object') {
    const rawAmt = pay.amount;
    if (rawAmt != null && String(rawAmt).trim() !== '') {
      let amtStr;
      if (typeof rawAmt === 'number' && !Number.isNaN(rawAmt)) {
        amtStr = rawAmt.toFixed(2);
      } else {
        amtStr = String(rawAmt).trim();
      }
      let cur = pay.currency != null ? String(pay.currency).trim() : '';
      const items = Array.isArray(o.items) ? o.items : [];
      if (!cur && items[0]?.price?.currency) cur = String(items[0].price.currency);
      return cur ? `${amtStr} ${cur}` : amtStr;
    }
  }
  return summarizeOrderSubtotalLine(Array.isArray(o.items) ? o.items : []);
}

function orderHasPaymentChargedAmount(o) {
  const pay = o?.payment;
  if (!pay || typeof pay !== 'object') return false;
  const raw = pay.amount;
  return raw != null && String(raw).trim() !== '';
}

function paymentSummaryLine(payment) {
  if (!payment || typeof payment !== 'object') return '—';
  const method = payment.method != null ? String(payment.method) : '';
  const provider = payment.provider != null ? String(payment.provider) : '';
  const bits = [method, provider].filter(Boolean);
  return bits.length ? bits.join(' · ') : '—';
}

function customerTypeLabel(customerType) {
  const type = customerType != null ? String(customerType).trim().toLowerCase() : '';
  if (type === 'registered') return 'Registered User';
  if (type === 'guest') return 'Guest';
  return '';
}

function formatAddressLines(addr) {
  if (!addr || typeof addr !== 'object') return '';
  const lines = [];
  if (addr.name) lines.push(String(addr.name));
  if (addr.address1) lines.push(String(addr.address1));
  if (addr.address2) lines.push(String(addr.address2));
  const cityParts = [addr.city, addr.state, addr.zip]
    .map((x) => (x != null ? String(x).trim() : ''))
    .filter(Boolean);
  if (cityParts.length) lines.push(cityParts.join(', '));
  if (addr.country) lines.push(String(addr.country).toUpperCase());
  if (addr.phone) lines.push(`Phone: ${String(addr.phone)}`);
  if (addr.email) lines.push(String(addr.email));
  return lines.join('\n');
}

function appendPill(container, label, on) {
  const span = document.createElement('span');
  span.className = on ? 'coupons-pill coupons-pill-on' : 'coupons-pill coupons-pill-off';
  span.textContent = label;
  container.appendChild(span);
}

/**
 * Applied coupon code(s) for an order as an ordered, de-duplicated array.
 * An order may now carry multiple coupons: prefers couponCodes[] (the full
 * applied set), then couponCode (string | string[]), then the legacy single
 * `coupon` string.
 * @param {Record<string, unknown>} o
 * @returns {string[]}
 */
function orderCouponCodes(o) {
  const raw = o?.couponCodes ?? o?.couponCode ?? o?.coupon;
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw != null) list = [raw];
  const seen = new Set();
  const codes = [];
  list.forEach((value) => {
    const code = String(value ?? '').trim();
    if (!code || seen.has(code)) return;
    seen.add(code);
    codes.push(code);
  });
  return codes;
}

function statBlock(label, value) {
  const div = document.createElement('div');
  div.className = 'coupons-modal-stat';
  div.setAttribute('role', 'listitem');
  const lbl = document.createElement('span');
  lbl.className = 'coupons-modal-stat-label';
  lbl.textContent = label;
  const val = document.createElement('span');
  val.className = 'coupons-modal-stat-value';
  val.textContent = value;
  div.append(lbl, val);
  return div;
}

const ORDER_BANNER_MAX = 400;

/** Non-empty only when the order deserves an alert banner (not routine hints). */
function orderUnusualBannerText(o) {
  const pay = o.payment && typeof o.payment === 'object' ? o.payment : null;
  const payErr = pay && pay.error != null ? String(pay.error).trim() : '';
  if (payErr) {
    const msg = `Payment: ${payErr}`;
    return msg.length <= ORDER_BANNER_MAX ? msg : `${msg.slice(0, ORDER_BANNER_MAX - 1)}…`;
  }
  const st = String(o.state || 'pending');
  if (/cancel|fail|error/i.test(st)) {
    return 'This order did not complete successfully — review payment and history below.';
  }
  return '';
}

/** Coupon-style hero + stats + pills above sectioned order body. */
function buildOrderRichHeader(o) {
  const wrap = document.createElement('div');
  wrap.className = 'orders-detail-rich';

  const hint = orderUnusualBannerText(o);
  if (hint) {
    const banner = document.createElement('div');
    banner.className = 'coupons-modal-banner';
    banner.textContent = hint;
    wrap.appendChild(banner);
  }

  const head = document.createElement('div');
  head.className = 'coupons-modal-head';
  const badges = document.createElement('div');
  badges.className = 'coupons-modal-badges';
  if (o.country) {
    const tag = document.createElement('span');
    tag.className = `coupons-tag ${orderCountryTagClass(o.country)}`;
    tag.textContent = String(o.country).toUpperCase();
    badges.appendChild(tag);
  }
  if (o.locale) {
    const loc = document.createElement('span');
    loc.className = 'coupons-tag coupons-tag-year';
    loc.textContent = String(o.locale);
    badges.appendChild(loc);
  }
  head.appendChild(badges);

  const title = document.createElement('h2');
  title.className = 'coupons-modal-title';
  const cust = o.customer && typeof o.customer === 'object' ? o.customer : null;
  const fullName = cust ? [cust.firstName, cust.lastName].filter(Boolean).join(' ').trim() : '';
  const shortOrderId = orderIdForDisplay(o);
  title.textContent = fullName || (shortOrderId ? `Order ${formatOrderIdChunks(shortOrderId)}` : 'Order');
  head.appendChild(title);

  const idLine = document.createElement('p');
  idLine.className = 'coupons-modal-idline orders-detail-idline';
  const code = document.createElement('code');
  code.className = 'orders-detail-id-code';
  const fullId = String(o.id || '').trim();
  const shortId = shortOrderId || '';
  code.textContent = shortId ? formatOrderIdChunks(shortId) : '—';
  if (fullId) {
    if (!shortId) code.title = fullId;
    else if (normalizeOrderIdKey(shortId) !== normalizeOrderIdKey(fullId)) code.title = fullId;
  }
  idLine.appendChild(code);
  head.appendChild(idLine);

  const email = cust?.email ? String(cust.email).trim() : '';
  const phone = cust?.phone ? String(cust.phone).trim() : '';
  if (email || phone) {
    const contactRow = document.createElement('p');
    contactRow.className = 'orders-detail-head-contact';
    const parts = [];
    if (email) {
      const em = document.createElement('a');
      em.href = `mailto:${email}`;
      em.textContent = email;
      parts.push(em);
    }
    if (phone) {
      const telHref = phone.replace(/[^\d+]/g, '');
      if (telHref) {
        const ph = document.createElement('a');
        ph.href = `tel:${telHref}`;
        ph.textContent = phone;
        parts.push(ph);
      } else {
        const sp = document.createElement('span');
        sp.textContent = phone;
        parts.push(sp);
      }
    }
    parts.forEach((node, i) => {
      if (i) contactRow.appendChild(document.createTextNode(' · '));
      contactRow.appendChild(node);
    });
    head.appendChild(contactRow);
  }

  wrap.appendChild(head);

  const st = String(o.state || 'pending');
  const hero = document.createElement('div');
  hero.className = 'coupons-modal-hero';
  const heroInner = document.createElement('div');
  heroInner.className = 'coupons-modal-hero-inner';
  const kicker = document.createElement('span');
  kicker.className = 'coupons-modal-hero-kicker';
  kicker.textContent = 'Order status';
  const heroVal = document.createElement('span');
  heroVal.className = 'coupons-modal-hero-value';
  heroVal.textContent = st.replace(/_/g, ' ');
  const heroNote = document.createElement('span');
  heroNote.className = 'coupons-modal-hero-note';
  const metaBits = [];
  if (o.createdAt) metaBits.push(`Created ${formatDateTime(o.createdAt)}`);
  if (o.updatedAt) metaBits.push(`Updated ${formatDateTime(o.updatedAt)}`);
  heroNote.textContent = metaBits.join(' · ');
  const badgeWrap = document.createElement('div');
  badgeWrap.className = 'orders-detail-hero-badge';
  const stBadge = document.createElement('span');
  stBadge.className = `orders-badge ${orderStateBadgeClass(st)}`;
  stBadge.textContent = st;
  badgeWrap.appendChild(stBadge);
  heroInner.append(kicker, heroVal, heroNote, badgeWrap);
  hero.appendChild(heroInner);
  wrap.appendChild(hero);

  const items = Array.isArray(o.items) ? o.items : [];
  const stats = document.createElement('div');
  stats.className = 'coupons-modal-stats';
  stats.setAttribute('role', 'list');
  stats.appendChild(statBlock('Line items', String(items.length)));
  stats.appendChild(statBlock(
    orderHasPaymentChargedAmount(o) ? 'Payment amount' : 'Subtotal (lines)',
    summarizeOrderMonetaryTotal(o),
  ));
  stats.appendChild(statBlock('Payment', paymentSummaryLine(o.payment)));
  const customerType = customerTypeLabel(o.customerType);
  if (customerType) stats.appendChild(statBlock('Customer type', customerType));
  wrap.appendChild(stats);

  const couponCodes = orderCouponCodes(o);
  if (couponCodes.length) {
    const couponRow = document.createElement('div');
    couponRow.className = 'coupons-modal-pills orders-modal-coupons';
    couponRow.setAttribute('aria-label', 'Coupons');
    const label = document.createElement('span');
    label.className = 'orders-modal-coupons-label';
    label.textContent = couponCodes.length > 1 ? 'Coupons' : 'Coupon';
    couponRow.appendChild(label);
    couponCodes.forEach((couponCode) => {
      const span = document.createElement('span');
      span.className = 'coupons-pill coupons-pill-state';
      span.textContent = couponCode;
      couponRow.appendChild(span);
    });
    wrap.appendChild(couponRow);
  }

  const pills = document.createElement('div');
  pills.className = 'coupons-modal-pills';
  pills.setAttribute('aria-label', 'Order flags');
  const pay = o.payment && typeof o.payment === 'object' && Object.keys(o.payment).length > 0;
  const cancelled = /cancel|fail|error/i.test(st);
  const hasShip = Boolean(formatAddressLines(o.shipping));
  appendPill(pills, 'Payment details', pay);
  appendPill(pills, 'Terminal issue', cancelled);
  appendPill(pills, 'Shipping address', hasShip);
  appendPill(pills, 'Gift message', Boolean(orderGiftMessage(o)));
  appendPill(pills, 'Multi-line', items.length > 1);
  wrap.appendChild(pills);

  return wrap;
}

function safeHttpUrl(href) {
  if (typeof href !== 'string' || !href.trim()) return '';
  try {
    const u = new URL(href);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch {
    /* ignore */
  }
  return '';
}

function formatItemPrice(item) {
  const p = item?.price;
  if (!p || typeof p !== 'object') return '';
  const final = p.final ?? p.amount;
  const cur = p.currency || '';
  if (final == null) return '';
  return cur ? `${final} ${cur}` : String(final);
}

/** Best-effort order currency: payment currency, else first line item's. */
function orderCurrency(o) {
  const pay = o?.payment;
  if (pay && typeof pay === 'object' && pay.currency != null && String(pay.currency).trim()) {
    return String(pay.currency).trim();
  }
  const items = Array.isArray(o?.items) ? o.items : [];
  const cur = items[0]?.price?.currency;
  return cur != null && String(cur).trim() ? String(cur).trim() : '';
}

const DISCOUNT_SOURCE_LABELS = {
  coupon: 'Coupon',
  pricing_rule: 'Price rule',
  promotion: 'Promotion',
};

const DISCOUNT_TYPE_LABELS = {
  percentage: 'Percentage',
  fixed: 'Fixed amount',
  free_shipping: 'Free shipping',
  product_price_override: 'Sale price',
};

/** Human-readable name for a single applied discount (name › id › fallback). */
function discountLabel(d) {
  if (d == null || typeof d !== 'object') return 'Discount';
  if (typeof d.name === 'string' && d.name.trim()) return d.name.trim();
  if (typeof d.id === 'string' && d.id.trim()) return d.id.trim();
  return 'Discount';
}

/**
 * Render a single applied discount as readable text, e.g.
 * `-15.00 USD (Coupon · Percentage)`. Returns '' when there is nothing to show.
 */
function discountValueText(d, currency) {
  if (d == null || typeof d !== 'object') return '';
  const parts = [];
  const amt = Number(d.amount);
  // Free-shipping discounts carry amount 0 (the value lives in shipping, not a
  // cash discount), so skip the redundant `-0.00` and let the tag describe it.
  if (d.amount != null && String(d.amount).trim() !== '' && !Number.isNaN(amt) && amt !== 0) {
    parts.push(`-${amt.toFixed(2)}${currency ? ` ${currency}` : ''}`);
  }
  const tags = [];
  const src = DISCOUNT_SOURCE_LABELS[d.source];
  if (src) tags.push(src);
  if (d.freeShipping) tags.push('Free shipping');
  else {
    const typ = DISCOUNT_TYPE_LABELS[d.type];
    if (typ) tags.push(typ);
  }
  if (tags.length) parts.push(`(${tags.join(' · ')})`);
  return parts.join(' ');
}

/** Build the `Discounts` row value: a readable list, or the string 'None'. */
function discountsValueNode(disc, currency) {
  if (!Array.isArray(disc) || !disc.length) return 'None';
  const ul = document.createElement('ul');
  ul.className = 'orders-detail-discounts';
  disc.forEach((d) => {
    const li = document.createElement('li');
    const label = discountLabel(d);
    const text = discountValueText(d, currency);
    li.textContent = text ? `${label} — ${text}` : label;
    ul.appendChild(li);
  });
  return ul;
}

/** Format a numeric money value as `12.34 USD` (currency optional). */
function formatMoney(n, currency) {
  if (n == null || Number.isNaN(Number(n))) return '';
  const amt = Number(n).toFixed(2);
  return currency ? `${amt} ${currency}` : amt;
}

/**
 * Compute the order's monetary breakdown for display, mirroring the canonical
 * server-side `computeTotal` in helix-commerce-api/src/utils/payment.js — the
 * same math used for the actual charge and the order confirmation email.
 *
 * - `subtotal` is the sum of line `price.final × quantity`.
 * - `taxAmount` prefers the persisted `estimates.tax.amount`, falling back to
 *   `subtotal × rate/100` for older orders that only stored a rate.
 * - A `free_shipping` discount zeroes the shipping line rather than adding a
 *   cash discount; such rows are excluded from `discountTotal`.
 * - `total = subtotal − discountTotal + taxAmount + shippingCost`.
 *
 * Returns null when there are no line items to summarize.
 */
function computeDetailTotals(o) {
  const items = Array.isArray(o?.items) ? o.items : [];
  if (!items.length) return null;
  const currency = orderCurrency(o);
  const subtotal = items.reduce(
    (sum, item) => sum + (Number(item?.price?.final) || 0) * (item?.quantity ?? 1),
    0,
  );

  const est = o?.estimates;
  if (!est || typeof est !== 'object') {
    return {
      currency,
      subtotal,
      taxAmount: 0,
      shippingCost: 0,
      discountTotal: 0,
      freeShipping: false,
      total: subtotal,
    };
  }

  let taxAmount = 0;
  if (est.tax && typeof est.tax === 'object') {
    if (est.tax.amount != null && String(est.tax.amount).trim() !== '') {
      taxAmount = Number(est.tax.amount) || 0;
    } else if (est.tax.rate != null) {
      taxAmount = subtotal * (Number(est.tax.rate) / 100);
    }
  }

  const discountsList = Array.isArray(est.discounts) ? est.discounts : [];
  const freeShipping = discountsList.some((d) => d?.freeShipping);
  const shippingCost = freeShipping ? 0 : (Number(est.shippingMethod?.rate) || 0);
  const discountTotal = Math.round(
    discountsList.reduce(
      (sum, d) => sum + (d?.type === 'free_shipping' ? 0 : (Number(d?.amount) || 0)),
      0,
    ) * 100,
  ) / 100;

  const total = subtotal - discountTotal + taxAmount + shippingCost;
  return {
    currency, subtotal, taxAmount, shippingCost, discountTotal, freeShipping, total,
  };
}

/**
 * Build the right-aligned order totals summary (Subtotal, cash discounts,
 * Shipping, Estimated taxes, Total) shown directly below the line-items table.
 * Mirrors the storefront order-summary block. Returns null when there are no
 * items to summarize.
 */
function buildOrderTotalsSummary(o) {
  const t = computeDetailTotals(o);
  if (!t) return null;
  const { currency } = t;

  const wrap = document.createElement('div');
  wrap.className = 'orders-detail-totals';

  const addRow = (label, value, opts = {}) => {
    const row = document.createElement('div');
    row.className = 'orders-detail-totals-row';
    if (opts.final) row.classList.add('orders-detail-totals-final');
    if (opts.discount) row.classList.add('orders-detail-totals-discount');
    const l = document.createElement(opts.final ? 'strong' : 'span');
    l.textContent = label;
    const v = document.createElement(opts.final ? 'strong' : 'span');
    v.textContent = value;
    row.append(l, v);
    wrap.appendChild(row);
  };

  addRow('Subtotal', formatMoney(t.subtotal, currency));

  // Per-coupon/cash discount lines (free-shipping-only rows are reflected in the
  // shipping line instead, so skip them here).
  const disc = Array.isArray(o?.estimates?.discounts) ? o.estimates.discounts : [];
  disc.forEach((d) => {
    if (!d || d.type === 'free_shipping') return;
    const amt = Number(d.amount);
    if (Number.isNaN(amt) || amt === 0) return;
    addRow(discountLabel(d), `-${formatMoney(amt, currency)}`, { discount: true });
  });

  addRow('Shipping', t.freeShipping || t.shippingCost === 0 ? 'Free' : formatMoney(t.shippingCost, currency));
  addRow('Estimated taxes', formatMoney(t.taxAmount, currency));
  addRow('Total', formatMoney(t.total, currency), { final: true });

  return wrap;
}

function section(title) {
  const sec = document.createElement('section');
  sec.className = 'orders-detail-section';
  const h = document.createElement('h3');
  h.className = 'orders-detail-section-title';
  h.textContent = title;
  sec.appendChild(h);
  return sec;
}

function appendDl(sectionEl, rows) {
  const dl = document.createElement('dl');
  dl.className = 'orders-detail-dl';
  rows.forEach(([label, value]) => {
    if (value == null || value === '') return;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    if (value instanceof Node) dd.appendChild(value);
    else dd.textContent = String(value);
    dl.appendChild(dt);
    dl.appendChild(dd);
  });
  if (dl.children.length) sectionEl.appendChild(dl);
}

/**
 * Storefront host used for line-item links when the admin is in the staging
 * environment. Order line items persist an absolute `productUrl` whose host is
 * the product's canonical (production) URL, regardless of where the order was
 * placed. When viewing staging orders we rewrite the host to the staging
 * storefront so the link opens the matching environment. See issue #610.
 */
const STAGING_STOREFRONT_HOST = 'uat.vitamix.com';

/**
 * Resolve an order line item's link to the current admin environment. In
 * staging the canonical (production) host is rewritten to the staging
 * storefront; in production the URL is returned unchanged (its canonical host
 * is already correct). Relative paths and non-http values pass through
 * unchanged.
 */
function itemUrlForEnv(url) {
  if (!url || typeof url !== 'string' || getApiEnvironment() !== 'stage') return url;
  try {
    const u = new URL(url, window.location.origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
    u.host = STAGING_STOREFRONT_HOST;
    return u.href;
  } catch {
    return url;
  }
}

function linkCell(href, text) {
  const hrefOk = safeHttpUrl(href);
  if (!hrefOk) {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
  }
  const a = document.createElement('a');
  a.href = hrefOk;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = text;
  return a;
}

/** Structured summary + sections for ProductBus order payloads. */
function buildOrderHumanView(payload) {
  const root = document.createElement('div');
  const o = getOrderNodeForDisplay(payload);
  if (!o) {
    const p = document.createElement('p');
    p.className = 'orders-detail-empty';
    p.textContent = 'Could not read order from this response.';
    root.appendChild(p);
    return root;
  }

  root.appendChild(buildOrderRichHeader(o));

  const shipLines = formatAddressLines(o.shipping);
  const billLines = formatAddressLines(o.billing);
  if (shipLines || billLines) {
    const pair = document.createElement('div');
    pair.className = 'orders-detail-address-pair';
    if (shipLines) {
      const sec = section('Shipping');
      const p = document.createElement('p');
      p.className = 'orders-detail-address';
      p.textContent = shipLines;
      sec.appendChild(p);
      if (o.shippingMethod?.id != null) {
        appendDl(sec, [['Shipping method ID', String(o.shippingMethod.id)]]);
      }
      pair.appendChild(sec);
    }
    if (billLines) {
      const sec = section('Billing');
      const p = document.createElement('p');
      p.className = 'orders-detail-address';
      p.textContent = billLines;
      sec.appendChild(p);
      pair.appendChild(sec);
    }
    root.appendChild(pair);
  }

  const giftMsg = orderGiftMessage(o);
  if (giftMsg) {
    const giftSec = section('Gift message');
    const giftP = document.createElement('p');
    giftP.className = 'orders-detail-address';
    giftP.textContent = giftMsg;
    giftSec.appendChild(giftP);
    root.appendChild(giftSec);
  }

  const items = Array.isArray(o.items) ? o.items : [];
  if (items.length) {
    const sec = section('Line items');
    const table = document.createElement('table');
    table.className = 'orders-detail-items-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Product</th><th>SKU</th><th>Qty</th><th>Price</th><th>Link</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    items.forEach((item) => {
      const tr = document.createElement('tr');
      const nameTd = document.createElement('td');
      const nameDiv = document.createElement('div');
      nameDiv.className = 'orders-detail-item-name';
      nameDiv.textContent = item.name || '—';
      nameTd.appendChild(nameDiv);
      const skuTd = document.createElement('td');
      skuTd.textContent = item.sku || '—';
      const qtyTd = document.createElement('td');
      qtyTd.textContent = item.quantity != null ? String(item.quantity) : '—';
      const priceTd = document.createElement('td');
      priceTd.textContent = formatItemPrice(item) || '—';
      const linkTd = document.createElement('td');
      const url = itemUrlForEnv(item.productUrl || item.path);
      if (url) {
        const display = typeof url === 'string' && url.length > 40 ? `${url.slice(0, 37)}…` : String(url);
        linkTd.appendChild(linkCell(url, display));
      } else linkTd.textContent = '—';
      tr.append(nameTd, skuTd, qtyTd, priceTd, linkTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    sec.appendChild(table);
    const totals = buildOrderTotalsSummary(o);
    if (totals) sec.appendChild(totals);
    root.appendChild(sec);
  }

  const est = o.estimates;
  if (est && typeof est === 'object') {
    const sec = section('Estimates');
    const sm = est.shippingMethod;
    if (sm && typeof sm === 'object') {
      const bits = [sm.label, sm.type, sm.rate != null ? `Rate: ${sm.rate}` : ''].filter(Boolean);
      appendDl(sec, [
        ['Shipping (estimate)', bits.join(' · ') || (sm.id != null ? `ID ${sm.id}` : '')],
      ]);
    }
    const { tax } = est;
    if (tax && typeof tax === 'object') {
      appendDl(sec, [
        ['Tax', [tax.country, tax.state, tax.rate != null ? `${tax.rate}%` : '', tax.id].filter(Boolean).join(' · ')],
      ]);
    }
    const disc = est.discounts;
    if (Array.isArray(disc)) {
      appendDl(sec, [['Discounts', discountsValueNode(disc, orderCurrency(o))]]);
    }
    if (sec.querySelector('dl')?.children?.length) root.appendChild(sec);
  }

  const pay = o.payment;
  if (pay && typeof pay === 'object' && Object.keys(pay).length) {
    const sec = section('Payment');
    const rows = Object.entries(pay).map(([k, v]) => {
      const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
      let text = '';
      if (v != null && v !== '') {
        text = typeof v === 'object' ? JSON.stringify(v) : String(v);
      }
      return [label, text];
    });
    appendDl(sec, rows);
    root.appendChild(sec);
  }

  const { custom } = o;
  if (custom && typeof custom === 'object' && Object.keys(custom).length) {
    const sec = section('Custom');
    const rows = Object.entries(custom).map(([k, v]) => {
      const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
      let text = '';
      if (v != null && v !== '') {
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
          text = formatDateTime(v) || v;
        } else {
          text = typeof v === 'object' ? JSON.stringify(v) : String(v);
        }
      }
      return [label, text];
    });
    appendDl(sec, rows);
    root.appendChild(sec);
  }

  const hist = Array.isArray(o.history) ? o.history : [];
  if (hist.length) {
    const sec = section('State history');
    const ul = document.createElement('ul');
    ul.className = 'orders-detail-history';
    hist.forEach((h) => {
      const li = document.createElement('li');
      const time = document.createElement('time');
      time.textContent = formatDateTime(h.timestamp) || '—';
      const ev = document.createElement('div');
      ev.className = 'orders-history-event';
      const evName = h.event || 'event';
      ev.appendChild(document.createTextNode(`${evName}`));
      if (h.state != null && String(h.state).trim() !== '') {
        ev.appendChild(document.createTextNode(' → '));
        const stSpan = document.createElement('span');
        stSpan.className = `orders-badge orders-history-state ${orderStateBadgeClass(h.state)}`;
        stSpan.textContent = String(h.state);
        ev.appendChild(stSpan);
      }
      li.append(time, ev);
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    root.appendChild(sec);
  }

  return root;
}

const JOURNAL_HEAD_KEYS = new Set(['timestamp', 'event']);
const JOURNAL_KEY_ORDER = [
  'service', 'method', 'url', 'ok', 'statusCode', 'duration', 'orderId', 'attemptId', 'provider',
  'state', 'decision', 'idempotencyKey', 'customerIP', 'userAgent', 'amount', 'currency',
  'subtotal', 'taxAmount', 'shippingCost', 'transactionId', 'approvalCode', 'avsMatch', 'cvvMatch',
  'kind', 'type', 'jobId', 'outcome', 'attempts', 'toEmail', 'fromEmail', 'sesMessageId', 'sentAt',
  'org', 'site', 'journal', 'id',
];

function humanizeJournalKey(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()).trim();
}

function journalValueDd(key, val) {
  const dd = document.createElement('dd');
  if (val == null) {
    dd.textContent = '—';
    return dd;
  }
  if (typeof val === 'boolean') {
    dd.textContent = val ? 'Yes' : 'No';
    return dd;
  }
  if (typeof val === 'number') {
    dd.textContent = String(val);
    return dd;
  }
  if (typeof val === 'string') {
    const isUrlKey = key === 'url' || key.endsWith('Url');
    if (isUrlKey) {
      const hrefOk = safeHttpUrl(val);
      if (hrefOk) {
        const a = document.createElement('a');
        a.href = hrefOk;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = val.length > 96 ? `${val.slice(0, 93)}…` : val;
        dd.appendChild(a);
        return dd;
      }
    }
    dd.textContent = val;
    if (key === 'userAgent' || key === 'customerIP') dd.classList.add('mono');
    return dd;
  }
  const span = document.createElement('span');
  span.className = 'orders-journal-inline-json';
  let s = JSON.stringify(val);
  if (s.length > 320) s = `${s.slice(0, 317)}…`;
  span.textContent = s;
  dd.appendChild(span);
  return dd;
}

function sortJournalDetailKeys(keys) {
  return [...keys].sort((a, b) => {
    const ia = JOURNAL_KEY_ORDER.indexOf(a);
    const ib = JOURNAL_KEY_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

function buildJournalHumanView(data) {
  const root = document.createElement('div');
  const entries = Array.isArray(data?.entries) ? omitCardStarKeys([...data.entries]) : [];
  entries.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });

  if (entries.length === 0) {
    const p = document.createElement('p');
    p.className = 'orders-detail-empty';
    p.textContent = 'Journal entries are still being ingested. They can take up to five minutes after order creation to appear.';
    root.appendChild(p);
    return root;
  }

  const list = document.createElement('ul');
  list.className = 'orders-journal-list';

  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const li = document.createElement('li');
    const art = document.createElement('article');
    art.className = 'orders-journal-entry';

    const head = document.createElement('header');
    head.className = 'orders-journal-entry-head';
    const timeSpan = document.createElement('span');
    timeSpan.className = 'orders-journal-time';
    timeSpan.textContent = formatDateTime(entry.timestamp) || '—';
    const evSpan = document.createElement('span');
    evSpan.className = 'orders-journal-event';
    evSpan.textContent = String(entry.event || 'entry');
    head.append(timeSpan, evSpan);
    art.appendChild(head);

    const detailKeys = sortJournalDetailKeys(
      Object.keys(entry).filter((k) => !JOURNAL_HEAD_KEYS.has(k)),
    );
    if (detailKeys.length) {
      const dl = document.createElement('dl');
      dl.className = 'orders-detail-dl';
      detailKeys.forEach((k) => {
        const dt = document.createElement('dt');
        dt.textContent = humanizeJournalKey(k);
        dl.appendChild(dt);
        dl.appendChild(journalValueDd(k, entry[k]));
      });
      art.appendChild(dl);
    }

    li.appendChild(art);
    list.appendChild(li);
  });

  root.appendChild(list);
  return root;
}

export function showOrderDialog(order, { onEditSaved } = {}) {
  let orderPayload = order;
  const orderId = resolveOrderId(orderPayload);
  let isJournalView = false;
  let journalData = null;

  const dialog = document.createElement('dialog');
  dialog.className = 'orders-json-dialog coupons-detail-dialog';

  const actions = document.createElement('div');
  actions.className = 'orders-json-dialog-actions commerce-detail-modal-toolbar';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'orders-edit-btn orders-dialog-edit-btn';
  editBtn.textContent = 'Edit';
  editBtn.disabled = !orderId;

  const journalBtn = document.createElement('button');
  journalBtn.type = 'button';
  journalBtn.className = 'orders-journal-btn';
  journalBtn.textContent = 'Journal';
  journalBtn.disabled = !orderId;

  const viewOrderBtn = document.createElement('button');
  viewOrderBtn.type = 'button';
  viewOrderBtn.className = 'orders-view-order-btn';
  viewOrderBtn.textContent = 'View order';
  viewOrderBtn.hidden = true;

  const content = document.createElement('div');
  content.className = 'coupons-detail-dialog-scroll orders-detail-body';

  const toolbarMain = document.createElement('div');
  toolbarMain.className = 'commerce-detail-modal-toolbar-main';
  toolbarMain.append(editBtn, journalBtn, viewOrderBtn);

  const shut = () => {
    dialog.close();
    dialog.remove();
  };

  const header = createDetailModalHeaderCloseAndJson({
    bodyHost: content,
    getHumanNode: () => (isJournalView && journalData
      ? buildJournalHumanView(journalData)
      : buildOrderHumanView(orderPayload)),
    getJsonValue: () => (isJournalView && journalData ? journalData : orderPayload),
    onClose: shut,
  });

  actions.append(toolbarMain, header.headerRight);
  dialog.append(actions, content);
  header.resetToHuman();

  async function refetchOrderPayload() {
    const resp = await apiFetch(PB_ORG, PB_SITE, `orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
    if (!resp.ok) throw new Error(await readRespError(resp));
    orderPayload = await resp.json();
  }

  function showOrderView() {
    isJournalView = false;
    journalData = null;
    header.resetToHuman();
    viewOrderBtn.hidden = true;
    journalBtn.hidden = false;
    editBtn.hidden = false;
    journalBtn.disabled = !orderId;
    journalBtn.textContent = 'Journal';
  }

  editBtn.addEventListener('click', async () => {
    if (!orderId) return;
    try {
      const saved = await openOrderContactEditDialog({
        title: `Edit order ${orderId}`,
        orderPayload,
        onSave: (merged) => putOrPatchResource(`orders/${encodeURIComponent(orderId)}`, merged),
      });
      if (saved) {
        try {
          await refetchOrderPayload();
        } catch (err) {
          showToast(err.message || 'Saved but failed to refresh order', 'error');
        }
        if (!viewOrderBtn.hidden) {
          /* journal view active — leave content as-is */
        } else {
          showOrderView();
        }
        if (onEditSaved) await onEditSaved();
      }
    } catch (err) {
      showToast(err.message || 'Failed to open editor', 'error');
    }
  });

  journalBtn.addEventListener('click', async () => {
    if (!orderId) return;
    journalBtn.disabled = true;
    journalBtn.textContent = 'Loading…';
    try {
      const data = await fetchOrderJournal(orderId);
      const sanitized = omitCardStarKeys(data);
      isJournalView = true;
      journalData = sanitized;
      header.resetToHuman();
      viewOrderBtn.hidden = false;
      journalBtn.hidden = true;
      editBtn.hidden = true;
      journalBtn.textContent = 'Journal';
    } catch (err) {
      showToast(err.message || 'Failed to load journal', 'error');
      journalBtn.disabled = false;
      journalBtn.textContent = 'Journal';
    }
  });

  viewOrderBtn.addEventListener('click', () => {
    showOrderView();
  });

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      shut();
    }
  });
  document.body.appendChild(dialog);
  wireDialogEscapeDismiss(dialog, shut);
  dialog.showModal();
}

/**
 * Fetch a full order by id and open the shared order detail dialog. Reused by
 * the customers admin so a customer's order opens the same pop-up as the
 * orders list.
 * @param {string} orderId
 * @param {{ onEditSaved?: () => (void | Promise<void>) }} [opts]
 */
export async function openOrderById(orderId, { onEditSaved } = {}) {
  const resp = await apiFetch(PB_ORG, PB_SITE, `orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
  if (!resp.ok) throw new Error(await readRespError(resp));
  const orderData = await resp.json();
  showOrderDialog(orderData, { onEditSaved });
}

function fillStateSelect(select, states, current) {
  select.innerHTML = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All states';
  select.appendChild(all);
  states.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    select.appendChild(opt);
  });
  if (current) {
    const match = [...select.options].find(
      (o) => o.value && o.value.toLowerCase() === String(current).toLowerCase(),
    );
    if (match) select.value = match.value;
  }
}

function renderTable(wrap, orders, query, onEditSaved) {
  if (orders.length === 0) {
    wrap.innerHTML = `
      <div class="orders-empty">
        <h2 class="orders-empty-title">No orders match</h2>
        <p class="orders-empty-text">Try changing search, range, or state filter.</p>
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="orders-data-table">
      <thead>
        <tr>
          <th>Order ID</th>
          <th>Email</th>
          <th>State</th>
          <th>Items</th>
          <th>Subtotal</th>
          <th>Total</th>
          <th>Coupon</th>
          <th>Payment</th>
          <th>Market</th>
          <th>Updated</th>
          <th>Sync Status</th>
        </tr>
      </thead>
      <tbody>
        ${orders.map((o) => {
    const updatedStr = o.updatedAt ? new Date(o.updatedAt).toLocaleString() : '—';
    const syncStatusHtml = syncStatusCell(o, query);
    const id = String(o.id || '');
    const compactId = orderIdForDisplay(o) || id;
    const formattedId = formatOrderIdChunks(compactId);
    const titleAttr = id && normalizeOrderIdKey(compactId) !== normalizeOrderIdKey(id)
      ? ` title="${escapeHtml(id)}"`
      : '';
    let itemCountRaw = null;
    if (o.itemCount != null) itemCountRaw = o.itemCount;
    else if (Array.isArray(o.items)) itemCountRaw = o.items.length;
    const itemCount = itemCountRaw != null ? String(itemCountRaw) : '—';
    const subtotalStr = o.subtotal != null && String(o.subtotal).trim() !== ''
      ? `$${String(o.subtotal).trim()}`
      : '—';
    const totalStr = o.total != null && String(o.total).trim() !== ''
      ? `$${String(o.total).trim()}`
      : '—';
    const couponCodes = orderCouponCodes(o);
    const couponHtml = couponCodes.length
      ? `<span class="orders-coupon-pills">${couponCodes
        .map((code) => `<span class="coupons-pill coupons-pill-state">${highlightMatch(code, query)}</span>`)
        .join('')}</span>`
      : '—';
    const paymentMethodStr = o.paymentMethod != null && String(o.paymentMethod).trim() !== ''
      ? String(o.paymentMethod).trim()
      : '—';
    const marketHtml = orderMarketBadgeHtml(o, query);
    const emailRaw = o.email || o.customer?.email || '';
    const emailStr = String(emailRaw).trim();
    const emailHtml = emailStr
      ? `<span class="orders-email">${highlightMatch(emailStr, query)}</span>`
      : '—';
    return `
          <tr class="orders-row-open" data-id="${escapeHtml(id)}" tabindex="0" role="button" aria-label="Open order ${escapeHtml(formattedId)}">
            <td><code class="orders-id"${titleAttr}>${highlightOrderIdCell(formattedId, compactId, query)}</code></td>
            <td>${emailHtml}</td>
            <td><span class="orders-badge ${orderStateBadgeClass(o.state)}">${highlightMatch(String(o.state || 'pending'), query)}</span></td>
            <td>${highlightMatch(itemCount, query)}</td>
            <td>${highlightMatch(subtotalStr, query)}</td>
            <td>${highlightMatch(totalStr, query)}</td>
            <td>${couponHtml}</td>
            <td>${highlightMatch(paymentMethodStr, query)}</td>
            <td>${marketHtml}</td>
            <td>${highlightMatch(updatedStr, query)}</td>
            <td>${syncStatusHtml}</td>
          </tr>`;
  }).join('')}
      </tbody>
    </table>`;

  wrap.querySelectorAll('tbody tr.orders-row-open[data-id]').forEach((row) => {
    const openDetail = async () => {
      const id = row.getAttribute('data-id');
      if (!id) return;
      try {
        await openOrderById(id, { onEditSaved });
      } catch (err) {
        showToast(`Failed to load order: ${err.message}`, 'error');
      }
    };
    row.addEventListener('click', () => {
      openDetail().catch(() => {
        /* errors surfaced inside openDetail */
      });
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDetail().catch(() => {
          /* errors surfaced inside openDetail */
        });
      }
    });
  });
}

/** Debounce (ms) before a detected order-id/email in the search box triggers a lookup. */
const SEARCH_LOOKUP_DEBOUNCE_MS = 350;

async function init() {
  const wrap = document.getElementById('orders-table');
  const search = document.getElementById('orders-search');
  const rangeSel = document.getElementById('orders-range');
  const rangeDatesEl = document.getElementById('orders-range-dates');
  const rangeFromInput = document.getElementById('orders-range-from');
  const rangeToInput = document.getElementById('orders-range-to');
  const marketSel = document.getElementById('orders-market');
  const stateSel = document.getElementById('orders-state');
  const sortSel = document.getElementById('orders-sort');
  const countEl = document.getElementById('orders-count');
  const errEl = document.getElementById('orders-error');
  const groupBySel = document.getElementById('orders-chart-group');
  const metricSel = document.getElementById('orders-chart-metric');
  const chartCanvasEl = document.getElementById('orders-chart-canvas');
  if (!wrap || !search || !rangeSel || !marketSel || !stateSel || !sortSel) return;

  const authed = await waitForCommerceAuthReady(PB_ORG, PB_SITE);
  if (!authed) {
    errEl.hidden = false;
    errEl.textContent = 'Sign-in did not finish before the wait timed out. Reload the page.';
    return;
  }

  const initialQ = getUrlParam('q');
  const initialMarket = getUrlParam('market') || '';
  const initialState = getUrlParam('state');
  const initialSort = getUrlParam('sort') === 'oldest' ? 'oldest' : 'newest';
  const initialRange = getUrlParam('range');
  const initialFrom = getUrlParam('from');
  const initialTo = getUrlParam('to');
  const initialGroupBy = getUrlParam('group');
  const initialMetric = getUrlParam('metric') === 'revenue' ? 'revenue' : 'orders';

  search.value = initialQ;
  sortSel.value = initialSort;
  rangeSel.value = ['1m', '3m', 'custom'].includes(initialRange) ? initialRange : '1m';

  const todayStr = toDateInputValue(todayLocalMidnight());
  rangeFromInput.max = todayStr;
  rangeToInput.max = todayStr;

  /** `'range'` browses the selected date range; `'search'` shows an exact id/email match. */
  let mode = 'range';
  let rangeOrders = [];
  let searchOrders = null;
  let lastSearchQuery = '';
  let searchDebounceTimer = null;
  let searchRequestToken = 0;
  /** Once the user manually picks Day/Week, stop auto-switching it on range changes. */
  let groupByOverridden = false;

  function syncCustomFieldsVisibility() {
    rangeDatesEl.hidden = rangeSel.value !== 'custom';
  }

  function seedCustomRangeDefaultsIfEmpty() {
    if (rangeFromInput.value && rangeToInput.value) return;
    const to = todayLocalMidnight();
    rangeFromInput.value = toDateInputValue(addMonthsLocal(to, -3));
    rangeToInput.value = toDateInputValue(to);
  }

  /** Swap/clamp whatever is currently in the from/to inputs and write the result back. */
  function normalizeCustomRangeInputs() {
    if (!rangeFromInput.value || !rangeToInput.value) return;
    const { from, to } = normalizeDateRange(
      fromDateInputValue(rangeFromInput.value),
      fromDateInputValue(rangeToInput.value),
    );
    rangeFromInput.value = toDateInputValue(from);
    rangeToInput.value = toDateInputValue(to);
  }

  function persistUrlParams() {
    const isCustom = rangeSel.value === 'custom';
    setUrlParams({
      q: search.value,
      market: marketSel.value,
      state: stateSel.value,
      sort: sortSel.value === 'newest' ? '' : sortSel.value,
      range: rangeSel.value === '1m' ? '' : rangeSel.value,
      from: isCustom ? rangeFromInput.value : '',
      to: isCustom ? rangeToInput.value : '',
      group: groupBySel ? groupBySel.value : '',
      metric: metricSel && metricSel.value === 'revenue' ? 'revenue' : '',
    });
  }

  /** since/until for the currently selected range control, as UTC ISO instants. */
  function currentSinceUntil() {
    const today = todayLocalMidnight();
    if (rangeSel.value === '3m') return dateRangeToUtcQuery(addMonthsLocal(today, -3), today);
    if (rangeSel.value === 'custom' && rangeFromInput.value && rangeToInput.value) {
      return dateRangeToUtcQuery(
        fromDateInputValue(rangeFromInput.value),
        fromDateInputValue(rangeToInput.value),
      );
    }
    return dateRangeToUtcQuery(addMonthsLocal(today, -1), today);
  }

  /** Inclusive calendar-day span of the currently selected range (`until` is exclusive, so -1). */
  function currentRangeSpanDays() {
    const { since, until } = currentSinceUntil();
    const ms = new Date(until).getTime() - new Date(since).getTime();
    return Math.round(ms / (24 * 60 * 60 * 1000)) - 1;
  }

  /** Day for ≤ 1 month, Week for longer — unless the user has manually chosen one this session. */
  function applyAutoGroupBy() {
    if (groupByOverridden || !groupBySel) return;
    groupBySel.value = currentRangeSpanDays() > 31 ? 'week' : 'day';
  }

  /**
   * Revenue mixes currencies across markets (US=USD, CA=CAD, MX=MXN), so the metric toggle is only
   * enabled once a specific market is selected; "All markets" forces the chart back to Orders.
   */
  function syncMetricAvailability() {
    if (!metricSel) return;
    const enabled = Boolean(marketSel.value);
    metricSel.disabled = !enabled;
    metricSel.title = enabled
      ? ''
      : 'Select a specific market to view revenue — orders can be in different currencies otherwise';
    if (!enabled && metricSel.value === 'revenue') {
      metricSel.value = 'orders';
    }
  }

  async function fetchOrdersForRange() {
    const { since, until } = currentSinceUntil();
    const qs = new URLSearchParams({ since, until });
    const resp = await apiFetch(PB_ORG, PB_SITE, `orders?${qs}`, { method: 'GET' });
    if (!resp.ok) throw new Error(await readRespError(resp));
    const data = await resp.json();
    const list = data.orders || data || [];
    if (!Array.isArray(list)) throw new Error('Unexpected orders response shape');
    return list;
  }

  /**
   * `GET customers/{email}/orders` ignores `since`/`until` and always returns the customer's full
   * history, so an active email search is narrowed to the selected range client-side instead.
   */
  function filterOrdersByCurrentRange(orders) {
    const { since, until } = currentSinceUntil();
    const sinceMs = new Date(since).getTime();
    const untilMs = new Date(until).getTime();
    return orders.filter((o) => {
      const t = o?.createdAt ? new Date(o.createdAt).getTime() : NaN;
      return !Number.isNaN(t) && t >= sinceMs && t < untilMs;
    });
  }

  async function fetchOrderByIdLookup(id) {
    const resp = await apiFetch(PB_ORG, PB_SITE, `orders/${encodeURIComponent(id)}`, { method: 'GET' });
    if (!resp.ok) throw new Error(await readRespError(resp));
    const node = getOrderNodeForDisplay(await resp.json());
    return node ? [node] : [];
  }

  async function fetchOrdersByEmailLookup(email) {
    const path = `customers/${encodeURIComponent(email)}/orders`;
    const resp = await apiFetch(PB_ORG, PB_SITE, path, { method: 'GET' });
    if (!resp.ok) throw new Error(await readRespError(resp));
    const data = await resp.json();
    const list = data.orders || data || [];
    return Array.isArray(list) ? list : [];
  }

  function runSearchLookup(q) {
    return looksLikeEmail(q) ? fetchOrdersByEmailLookup(q) : fetchOrderByIdLookup(q);
  }

  function renderLoadingView() {
    wrap.innerHTML = '<p class="commerce-admin-auth-placeholder orders-loading-msg">'
      + 'Loading orders…</p>';
  }

  function showLoadError(err) {
    errEl.hidden = false;
    errEl.textContent = err?.message || 'Failed to load orders';
    wrap.innerHTML = '';
    countEl.textContent = '';
  }

  function applyView() {
    syncMetricAvailability();
    const q = search.value;
    const usingSearch = mode === 'search' && Array.isArray(searchOrders);
    let base = usingSearch ? searchOrders : rangeOrders;
    if (usingSearch && looksLikeEmail(lastSearchQuery)) {
      base = filterOrdersByCurrentRange(base);
    }

    persistUrlParams();

    let list = usingSearch ? base : filterByQuery(base, q);
    list = filterByMarket(list, marketSel.value);
    list = filterByState(list, stateSel.value);
    list = sortByCreated(list, sortSel.value);

    const total = base.length;
    countEl.textContent = list.length === total
      ? `${total} order${total === 1 ? '' : 's'}`
      : `${list.length} of ${total} orders`;
    renderTable(wrap, list, q, handleEditSaved);

    if (chartCanvasEl) {
      /* Order-id exact lookups aren't bound to a date-range control, so the chart
         derives its own span from the (single) result instead of the range picker. */
      const chartBounds = (usingSearch && !looksLikeEmail(lastSearchQuery))
        ? null
        : currentSinceUntil();
      const granularity = groupBySel && groupBySel.value === 'week' ? 'week' : 'day';
      const metric = metricSel && !metricSel.disabled && metricSel.value === 'revenue'
        ? 'revenue' : 'orders';
      const currencyCode = metric === 'revenue' ? currencyForMarketKey(marketSel.value) : '';
      const buckets = ordersPerPeriodBuckets(list, chartBounds, granularity);
      chartCanvasEl.innerHTML = ordersPerPeriodChartHtml(
        buckets,
        { granularity, metric, currencyCode },
      );
    }
  }

  /** After a detail-modal edit, refresh whichever data source is currently displayed. */
  async function handleEditSaved() {
    try {
      rangeOrders = await fetchOrdersForRange();
    } catch (err) {
      showToast(err.message || 'Failed to refresh orders', 'error');
    }
    if (mode === 'search' && lastSearchQuery) {
      try {
        searchOrders = await runSearchLookup(lastSearchQuery);
      } catch (err) {
        showToast(err.message || 'Failed to refresh search results', 'error');
      }
    }
    const scopeOrders = (mode === 'search' && searchOrders) || rangeOrders;
    fillStateSelect(stateSel, uniqueStates(scopeOrders), stateSel.value);
    fillMarketSelect(marketSel, uniqueMarkets(scopeOrders), marketSel.value);
    applyView();
  }

  /**
   * Reload the range-scoped order list. An active order-id search is left untouched (it's an exact
   * match, not range-bound); an active email search stays but is re-rendered against the new range.
   */
  async function reloadRangeOrders() {
    const wasSearchMode = mode === 'search';
    const emailSearchActive = wasSearchMode && looksLikeEmail(lastSearchQuery);
    if (!wasSearchMode) renderLoadingView();
    try {
      rangeOrders = await fetchOrdersForRange();
    } catch (err) {
      if (wasSearchMode) {
        showToast(err.message || 'Failed to reload orders for the selected range', 'error');
      } else {
        showLoadError(err);
      }
      return;
    }
    if (!wasSearchMode) {
      fillStateSelect(stateSel, uniqueStates(rangeOrders), stateSel.value);
      fillMarketSelect(marketSel, uniqueMarkets(rangeOrders), marketSel.value);
      applyView();
    } else if (emailSearchActive) {
      applyView();
    }
  }

  async function runTargetedSearch(q) {
    searchRequestToken += 1;
    const myToken = searchRequestToken;
    try {
      const results = await runSearchLookup(q);
      if (myToken !== searchRequestToken || search.value.trim() !== q) return;
      mode = 'search';
      lastSearchQuery = q;
      searchOrders = results;
      const scopeOrders = results.length ? results : rangeOrders;
      fillStateSelect(stateSel, uniqueStates(scopeOrders), stateSel.value);
      fillMarketSelect(marketSel, uniqueMarkets(scopeOrders), marketSel.value);
      applyView();
    } catch {
      /* not found or lookup failed — keep showing the locally filtered range results */
    }
  }

  function scheduleTargetedSearch() {
    clearTimeout(searchDebounceTimer);
    const q = search.value.trim();
    if (!looksLikeEmail(q) && !looksLikeOrderId(q)) return;
    searchDebounceTimer = setTimeout(() => runTargetedSearch(q), SEARCH_LOOKUP_DEBOUNCE_MS);
  }

  try {
    if (rangeSel.value === 'custom') {
      rangeFromInput.value = initialFrom || '';
      rangeToInput.value = initialTo || '';
      seedCustomRangeDefaultsIfEmpty();
      normalizeCustomRangeInputs();
    }
    syncCustomFieldsVisibility();

    if (groupBySel && ['day', 'week'].includes(initialGroupBy)) {
      groupBySel.value = initialGroupBy;
      groupByOverridden = true;
    } else {
      applyAutoGroupBy();
    }
    if (metricSel) metricSel.value = initialMetric;

    rangeOrders = await fetchOrdersForRange();
    const initialStates = uniqueStates(rangeOrders);
    fillStateSelect(stateSel, initialStates, initialState || defaultCompletedState(initialStates));
    fillMarketSelect(marketSel, uniqueMarkets(rangeOrders), initialMarket);
    applyView();

    const trimmedInitialQ = initialQ.trim();
    if (trimmedInitialQ && (looksLikeEmail(trimmedInitialQ) || looksLikeOrderId(trimmedInitialQ))) {
      await runTargetedSearch(trimmedInitialQ);
    }

    search.addEventListener('input', () => {
      mode = 'range';
      searchOrders = null;
      applyView();
      scheduleTargetedSearch();
    });
    stateSel.addEventListener('change', applyView);
    marketSel.addEventListener('change', applyView);
    sortSel.addEventListener('change', applyView);
    if (groupBySel) {
      groupBySel.addEventListener('change', () => {
        groupByOverridden = true;
        applyView();
      });
    }
    if (metricSel) metricSel.addEventListener('change', applyView);
    rangeSel.addEventListener('change', () => {
      syncCustomFieldsVisibility();
      if (rangeSel.value === 'custom') seedCustomRangeDefaultsIfEmpty();
      applyAutoGroupBy();
      reloadRangeOrders();
    });
    rangeFromInput.addEventListener('change', () => {
      normalizeCustomRangeInputs();
      applyAutoGroupBy();
      reloadRangeOrders();
    });
    rangeToInput.addEventListener('change', () => {
      normalizeCustomRangeInputs();
      applyAutoGroupBy();
      reloadRangeOrders();
    });
  } catch (err) {
    showLoadError(err);
  }
}

if (typeof document !== 'undefined') {
  init();
}
