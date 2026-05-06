/**
 * Orders list — ProductBus API (helix productbus-admin/orders.js pattern).
 * View (read-only JSON) + Edit (customer / shipping / billing form, PUT / PATCH).
 */
import { apiFetch } from './commerce-otp-api.js';
import { putOrPatchResource } from './commerce-resource-save.js';
import { openOrderContactEditDialog } from './order-contact-edit-dialog.js';
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

/** Text search on id, email, state, billing/shipping names. */
function filterByQuery(orders, q) {
  if (!q) return orders;
  const needle = q.toLowerCase();
  return orders.filter((o) => {
    if ((o.id || '').toLowerCase().includes(needle)) return true;
    if ((o.customer?.email || '').toLowerCase().includes(needle)) return true;
    if ((o.customMetadata?.customerEmail || '').toLowerCase().includes(needle)) return true;
    if ((o.state || '').toLowerCase().includes(needle)) return true;
    const bill = billingName(o);
    const ship = shippingName(o);
    if (bill !== '—' && bill.toLowerCase().includes(needle)) return true;
    if (ship !== '—' && ship.toLowerCase().includes(needle)) return true;
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

function showOrderDialog(order) {
  const dialog = document.createElement('dialog');
  dialog.className = 'orders-json-dialog';
  const pre = document.createElement('pre');
  pre.className = 'orders-json-pre';
  pre.textContent = JSON.stringify(order, null, 2);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ca-btn ca-btn-primary orders-dialog-close';
  close.textContent = 'Close';
  close.addEventListener('click', () => {
    dialog.close();
    dialog.remove();
  });
  dialog.append(pre, close);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      dialog.close();
      dialog.remove();
    }
  });
  document.body.appendChild(dialog);
  dialog.showModal();
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
        <p class="orders-empty-text">Try changing search or state filter.</p>
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="orders-data-table">
      <thead>
        <tr>
          <th>Order ID</th>
          <th>State</th>
          <th>Billing</th>
          <th>Shipping</th>
          <th>Items</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${orders.map((o) => {
    const bill = billingName(o);
    const ship = shippingName(o);
    const createdStr = o.createdAt ? new Date(o.createdAt).toLocaleString() : 'N/A';
    return `
          <tr data-id="${escapeHtml(o.id)}">
            <td><code class="orders-id">${highlightMatch(String(o.id || ''), query)}</code></td>
            <td><span class="orders-badge ${o.state === 'completed' ? 'orders-badge-success' : 'orders-badge-info'}">${highlightMatch(String(o.state || 'pending'), query)}</span></td>
            <td class="orders-name-cell">${highlightMatch(bill, query)}</td>
            <td class="orders-name-cell">${highlightMatch(ship, query)}</td>
            <td>${highlightMatch(String(o.items?.length ?? '—'), query)}</td>
            <td>${highlightMatch(createdStr, query)}</td>
            <td>
              <div class="orders-actions">
                <button type="button" class="orders-view-btn" data-order-id="${escapeHtml(o.id)}">View</button>
                <button type="button" class="orders-edit-btn" data-order-id="${escapeHtml(o.id)}">Edit</button>
              </div>
            </td>
          </tr>`;
  }).join('')}
      </tbody>
    </table>`;

  wrap.querySelectorAll('.orders-view-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-order-id');
      try {
        const resp = await apiFetch(PB_ORG, PB_SITE, `orders/${encodeURIComponent(id)}`, { method: 'GET' });
        if (!resp.ok) throw new Error(await readRespError(resp));
        const order = await resp.json();
        showOrderDialog(order);
      } catch (err) {
        showToast(`Failed to load order: ${err.message}`, 'error');
      }
    });
  });

  wrap.querySelectorAll('.orders-edit-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-order-id');
      try {
        const resp = await apiFetch(PB_ORG, PB_SITE, `orders/${encodeURIComponent(id)}`, { method: 'GET' });
        if (!resp.ok) throw new Error(await readRespError(resp));
        const order = await resp.json();
        const saved = await openOrderContactEditDialog({
          title: `Edit order ${id}`,
          orderPayload: order,
          onSave: (merged) => putOrPatchResource(`orders/${encodeURIComponent(id)}`, merged),
        });
        if (saved && onEditSaved) {
          await onEditSaved();
        }
      } catch (err) {
        showToast(err.message || 'Failed to open editor', 'error');
      }
    });
  });
}

async function init() {
  const wrap = document.getElementById('orders-table');
  const search = document.getElementById('orders-search');
  const stateSel = document.getElementById('orders-state');
  const sortSel = document.getElementById('orders-sort');
  const countEl = document.getElementById('orders-count');
  const errEl = document.getElementById('orders-error');
  if (!wrap || !search || !stateSel || !sortSel) return;

  const initialQ = getUrlParam('q');
  const initialState = getUrlParam('state');
  const initialSort = getUrlParam('sort') === 'oldest' ? 'oldest' : 'newest';

  search.value = initialQ;
  sortSel.value = initialSort;

  let allOrders = [];

  async function refreshOrders() {
    const resp = await apiFetch(PB_ORG, PB_SITE, 'orders', { method: 'GET' });
    if (!resp.ok) throw new Error(await readRespError(resp));
    const data = await resp.json();
    const list = data.orders || data || [];
    if (!Array.isArray(list)) {
      throw new Error('Unexpected orders response shape');
    }
    allOrders = list;
    const states = uniqueStates(allOrders);
    fillStateSelect(stateSel, states, stateSel.value);
  }

  function applyFilters() {
    const q = search.value;
    const state = stateSel.value;
    const sort = sortSel.value;

    setUrlParams({ q, state, sort: sort === 'newest' ? '' : sort });

    let list = filterByQuery(allOrders, q);
    list = filterByState(list, state);
    list = sortByCreated(list, sort);

    const total = allOrders.length;
    countEl.textContent = list.length === total
      ? `${total} order${total === 1 ? '' : 's'}`
      : `${list.length} of ${total} orders`;
    renderTable(wrap, list, q, async () => {
      await refreshOrders();
      applyFilters();
    });
  }

  try {
    await refreshOrders();
    if (initialState) {
      const match = [...stateSel.options].find(
        (o) => o.value && o.value.toLowerCase() === initialState.toLowerCase(),
      );
      if (match) stateSel.value = match.value;
    }
    applyFilters();

    search.addEventListener('input', applyFilters);
    stateSel.addEventListener('change', applyFilters);
    sortSel.addEventListener('change', applyFilters);
  } catch (err) {
    errEl.hidden = false;
    errEl.textContent = err.message || 'Failed to load orders';
    wrap.innerHTML = '';
    countEl.textContent = '';
  }
}

init();
