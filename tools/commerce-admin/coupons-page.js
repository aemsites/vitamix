/**
 * Coupons — ProductBus: types at …/coupons/types; codes at …/coupons;
 * batch at …/coupons/batch. UI: “coupon” / “code”; nav on selected coupon.
 */
/* eslint-disable no-use-before-define, no-console */
// render, bindCodesEvents, and open* dialogs reference each other.
// console: intentional debug logs for ProductBus coupon API failures.
import { apiFetch, getApiEnvironment, getAuthState } from './commerce-otp-api.js';
import { waitForCommerceAuthReady } from './commerce-wait-auth-ready.js';
import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';
import { createDetailModalHeaderShell } from './commerce-detail-modal-json.js';
import { mountPromoteProductionInToolbar } from './commerce-promote-production.js';
import { PB_ORG, PB_SITE } from './commerce-pbus-config.js';
import {
  commerceGroupBadgeHtml,
  commerceMarketEmojiHtml,
  escapeHtml,
  showToast,
} from './commerce-otp-ui.js';

async function readRespError(resp) {
  return resp.headers.get('x-error')
    || (await resp.text().catch(() => '')).trim()
    || `HTTP ${resp.status}`;
}

/** Decoded coupon type id when `path` is `coupons/types/{segment}`. */
function decodeTypeIdFromCouponsTypesPath(path) {
  const m = String(path).match(/^coupons\/types\/([^?]+)/);
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** `type` query value from `coupons?type=…` (decoded). */
function typeIdFromCouponsQueryPath(path) {
  const s = String(path);
  if (!s.startsWith('coupons?')) return '';
  try {
    const q = s.indexOf('?');
    return new URLSearchParams(s.slice(q + 1)).get('type') || '';
  } catch {
    return '';
  }
}

/** Extra hint when path shape is likely wrong (omit 404 — often a plain “not found”). */
function appendUnsafeCouponIdHint(decodedTypeId, status) {
  if (!decodedTypeId || !/[\\/]/.test(decodedTypeId)) return '';
  if (![400, 405].includes(status)) return '';
  return ' — Tip: "/" or "\\" in a coupon id breaks REST paths. Prefer us-2026-my-promo (hyphens only).';
}

/** Persisted market filter (All, US, CA, MX). */
const COUPON_MARKET_STORAGE_KEY = 'vitamix-coupons-market-filter';

const COUPON_MARKETS = /** @type {const} */ ([
  { key: 'all', label: 'All' },
  { key: 'us', label: 'United States' },
  { key: 'ca', label: 'Canada' },
  { key: 'mx', label: 'Mexico' },
]);

/**
 * Expected coupon type id: `us-2026-my-promo` (country-year-key).
 */
function assertCouponIdMarketPath(id) {
  const t = String(id || '').trim();
  if (!t) throw new Error('Coupon ID is required');
  if (!/^(us|ca|mx)-\d{4}-[a-z0-9-]+$/i.test(t)) {
    throw new Error(
      'Coupon ID must look like us-2026-my-promo — country (us, ca, or mx), 4-digit year, hyphen, then a program key (letters, numbers, hyphens only).',
    );
  }
  if (/[\s?#%\\]/.test(t)) {
    throw new Error('Coupon ID cannot contain spaces, ?, #, %, or backslashes.');
  }
}

function couponMarketPrefixFromId(id) {
  const s = String(id).trim().toLowerCase();
  if (s.startsWith('us-')) return 'us';
  if (s.startsWith('ca-')) return 'ca';
  if (s.startsWith('mx-')) return 'mx';
  return '';
}

function couponsVisibleForMarket() {
  if (state.marketFilter === 'all') return state.coupons;
  return state.coupons.filter((row) => {
    const prefix = couponMarketPrefixFromId(couponIdFromRow(row));
    return prefix === state.marketFilter;
  });
}

/**
 * When id matches `country-year-key`, return breakdown for UI and derived fields.
 */
function parseCouponTypePath(id) {
  const s = String(id).trim();
  const hy = s.match(/^((?:us|ca|mx))-(\d{4})-(.+)$/i);
  if (hy) {
    return {
      country: hy[1].toLowerCase(),
      year: hy[2],
      name: hy[3],
    };
  }
  return null;
}

/** @param {string} raw */
function slugifyCouponLabelSegment(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * @param {string} country
 * @param {string} year
 * @param {string} labelSlug
 */
function buildCouponIdFromParts(country, year, labelSlug) {
  return `${String(country).toLowerCase()}-${String(year).trim()}-${labelSlug}`;
}

function couponYearSelectOptionsHtml() {
  const y = new Date().getFullYear();
  const years = [y, y + 1];
  return years
    .map((yr) => {
      const s = String(yr);
      return `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`;
    })
    .join('');
}

/** Fields for “new coupon” id: country + year + program key (no manual full id). */
function newCouponIdFieldsHtml() {
  const countryOpts = COUPON_MARKETS.filter((m) => m.key !== 'all')
    .map(({ key, label }) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`)
    .join('');
  const y0 = new Date().getFullYear();
  return `
      <div class="coupons-field">
        <label for="cp-new-country">Country</label>
        <select id="cp-new-country" required>${countryOpts}</select>
      </div>
      <div class="coupons-field">
        <label for="cp-new-year">Year</label>
        <select id="cp-new-year" required>${couponYearSelectOptionsHtml()}</select>
      </div>
      <div class="coupons-field coupons-field-full">
        <label for="cp-new-label">Program key</label>
        <input type="text" id="cp-new-label" autocomplete="off" required placeholder="spring-sale" />
        <p class="coupons-field-hint">Coupon id will be <code id="cp-new-id-preview">${escapeHtml(`us-${y0}-…`)}</code>
        (<code>country</code>-<code>year</code>-<code>key</code>; letters, numbers, and hyphens only in the key).</p>
      </div>`;
}

function marketTagHtml(market) {
  const m = String(market || '').toLowerCase();
  const labels = { us: 'US', ca: 'CA', mx: 'MX' };
  const classes = { us: 'coupons-tag-us', ca: 'coupons-tag-ca', mx: 'coupons-tag-mx' };
  const label = labels[m];
  if (!label) return '<span class="coupons-tag coupons-tag-muted">—</span>';
  return `<span class="coupons-tag ${classes[m]}">${label}</span>`;
}

function pillHtml(label, on) {
  const cl = on ? 'coupons-pill coupons-pill-on' : 'coupons-pill coupons-pill-off';
  return `<span class="${cl}">${escapeHtml(label)}</span>`;
}

function couponDetailModalInnerHtml(d) {
  const id = String(d.id ?? state.selectedCouponId ?? '');
  const name = d.name != null ? String(d.name) : '';
  const pathSeg = parseCouponTypePath(id);
  const market = pathSeg ? pathSeg.country : (couponMarketPrefixFromId(id) || '');
  const year = pathSeg ? pathSeg.year : '';
  const slugName = pathSeg ? pathSeg.name : '';

  let heroMain = '—';
  let heroSub = '';
  if (d.discountType === 'fixed' && d.discountValue != null) {
    heroMain = `$${d.discountValue}`;
    heroSub = 'off order subtotal';
  } else if (d.discountType === 'percentage' && d.discountValue != null) {
    heroMain = `${d.discountValue}%`;
    heroSub = 'off order subtotal';
  } else if (d.discountType) {
    heroMain = String(d.discountType);
    heroSub = d.discountValue != null ? String(d.discountValue) : '';
  }

  const min = d.minimumOrderAmount != null && d.minimumOrderAmount !== ''
    ? `$${Number(d.minimumOrderAmount).toFixed(2)}`
    : 'None';
  const cap = d.maximumDiscountAmount != null && d.maximumDiscountAmount !== ''
    ? `$${Number(d.maximumDiscountAmount).toFixed(2)}`
    : 'No cap';

  const cats = Array.isArray(d.excludedCategories) ? d.excludedCategories : [];
  const catTags = cats.length
    ? cats.map((c) => `<span class="coupons-mini-tag">${escapeHtml(String(c))}</span>`).join('')
    : '<span class="coupons-muted">None</span>';

  const listBanner = state.detailFromListFallback
    ? '<div class="coupons-modal-banner">List snapshot only — edit and delete use the API path and may be unavailable.</div>'
    : '';

  return `
    ${listBanner}
    <div class="coupons-modal-head">
      <div class="coupons-modal-badges">
        ${market ? marketTagHtml(market) : ''}
        ${year ? commerceGroupBadgeHtml(year) : ''}
        ${slugName ? `<span class="coupons-tag coupons-tag-slug">${escapeHtml(slugName)}</span>` : ''}
      </div>
      <h2 class="coupons-modal-title">${escapeHtml(name || id || 'Coupon')}</h2>
      <p class="coupons-modal-idline"><code>${escapeHtml(id)}</code></p>
    </div>
    <div class="coupons-modal-hero">
      <div class="coupons-modal-hero-inner">
        <span class="coupons-modal-hero-kicker">Discount</span>
        <span class="coupons-modal-hero-value">${escapeHtml(heroMain)}</span>
        ${heroSub ? `<span class="coupons-modal-hero-note">${escapeHtml(heroSub)}</span>` : ''}
      </div>
    </div>
    <div class="coupons-modal-stats" role="list">
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Minimum order</span><span class="coupons-modal-stat-value">${escapeHtml(min)}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Discount cap</span><span class="coupons-modal-stat-value">${escapeHtml(cap)}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Default code uses</span><span class="coupons-modal-stat-value">${escapeHtml(d.defaultUsageLimit != null ? String(d.defaultUsageLimit) : '—')}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Uses per code</span><span class="coupons-modal-stat-value">${escapeHtml(d.defaultUsesPerCode != null ? String(d.defaultUsesPerCode) : '—')}</span></div>
    </div>
    <div class="coupons-modal-pills" aria-label="Program flags">
      ${pillHtml('Free shipping', !!d.freeShipping)}
      ${pillHtml('Stacks with rules', d.stackable !== false)}
      ${pillHtml('Auto-apply', !!d.autoApply)}
      ${pillHtml('Manual entry', d.allowManualEntry !== false)}
    </div>
    <section class="coupons-modal-section">
      <h3 class="coupons-modal-section-title">Excluded categories</h3>
      <div class="coupons-modal-tags">${catTags}</div>
    </section>
    ${d.notes && String(d.notes).trim()
    ? `<section class="coupons-modal-section"><h3 class="coupons-modal-section-title">Notes</h3><div class="coupons-modal-notes">${escapeHtml(String(d.notes).trim())}</div></section>`
    : ''}
    <div class="coupons-modal-codes" data-cp-modal-codes-mount>${renderCodesSection()}</div>`;
}

function closeCouponDetailDialog() {
  document.querySelector('dialog.coupons-detail-dialog')?.remove();
}

function afterCodesRefresh() {
  const dlg = document.querySelector('dialog.coupons-detail-dialog');
  const host = dlg?.querySelector('[data-cp-modal-codes-mount]');
  if (host) {
    host.innerHTML = renderCodesSection();
    bindCodesEvents(dlg);
    return;
  }
  render();
}

function wireCouponDetailModal(dialog) {
  const shut = () => {
    dialog.close();
    dialog.remove();
  };
  wireDialogEscapeDismiss(dialog, shut);
  dialog.querySelector('[data-cp-modal-close-secondary]')?.addEventListener('click', shut);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) shut();
  });
  dialog.querySelector('[data-cp-modal-edit]')?.addEventListener('click', () => {
    shut();
    openEditCouponDialog();
  });
  dialog.querySelector('[data-cp-modal-delete]')?.addEventListener('click', async () => {
    if (!state.selectedCouponId) return;
    if (state.detailFromListFallback) {
      showToast('Delete is unavailable for list-only snapshots.', 'error');
      return;
    }
    /* eslint-disable-next-line no-alert -- destructive action needs explicit confirmation */
    if (!window.confirm(`Delete coupon "${state.selectedCouponId}"?`)) return;
    try {
      await couponsApiFetch(
        `coupons/types/${encodeURIComponent(state.selectedCouponId)}`,
        { method: 'DELETE' },
      );
      showToast('Coupon deleted', 'success');
      state.selectedCouponId = '';
      state.couponDetail = null;
      state.codes = [];
      shut();
      await refreshCouponList();
      render();
    } catch (err) {
      console.warn('[commerce-admin/coupons] delete coupon failed', {
        couponId: state.selectedCouponId,
        message: err?.message,
      });
      setError(err.message || 'Delete failed.');
      showToast(err.message || 'Delete failed', 'error');
    }
  });
}

function openCouponDetailModal() {
  closeCouponDetailDialog();
  const d = state.couponDetail;
  if (!d || !state.selectedCouponId) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'coupons-detail-dialog';

  const toolbar = document.createElement('div');
  toolbar.className = 'commerce-detail-modal-toolbar';

  const shut = () => {
    dialog.close();
    dialog.remove();
  };

  const toolbarMain = document.createElement('div');
  toolbarMain.className = 'commerce-detail-modal-toolbar-main';

  mountPromoteProductionInToolbar(toolbarMain, {
    org: PB_ORG,
    site: PB_SITE,
    entityKind: 'coupon',
    getPayload: () => ({ ...state.couponDetail, id: state.selectedCouponId }),
  });

  const { headerRight, jsonLink } = createDetailModalHeaderShell(shut);

  toolbar.append(toolbarMain, headerRight);

  const scroll = document.createElement('div');
  scroll.className = 'coupons-detail-dialog-scroll';

  const humanWrap = document.createElement('div');
  humanWrap.setAttribute('data-cp-human', '');
  humanWrap.innerHTML = couponDetailModalInnerHtml(d);

  const jsonPre = document.createElement('pre');
  jsonPre.className = 'commerce-detail-modal-json-pre';
  jsonPre.hidden = true;
  jsonPre.textContent = JSON.stringify(d, null, 2);

  scroll.append(humanWrap, jsonPre);

  jsonLink.addEventListener('click', () => {
    const showJson = jsonPre.hidden;
    jsonPre.hidden = !showJson;
    humanWrap.hidden = showJson;
    jsonLink.textContent = showJson ? 'Details' : 'JSON';
    jsonLink.setAttribute('aria-pressed', showJson ? 'true' : 'false');
  });

  const footer = document.createElement('footer');
  footer.className = 'coupons-modal-footer';
  footer.innerHTML = `
      <button type="button" class="coupons-btn" data-cp-modal-edit ${state.detailFromListFallback ? 'disabled' : ''}>Edit…</button>
      <button type="button" class="coupons-btn coupons-btn-danger" data-cp-modal-delete ${state.detailFromListFallback ? 'disabled' : ''}>Delete</button>
      <button type="button" class="coupons-btn coupons-btn-primary" data-cp-modal-close-secondary>Done</button>`;

  dialog.append(toolbar, scroll, footer);
  document.body.appendChild(dialog);
  wireCouponDetailModal(dialog);
  bindCodesEvents(dialog);
  dialog.showModal();
}

function renderMarketTabs() {
  return COUPON_MARKETS.map(({ key, label }) => {
    const sel = key === state.marketFilter ? 'true' : 'false';
    return `<button type="button" class="coupons-market-tab" role="tab" aria-selected="${sel}" data-cp-market="${escapeHtml(key)}">${escapeHtml(label)}</button>`;
  }).join('');
}

async function alignSelectionToMarketFilter() {
  closeCouponDetailDialog();
  const visible = couponsVisibleForMarket();
  const ids = new Set(visible.map((row) => couponIdFromRow(row)));
  if (state.selectedCouponId && ids.has(state.selectedCouponId)) {
    await refreshSelection();
    return;
  }
  state.selectedCouponId = couponIdFromRow(visible[0]) || '';
  await refreshSelection();
}

/**
 * Wraps ProductBus calls: logs failed requests to the console for debugging.
 */
async function couponsApiFetch(path, fetchInit = {}) {
  const method = (fetchInit && fetchInit.method) || 'GET';
  let resp;
  try {
    resp = await apiFetch(PB_ORG, PB_SITE, path, fetchInit);
  } catch (e) {
    console.warn('[commerce-admin/coupons] request failed (network or auth)', {
      method,
      path,
      message: e?.message || String(e),
    });
    throw e;
  }
  if (resp.ok) return resp;
  const errText = await readRespError(resp);
  const decodedType = decodeTypeIdFromCouponsTypesPath(path)
    || typeIdFromCouponsQueryPath(path);
  console.warn('[commerce-admin/coupons] API error response', {
    method,
    path,
    status: resp.status,
    statusText: resp.statusText,
    error: errText,
    couponTypeId: decodedType || undefined,
  });
  const hint = appendUnsafeCouponIdHint(decodedType, resp.status);
  throw new Error(`${errText}${hint}`);
}

function asArray(data, keys) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const key = keys.find((k) => Array.isArray(data[k]));
  return key ? data[key] : [];
}

/** Coupon id from a list row (API “coupon type”). */
function couponIdFromRow(row) {
  if (!row || typeof row !== 'object') return '';
  return String(row.id ?? row.typeId ?? '').trim();
}

const state = {
  /** @type {'all'|'us'|'ca'|'mx'} */
  marketFilter: 'all',
  coupons: [],
  selectedCouponId: '',
  couponDetail: null,
  /** True when `couponDetail` came from the list row because GET …/types/{id} failed. */
  detailFromListFallback: false,
  codes: [],
  /** Cursor from the last list response; used for “Next page” requests. */
  codesNextCursor: '',
};

/** @param {'error'|'info'} tone */
function setError(msg, tone = 'error') {
  const el = document.getElementById('coupons-error');
  if (!el) return;
  el.classList.toggle('coupons-error-info', Boolean(msg) && tone === 'info');
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

/** Single-line discount summary for overview grid (list row). */
function overviewDiscountText(row) {
  if (!row || typeof row !== 'object') return '—';
  if (row.discountType === 'fixed' && row.discountValue != null) {
    return `$${row.discountValue}`;
  }
  if (row.discountType === 'percentage' && row.discountValue != null) {
    return `${row.discountValue}%`;
  }
  if (row.discountType) return `${row.discountType}: ${row.discountValue ?? '—'}`;
  return '—';
}

function overviewMinOrder(row) {
  if (!row || typeof row !== 'object') return '—';
  if (row.minimumOrderAmount == null || row.minimumOrderAmount === '') return '—';
  return `$${Number(row.minimumOrderAmount).toFixed(2)}`;
}

function overviewCap(row) {
  if (!row || typeof row !== 'object') return '—';
  if (row.maximumDiscountAmount == null || row.maximumDiscountAmount === '') return '—';
  return `$${Number(row.maximumDiscountAmount).toFixed(2)}`;
}

function renderCouponsOverviewBody(filtered) {
  const emptyCell = (msg) => `<tr><td colspan="9" class="coupons-empty-cell">${msg}</td></tr>`;
  if (!state.coupons.length) {
    return emptyCell('No coupons yet (empty list or missing <code>coupons:read</code>).');
  }
  if (!filtered.length) {
    return emptyCell('No coupons for this market. Try <strong>All</strong> or another country tab.');
  }
  return filtered.map((row) => {
    const id = couponIdFromRow(row);
    const name = row.name || '—';
    const pathSeg = parseCouponTypePath(id);
    const year = pathSeg ? pathSeg.year : '—';
    const disc = overviewDiscountText(row);
    const min = overviewMinOrder(row);
    const cap = overviewCap(row);
    const ship = yn(row.freeShipping);
    const stack = yn(row.stackable !== false);
    const label = `Open coupon ${String(name)}`;
    const mKey = couponMarketPrefixFromId(id);
    return `<tr class="coupons-grid-row coupons-row-open" data-cp-coupon-id="${escapeHtml(id)}" tabindex="0" role="button" aria-label="${escapeHtml(label)}">
      <td class="coupons-grid-lead coupons-grid-name">${escapeHtml(String(name))}</td>
      <td><code class="coupons-grid-id">${escapeHtml(id || '—')}</code></td>
      <td>${escapeHtml(disc)}</td>
      <td>${escapeHtml(min)}</td>
      <td>${escapeHtml(cap)}</td>
      <td>${escapeHtml(ship)}</td>
      <td>${escapeHtml(stack)}</td>
      <td class="coupons-grid-col-year">${commerceGroupBadgeHtml(year)}</td>
      <td class="coupons-grid-col-market">${commerceMarketEmojiHtml(mKey)}</td>
    </tr>`;
  }).join('');
}

async function fetchCouponList() {
  const resp = await couponsApiFetch('coupons/types', { method: 'GET' });
  const data = await resp.json();
  state.coupons = asArray(data, ['types', 'items', 'data', 'results', 'coupons']);
}

async function fetchCouponDetail(id) {
  if (!id) {
    state.couponDetail = null;
    state.detailFromListFallback = false;
    return;
  }
  try {
    const resp = await couponsApiFetch(`coupons/types/${encodeURIComponent(id)}`, { method: 'GET' });
    state.couponDetail = await resp.json();
    state.detailFromListFallback = false;
  } catch (err) {
    const row = state.coupons.find((c) => couponIdFromRow(c) === id);
    if (row && typeof row === 'object') {
      state.couponDetail = { ...row };
      state.detailFromListFallback = true;
      console.warn('[commerce-admin/coupons] detail GET failed; using list row snapshot', {
        id,
        message: err?.message || String(err),
      });
      return;
    }
    state.couponDetail = null;
    state.detailFromListFallback = false;
    throw err;
  }
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
  const path = `coupons?${qs.toString()}`;
  const resp = await couponsApiFetch(path, { method: 'GET' });
  const data = await resp.json();
  const batch = asArray(data, ['codes', 'items', 'data', 'results', 'values', 'generated']);
  const next = data && typeof data === 'object' && data.cursor ? String(data.cursor) : '';
  if (append) {
    state.codes = [...state.codes, ...batch];
  } else {
    state.codes = batch;
  }
  state.codesNextCursor = next;
  if (!append && state.codes.length && !pickCouponCodeString(state.codes[0])) {
    console.warn('[commerce-admin/coupons] first code row has no recognized code field; sample:', state.codes[0]);
  }
}

async function refreshSelection() {
  if (state.selectedCouponId) {
    try {
      await fetchCouponDetail(state.selectedCouponId);
      state.codes = [];
      state.codesNextCursor = '';
      if (state.detailFromListFallback) {
        setError('Showing data from the coupon list only: GET …/coupons/types/{id} failed for this id (often when the id contains “/” or other awkward characters). Edit and delete use that URL path and are disabled here until the id is fixed on the server.', 'info');
      } else {
        setError('');
      }
    } catch (e) {
      state.codes = [];
      state.codesNextCursor = '';
      state.detailFromListFallback = false;
      setError(e.message || 'Could not load this coupon.');
      throw e;
    }
  } else {
    state.couponDetail = null;
    state.codes = [];
    state.codesNextCursor = '';
    state.detailFromListFallback = false;
    setError('');
  }
}

async function refreshCouponList() {
  await fetchCouponList();
  const visible = couponsVisibleForMarket();
  if (state.selectedCouponId) {
    const still = state.coupons.some((c) => couponIdFromRow(c) === state.selectedCouponId);
    if (!still) state.selectedCouponId = couponIdFromRow(state.coupons[0]) || '';
    const stillVisible = visible.some((c) => couponIdFromRow(c) === state.selectedCouponId);
    if (!stillVisible) state.selectedCouponId = couponIdFromRow(visible[0]) || '';
  } else if (visible.length) {
    state.selectedCouponId = couponIdFromRow(visible[0]);
  } else {
    state.selectedCouponId = '';
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
      console.warn('[commerce-admin/coupons] dialog submit failed', {
        title,
        message: err?.message || String(err),
      });
      showToast(err.message || 'Request failed', 'error');
    }
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      dialog.close();
      dialog.remove();
    }
  });
  wireDialogEscapeDismiss(dialog, () => {
    dialog.close();
    dialog.remove();
  });
  dialog.showModal();
}

function couponFormHtml({ idReadonly }) {
  const idBlock = idReadonly
    ? `<div class="coupons-field coupons-field-full">
        <label for="cp-form-id">Coupon ID</label>
        <input type="text" id="cp-form-id" autocomplete="off" readonly class="coupons-readonly" required />
        <p class="coupons-field-hint">Ids use <code>country-year-key</code> (e.g. <code>us-2026-spring-sale</code>).</p>
      </div>`
    : `${newCouponIdFieldsHtml()}`;

  return `
    <p class="coupons-page-lead" style="margin-bottom:12px">Describe how this coupon behaves. Amounts are in storefront currency unless noted otherwise.</p>
    <div class="coupons-form-grid">
      ${idBlock}
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
  let id = dlg.querySelector('#cp-form-id')?.value?.trim() ?? '';
  const name = dlg.querySelector('#cp-form-name')?.value?.trim();
  if (requireId && dlg.querySelector('#cp-new-country')) {
    const country = dlg.querySelector('#cp-new-country')?.value?.trim().toLowerCase() || '';
    const year = dlg.querySelector('#cp-new-year')?.value?.trim() || '';
    const labelRaw = dlg.querySelector('#cp-new-label')?.value?.trim() || '';
    if (!country || !year || !labelRaw) {
      throw new Error('Country, year, and program key are required');
    }
    const slug = slugifyCouponLabelSegment(labelRaw);
    if (!slug) {
      throw new Error('Program key must include at least one letter or number');
    }
    id = buildCouponIdFromParts(country, year, slug);
  }
  if (requireId && !id) throw new Error('Coupon ID is required');
  if (requireId) assertCouponIdMarketPath(id);
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
  const seg = parseCouponTypePath(String(body.id || ''));
  if (seg && /^(us|ca|mx)$/.test(seg.country)) {
    body.country = seg.country;
  }
  if (seg && seg.year) {
    body.custom = { group: String(seg.year).trim() };
  }
  return body;
}

/** API may return each code as a string or an object with varying keys. */
function normalizeCouponCodeEntry(raw) {
  if (raw == null) return {};
  if (typeof raw === 'string') return { code: raw.trim() };
  if (typeof raw === 'object') return raw;
  return {};
}

function pickCouponCodeString(c) {
  const o = normalizeCouponCodeEntry(c);
  const candidates = [
    o.code,
    o.couponCode,
    o.coupon_code,
    o.value,
    o.token,
    o.label,
    o.name,
    o.couponId,
    o.coupon_id,
    o.id,
  ];
  const hit = candidates.find((v) => v != null && String(v).trim() !== '');
  return hit != null ? String(hit).trim() : '';
}

function pickCouponUsageParts(c) {
  const o = normalizeCouponCodeEntry(c);
  const used = o.usageCount ?? o.usedCount ?? o.uses ?? o.timesUsed ?? o.redemptions ?? o.useCount;
  const limit = o.usageLimit ?? o.maxUses ?? o.limit ?? o.maxRedemptions ?? o.totalUses;
  return { used, limit };
}

function pickCouponExpires(c) {
  const o = normalizeCouponCodeEntry(c);
  const v = o.expiresAt ?? o.expirationDate ?? o.expires ?? o.expiration ?? o.expiry;
  return v != null && String(v).trim() !== '' ? String(v).trim() : '';
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

function renderCodesSection() {
  if (!state.selectedCouponId) {
    return '<p class="coupons-empty">Select a coupon to load its codes.</p>';
  }
  const rows = state.codes.length
    ? state.codes.map((raw) => {
      const c = normalizeCouponCodeEntry(raw);
      const codeStr = pickCouponCodeString(raw);
      const code = escapeHtml(codeStr || '—');
      const active = c.active !== false && c.active !== 'false';
      const { used, limit } = pickCouponUsageParts(raw);
      const usage = `${used ?? '—'} / ${limit ?? '∞'}`;
      const expRaw = pickCouponExpires(raw);
      const exp = expRaw ? escapeHtml(expRaw) : '—';
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
      afterCodesRefresh();
    } catch (err) {
      console.warn('[commerce-admin/coupons] load codes failed', {
        couponId: state.selectedCouponId,
        message: err?.message,
      });
      setError(err.message || 'Could not load codes for this coupon.');
      showToast(err.message || 'Failed to load codes', 'error');
    }
  });
  mount.querySelector('[data-cp-next-codes]')?.addEventListener('click', async () => {
    if (!state.codesNextCursor) return;
    try {
      await fetchCodesForCoupon({ append: true });
      afterCodesRefresh();
    } catch (err) {
      console.warn('[commerce-admin/coupons] codes next page failed', {
        couponId: state.selectedCouponId,
        message: err?.message,
      });
      showToast(err.message || 'Failed', 'error');
    }
  });
  mount.querySelector('[data-cp-add-code]')?.addEventListener('click', () => openAddCodeDialog());
  mount.querySelector('[data-cp-batch]')?.addEventListener('click', () => openBatchDialog());
}

function render() {
  const mount = document.getElementById('coupons-mount');
  if (!mount) return;

  const filtered = couponsVisibleForMarket();
  const overviewBody = renderCouponsOverviewBody(filtered);

  mount.innerHTML = `
    <div class="coupons-toolbar pim-toolbar">
      <div class="coupons-toolbar-left">
        <div class="coupons-market-tabs" role="tablist" aria-label="Market">${renderMarketTabs()}</div>
      </div>
      <div class="coupons-toolbar-right">
        <button type="button" class="coupons-btn coupons-btn-primary" data-cp-new>New coupon…</button>
      </div>
    </div>
    <p class="coupons-market-hint">Ids: <code>us-2026-name</code>, <code>ca-2026-name</code>, <code>mx-2026-name</code> (country-year-key). Click a row for a <strong>modal</strong> with full rules and codes (like opening an order).</p>
    <section class="coupons-overview coupons-overview-solo" aria-label="Coupon programs overview">
      <h2 class="coupons-panel-title">Coupon programs</h2>
      <p class="coupons-panel-hint">Quick columns; open the modal for edit, delete, and code tools.</p>
      <div class="coupons-table-wrap coupons-overview-table-wrap pim-list-wrapper">
        <table class="coupons-grid-table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Id</th>
              <th scope="col">Discount</th>
              <th scope="col">Min order</th>
              <th scope="col">Cap</th>
              <th scope="col">Free ship</th>
              <th scope="col">Stack</th>
              <th scope="col" class="coupons-grid-col-year">Year</th>
              <th scope="col" class="coupons-grid-col-market">Market</th>
            </tr>
          </thead>
          <tbody>${overviewBody}</tbody>
        </table>
      </div>
    </section>`;

  mount.querySelectorAll('[data-cp-market]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.getAttribute('data-cp-market');
      if (!key || key === state.marketFilter) return;
      state.marketFilter = /** @type {typeof state.marketFilter} */ (key);
      try {
        sessionStorage.setItem(COUPON_MARKET_STORAGE_KEY, state.marketFilter);
        await alignSelectionToMarketFilter();
        render();
      } catch (err) {
        console.warn('[commerce-admin/coupons] market filter change failed', { message: err?.message });
        showToast(err.message || 'Failed to switch market', 'error');
      }
    });
  });

  mount.querySelector('[data-cp-new]')?.addEventListener('click', () => openNewCouponDialog());

  mount.querySelectorAll('tr.coupons-grid-row[data-cp-coupon-id]').forEach((rowEl) => {
    const openRow = async () => {
      const id = rowEl.getAttribute('data-cp-coupon-id') || '';
      if (!id) return;
      state.selectedCouponId = id;
      try {
        await refreshSelection();
        render();
        openCouponDetailModal();
      } catch (err) {
        console.warn('[commerce-admin/coupons] open coupon failed', {
          couponId: id,
          message: err?.message || String(err),
        });
        state.couponDetail = null;
        state.detailFromListFallback = false;
        state.codes = [];
        state.codesNextCursor = '';
        setError(err.message || 'Could not load this coupon.');
        showToast(err.message || 'Failed to load coupon', 'error');
        render();
      }
    };
    rowEl.addEventListener('click', () => {
      openRow();
    });
    rowEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openRow();
      }
    });
  });
}

function openNewCouponDialog() {
  openDialog(
    'New coupon',
    couponFormHtml({ idReadonly: false }),
    async (dlg) => {
      const body = readCouponBodyFromForm(dlg, { requireId: true });
      await couponsApiFetch('coupons/types', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      showToast('Coupon created', 'success');
      const m = couponMarketPrefixFromId(body.id);
      if (m) {
        state.marketFilter = m;
        try {
          sessionStorage.setItem(COUPON_MARKET_STORAGE_KEY, state.marketFilter);
        } catch {
          /* ignore */
        }
      }
      state.selectedCouponId = body.id;
      await refreshCouponList();
      render();
      openCouponDetailModal();
    },
    (dlg) => {
      dlg.querySelector('#cp-form-stackable').checked = true;
      dlg.querySelector('#cp-form-manual').checked = true;
      const countryEl = dlg.querySelector('#cp-new-country');
      const yearEl = dlg.querySelector('#cp-new-year');
      const labelEl = dlg.querySelector('#cp-new-label');
      const previewEl = dlg.querySelector('#cp-new-id-preview');
      const syncPreview = () => {
        const country = countryEl?.value || 'us';
        const year = yearEl?.value || String(new Date().getFullYear());
        const slug = slugifyCouponLabelSegment(labelEl?.value || '');
        if (previewEl) {
          previewEl.textContent = slug ? `${country}-${year}-${slug}` : `${country}-${year}-…`;
        }
      };
      if (['us', 'ca', 'mx'].includes(state.marketFilter) && countryEl) {
        countryEl.value = state.marketFilter;
      }
      [countryEl, yearEl, labelEl].forEach((el) => {
        el?.addEventListener('input', syncPreview);
        el?.addEventListener('change', syncPreview);
      });
      syncPreview();
    },
    'coupons-dialog-wide',
  );
}

function openEditCouponDialog() {
  if (!state.couponDetail) return;
  if (state.detailFromListFallback) {
    showToast('Edit is unavailable: rules are from the list only because GET …/coupons/types/{id} failed for this id.', 'error');
    return;
  }
  const snap = { ...state.couponDetail };
  openDialog(
    'Edit coupon',
    couponFormHtml({ idReadonly: true }),
    async (dlg) => {
      const body = readCouponBodyFromForm(dlg, { requireId: false });
      await couponsApiFetch(
        `coupons/types/${encodeURIComponent(state.selectedCouponId)}`,
        { method: 'PUT', body: JSON.stringify(body) },
      );
      showToast('Coupon updated', 'success');
      await refreshSelection();
      afterCodesRefresh();
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
      await couponsApiFetch('coupons', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      showToast('Code created', 'success');
      await fetchCodesForCoupon();
      afterCodesRefresh();
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
      await couponsApiFetch('coupons/batch', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      showToast('Batch created', 'success');
      await fetchCodesForCoupon();
      afterCodesRefresh();
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

async function init() {
  const mount = document.getElementById('coupons-mount');
  if (!mount) return;
  console.log('[commerce-admin] coupons init start (before waitForCommerceAuthReady)');
  const authed = await waitForCommerceAuthReady(PB_ORG, PB_SITE);
  if (!authed) {
    setError('Sign-in did not finish before the wait timed out. Reload the page and complete sign-in.');
    mount.innerHTML = '<p class="coupons-empty">Reload the page after signing in.</p>';
    return;
  }
  const a = getAuthState(PB_ORG, PB_SITE);
  const roles = Array.isArray(a?.roles) ? a.roles.join(',') : String(a?.roles ?? '');
  const htmlOk = document.documentElement.classList.contains('commerce-admin-auth-ok');
  console.log(`[commerce-admin] coupons init after wait apiEnv=${getApiEnvironment()} hasToken=${Boolean(a?.token)} htmlAuthOk=${htmlOk} roles=${roles}`);
  try {
    try {
      const saved = sessionStorage.getItem(COUPON_MARKET_STORAGE_KEY);
      if (saved === 'all' || saved === 'us' || saved === 'ca' || saved === 'mx') {
        state.marketFilter = /** @type {typeof state.marketFilter} */ (saved);
      }
    } catch {
      /* sessionStorage unavailable */
    }
    await refreshCouponList();
    render();
  } catch (err) {
    console.warn('[commerce-admin/coupons] initial load failed', { message: err?.message || String(err) });
    setError(err.message || 'Failed to load coupons');
    mount.innerHTML = '<p class="coupons-empty">Fix the error above or confirm your token includes <code>coupons:read</code>, then reload.</p>';
  }
}

init();
