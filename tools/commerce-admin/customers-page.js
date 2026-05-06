/**
 * Customers list — ProductBus API (helix productbus-admin/customers.js pattern).
 * View + Edit (JSON editor, PUT / PATCH).
 */
import { apiFetch } from './commerce-otp-api.js';
import { putOrPatchResource } from './commerce-resource-save.js';
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

function showJsonDialog(obj) {
  const dialog = document.createElement('dialog');
  dialog.className = 'customers-json-dialog';
  const pre = document.createElement('pre');
  pre.className = 'customers-json-pre';
  pre.textContent = JSON.stringify(obj, null, 2);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ca-btn ca-btn-primary customers-dialog-close';
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

async function viewCustomer(email, rowFallback) {
  try {
    const resp = await apiFetch(PB_ORG, PB_SITE, `customers/${encodeURIComponent(email)}`, { method: 'GET' });
    if (resp.ok) {
      const data = await resp.json();
      showJsonDialog(data);
      return;
    }
  } catch {
    /* use fallback */
  }
  showJsonDialog(rowFallback);
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
          <th>Actions</th>
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
    return `
          <tr>
            <td class="customers-email-cell">${highlightMatch(email, query)}</td>
            <td>${highlightMatch(first, query)}</td>
            <td>${highlightMatch(last, query)}</td>
            <td>${highlightMatch(phone, query)}</td>
            <td>${highlightMatch(createdStr, query)}</td>
            <td>
              <div class="customers-actions">
                <button type="button" class="customers-view-btn" data-email="${safeAttr}">View</button>
                <button type="button" class="customers-edit-btn" data-email="${safeAttr}">Edit</button>
              </div>
            </td>
          </tr>`;
  }).join('')}
      </tbody>
    </table>`;

  wrap.querySelectorAll('.customers-view-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const email = btn.getAttribute('data-email');
      const row = displayed.find((x) => x.email === email) || { email };
      try {
        await viewCustomer(email, row);
      } catch (err) {
        showToast(err.message || 'Failed to load customer', 'error');
      }
    });
  });

  wrap.querySelectorAll('.customers-edit-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const email = btn.getAttribute('data-email');
      if (!email) return;
      try {
        const resp = await apiFetch(PB_ORG, PB_SITE, `customers/${encodeURIComponent(email)}`, { method: 'GET' });
        let customer;
        if (resp.ok) {
          customer = await resp.json();
        } else {
          customer = displayed.find((x) => x.email === email) || { email };
        }
        const saved = await openJsonEditDialog({
          title: `Edit customer ${email}`,
          initialObject: customer,
          onSave: (parsed) => putOrPatchResource(`customers/${encodeURIComponent(email)}`, parsed),
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
