/**
 * Customers list — ProductBus API (helix productbus-admin/customers.js pattern).
 * Row opens detail (coupon-style header, account extras, addresses, order numbers).
 * Edit opens JSON.
 */
import { apiFetch } from './commerce-otp-api.js';
import waitForCommerceAuthReady from './commerce-wait-auth-ready.js';
import { putOrPatchResource } from './commerce-resource-save.js';
import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';
import { createDetailModalHeaderCloseAndJson } from './commerce-detail-modal-json.js';
import { openJsonEditDialog } from './commerce-json-edit-dialog.js';
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

/** `GET customers/…` may return `{ customer: { … } }` (storefront-style envelope). */
function unwrapCustomerRecord(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const inner = raw.customer;
  if (inner && typeof inner === 'object' && raw.email == null && inner.email != null) {
    return inner;
  }
  return raw;
}

/** Lowercase a-z0-9 only — matches order id search behavior in orders admin. */
function normalizeOrderIdKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Short id for display: `friendlyId`, else suffix after timestamp-prefixed ProductBus ids. */
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

/** Compact short id for display (same as orders admin). */
function formatOrderIdChunks(shortId) {
  const compact = normalizeOrderIdKey(shortId);
  if (!compact) return '—';
  return compact.toUpperCase();
}

function formatOrderNumberLabel(orderOrRawId) {
  if (orderOrRawId && typeof orderOrRawId === 'object') {
    const short = orderIdForDisplay(orderOrRawId);
    return short ? formatOrderIdChunks(short) : '';
  }
  const raw = String(orderOrRawId || '').trim();
  if (!raw) return '';
  const short = orderIdForDisplay({ id: raw, friendlyId: raw });
  return short ? formatOrderIdChunks(short) : formatOrderIdChunks(raw);
}

function orderEmailNorm(o) {
  const e = o?.customer?.email
    || o?.customMetadata?.customerEmail
    || o?.email;
  return e != null ? String(e).trim().toLowerCase() : '';
}

/**
 * Order numbers for a customer email from `GET orders` (same list payload as the Orders admin).
 * @param {object[]} orders
 * @param {string} email
 */
function orderDisplayNumbersFromOrdersList(orders, email) {
  const want = String(email || '').trim().toLowerCase();
  if (!want || !Array.isArray(orders)) return [];
  const matches = orders.filter((o) => {
    const e = orderEmailNorm(o);
    return e && e === want;
  });
  matches.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
  const labels = matches.map((o) => formatOrderNumberLabel(o)).filter(Boolean);
  const seen = new Set();
  const out = [];
  labels.forEach((lbl) => {
    const k = normalizeOrderIdKey(lbl);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(lbl);
  });
  return out;
}

/** Pull order id / number hints already present on the customer JSON (no extra widget deps). */
function embeddedOrderDisplayNumbers(data) {
  if (!data || typeof data !== 'object') return [];
  const acc = [];
  const pushLabel = (x) => {
    const lbl = formatOrderNumberLabel(x);
    if (lbl && lbl !== '—') acc.push(lbl);
  };
  ['orders', 'orderHistory', 'recentOrders', 'pastOrders'].forEach((key) => {
    const arr = data[key];
    if (!Array.isArray(arr)) return;
    arr.forEach((item) => {
      if (item == null) return;
      if (typeof item === 'string' || typeof item === 'number') pushLabel(String(item));
      else if (typeof item === 'object') pushLabel(item);
    });
  });
  const ids = data.orderIds || data.order_ids;
  if (Array.isArray(ids)) {
    ids.forEach((id) => {
      if (id != null) pushLabel(String(id));
    });
  }
  const seen = new Set();
  const out = [];
  acc.forEach((lbl) => {
    const k = normalizeOrderIdKey(lbl);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(lbl);
  });
  return out;
}

function mergeOrderNumberLists(primary, secondary) {
  const seen = new Set();
  const out = [];
  [...primary, ...secondary].forEach((lbl) => {
    const k = normalizeOrderIdKey(lbl);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(lbl);
  });
  return out;
}

/** Person / org line from an address (ProductBus + Magento-style). */
function addressDisplayName(addr) {
  if (!addr || typeof addr !== 'object') return '';
  if (typeof addr.name === 'string' && addr.name.trim()) return addr.name.trim();
  const fn = addr.firstName || addr.first_name || addr.firstname || '';
  const ln = addr.lastName || addr.last_name || addr.lastname || '';
  const joined = [fn, ln].map((s) => String(s).trim()).filter(Boolean).join(' ');
  if (joined) return joined;
  if (addr.company && String(addr.company).trim()) return String(addr.company).trim();
  return '';
}

function regionLine(addr) {
  if (!addr || typeof addr !== 'object') return '';
  const r = addr.region;
  if (r && typeof r === 'object') {
    const code = r.region_code || r.regionCode || '';
    const name = r.region || r.region_name || '';
    const bits = [String(code || '').trim(), String(name || '').trim()].filter(Boolean);
    if (bits.length) return bits.join(' · ');
  }
  if (addr.state != null && String(addr.state).trim()) return String(addr.state).trim();
  if (addr.region != null && typeof addr.region === 'string' && addr.region.trim()) return addr.region.trim();
  return '';
}

function streetLines(addr) {
  if (!addr || typeof addr !== 'object') return [];
  const st = addr.street;
  if (Array.isArray(st)) return st.map((s) => String(s || '').trim()).filter(Boolean);
  if (typeof st === 'string' && st.trim()) {
    return st.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function addressPostalCode(addr) {
  if (!addr || typeof addr !== 'object') return '';
  if (addr.zip != null && String(addr.zip).trim() !== '') return String(addr.zip).trim();
  if (addr.postcode != null && String(addr.postcode).trim() !== '') return String(addr.postcode).trim();
  if (addr.postalCode != null && String(addr.postalCode).trim() !== '') return String(addr.postalCode).trim();
  return '';
}

/** Multi-line address block aligned with order admin `formatAddressLines` + Magento REST fields. */
function formatAddressLines(addr) {
  if (!addr || typeof addr !== 'object') return '';
  const lines = [];
  const nm = addressDisplayName(addr);
  if (nm) lines.push(nm);
  const sLines = streetLines(addr);
  if (sLines.length) sLines.forEach((ln) => lines.push(ln));
  if (addr.address1) lines.push(String(addr.address1));
  if (addr.address2) lines.push(String(addr.address2));
  const city = addr.city != null ? String(addr.city).trim() : '';
  const state = regionLine(addr) || (addr.state != null ? String(addr.state).trim() : '');
  const zip = addressPostalCode(addr);
  const cityBits = [city, state, zip].filter(Boolean);
  if (cityBits.length) lines.push(cityBits.join(', '));
  const country = addr.country || addr.country_id || addr.countryId;
  if (country) lines.push(String(country).toUpperCase());
  if (addr.phone || addr.telephone) lines.push(`Phone: ${String(addr.phone || addr.telephone)}`);
  if (addr.email) lines.push(String(addr.email));
  return lines.join('\n');
}

function detailSection(title) {
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
    dd.textContent = String(value);
    dl.appendChild(dt);
    dl.appendChild(dd);
  });
  if (dl.children.length) sectionEl.appendChild(dl);
}

function truthyAttr(v) {
  if (v === true || v === 1 || v === '1') return true;
  if (typeof v === 'string' && ['true', 'on', 'yes'].includes(v.toLowerCase())) return true;
  return false;
}

function addressEntryLabel(addr, index) {
  if (!addr || typeof addr !== 'object') return `Address ${index + 1}`;
  const bits = [];
  if (truthyAttr(addr.default_shipping) || truthyAttr(addr.defaultShipping)) bits.push('default shipping');
  if (truthyAttr(addr.default_billing) || truthyAttr(addr.defaultBilling)) bits.push('default billing');
  if (bits.length) return `Address ${index + 1} (${bits.join(', ')})`;
  return `Address ${index + 1}`;
}

/**
 * Collect saved addresses from a customer record (Magento `addresses[]`, ProductBus-style roots).
 * @returns {{ title: string, text: string }[]}
 */
function collectAddressBlocks(data) {
  if (!data || typeof data !== 'object') return [];
  const blocks = [];

  if (Array.isArray(data.addresses) && data.addresses.length) {
    data.addresses.forEach((addr, i) => {
      if (!addr || typeof addr !== 'object') return;
      const text = formatAddressLines(addr);
      if (!text) return;
      blocks.push({ title: addressEntryLabel(addr, i), text });
    });
    if (blocks.length) return blocks;
  }

  const ship = formatAddressLines(data.shipping);
  const bill = formatAddressLines(data.billing);
  if (ship) blocks.push({ title: 'Shipping', text: ship });
  if (bill) blocks.push({ title: 'Billing', text: bill });
  if (blocks.length) return blocks;

  const ship2 = formatAddressLines(data.shippingAddress || data.shipping_address);
  const bill2 = formatAddressLines(data.billingAddress || data.billing_address);
  if (ship2) blocks.push({ title: 'Shipping', text: ship2 });
  if (bill2) blocks.push({ title: 'Billing', text: bill2 });

  return blocks;
}

/** Extra account fields not already shown in the rich header stats. */
function buildAccountExtrasRows(data) {
  if (!data || typeof data !== 'object') return [];
  const rows = [];
  const take = (label, val) => {
    if (val == null) return;
    const s = typeof val === 'string' ? val.trim() : String(val).trim();
    if (s !== '') rows.push([label, s]);
  };
  take('Middle name', data.middleName || data.middlename);
  take('Prefix', data.prefix);
  take('Suffix', data.suffix);
  take('Gender', data.gender);
  take('Date of birth', data.dateOfBirth || data.dob);
  take('Company', data.company);
  take('Tax / VAT', data.taxvat || data.vatId || data.vat_id);
  take('Group', data.groupId ?? data.group_id);
  take('Website', data.websiteId ?? data.website_id);
  take('Store locale', data.locale);
  take('Country', data.country);
  if (data.storeCredit != null && data.storeCredit !== '') take('Store credit', data.storeCredit);
  if (truthyAttr(data.isSubscribed) || data.is_subscribed != null) {
    take('Email subscription', truthyAttr(data.isSubscribed) || truthyAttr(data.is_subscribed) ? 'Subscribed' : 'Not subscribed');
  }
  return rows;
}

/** Same idea as productbus filterCustomers. */
function filterByQuery(customers, q) {
  if (!q) return customers;
  const needle = q.toLowerCase();
  return customers.filter((c) => (c.email || '').toLowerCase().includes(needle)
    || (c.firstName || '').toLowerCase().includes(needle)
    || (c.lastName || '').toLowerCase().includes(needle)
    || (c.phone || '').toLowerCase().includes(needle));
}

function sortByCreated(customers, sort) {
  const arr = [...customers];
  arr.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return sort === 'oldest' ? ta - tb : tb - ta;
  });
  return arr;
}

function appendPill(container, label, on) {
  const span = document.createElement('span');
  span.className = on ? 'coupons-pill coupons-pill-on' : 'coupons-pill coupons-pill-off';
  span.textContent = label;
  container.appendChild(span);
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

/** Same “rich header” pattern as orders detail — badges, title, id line, hero, stats, pills. */
function buildCustomerRichHeader(data) {
  const wrap = document.createElement('div');
  wrap.className = 'orders-detail-rich';

  if (!data || typeof data !== 'object') {
    const p = document.createElement('p');
    p.className = 'customers-detail-empty';
    p.textContent = 'No customer data.';
    wrap.appendChild(p);
    return wrap;
  }

  const email = data.email != null ? String(data.email).trim() : '';
  const fullName = [data.firstName, data.lastName].filter(Boolean).join(' ').trim();

  const head = document.createElement('div');
  head.className = 'coupons-modal-head';
  const badges = document.createElement('div');
  badges.className = 'coupons-modal-badges';
  if (email && email.includes('@')) {
    const domain = email.split('@')[1] || '';
    if (domain) {
      const tag = document.createElement('span');
      tag.className = 'coupons-tag coupons-tag-slug';
      tag.textContent = domain;
      badges.appendChild(tag);
    }
  }
  head.appendChild(badges);

  const title = document.createElement('h2');
  title.className = 'coupons-modal-title';
  /* Email stays on the id line only — avoid repeating it as the headline when there is no name. */
  title.textContent = fullName || 'Customer';
  head.appendChild(title);

  const idLine = document.createElement('p');
  idLine.className = 'coupons-modal-idline orders-detail-idline';
  const code = document.createElement('code');
  code.className = 'orders-detail-id-code';
  code.textContent = email || '—';
  idLine.appendChild(code);
  head.appendChild(idLine);
  wrap.appendChild(head);

  const createdStr = data.createdAt ? new Date(data.createdAt).toLocaleString() : '';

  const stats = document.createElement('div');
  stats.className = 'coupons-modal-stats';
  stats.setAttribute('role', 'list');
  stats.appendChild(statBlock('Phone', data.phone != null && String(data.phone).trim() !== '' ? String(data.phone) : '—'));
  stats.appendChild(statBlock('First name', data.firstName != null && String(data.firstName).trim() !== '' ? String(data.firstName) : '—'));
  stats.appendChild(statBlock('Last name', data.lastName != null && String(data.lastName).trim() !== '' ? String(data.lastName) : '—'));
  stats.appendChild(statBlock('Created', createdStr || '—'));
  wrap.appendChild(stats);

  const pills = document.createElement('div');
  pills.className = 'coupons-modal-pills';
  pills.setAttribute('aria-label', 'Customer flags');
  appendPill(pills, 'Has phone', Boolean(data.phone && String(data.phone).trim()));
  appendPill(pills, 'Full name', Boolean(fullName));
  wrap.appendChild(pills);

  return wrap;
}

function buildCustomerDetailHumanView(data, orderDisplayNumbers) {
  const root = document.createElement('div');
  root.className = 'customers-detail-human';
  root.appendChild(buildCustomerRichHeader(data));

  const extras = buildAccountExtrasRows(data);
  if (extras.length) {
    const sec = detailSection('Account');
    appendDl(sec, extras);
    root.appendChild(sec);
  }

  const addrBlocks = collectAddressBlocks(data);
  if (addrBlocks.length) {
    const sec = detailSection(addrBlocks.length > 1 ? 'Addresses' : 'Address');
    addrBlocks.forEach(({ title, text }, idx) => {
      if (addrBlocks.length > 1) {
        const sub = document.createElement('h4');
        sub.className = 'customers-detail-address-subtitle';
        sub.textContent = title;
        sec.appendChild(sub);
      }
      const p = document.createElement('p');
      p.className = 'orders-detail-address';
      p.textContent = text;
      sec.appendChild(p);
      if (addrBlocks.length > 1 && idx < addrBlocks.length - 1) {
        const gap = document.createElement('div');
        gap.className = 'customers-detail-address-gap';
        sec.appendChild(gap);
      }
    });
    root.appendChild(sec);
  }

  const orderNums = Array.isArray(orderDisplayNumbers) ? orderDisplayNumbers : [];
  const ordSec = detailSection('Orders');
  if (!orderNums.length) {
    const p = document.createElement('p');
    p.className = 'orders-detail-empty';
    p.textContent = 'No orders found for this email in the loaded orders list, and none on the customer record.';
    ordSec.appendChild(p);
  } else {
    const ul = document.createElement('ul');
    ul.className = 'customers-order-number-list';
    orderNums.forEach((label) => {
      const li = document.createElement('li');
      const code = document.createElement('code');
      code.className = 'customers-order-number-code';
      code.textContent = label;
      li.appendChild(code);
      ul.appendChild(li);
    });
    ordSec.appendChild(ul);
  }
  root.appendChild(ordSec);

  return root;
}

function openCustomerDetailModal(
  customerData,
  { email, onRefresh, orderDisplayNumbers = [] } = {},
) {
  const dialog = document.createElement('dialog');
  dialog.className = 'customers-detail-dialog coupons-detail-dialog';

  const toolbar = document.createElement('div');
  toolbar.className = 'commerce-detail-modal-toolbar';

  const scroll = document.createElement('div');
  scroll.className = 'coupons-detail-dialog-scroll customers-detail-scroll';

  const bodyHost = document.createElement('div');

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'orders-edit-btn';
  editBtn.textContent = 'Edit';

  const toolbarMain = document.createElement('div');
  toolbarMain.className = 'commerce-detail-modal-toolbar-main';
  toolbarMain.appendChild(editBtn);

  const shut = () => {
    dialog.close();
    dialog.remove();
  };

  const header = createDetailModalHeaderCloseAndJson({
    bodyHost,
    getHumanNode: () => buildCustomerDetailHumanView(customerData, orderDisplayNumbers),
    getJsonValue: () => customerData,
    onClose: shut,
  });

  toolbar.append(toolbarMain, header.headerRight);

  scroll.appendChild(bodyHost);
  header.resetToHuman();

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) shut();
  });

  editBtn.addEventListener('click', async () => {
    if (!email) return;
    try {
      const resp = await apiFetch(PB_ORG, PB_SITE, `customers/${encodeURIComponent(email)}`, { method: 'GET' });
      let customer = customerData;
      if (resp.ok) {
        customer = unwrapCustomerRecord(await resp.json());
      }
      const saved = await openJsonEditDialog({
        title: `Edit customer ${email}`,
        initialObject: customer,
        onSave: (parsed) => putOrPatchResource(`customers/${encodeURIComponent(email)}`, parsed),
      });
      if (saved) {
        shut();
        if (typeof onRefresh === 'function') await onRefresh();
      }
    } catch (err) {
      showToast(err.message || 'Failed to open editor', 'error');
    }
  });

  dialog.append(toolbar, scroll);
  document.body.appendChild(dialog);
  wireDialogEscapeDismiss(dialog, shut);
  dialog.showModal();
}

async function viewCustomer(email, rowFallback, onRefresh) {
  let data = rowFallback;
  let ordersList = [];
  try {
    const [custResp, ordResp] = await Promise.all([
      apiFetch(PB_ORG, PB_SITE, `customers/${encodeURIComponent(email)}`, { method: 'GET' }),
      apiFetch(PB_ORG, PB_SITE, 'orders', { method: 'GET' }),
    ]);
    if (custResp.ok) {
      const raw = await custResp.json();
      data = unwrapCustomerRecord(raw);
    }
    if (ordResp.ok) {
      const ordJson = await ordResp.json();
      const list = ordJson.orders || ordJson || [];
      if (Array.isArray(list)) ordersList = list;
    }
  } catch {
    /* use fallback */
  }

  const fromOrders = orderDisplayNumbersFromOrdersList(ordersList, email);
  const embedded = embeddedOrderDisplayNumbers(data);
  const merged = mergeOrderNumberLists(fromOrders, embedded);

  openCustomerDetailModal(data, { email, onRefresh, orderDisplayNumbers: merged });
}

function renderTable(wrap, displayed, query, onEditSaved) {
  if (displayed.length === 0) {
    wrap.innerHTML = `
      <div class="customers-empty">
        <h2 class="customers-empty-title">No customers match</h2>
        <p class="customers-empty-text">Try changing search or sort.</p>
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="customers-data-table">
      <thead>
        <tr>
          <th>Email</th>
          <th>First name</th>
          <th>Last name</th>
          <th>Phone</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        ${displayed.map((c) => {
    const email = c.email || '';
    const safeAttr = escapeHtml(email);
    const first = c.firstName || '—';
    const last = c.lastName || '—';
    const phone = c.phone || '—';
    const createdStr = c.createdAt ? new Date(c.createdAt).toLocaleString() : '—';
    const labelName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || email || 'Customer';
    const rowClass = email ? 'customers-row-open' : '';
    const tabIdx = email ? '0' : '-1';
    const roleBtn = email ? 'role="button"' : '';
    return `
          <tr class="${rowClass}" data-email="${safeAttr}" tabindex="${tabIdx}" ${roleBtn} aria-label="Open customer ${escapeHtml(labelName)}">
            <td class="customers-email-cell">${highlightMatch(email, query)}</td>
            <td>${highlightMatch(first, query)}</td>
            <td>${highlightMatch(last, query)}</td>
            <td>${highlightMatch(phone, query)}</td>
            <td>${highlightMatch(createdStr, query)}</td>
          </tr>`;
  }).join('')}
      </tbody>
    </table>`;

  wrap.querySelectorAll('tbody tr.customers-row-open[data-email]').forEach((row) => {
    const openDetail = async () => {
      const email = row.getAttribute('data-email');
      if (!email) return;
      const fallback = displayed.find((x) => x.email === email) || { email };
      try {
        await viewCustomer(email, fallback, onEditSaved);
      } catch (err) {
        showToast(err.message || 'Failed to load customer', 'error');
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

async function init() {
  const wrap = document.getElementById('customers-table');
  const search = document.getElementById('customers-search');
  const sortSel = document.getElementById('customers-sort');
  const countEl = document.getElementById('customers-count');
  const errEl = document.getElementById('customers-error');
  if (!wrap || !search || !sortSel) return;

  const authed = await waitForCommerceAuthReady(PB_ORG, PB_SITE);
  if (!authed) {
    errEl.hidden = false;
    errEl.textContent = 'Sign-in did not finish before the wait timed out. Reload the page.';
    return;
  }

  const initialQ = getUrlParam('q');
  const initialSort = getUrlParam('sort') === 'oldest' ? 'oldest' : 'newest';

  search.value = initialQ;
  sortSel.value = initialSort;

  let allCustomers = [];

  async function refreshCustomers() {
    const resp = await apiFetch(PB_ORG, PB_SITE, 'customers', { method: 'GET' });
    if (!resp.ok) throw new Error(await readRespError(resp));
    const data = await resp.json();
    const list = data.customers || data || [];
    if (!Array.isArray(list)) {
      throw new Error('Unexpected customers response shape');
    }
    allCustomers = list;
  }

  function applyFilters() {
    const q = search.value;
    const sort = sortSel.value;

    setUrlParams({ q, sort: sort === 'newest' ? '' : sort });

    let list = filterByQuery(allCustomers, q);
    list = sortByCreated(list, sort);

    const total = allCustomers.length;
    countEl.textContent = list.length === total
      ? `${total} customer${total === 1 ? '' : 's'}`
      : `${list.length} of ${total} customers`;
    renderTable(wrap, list, q, async () => {
      await refreshCustomers();
      applyFilters();
    });
  }

  try {
    await refreshCustomers();
    applyFilters();

    search.addEventListener('input', applyFilters);
    sortSel.addEventListener('change', applyFilters);
  } catch (err) {
    errEl.hidden = false;
    errEl.textContent = err.message || 'Failed to load customers';
    wrap.innerHTML = '';
    countEl.textContent = '';
  }
}

init();
