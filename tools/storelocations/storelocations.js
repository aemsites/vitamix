// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
/* eslint-disable no-use-before-define -- functions are used before definition in this file */

const ADMIN_BASE = 'https://admin.da.live/source/aemsites/vitamix/us/en_us/where-to-buy';
const PUBLIC_BASE = 'https://main--vitamix--aemsites.aem.live/us/en_us/where-to-buy';
const CORS_PROXY = 'https://fcors.org/?url=';
const CORS_KEY = '&key=Mg23N96GgR8O3NjU';
const GEOCODE_BASE = 'https://helix-geocode.adobeaem.workers.dev/';
const GOOGLE_MAPS_SEARCH = 'https://www.google.com/maps/search/?api=1&query=';

const ADDRESS_FIELDS = ['NAME', 'ADDRESS_1', 'ADDRESS_2', 'CITY', 'STATE_PROVINCE', 'POSTAL_CODE', 'COUNTY', 'COUNTRY'];
const META_COLUMNS = ['TYPE', 'ENABLED', 'PRODUCT FAMILY', 'START_DATE', 'END_DATE', 'NOTES', 'PRODUCT_TYPE', 'WEB_ADDRESS', 'WEB_ADDRESS_LINK_TEXT'];
const ADDRESS_COLUMNS = ['NAME', 'ADDRESS_1', 'ADDRESS_2', 'CITY', 'STATE_PROVINCE', 'POSTAL_CODE', 'COUNTY', 'COUNTRY', 'PHONE_NUMBER', 'LAT', 'LONG'];

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

const PAGE_SIZE = 100;

const DEFAULT_TYPE_OPTIONS = ['DEMO', 'DEALER/DISTRIBUTOR', 'RETAILER', 'EVENT', 'OTHER'];

let daToken = null;
let rawPayload = null;
let columns = [];
let viewData = [];
let currentPage = 1;

function getTypeOptions() {
  const fromData = rawPayload?.data
    ? [...new Set(rawPayload.data.map((r) => r.TYPE).filter(Boolean))]
    : [];
  const combined = [...new Set([...DEFAULT_TYPE_OPTIONS, ...fromData])].sort();
  return combined;
}

function toDateInputValue(str) {
  if (!str || typeof str !== 'string') return '';
  const parts = str.trim().split(/[/-]/);
  if (parts.length !== 3) return str;
  const m = parseInt(parts[0], 10);
  const d = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);
  if (Number.isNaN(m) || Number.isNaN(d) || Number.isNaN(y)) return str;
  const month = m < 10 ? `0${m}` : String(m);
  const day = d < 10 ? `0${d}` : String(d);
  let fullYear = y;
  if (y < 100) {
    fullYear = y < 50 ? 2000 + y : 1900 + y;
  }
  const year = String(fullYear);
  return `${year}-${month}-${day}`;
}

function fromDateInputValue(str) {
  if (!str || typeof str !== 'string') return '';
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return str;
  const [, y, m, d] = match;
  return `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}`;
}

function buildAddressFromForm(form) {
  const parts = ADDRESS_FIELDS.map((f) => {
    const input = form.querySelector(`[name="${f}"]`);
    return input ? (input.value || '').replace(/\s+/g, ' ').trim() : '';
  }).filter(Boolean);
  return parts.join(' ');
}

async function geocodeAddress(address) {
  if (!address || !address.trim()) return null;
  const url = `${GEOCODE_BASE}?address=${encodeURIComponent(address)}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  if (data.results && Array.isArray(data.results) && data.results.length > 0) {
    const location = data.results[0].geometry?.location;
    if (location && location.lat != null && location.lng != null) {
      return { lat: Number(location.lat), lng: Number(location.lng) };
    }
  }
  return null;
}

function isOpenedInDA() {
  try {
    return window.self !== window.top
      && typeof document.referrer === 'string'
      && document.referrer.indexOf('da.live') >= 0;
  } catch {
    return false;
  }
}

function isReadOnly() {
  return !daToken;
}

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

/** Build a stable key for a row (for diffing). */
function rowKey(row) {
  const parts = ['NAME', 'ADDRESS_1', 'CITY', 'POSTAL_CODE'].map(
    (c) => (row[c] != null ? String(row[c]).trim() : ''),
  );
  return parts.join('|\u200b');
}

/** Normalize row to a comparable string (sorted keys). */
function rowFingerprint(row) {
  const o = {};
  Object.keys(row)
    .filter((k) => k !== ':type' && !k.startsWith(':'))
    .sort()
    .forEach((k) => {
      o[k] = row[k];
    });
  return JSON.stringify(o);
}

/**
 * Compare admin (to publish) vs live data.
 * Returns { added, removed, changed, liveTotal, adminTotal }.
 */
function diffLiveVsAdmin(liveData, adminData) {
  const liveRows = Array.isArray(liveData?.data) ? liveData.data : [];
  const adminRows = Array.isArray(adminData?.data) ? adminData.data : [];
  const liveByKey = new Map();
  const adminByKey = new Map();
  liveRows.forEach((r) => liveByKey.set(rowKey(r), r));
  adminRows.forEach((r) => adminByKey.set(rowKey(r), r));

  let added = 0;
  let removed = 0;
  let changed = 0;
  const adminKeys = new Set(adminByKey.keys());
  const liveKeys = new Set(liveByKey.keys());
  adminKeys.forEach((k) => {
    if (!liveKeys.has(k)) added += 1;
    else if (rowFingerprint(adminByKey.get(k)) !== rowFingerprint(liveByKey.get(k))) changed += 1;
  });
  liveKeys.forEach((k) => {
    if (!adminKeys.has(k)) removed += 1;
  });

  return {
    added,
    removed,
    changed,
    liveTotal: liveRows.length,
    adminTotal: adminRows.length,
  };
}

/** Fetch current live JSON (PUBLIC_BASE). */
async function fetchLiveJson() {
  const url = getDataUrl(false);
  const finalUrl = CORS_PROXY + encodeURIComponent(url) + CORS_KEY;
  const res = await fetch(finalUrl);
  if (!res.ok) throw new Error(`Live fetch failed: ${res.status}`);
  return res.json();
}

/** Path for admin.hlx.page (e.g. us/en_us/where-to-buy/storelocations-hh.json) */
function getHlxPath() {
  const config = getSourceConfig();
  return `us/en_us/where-to-buy/${config.publicPath}`;
}

async function previewStorelocations(token) {
  const path = getHlxPath();
  const url = `https://admin.hlx.page/preview/aemsites/vitamix/main/${path}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`Preview failed: ${resp.status} ${resp.statusText}`);
  }
  return url;
}

async function publishStorelocations(token) {
  const path = getHlxPath();
  const url = `https://admin.hlx.page/live/aemsites/vitamix/main/${path}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`Publish failed: ${resp.status} ${resp.statusText}`);
  }
  return url;
}

function setAuthNotice() {
  const notice = document.getElementById('authNotice');
  const show = isReadOnly() && !isOpenedInDA();
  notice.classList.toggle('hidden', !show);
}

export async function initAuth() {
  try {
    const { token } = await DA_SDK;
    daToken = token || null;
    setAuthNotice();
    return daToken;
  } catch (e) {
    setAuthNotice();
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

function applySearchFilterSort(resetPage = true) {
  if (resetPage) currentPage = 1;
  const search = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  const filterCol = document.getElementById('filterColumn').value;
  const filterVal = (document.getElementById('filterValue').value || '').trim().toLowerCase();
  const sortCol = document.getElementById('sortColumn').value;
  const sortOrder = document.getElementById('sortOrder').value;

  let out = rawPayload ? [...rawPayload.data] : [];

  if (search) {
    out = out.filter((row) => columns.some((col) => {
      const v = row[col];
      return typeof v === 'string' && v.toLowerCase().includes(search);
    }));
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
  const totalFiltered = viewData.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  renderTable();
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, totalFiltered);
  document.getElementById('recordCount').textContent = totalFiltered <= PAGE_SIZE
    ? `Showing ${totalFiltered} of ${rawPayload?.data?.length ?? 0} records`
    : `Showing ${start}-${end} of ${totalFiltered} (of ${rawPayload?.data?.length ?? 0} total)`;
  renderPager(totalFiltered, totalPages);
}

function getPageSlice() {
  const start = (currentPage - 1) * PAGE_SIZE;
  return viewData.slice(start, start + PAGE_SIZE);
}

function renderPager(totalFiltered, totalPages) {
  const pager = document.getElementById('pager');
  if (totalFiltered <= PAGE_SIZE) {
    pager.classList.remove('active');
    pager.innerHTML = '';
    return;
  }
  pager.classList.add('active');
  pager.innerHTML = '';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'btn-secondary btn-page';
  prev.textContent = 'Previous';
  prev.disabled = currentPage <= 1;
  prev.addEventListener('click', () => { currentPage -= 1; applySearchFilterSort(false); });
  const span = document.createElement('span');
  span.className = 'pager-info';
  span.textContent = `Page ${currentPage} of ${totalPages}`;
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn-secondary btn-page';
  next.textContent = 'Next';
  next.disabled = currentPage >= totalPages;
  next.addEventListener('click', () => { currentPage += 1; applySearchFilterSort(false); });
  pager.append(prev, span, next);
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

  const pageRows = getPageSlice();
  pageRows.forEach((row) => {
    const tr = document.createElement('tr');
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
  const title = document.getElementById('editModalTitle');
  const deleteBtn = document.getElementById('editDeleteBtn');
  form.innerHTML = '';
  const isNew = row == null;
  const rowToEdit = isNew
    ? (() => {
      const r = columns.reduce((o, c) => ({ ...o, [c]: '' }), {});
      r.ENABLED = 'TRUE';
      r.ACTION = 'ADD';
      return r;
    })()
    : row;
  const dataIndex = isNew ? -1 : rawPayload.data.indexOf(rowToEdit);
  form.dataset.dataIndex = String(dataIndex);
  title.textContent = isNew ? 'Add new record' : 'Edit record';
  deleteBtn.style.display = isNew ? 'none' : 'inline-block';

  const typeOptions = getTypeOptions();
  const leftCols = ['ENABLED'].filter((c) => columns.includes(c))
    .concat(META_COLUMNS.filter((c) => columns.includes(c) && c !== 'ENABLED'));
  const rightCols = ADDRESS_COLUMNS.filter((c) => columns.includes(c));
  const restCols = columns.filter((c) => c !== 'ACTION' && !leftCols.includes(c) && !rightCols.includes(c));

  const wrapper = document.createElement('div');
  wrapper.className = 'edit-form-columns';
  const leftCol = document.createElement('div');
  leftCol.className = 'edit-form-col edit-form-meta';
  const rightCol = document.createElement('div');
  rightCol.className = 'edit-form-col edit-form-address';
  wrapper.appendChild(leftCol);
  wrapper.appendChild(rightCol);
  form.appendChild(wrapper);

  function addField(col, container) {
    const label = document.createElement('label');
    label.htmlFor = `edit-${col}`;
    label.textContent = col;
    if (col === 'TYPE') {
      const select = document.createElement('select');
      select.id = `edit-${col}`;
      select.name = col;
      typeOptions.forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        if (String(rowToEdit[col] || '').trim() === opt) o.selected = true;
        select.appendChild(o);
      });
      const current = (rowToEdit[col] || '').trim();
      if (current && !typeOptions.includes(current)) {
        const o = document.createElement('option');
        o.value = current;
        o.textContent = current;
        o.selected = true;
        select.insertBefore(o, select.firstChild);
      }
      container.appendChild(label);
      container.appendChild(select);
      return;
    }
    if (col === 'ENABLED') {
      const wrap = document.createElement('div');
      wrap.className = 'form-field checkbox-field';
      const input = document.createElement('input');
      input.id = `edit-${col}`;
      input.name = col;
      input.type = 'checkbox';
      input.checked = String(rowToEdit[col] || '').toUpperCase() === 'TRUE';
      wrap.appendChild(label);
      wrap.appendChild(input);
      container.appendChild(wrap);
      return;
    }
    if (col === 'START_DATE' || col === 'END_DATE') {
      const input = document.createElement('input');
      input.id = `edit-${col}`;
      input.name = col;
      input.type = 'date';
      input.value = toDateInputValue(rowToEdit[col] || '');
      container.appendChild(label);
      container.appendChild(input);
      return;
    }
    const input = document.createElement('input');
    input.id = `edit-${col}`;
    input.name = col;
    input.type = 'text';
    input.value = (rowToEdit[col] != null ? rowToEdit[col] : '');
    container.appendChild(label);
    container.appendChild(input);
  }

  leftCols.forEach((col) => {
    if (col === 'END_DATE') return;
    if (col === 'START_DATE') {
      const dateRowEl = document.createElement('div');
      dateRowEl.className = 'edit-form-row-half';
      ['START_DATE', 'END_DATE'].forEach((dateCol) => {
        const cell = document.createElement('div');
        cell.className = 'edit-form-half-cell';
        const lab = document.createElement('label');
        lab.htmlFor = `edit-${dateCol}`;
        lab.textContent = dateCol;
        const inp = document.createElement('input');
        inp.id = `edit-${dateCol}`;
        inp.name = dateCol;
        inp.type = 'date';
        inp.value = toDateInputValue(rowToEdit[dateCol] || '');
        cell.appendChild(lab);
        cell.appendChild(inp);
        dateRowEl.appendChild(cell);
      });
      leftCol.appendChild(dateRowEl);
      return;
    }
    addField(col, leftCol);
  });
  restCols.forEach((col) => addField(col, leftCol));

  const actionsSection = document.createElement('div');
  actionsSection.className = 'edit-form-actions-section';
  const actionsHeading = document.createElement('h3');
  actionsHeading.className = 'edit-form-actions-heading';
  actionsHeading.textContent = 'Actions';
  actionsSection.appendChild(actionsHeading);
  const mapsAddressBtn = document.createElement('button');
  mapsAddressBtn.type = 'button';
  mapsAddressBtn.className = 'btn-secondary btn-maps';
  mapsAddressBtn.textContent = 'View address on Google Maps';
  mapsAddressBtn.addEventListener('click', () => {
    const q = buildAddressFromForm(form);
    if (q) {
      window.open(GOOGLE_MAPS_SEARCH + encodeURIComponent(q), '_blank');
    }
  });
  actionsSection.appendChild(mapsAddressBtn);
  const geocodeBtn = document.createElement('button');
  geocodeBtn.type = 'button';
  geocodeBtn.className = 'btn-secondary btn-geocode';
  geocodeBtn.textContent = 'Geocode address';
  geocodeBtn.addEventListener('click', async () => {
    const address = buildAddressFromForm(form);
    if (!address) return;
    geocodeBtn.disabled = true;
    geocodeBtn.textContent = 'Looking up…';
    try {
      const result = await geocodeAddress(address);
      if (result) {
        const latInput = form.querySelector('[name="LAT"]');
        const lngInput = form.querySelector('[name="LONG"]');
        if (latInput) latInput.value = String(result.lat);
        if (lngInput) lngInput.value = String(result.lng);
      } else {
        showError('Geocode failed for this address.');
      }
    } finally {
      geocodeBtn.disabled = false;
      geocodeBtn.textContent = 'Geocode address';
    }
  });
  actionsSection.appendChild(geocodeBtn);
  const mapsCoordsBtn = document.createElement('button');
  mapsCoordsBtn.type = 'button';
  mapsCoordsBtn.className = 'btn-secondary btn-maps';
  mapsCoordsBtn.textContent = 'View lat/long on Google Maps';
  mapsCoordsBtn.addEventListener('click', () => {
    const latInput = form.querySelector('[name="LAT"]');
    const lngInput = form.querySelector('[name="LONG"]');
    const lat = (latInput?.value || '').trim();
    const lng = (lngInput?.value || '').trim();
    if (lat && lng) {
      window.open(GOOGLE_MAPS_SEARCH + encodeURIComponent(`${lat},${lng}`), '_blank');
    }
  });
  actionsSection.appendChild(mapsCoordsBtn);
  leftCol.appendChild(actionsSection);

  rightCols.forEach((col) => {
    if (col === 'COUNTRY') {
      addField(col, rightCol);
      if (columns.includes('PHONE_NUMBER')) {
        addField('PHONE_NUMBER', rightCol);
      }
    } else if (col === 'LONG') {
      // skip LONG (handled with LAT in same row)
    } else if (col === 'LAT') {
      const latLongRowEl = document.createElement('div');
      latLongRowEl.className = 'edit-form-row-half';
      ['LAT', 'LONG'].forEach((coordCol) => {
        const cell = document.createElement('div');
        cell.className = 'edit-form-half-cell';
        const lab = document.createElement('label');
        lab.htmlFor = `edit-${coordCol}`;
        lab.textContent = coordCol;
        const inp = document.createElement('input');
        inp.id = `edit-${coordCol}`;
        inp.name = coordCol;
        inp.type = 'text';
        inp.value = (rowToEdit[coordCol] != null ? rowToEdit[coordCol] : '');
        cell.appendChild(lab);
        cell.appendChild(inp);
        latLongRowEl.appendChild(cell);
      });
      rightCol.appendChild(latLongRowEl);
    } else if (col !== 'PHONE_NUMBER') {
      addField(col, rightCol);
    }
  });

  modal.showModal();
}

function closeEditModal() {
  document.getElementById('editModal').close();
}

function deleteCurrentRecord() {
  const form = document.getElementById('editForm');
  const dataIndex = parseInt(form.dataset.dataIndex, 10);
  if (dataIndex < 0 || !rawPayload?.data || dataIndex >= rawPayload.data.length) return;
  // eslint-disable-next-line no-alert -- intentional confirm for destructive action
  if (!window.confirm('Delete this record?')) return;
  rawPayload.data.splice(dataIndex, 1);
  rawPayload.total = rawPayload.data.length;
  closeEditModal();
  applySearchFilterSort();
  if (daToken) {
    saveToAdmin();
  } else {
    showError('Sign in via DA to save changes.');
  }
}

function saveEdit(e) {
  e.preventDefault();
  const form = document.getElementById('editForm');
  const dataIndex = parseInt(form.dataset.dataIndex, 10);
  if (!rawPayload?.data) return;
  const row = dataIndex >= 0 ? rawPayload.data[dataIndex] : columns.reduce((o, c) => ({ ...o, [c]: '' }), {});
  columns.forEach((col) => {
    const input = form.querySelector(`[name="${col}"]`);
    if (!input) return;
    if (col === 'ENABLED') {
      row[col] = input.checked ? 'TRUE' : 'FALSE';
      return;
    }
    if (col === 'START_DATE' || col === 'END_DATE') {
      const val = (input.value || '').trim();
      row[col] = val ? fromDateInputValue(val) : '';
      return;
    }
    row[col] = (input.value || '').trim();
  });
  if (dataIndex < 0) {
    rawPayload.data.push(row);
    rawPayload.total = rawPayload.data.length;
  }
  applySearchFilterSort();
  closeEditModal();
  if (daToken) {
    saveToAdmin();
  } else {
    showError('Sign in via DA to save changes.');
  }
}

function saveToAdmin() {
  const url = getDataUrl(true);
  setLoading(true);

  const body = new FormData();
  const data = new Blob([JSON.stringify(rawPayload)], { type: 'application/json' });
  body.append('data', data);

  fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${daToken}`,
    },
    body,
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Save failed: ${res.status} ${res.statusText}`);
    })
    .catch((err) => {
      showError(err.message || 'Failed to save');
    })
    .finally(() => setLoading(false));
}

function renderPublishSummary(diff) {
  const {
    added, removed, changed, liveTotal, adminTotal,
  } = diff;
  const parts = [];
  parts.push(`<p><strong>Live</strong> (current): ${liveTotal} record(s).</p>`);
  parts.push(`<p><strong>Admin</strong> (to publish): ${adminTotal} record(s).</p>`);
  if (added || removed || changed) {
    parts.push('<ul class="publish-diff-list">');
    if (added) parts.push(`<li>${added} added</li>`);
    if (removed) parts.push(`<li>${removed} removed</li>`);
    if (changed) parts.push(`<li>${changed} updated</li>`);
    parts.push('</ul>');
  } else {
    parts.push('<p class="publish-no-changes">No content changes.</p>');
  }
  return parts.join('');
}

function closePublishModal() {
  document.getElementById('publishModal').close();
}

async function openPublishModal() {
  if (!daToken) {
    showError('Sign in via DA to publish.');
    return;
  }
  const summaryEl = document.getElementById('publishSummary');
  const modal = document.getElementById('publishModal');
  summaryEl.innerHTML = '<p>Comparing live vs admin…</p>';
  modal.showModal();

  let livePayload;
  try {
    livePayload = await fetchLiveJson();
  } catch (e) {
    summaryEl.innerHTML = `<p class="publish-error">Could not load live data: ${e.message}</p>`;
    return;
  }

  const diff = diffLiveVsAdmin(livePayload, rawPayload);
  summaryEl.innerHTML = renderPublishSummary(diff);
}

async function runPublish() {
  if (!daToken) {
    showError('Sign in via DA to publish.');
    return;
  }
  closePublishModal();
  const btn = document.getElementById('publishBtn');
  btn.disabled = true;
  setLoading(true);
  try {
    await previewStorelocations(daToken);
    await publishStorelocations(daToken);
  } catch (e) {
    showError(e.message || 'Publish failed');
  } finally {
    setLoading(false);
    btn.disabled = false;
  }
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
  let url = getDataUrl(!!daToken);
  if (isReadOnly()) {
    url = CORS_PROXY + encodeURIComponent(url) + CORS_KEY;
  }
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
    document.getElementById('bulkAddBtn').disabled = false;
    document.getElementById('addNewBtn').disabled = false;
    document.getElementById('publishBtn').disabled = false;
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
    rawPayload = {
      total: 0,
      limit: 0,
      offset: 0,
      data: [],
      ':type': 'sheet',
    };
    columns = buildColumns(newRows.length ? newRows : []);
    fillFilterSortOptions();
  }
  rawPayload.data.push(...newRows);
  rawPayload.total = rawPayload.data.length;
  closeBulkModal();
  applySearchFilterSort();
  if (daToken) {
    saveToAdmin();
  } else {
    showError('Sign in via DA to save changes.');
  }
}

function bindEvents() {
  document.getElementById('loadBtn').addEventListener('click', () => loadSource());
  document.getElementById('publishBtn').addEventListener('click', openPublishModal);
  document.getElementById('publishCancelBtn').addEventListener('click', closePublishModal);
  document.getElementById('publishConfirmBtn').addEventListener('click', runPublish);
  document.getElementById('publishModal').addEventListener('cancel', closePublishModal);
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
  document.getElementById('editDeleteBtn').addEventListener('click', deleteCurrentRecord);
  document.getElementById('addNewBtn').addEventListener('click', () => openEditModal(null));
  document.getElementById('bulkAddBtn').addEventListener('click', openBulkModal);
  document.getElementById('bulkCancelBtn').addEventListener('click', closeBulkModal);
  document.getElementById('bulkImportBtn').addEventListener('click', bulkImport);
  document.getElementById('editModal').addEventListener('cancel', closeEditModal);
  document.getElementById('bulkModal').addEventListener('cancel', closeBulkModal);
}

export async function init() {
  bindEvents();
  await initAuth();
}

init();
