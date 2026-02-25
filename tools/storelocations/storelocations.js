// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

const ADMIN_BASE = 'https://admin.da.live/source/aemsites/vitamix/us/en_us/where-to-buy';
const PUBLIC_BASE = 'https://main--vitamix--aemsites.aem.live/us/en_us/where-to-buy';

const SOURCE_OPTIONS = [
  { value: 'storelocations-hh', publicPath: 'storelocations-hh.json', adminPath: 'storelocations-hh.json' },
  { value: 'storelocations-events', publicPath: 'storelocations-events.json', adminPath: 'storelocations-events.json' },
  { value: 'storelocations-comm', publicPath: 'storelocations-comm.json', adminPath: 'storelocations-comm.json' },
];

const SCHEMA_ORDER = [
  'TYPE', 'ACTION', 'ENABLED', 'NAME', 'ADDRESS_1', 'ADDRESS_2', 'CITY', 'STATE_PROVINCE',
  'POSTAL_CODE', 'COUNTY', 'COUNTRY', 'LAT', 'LONG', 'PHONE_NUMBER', 'PRODUCT FAMILY',
  'START_DATE', 'END_DATE', 'NOTES', 'PRODUCT_TYPE', 'WEB_ADDRESS', 'WEB_ADDRESS_LINK_TEXT',
];

let daToken = null;
let rawPayload = null;
let columns = [];
let viewData = [];

function getSourceConfig() {
  const select = document.getElementById('sourceSelect');
  return SOURCE_OPTIONS.find((o) => o.value === select.value) || SOURCE_OPTIONS[0];
}

function getDataUrl(useAdmin) {
  const config = getSourceConfig();
  const base = useAdmin && daToken ? ADMIN_BASE : PUBLIC_BASE;
  const path = useAdmin && daToken ? config.adminPath : config.publicPath;
  return `${base}/${path}`;
}

function setAuthNotice(hasToken) {
  const notice = document.getElementById('authNotice');
  notice.classList.toggle('hidden', hasToken);
}

export async function initAuth() {
  try {
    const { token } = await DA_SDK;
    daToken = token || null;
    setAuthNotice(!daToken);
    return daToken;
  } catch (e) {
    setAuthNotice(true);
    return null;
  }
}

async function fetchJson(url, options = {}) {
  const headers = { ...options.headers };
  if (daToken) {
    headers.Authorization = `Bearer ${daToken}`;
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export function showError(message) {
  const el = document.getElementById('error');
  el.textContent = message;
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 6000);
}

function setLoading(active) {
  const loading = document.getElementById('loading');
  const loadBtn = document.getElementById('loadBtn');
  if (active) {
    loading.classList.add('active');
    loadBtn.disabled = true;
  } else {
    loading.classList.remove('active');
    loadBtn.disabled = false;
  }
}

function buildColumns(data) {
  if (!data || data.length === 0) {
    return SCHEMA_ORDER.filter(() => true);
  }
  const first = data[0];
  const keys = Object.keys(first).filter((k) => k !== ':type' && !k.startsWith(':'));
  const ordered = [...SCHEMA_ORDER];
  keys.forEach((k) => {
    if (!ordered.includes(k)) ordered.push(k);
  });
  return ordered.filter((k) => keys.includes(k));
}

function applySearchFilterSort() {
  const search = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  const filterCol = document.getElementById('filterColumn').value;
  const filterVal = (document.getElementById('filterValue').value || '').trim().toLowerCase();
  const sortCol = document.getElementById('sortColumn').value;
  const sortOrder = document.getElementById('sortOrder').value;

  let out = rawPayload ? [...rawPayload.data] : [];

  if (search) {
    out = out.filter((row) => {
      return columns.some((col) => {
        const v = row[col];
        return typeof v === 'string' && v.toLowerCase().includes(search);
      });
    });
  }
  if (filterCol && (filterVal || filterCol)) {
    out = out.filter((row) => {
      const v = (row[filterCol] || '').toString().trim().toLowerCase();
      return filterVal ? v.includes(filterVal) : v !== '';
    });
  }
  if (sortCol) {
    out.sort((a, b) => {
      const va = (a[sortCol] ?? '').toString();
      const vb = (b[sortCol] ?? '').toString();
      const cmp = va.localeCompare(vb, undefined, { sensitivity: 'base' });
      return sortOrder === 'desc' ? -cmp : cmp;
    });
  }

  viewData = out;
  renderTable();
  document.getElementById('recordCount').textContent = `Showing ${viewData.length} of ${rawPayload?.data?.length ?? 0} records`;
}

function renderTable() {
  const thead = document.getElementById('tableHead');
  const tbody = document.getElementById('tableBody');
  thead.innerHTML = '';
  tbody.innerHTML = '';
  if (!columns.length) return;

  const trHead = document.createElement('tr');
  trHead.appendChild(document.createElement('th')); // row action
  columns.forEach((col) => {
    const th = document.createElement('th');
    th.textContent = col;
    th.scope = 'col';
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  viewData.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.dataset.index = String(index);
    const editCell = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-edit';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openEditModal(row));
    editCell.appendChild(editBtn);
    tr.appendChild(editCell);
    columns.forEach((col) => {
      const td = document.createElement('td');
      const val = row[col];
      td.textContent = val != null ? String(val) : '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function openEditModal(row) {
  const modal = document.getElementById('editModal');
  const form = document.getElementById('editForm');
  form.innerHTML = '';
  const dataIndex = rawPayload.data.indexOf(row);
  form.dataset.dataIndex = String(dataIndex);

  columns.forEach((col) => {
    const label = document.createElement('label');
    label.htmlFor = `edit-${col}`;
    label.textContent = col;
    const input = document.createElement('input');
    input.id = `edit-${col}`;
    input.name = col;
    input.type = 'text';
    input.value = (row[col] != null ? row[col] : '');
    form.appendChild(label);
    form.appendChild(input);
  });
  modal.showModal();
}

function closeEditModal() {
  document.getElementById('editModal').close();
}

function saveEdit(e) {
  e.preventDefault();
  const form = document.getElementById('editForm');
  const dataIndex = parseInt(form.dataset.dataIndex, 10);
  if (Number.isNaN(dataIndex) || !rawPayload?.data) return;
  const row = rawPayload.data[dataIndex];
  columns.forEach((col) => {
    const input = form.querySelector(`[name="${col}"]`);
    if (input) row[col] = input.value.trim();
  });
  applySearchFilterSort();
  closeEditModal();
  if (daToken) saveToAdmin();
}

function saveToAdmin() {
  const url = getDataUrl(true);
  setLoading(true);
  fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${daToken}`,
    },
    body: JSON.stringify(rawPayload),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Save failed: ${res.status} ${res.statusText}`);
    })
    .catch((err) => {
      showError(err.message || 'Failed to save');
    })
    .finally(() => setLoading(false));
}

function fillFilterSortOptions() {
  const filterCol = document.getElementById('filterColumn');
  const sortCol = document.getElementById('sortColumn');
  const prevFilter = filterCol.value;
  const prevSort = sortCol.value;
  filterCol.innerHTML = '<option value="">—</option>';
  sortCol.innerHTML = '<option value="">—</option>';
  columns.forEach((col) => {
    const o1 = document.createElement('option');
    o1.value = col;
    o1.textContent = col;
    filterCol.appendChild(o1);
    const o2 = document.createElement('option');
    o2.value = col;
    o2.textContent = col;
    sortCol.appendChild(o2);
  });
  if (columns.includes(prevFilter)) filterCol.value = prevFilter;
  if (columns.includes(prevSort)) sortCol.value = prevSort;
}

export async function loadSource() {
  const url = getDataUrl(!!daToken);
  setLoading(true);
  document.getElementById('error').classList.remove('active');
  document.getElementById('tableSection').classList.remove('active');
  try {
    const payload = await fetchJson(url);
    if (!payload || !Array.isArray(payload.data)) {
      throw new Error('Invalid response: expected { data: [] }');
    }
    rawPayload = payload;
    columns = buildColumns(payload.data);
    fillFilterSortOptions();
    viewData = [...payload.data];
    document.getElementById('tableSection').classList.add('active');
    document.getElementById('bulkAddBtn').disabled = !daToken;
    applySearchFilterSort();
  } catch (err) {
    showError(err.message || 'Failed to load');
  } finally {
    setLoading(false);
  }
}

function parseSpreadsheet(text) {
  const lines = text.trim().split(/\r\n|\r|\n/).filter((l) => l.trim());
  if (lines.length < 2) return { header: [], rows: [] };
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const unquote = (s) => {
    const t = s.trim().replace(/\r+$/, '');
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      return t.slice(1, -1).replace(/""/g, '"');
    }
    return t;
  };
  const header = lines[0].split(sep).map(unquote);
  const rows = lines.slice(1).map((line) => {
    const raw = line.split(sep);
    const cells = raw.map(unquote);
    while (cells.length < header.length) cells.push('');
    return cells.slice(0, header.length);
  });
  return { header, rows };
}

function openBulkModal() {
  document.getElementById('bulkTextarea').value = '';
  document.getElementById('bulkModal').showModal();
}

function closeBulkModal() {
  document.getElementById('bulkModal').close();
}

function bulkImport() {
  const text = document.getElementById('bulkTextarea').value.trim();
  if (!text) {
    showError('Paste spreadsheet data first.');
    return;
  }
  const { header, rows } = parseSpreadsheet(text);
  if (!header.length || !rows.length) {
    showError('Need a header row and at least one data row.');
    return;
  }
  const headerNorm = header.map((h) => h.trim());
  const newRows = rows.map((cells) => {
    const obj = {};
    columns.forEach((col) => {
      const idx = headerNorm.findIndex((h) => h.toUpperCase() === col.toUpperCase());
      obj[col] = idx >= 0 && cells[idx] !== undefined ? String(cells[idx]).trim() : '';
    });
    return obj;
  });
  if (!rawPayload) {
    rawPayload = { total: 0, limit: 0, offset: 0, data: [], ':type': 'sheet' };
    columns = buildColumns(newRows.length ? newRows : []);
    fillFilterSortOptions();
  }
  rawPayload.data.push(...newRows);
  rawPayload.total = rawPayload.data.length;
  closeBulkModal();
  applySearchFilterSort();
  if (daToken) saveToAdmin();
}

function bindEvents() {
  document.getElementById('loadBtn').addEventListener('click', () => loadSource());
  document.getElementById('sourceSelect').addEventListener('change', () => {
    if (rawPayload) loadSource();
  });
  document.getElementById('searchInput').addEventListener('input', applySearchFilterSort);
  document.getElementById('filterColumn').addEventListener('change', applySearchFilterSort);
  document.getElementById('filterValue').addEventListener('input', applySearchFilterSort);
  document.getElementById('sortColumn').addEventListener('change', applySearchFilterSort);
  document.getElementById('sortOrder').addEventListener('change', applySearchFilterSort);
  document.getElementById('editForm').addEventListener('submit', saveEdit);
  document.getElementById('editCancelBtn').addEventListener('click', closeEditModal);
  document.getElementById('bulkAddBtn').addEventListener('click', openBulkModal);
  document.getElementById('bulkCancelBtn').addEventListener('click', closeBulkModal);
  document.getElementById('bulkImportBtn').addEventListener('click', bulkImport);
  document.getElementById('editModal').addEventListener('cancel', closeEditModal);
  document.getElementById('bulkModal').addEventListener('cancel', closeBulkModal);
}

export async function init() {
  await initAuth();
  bindEvents();
}

init();
