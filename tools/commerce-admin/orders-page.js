/**
 * Orders list — ProductBus API (helix productbus-admin/orders.js pattern).
 * Row opens a detail dialog (human-readable order + journal); Edit saves via PUT / PATCH.
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
  for (const node of candidates) {
    const id = node.id ?? node.orderId;
    if (id != null && String(id).trim() !== '') return String(id).trim();
  }
  return '';
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

function formatItemPrice(item) {
  const p = item?.price;
  if (!p || typeof p !== 'object') return '';
  const final = p.final ?? p.amount;
  const cur = p.currency || '';
  if (final == null) return '';
  return cur ? `${final} ${cur}` : String(final);
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

function appendDl(section, rows) {
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
  if (dl.children.length) section.appendChild(dl);
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

  const summary = document.createElement('div');
  summary.className = 'orders-detail-summary';

  const idRow = document.createElement('div');
  idRow.style.display = 'flex';
  idRow.style.flexWrap = 'wrap';
  idRow.style.alignItems = 'center';
  idRow.style.gap = '8px';
  if (o.id != null) {
    const code = document.createElement('code');
    code.className = 'orders-detail-summary-id';
    code.textContent = String(o.id);
    idRow.appendChild(code);
  }
  if (o.friendlyId) {
    const friendly = document.createElement('span');
    friendly.className = 'orders-detail-summary-meta';
    friendly.textContent = `(${o.friendlyId})`;
    idRow.appendChild(friendly);
  }
  const stateEl = document.createElement('span');
  const st = String(o.state || 'pending');
  stateEl.className = `orders-badge ${st === 'completed' || st === 'payment_completed' ? 'orders-badge-success' : 'orders-badge-info'}`;
  stateEl.textContent = st;
  idRow.appendChild(stateEl);
  summary.appendChild(idRow);

  const meta = document.createElement('p');
  meta.className = 'orders-detail-summary-meta';
  const metaBits = [];
  if (o.createdAt) metaBits.push(`Created ${formatDateTime(o.createdAt)}`);
  if (o.updatedAt) metaBits.push(`Updated ${formatDateTime(o.updatedAt)}`);
  if (o.locale) metaBits.push(`Locale ${o.locale}`);
  if (o.country) metaBits.push(`Country ${String(o.country).toUpperCase()}`);
  meta.textContent = metaBits.join(' · ');
  summary.appendChild(meta);
  root.appendChild(summary);

  const cust = o.customer;
  if (cust && typeof cust === 'object' && Object.keys(cust).length) {
    const sec = section('Customer');
    appendDl(sec, [
      ['Name', [cust.firstName, cust.lastName].filter(Boolean).join(' ') || ''],
      ['Email', cust.email || ''],
      ['Phone', cust.phone || ''],
    ]);
    root.appendChild(sec);
  }

  const shipLines = formatAddressLines(o.shipping);
  if (shipLines) {
    const sec = section('Shipping');
    const p = document.createElement('p');
    p.className = 'orders-detail-address';
    p.textContent = shipLines;
    sec.appendChild(p);
    if (o.shippingMethod?.id != null) {
      appendDl(sec, [['Shipping method ID', String(o.shippingMethod.id)]]);
    }
    root.appendChild(sec);
  }

  const billLines = formatAddressLines(o.billing);
  if (billLines) {
    const sec = section('Billing');
    const p = document.createElement('p');
    p.className = 'orders-detail-address';
    p.textContent = billLines;
    sec.appendChild(p);
    root.appendChild(sec);
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
      const url = item.productUrl || item.path;
      if (url) {
        const display = typeof url === 'string' && url.length > 40 ? `${url.slice(0, 37)}…` : String(url);
        linkTd.appendChild(linkCell(url, display));
      } else linkTd.textContent = '—';
      tr.append(nameTd, skuTd, qtyTd, priceTd, linkTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    sec.appendChild(table);
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
    const tax = est.tax;
    if (tax && typeof tax === 'object') {
      appendDl(sec, [
        ['Tax', [tax.country, tax.state, tax.rate != null ? `${tax.rate}%` : '', tax.id].filter(Boolean).join(' · ')],
      ]);
    }
    const disc = est.discounts;
    if (Array.isArray(disc)) {
      appendDl(sec, [['Discounts', disc.length ? disc.map((d) => JSON.stringify(d)).join('; ') : 'None']]);
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
      const stName = h.state != null ? ` → ${h.state}` : '';
      ev.textContent = `${evName}${stName}`;
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
  const pre = document.createElement('pre');
  pre.className = 'orders-detail-json-inline';
  pre.textContent = JSON.stringify(val, null, 2);
  dd.appendChild(pre);
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
    p.textContent = 'No journal entries for this order.';
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

function showOrderDialog(order, { onEditSaved } = {}) {
  let orderPayload = order;
  const orderId = resolveOrderId(orderPayload);

  const dialog = document.createElement('dialog');
  dialog.className = 'orders-json-dialog';

  const actions = document.createElement('div');
  actions.className = 'orders-json-dialog-actions';

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

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ca-btn ca-btn-primary orders-dialog-close';
  close.textContent = 'Close';

  const content = document.createElement('div');
  content.className = 'orders-detail-body';
  content.appendChild(buildOrderHumanView(orderPayload));

  actions.append(editBtn, journalBtn, viewOrderBtn, close);
  dialog.append(actions, content);

  async function refetchOrderPayload() {
    const resp = await apiFetch(PB_ORG, PB_SITE, `orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
    if (!resp.ok) throw new Error(await readRespError(resp));
    orderPayload = await resp.json();
  }

  function showOrderView() {
    content.replaceChildren();
    content.appendChild(buildOrderHumanView(orderPayload));
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
      content.replaceChildren();
      content.appendChild(buildJournalHumanView(sanitized));
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

  close.addEventListener('click', () => {
    dialog.close();
    dialog.remove();
  });

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
        </tr>
      </thead>
      <tbody>
        ${orders.map((o) => {
    const bill = billingName(o);
    const ship = shippingName(o);
    const createdStr = o.createdAt ? new Date(o.createdAt).toLocaleString() : 'N/A';
    const id = String(o.id || '');
    return `
          <tr class="orders-row-open" data-id="${escapeHtml(id)}" tabindex="0" role="button" aria-label="Open order details for ${escapeHtml(id)}">
            <td><code class="orders-id">${highlightMatch(String(o.id || ''), query)}</code></td>
            <td><span class="orders-badge ${o.state === 'completed' ? 'orders-badge-success' : 'orders-badge-info'}">${highlightMatch(String(o.state || 'pending'), query)}</span></td>
            <td class="orders-name-cell">${highlightMatch(bill, query)}</td>
            <td class="orders-name-cell">${highlightMatch(ship, query)}</td>
            <td>${highlightMatch(String(o.items?.length ?? '—'), query)}</td>
            <td>${highlightMatch(createdStr, query)}</td>
          </tr>`;
  }).join('')}
      </tbody>
    </table>`;

  wrap.querySelectorAll('tbody tr.orders-row-open[data-id]').forEach((row) => {
    const openDetail = async () => {
      const id = row.getAttribute('data-id');
      if (!id) return;
      try {
        const resp = await apiFetch(PB_ORG, PB_SITE, `orders/${encodeURIComponent(id)}`, { method: 'GET' });
        if (!resp.ok) throw new Error(await readRespError(resp));
        const orderData = await resp.json();
        showOrderDialog(orderData, { onEditSaved });
      } catch (err) {
        showToast(`Failed to load order: ${err.message}`, 'error');
      }
    };
    row.addEventListener('click', () => {
      void openDetail();
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        void openDetail();
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
