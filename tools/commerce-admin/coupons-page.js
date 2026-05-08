/**
 * Coupons — ProductBus: coupons (types) at …/coupons/types; codes at …/coupons; batch at …/coupons/batch.
 * UI speaks in “coupon” / “code”; navigation is anchored on the selected coupon.
 */
import { apiFetch } from './commerce-otp-api.js';
import { PB_ORG, PB_SITE } from './commerce-pbus-config.js';
import { escapeHtml, showToast } from './commerce-otp-ui.js';

async function readRespError(resp) {
  return resp.headers.get('x-error')
    || (await resp.text().catch(() => '')).trim()
    || `HTTP ${resp.status}`;
}

function asArray(data, keys) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const k of keys) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

/** Coupon id from a list row (API “coupon type”). */
function couponIdFromRow(row) {
  if (!row || typeof row !== 'object') return '';
  return String(row.id ?? row.typeId ?? '').trim();
}

const state = {
  coupons: [],
  selectedCouponId: '',
  couponDetail: null,
  codes: [],
  /** Cursor from the last list response; used for “Next page” requests. */
  codesNextCursor: '',
};

function setError(msg) {
  const el = document.getElementById('coupons-error');
  if (!el) return;
  if (msg) {
    el.hidden = false;
    el.textContent = msg;
  } else {
    el.hidden = true;
    el.textContent = '';
  }
}

function yn(v) {
  if (v === true || v === 'true' || v === 1) return 'Yes';
  if (v === false || v === 'false' || v === 0) return 'No';
  return '—';
}

function renderCouponRulesHuman(d) {
  if (!d || typeof d !== 'object') return '';
  let discountLine = '—';
  if (d.discountType === 'fixed' && d.discountValue != null) {
    discountLine = `$${d.discountValue} off the order`;
  } else if (d.discountType === 'percentage' && d.discountValue != null) {
    discountLine = `${d.discountValue}% off the order`;
  } else if (d.discountType) {
    discountLine = `${d.discountType}: ${d.discountValue ?? '—'}`;
  }
  const cats = Array.isArray(d.excludedCategories) && d.excludedCategories.length
    ? d.excludedCategories.join(', ')
    : 'None';
  const min = d.minimumOrderAmount != null && d.minimumOrderAmount !== ''
    ? `$${Number(d.minimumOrderAmount).toFixed(2)}`
    : 'None';
  const cap = d.maximumDiscountAmount != null && d.maximumDiscountAmount !== ''
    ? `$${Number(d.maximumDiscountAmount).toFixed(2)}`
    : 'No cap';
  const rows = [
    ['Coupon ID', d.id ?? '—'],
    ['Display name', d.name ?? '—'],
    ['Discount', discountLine],
    ['Minimum order subtotal', min],
    ['Maximum discount (cap)', cap],
    ['Also grants free shipping', yn(d.freeShipping)],
    ['Excluded category slugs', cats],
    ['Stacks with auto pricing rules', yn(d.stackable !== false)],
    ['Auto-apply (storefront hint)', yn(d.autoApply)],
    ['Customers can type this code', yn(d.allowManualEntry !== false)],
    ['Default usage limit (codes)', d.defaultUsageLimit ?? '—'],
    ['Default uses per code', d.defaultUsesPerCode ?? '—'],
    ['Internal notes', d.notes && String(d.notes).trim() ? d.notes : '—'],
  ];
  return `<dl class="coupons-rule-dl">${rows.map(([dt, dd]) => `
    <div><dt>${escapeHtml(dt)}</dt><dd>${escapeHtml(String(dd))}</dd></div>
  `).join('')}</dl>`;
}

async function fetchCouponList() {
  const resp = await apiFetch(PB_ORG, PB_SITE, 'coupons/types', { method: 'GET' });
  if (!resp.ok) throw new Error(await readRespError(resp));
  const data = await resp.json();
  state.coupons = asArray(data, ['types', 'items', 'data', 'results', 'coupons']);
}

async function fetchCouponDetail(id) {
  if (!id) {
    state.couponDetail = null;
    return;
  }
  const resp = await apiFetch(PB_ORG, PB_SITE, `coupons/types/${encodeURIComponent(id)}`, { method: 'GET' });
  if (!resp.ok) throw new Error(await readRespError(resp));
  state.couponDetail = await resp.json();
}

async function fetchCodesForCoupon({ append } = {}) {
  if (!state.selectedCouponId) {
    state.codes = [];
    state.codesNextCursor = '';
    return;
  }
  const cursorParam = append ? state.codesNextCursor : '';
  if (append && !cursorParam) return;
  const qs = new URLSearchParams();
  qs.set('type', state.selectedCouponId);
  qs.set('limit', '100');
  if (cursorParam) qs.set('cursor', cursorParam);
  const resp = await apiFetch(PB_ORG, PB_SITE, `coupons?${qs.toString()}`, { method: 'GET' });
  if (!resp.ok) throw new Error(await readRespError(resp));
  const data = await resp.json();
  const batch = asArray(data, ['codes', 'items', 'data', 'results']);
  const next = data && typeof data === 'object' && data.cursor ? String(data.cursor) : '';
  if (append) {
    state.codes = [...state.codes, ...batch];
  } else {
    state.codes = batch;
  }
  state.codesNextCursor = next;
}

async function refreshSelection() {
  if (state.selectedCouponId) {
    await fetchCouponDetail(state.selectedCouponId);
    state.codes = [];
    state.codesNextCursor = '';
  } else {
    state.couponDetail = null;
    state.codes = [];
    state.codesNextCursor = '';
  }
}

async function refreshCouponList() {
  await fetchCouponList();
  if (state.selectedCouponId) {
    const still = state.coupons.some((c) => couponIdFromRow(c) === state.selectedCouponId);
    if (!still) state.selectedCouponId = couponIdFromRow(state.coupons[0]) || '';
  } else if (state.coupons.length) {
    state.selectedCouponId = couponIdFromRow(state.coupons[0]);
  }
  await refreshSelection();
}

function openDialog(title, innerHtml, onSubmit, afterMount, dialogClass) {
  const dialog = document.createElement('dialog');
  dialog.className = `coupons-dialog${dialogClass ? ` ${dialogClass}` : ''}`;
  dialog.innerHTML = `
    <div class="coupons-dialog-inner">
      <h2>${escapeHtml(title)}</h2>
      ${innerHtml}
      <div class="coupons-dialog-actions">
        <button type="button" class="coupons-btn" data-cp-cancel>Cancel</button>
        <button type="button" class="coupons-btn coupons-btn-primary" data-cp-submit>Save</button>
      </div>
    </div>`;
  document.body.appendChild(dialog);
  if (typeof afterMount === 'function') afterMount(dialog);
  dialog.querySelector('[data-cp-cancel]')?.addEventListener('click', () => {
    dialog.close();
    dialog.remove();
  });
  dialog.querySelector('[data-cp-submit]')?.addEventListener('click', async () => {
    try {
      await onSubmit(dialog);
      dialog.close();
      dialog.remove();
    } catch (err) {
      showToast(err.message || 'Request failed', 'error');
    }
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      dialog.close();
      dialog.remove();
    }
  });
  dialog.showModal();
}

function couponFormHtml({ idReadonly }) {
  return `
    <p class="coupons-page-lead" style="margin-bottom:12px">Describe how this coupon behaves. Amounts are in storefront currency unless noted otherwise.</p>
    <div class="coupons-form-grid">
      <div class="coupons-field coupons-field-full">
        <label for="cp-form-id">Coupon ID <span style="font-weight:400;color:#6d7175">(slug, e.g. friends-and-family)</span></label>
        <input type="text" id="cp-form-id" autocomplete="off" ${idReadonly ? 'readonly class="coupons-readonly"' : ''} required />
      </div>
      <div class="coupons-field coupons-field-full">
        <label for="cp-form-name">Display name</label>
        <input type="text" id="cp-form-name" autocomplete="off" required />
      </div>
      <div class="coupons-field">
        <label for="cp-form-discount-type">Discount style</label>
        <select id="cp-form-discount-type">
          <option value="percentage">Percentage off order</option>
          <option value="fixed">Fixed dollars off order</option>
        </select>
      </div>
      <div class="coupons-field">
        <label for="cp-form-discount-value">Discount value</label>
        <input type="number" id="cp-form-discount-value" min="0" step="any" placeholder="25 = 25% or $25" required />
      </div>
      <div class="coupons-field">
        <label for="cp-form-min">Minimum order subtotal ($)</label>
        <input type="number" id="cp-form-min" min="0" step="any" placeholder="0 = none" />
      </div>
      <div class="coupons-field">
        <label for="cp-form-max-cap">Max discount cap ($)</label>
        <input type="number" id="cp-form-max-cap" min="0" step="any" placeholder="empty = no cap" />
      </div>
      <div class="coupons-field coupons-field-full">
        <label for="cp-form-excluded">Excluded category slugs</label>
        <input type="text" id="cp-form-excluded" placeholder="sale, outlet — comma separated" />
      </div>
      <div class="coupons-field coupons-field-full">
        <label class="coupons-checkbox-row"><input type="checkbox" id="cp-form-free-ship" /> Also grants <strong>free shipping</strong> when the coupon applies</label>
      </div>
      <div class="coupons-field coupons-field-full">
        <label class="coupons-checkbox-row"><input type="checkbox" id="cp-form-stackable" checked /> Allow stacking with automatic pricing rules</label>
      </div>
      <div class="coupons-field coupons-field-full">
        <label class="coupons-checkbox-row"><input type="checkbox" id="cp-form-auto" /> Auto-apply hint (e.g. affiliate URL)</label>
      </div>
      <div class="coupons-field coupons-field-full">
        <label class="coupons-checkbox-row"><input type="checkbox" id="cp-form-manual" checked /> Customers may enter a code manually at checkout</label>
      </div>
      <div class="coupons-field">
        <label for="cp-form-def-limit">Default usage limit (total uses per code)</label>
        <input type="number" id="cp-form-def-limit" min="0" step="1" placeholder="empty = unlimited" />
      </div>
      <div class="coupons-field">
        <label for="cp-form-def-per-code">Default uses per code</label>
        <input type="number" id="cp-form-def-per-code" min="0" step="1" placeholder="empty = unlimited" />
      </div>
      <div class="coupons-field coupons-field-full">
        <label for="cp-form-notes">Notes (internal)</label>
        <textarea id="cp-form-notes" rows="2" placeholder="Shown only in admin"></textarea>
      </div>
    </div>`;
}

function readOptionalInt(raw) {
  const t = String(raw ?? '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function readCouponBodyFromForm(dlg, { requireId }) {
  const id = dlg.querySelector('#cp-form-id')?.value?.trim();
  const name = dlg.querySelector('#cp-form-name')?.value?.trim();
  if (requireId && !id) throw new Error('Coupon ID is required');
  if (!name) throw new Error('Display name is required');
  const discountType = dlg.querySelector('#cp-form-discount-type')?.value || 'percentage';
  const discountValRaw = dlg.querySelector('#cp-form-discount-value')?.value;
  const discountValue = Number(discountValRaw);
  if (!Number.isFinite(discountValue) || discountValue < 0) throw new Error('Discount value must be a valid number');
  const minRaw = dlg.querySelector('#cp-form-min')?.value;
  const minimumOrderAmount = minRaw != null && String(minRaw).trim() !== '' ? Number(minRaw) : 0;
  const maxCap = readOptionalInt(dlg.querySelector('#cp-form-max-cap')?.value);
  const excludedRaw = dlg.querySelector('#cp-form-excluded')?.value || '';
  const excludedCategories = excludedRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const freeShipping = !!dlg.querySelector('#cp-form-free-ship')?.checked;
  const stackable = !!dlg.querySelector('#cp-form-stackable')?.checked;
  const autoApply = !!dlg.querySelector('#cp-form-auto')?.checked;
  const allowManualEntry = !!dlg.querySelector('#cp-form-manual')?.checked;
  const defaultUsageLimit = readOptionalInt(dlg.querySelector('#cp-form-def-limit')?.value);
  const defaultUsesPerCode = readOptionalInt(dlg.querySelector('#cp-form-def-per-code')?.value);
  const notes = dlg.querySelector('#cp-form-notes')?.value?.trim() || '';

  const body = {
    id: id || state.selectedCouponId,
    name,
    discountType,
    discountValue,
    minimumOrderAmount: Number.isFinite(minimumOrderAmount) ? minimumOrderAmount : 0,
    maximumDiscountAmount: maxCap,
    freeShipping,
    excludedCategories,
    stackable,
    autoApply,
    allowManualEntry,
    defaultUsageLimit,
    defaultUsesPerCode,
    notes,
  };
  return body;
}

function fillCouponForm(dlg, d) {
  if (!d) return;
  const idEl = dlg.querySelector('#cp-form-id');
  if (idEl) idEl.value = d.id ?? '';
  dlg.querySelector('#cp-form-name').value = d.name ?? '';
  dlg.querySelector('#cp-form-discount-type').value = d.discountType === 'fixed' ? 'fixed' : 'percentage';
  dlg.querySelector('#cp-form-discount-value').value = d.discountValue != null ? String(d.discountValue) : '';
  dlg.querySelector('#cp-form-min').value = d.minimumOrderAmount != null ? String(d.minimumOrderAmount) : '';
  dlg.querySelector('#cp-form-max-cap').value = d.maximumDiscountAmount != null ? String(d.maximumDiscountAmount) : '';
  dlg.querySelector('#cp-form-excluded').value = Array.isArray(d.excludedCategories) ? d.excludedCategories.join(', ') : '';
  dlg.querySelector('#cp-form-free-ship').checked = !!d.freeShipping;
  dlg.querySelector('#cp-form-stackable').checked = d.stackable !== false;
  dlg.querySelector('#cp-form-auto').checked = !!d.autoApply;
  dlg.querySelector('#cp-form-manual').checked = d.allowManualEntry !== false;
  dlg.querySelector('#cp-form-def-limit').value = d.defaultUsageLimit != null ? String(d.defaultUsageLimit) : '';
  dlg.querySelector('#cp-form-def-per-code').value = d.defaultUsesPerCode != null ? String(d.defaultUsesPerCode) : '';
  dlg.querySelector('#cp-form-notes').value = d.notes ?? '';
}

function openNewCouponDialog() {
  openDialog(
    'New coupon',
    couponFormHtml({ idReadonly: false }),
    async (dlg) => {
      const body = readCouponBodyFromForm(dlg, { requireId: true });
      const resp = await apiFetch(PB_ORG, PB_SITE, 'coupons/types', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(await readRespError(resp));
      showToast('Coupon created', 'success');
      state.selectedCouponId = body.id;
      await refreshCouponList();
      render();
    },
    (dlg) => {
      dlg.querySelector('#cp-form-stackable').checked = true;
      dlg.querySelector('#cp-form-manual').checked = true;
    },
    'coupons-dialog-wide',
  );
}

function openEditCouponDialog() {
  if (!state.couponDetail) return;
  const snap = { ...state.couponDetail };
  openDialog(
    'Edit coupon',
    couponFormHtml({ idReadonly: true }),
    async (dlg) => {
      const body = readCouponBodyFromForm(dlg, { requireId: false });
      const resp = await apiFetch(
        PB_ORG,
        PB_SITE,
        `coupons/types/${encodeURIComponent(state.selectedCouponId)}`,
        { method: 'PUT', body: JSON.stringify(body) },
      );
      if (!resp.ok) throw new Error(await readRespError(resp));
      showToast('Coupon updated', 'success');
      await refreshSelection();
      render();
    },
    (dlg) => fillCouponForm(dlg, snap),
    'coupons-dialog-wide',
  );
}

function openAddCodeDialog() {
  if (!state.selectedCouponId) return;
  openDialog(
    'New code for this coupon',
    `<p class="coupons-page-lead" style="margin-bottom:10px">Codes are stored for coupon <strong>${escapeHtml(state.selectedCouponId)}</strong>.</p>
     <div class="coupons-form-grid">
       <div class="coupons-field coupons-field-full">
         <label for="cp-code-val">Code</label>
         <input type="text" id="cp-code-val" autocomplete="off" placeholder="FAF-APR2026" required />
       </div>
       <div class="coupons-field">
         <label for="cp-code-exp">Expires</label>
         <input type="datetime-local" id="cp-code-exp" />
       </div>
       <div class="coupons-field">
         <label for="cp-code-limit">Total use limit</label>
         <input type="number" id="cp-code-limit" min="0" step="1" placeholder="empty = unlimited" />
       </div>
       <div class="coupons-field">
         <label for="cp-code-per-cust">Uses per customer</label>
         <input type="number" id="cp-code-per-cust" min="0" step="1" placeholder="empty = unlimited" />
       </div>
     </div>`,
    async (dlg) => {
      const code = dlg.querySelector('#cp-code-val')?.value?.trim();
      if (!code) throw new Error('Code is required');
      const typeId = state.selectedCouponId;
      const body = { code, typeId };
      const expLocal = dlg.querySelector('#cp-code-exp')?.value;
      if (expLocal) {
        const iso = new Date(expLocal).toISOString();
        if (!Number.isNaN(Date.parse(iso))) body.expiresAt = iso;
      }
      const lim = readOptionalInt(dlg.querySelector('#cp-code-limit')?.value);
      if (lim != null) body.usageLimit = lim;
      const upc = readOptionalInt(dlg.querySelector('#cp-code-per-cust')?.value);
      if (upc != null) body.usesPerCustomer = upc;
      const resp = await apiFetch(PB_ORG, PB_SITE, 'coupons', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(await readRespError(resp));
      showToast('Code created', 'success');
      await fetchCodesForCoupon();
      render();
    },
    null,
    null,
  );
}

function openBatchDialog() {
  if (!state.selectedCouponId) return;
  openDialog(
    'Generate batch of codes',
    `<p class="coupons-page-lead" style="margin-bottom:10px">Creates many unique codes for <strong>${escapeHtml(state.selectedCouponId)}</strong> (<code>POST …/coupons/batch</code>).</p>
     <div class="coupons-form-grid">
       <div class="coupons-field">
         <label for="cp-b-count">How many codes</label>
         <input type="number" id="cp-b-count" min="1" max="10000" value="50" required />
       </div>
       <div class="coupons-field">
         <label for="cp-b-prefix">Prefix</label>
         <input type="text" id="cp-b-prefix" placeholder="AFF" maxlength="32" required />
       </div>
       <div class="coupons-field">
         <label for="cp-b-exp">Expires</label>
         <input type="datetime-local" id="cp-b-exp" />
       </div>
       <div class="coupons-field">
         <label for="cp-b-limit">Total uses per code</label>
         <input type="number" id="cp-b-limit" min="0" step="1" placeholder="empty = unlimited" />
       </div>
       <div class="coupons-field">
         <label for="cp-b-per-cust">Uses per customer</label>
         <input type="number" id="cp-b-per-cust" min="0" step="1" placeholder="empty = unlimited" />
       </div>
       <div class="coupons-field coupons-field-full">
         <label class="coupons-checkbox-row"><input type="checkbox" id="cp-b-override" /> Different discount than the coupon default (override)</label>
       </div>
       <div class="coupons-field" id="cp-b-ov-type-wrap" style="display:none">
         <label for="cp-b-ov-type">Override style</label>
         <select id="cp-b-ov-type"><option value="percentage">Percentage</option><option value="fixed">Fixed $</option></select>
       </div>
       <div class="coupons-field" id="cp-b-ov-val-wrap" style="display:none">
         <label for="cp-b-ov-val">Override value</label>
         <input type="number" id="cp-b-ov-val" min="0" step="any" />
       </div>
     </div>`,
    async (dlg) => {
      const count = Number(dlg.querySelector('#cp-b-count')?.value);
      const prefix = dlg.querySelector('#cp-b-prefix')?.value?.trim();
      if (!Number.isFinite(count) || count < 1) throw new Error('Count must be at least 1');
      if (!prefix) throw new Error('Prefix is required');
      const body = {
        typeId: state.selectedCouponId,
        count: Math.floor(count),
        prefix,
      };
      const expLocal = dlg.querySelector('#cp-b-exp')?.value;
      if (expLocal) {
        const iso = new Date(expLocal).toISOString();
        if (!Number.isNaN(Date.parse(iso))) body.expiresAt = iso;
      }
      const lim = readOptionalInt(dlg.querySelector('#cp-b-limit')?.value);
      if (lim != null) body.usageLimit = lim;
      const upc = readOptionalInt(dlg.querySelector('#cp-b-per-cust')?.value);
      if (upc != null) body.usesPerCustomer = upc;
      if (dlg.querySelector('#cp-b-override')?.checked) {
        const dt = dlg.querySelector('#cp-b-ov-type')?.value || 'percentage';
        const dv = Number(dlg.querySelector('#cp-b-ov-val')?.value);
        if (!Number.isFinite(dv)) throw new Error('Override value required when override is checked');
        body.discountOverride = { discountType: dt, discountValue: dv };
      }
      const resp = await apiFetch(PB_ORG, PB_SITE, 'coupons/batch', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(await readRespError(resp));
      showToast('Batch created', 'success');
      await fetchCodesForCoupon();
      render();
    },
    (dlg) => {
      const cb = dlg.querySelector('#cp-b-override');
      const tw = dlg.querySelector('#cp-b-ov-type-wrap');
      const vw = dlg.querySelector('#cp-b-ov-val-wrap');
      const sync = () => {
        const on = !!cb?.checked;
        if (tw) tw.style.display = on ? '' : 'none';
        if (vw) vw.style.display = on ? '' : 'none';
      };
      cb?.addEventListener('change', sync);
      sync();
    },
    'coupons-dialog-wide',
  );
}

function renderCodesSection() {
  if (!state.selectedCouponId) {
    return '<p class="coupons-empty">Select a coupon to load its codes.</p>';
  }
  const rows = state.codes.length
    ? state.codes.map((c) => {
      const code = escapeHtml(c.code ?? c.id ?? '—');
      const active = c.active !== false && c.active !== 'false';
      const usage = `${c.usageCount ?? '—'} / ${c.usageLimit ?? '∞'}`;
      const exp = c.expiresAt ? escapeHtml(String(c.expiresAt)) : '—';
      return `<tr><td><code>${code}</code></td><td>${active ? 'Yes' : 'No'}</td><td>${escapeHtml(String(usage))}</td><td>${exp}</td></tr>`;
    }).join('')
    : '<tr><td colspan="4" class="coupons-empty" style="padding:16px">No codes loaded yet — use <strong>Load codes</strong>.</td></tr>';

  return `
    <h3 class="coupons-section-title">Codes for this coupon</h3>
    <div class="coupons-detail-actions">
      <button type="button" class="coupons-btn coupons-btn-primary" data-cp-load-codes>Load codes</button>
      <button type="button" class="coupons-btn" data-cp-add-code>New code</button>
      <button type="button" class="coupons-btn" data-cp-batch>Generate batch</button>
      ${state.codesNextCursor ? '<button type="button" class="coupons-btn" data-cp-next-codes>Next page</button>' : ''}
    </div>
    <div class="coupons-table-wrap">
      <table class="coupons-data-table">
        <thead><tr><th>Code</th><th>Active</th><th>Usage</th><th>Expires</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function bindCodesEvents(mount) {
  mount.querySelector('[data-cp-load-codes]')?.addEventListener('click', async () => {
    try {
      await fetchCodesForCoupon();
      setError('');
      render();
    } catch (err) {
      showToast(err.message || 'Failed to load codes', 'error');
    }
  });
  mount.querySelector('[data-cp-next-codes]')?.addEventListener('click', async () => {
    if (!state.codesNextCursor) return;
    try {
      await fetchCodesForCoupon({ append: true });
      render();
    } catch (err) {
      showToast(err.message || 'Failed', 'error');
    }
  });
  mount.querySelector('[data-cp-add-code]')?.addEventListener('click', () => openAddCodeDialog());
  mount.querySelector('[data-cp-batch]')?.addEventListener('click', () => openBatchDialog());
}

function render() {
  const mount = document.getElementById('coupons-mount');
  if (!mount) return;

  const listItems = state.coupons.length
    ? state.coupons.map((row) => {
      const id = couponIdFromRow(row);
      const name = row.name || id || '—';
      const cur = id === state.selectedCouponId ? 'true' : 'false';
      return `<li><button type="button" aria-current="${cur}" data-cp-coupon-id="${escapeHtml(id)}">${escapeHtml(name)} <span class="coupons-coupon-slug">${escapeHtml(id || '—')}</span></button></li>`;
    }).join('')
    : '<li class="coupons-empty">No coupons yet (empty list or missing <code>coupons:read</code>).</li>';

  const detailBlock = state.couponDetail
    ? `${renderCouponRulesHuman(state.couponDetail)}
       <details class="coupons-advanced"><summary>Advanced: raw JSON</summary>
       <pre class="coupons-pre" style="margin-top:8px">${escapeHtml(JSON.stringify(state.couponDetail, null, 2))}</pre></details>`
    : '<p class="coupons-empty">Select a coupon from the list.</p>';

  mount.innerHTML = `
    <div class="coupons-split">
      <div>
        <p class="coupons-sidebar-head">Coupons</p>
        <div class="coupons-detail-actions">
          <button type="button" class="coupons-btn coupons-btn-primary" data-cp-reload-all>Reload</button>
          <button type="button" class="coupons-btn" data-cp-new>New coupon…</button>
        </div>
        <ul class="coupons-coupon-list" aria-label="Coupons">${listItems}</ul>
      </div>
      <div class="coupons-detail">
        <div class="coupons-detail-actions">
          <button type="button" class="coupons-btn" data-cp-edit ${state.selectedCouponId ? '' : 'disabled'}>Edit coupon…</button>
          <button type="button" class="coupons-btn" data-cp-del ${state.selectedCouponId ? '' : 'disabled'}>Delete coupon</button>
        </div>
        <h2 class="coupons-section-title" style="margin-top:0;border:none;padding:0">Rules</h2>
        ${detailBlock}
        ${state.selectedCouponId ? renderCodesSection() : ''}
      </div>
    </div>`;

  mount.querySelector('[data-cp-reload-all]')?.addEventListener('click', async () => {
    try {
      await refreshCouponList();
      setError('');
      render();
    } catch (err) {
      showToast(err.message || 'Reload failed', 'error');
    }
  });

  mount.querySelector('[data-cp-new]')?.addEventListener('click', () => openNewCouponDialog());

  mount.querySelectorAll('[data-cp-coupon-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-cp-coupon-id') || '';
      if (!id || id === state.selectedCouponId) return;
      state.selectedCouponId = id;
      try {
        await refreshSelection();
        setError('');
        render();
      } catch (err) {
        showToast(err.message || 'Failed to load coupon', 'error');
      }
    });
  });

  mount.querySelector('[data-cp-edit]')?.addEventListener('click', () => openEditCouponDialog());

  mount.querySelector('[data-cp-del]')?.addEventListener('click', async () => {
    if (!state.selectedCouponId) return;
    if (!window.confirm(`Delete coupon "${state.selectedCouponId}"? This does not delete codes in R2 until the API does.`)) return;
    try {
      const resp = await apiFetch(
        PB_ORG,
        PB_SITE,
        `coupons/types/${encodeURIComponent(state.selectedCouponId)}`,
        { method: 'DELETE' },
      );
      if (!resp.ok) throw new Error(await readRespError(resp));
      showToast('Coupon deleted', 'success');
      state.selectedCouponId = '';
      state.couponDetail = null;
      state.codes = [];
      await refreshCouponList();
      render();
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    }
  });

  if (state.selectedCouponId) bindCodesEvents(mount);
}

async function init() {
  const mount = document.getElementById('coupons-mount');
  if (!mount) return;
  try {
    await refreshCouponList();
    setError('');
    render();
  } catch (err) {
    setError(err.message || 'Failed to load coupons');
    mount.innerHTML = `<p class="coupons-empty">Fix the error above or confirm your token includes <code>coupons:read</code>, then reload.</p>`;
  }
}

init();
