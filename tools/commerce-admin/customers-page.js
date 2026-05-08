/**
 * Customers list — ProductBus API (helix productbus-admin/customers.js pattern).
 * Row opens detail (coupon-style header); Edit in the modal opens the JSON editor (PUT / PATCH).
 */
import { apiFetch } from './commerce-otp-api.js';
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

function buildCustomerDetailHumanView(data) {
  const root = document.createElement('div');
  root.className = 'customers-detail-human';
  root.appendChild(buildCustomerRichHeader(data));
  return root;
}

function openCustomerDetailModal(customerData, { email, onRefresh } = {}) {
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
    getHumanNode: () => buildCustomerDetailHumanView(customerData),
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
        customer = await resp.json();
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
  try {
    const resp = await apiFetch(PB_ORG, PB_SITE, `customers/${encodeURIComponent(email)}`, { method: 'GET' });
    if (resp.ok) {
      data = await resp.json();
    }
  } catch {
    /* use fallback */
  }
  openCustomerDetailModal(data, { email, onRefresh });
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
