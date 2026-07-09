/**
 * Coupons — ProductBus: types at …/coupons/types; codes at …/coupons;
 * batch at …/coupons/batch. UI: “coupon” / “code”; nav on selected coupon.
 * Coupon type bodies use camelCase fields such as `excludedCategories`, `includedCategories`,
 * `includedProducts`, `excludedProducts`, and `excludeDiscountedProducts`; the API may also
 * return snake_case — the form normalizes on read. Included/excluded product lists are mutually
 * exclusive.
 */
/* eslint-disable no-use-before-define, no-console */
// render, bindCodesEvents, and open* dialogs reference each other.
// console: intentional debug logs for ProductBus coupon API failures.
import { apiFetch, getApiEnvironment, getAuthState } from './commerce-otp-api.js';
import waitForCommerceAuthReady from './commerce-wait-auth-ready.js';
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
import {
  couponShippingModeFromRow,
  normalizeShippingBenefitMode,
  shippingBenefitFieldsFromMode,
  shippingBenefitModeLabel,
  shippingBenefitModeSortRank,
  shippingBenefitSelectOptionsHtml,
} from './shipping-benefit.js';
import {
  formatProductConditionsForForm,
  parseProductConditionsInput,
} from './product-conditions.js';
import {
  hydrateProductScopePills,
  mountProductSelectionField,
} from './product-selection-field.js';
import {
  couponProductListSectionHtml,
  fillCouponProductList,
  readCouponDiscountedProductsFromDom,
  wireCouponProductListRows,
} from './coupons-product-list.js';

/**
 * ProductBus coupon type (`…/coupons/types`). Shapes match **helix-commerce-api**.
 *
 * @typedef {{ path: string; sku?: string }} ProductCondition
 *
 * @typedef {object} CouponType
 * @property {string} id
 * @property {string} name
 * @property {'percentage'|'fixed'} discountType
 * @property {number} discountValue
 * @property {number} [minimumOrderAmount]
 * @property {number|null} [maximumDiscountAmount]
 * @property {boolean} [freeShipping]
 * @property {string[]} [includedShippingTypes] e.g. `standard`, `priority`
 * @property {string[]} [includedCategories]
 * @property {string[]} [excludedCategories]
 * @property {ProductCondition[]} [includedProducts]
 * @property {ProductCondition[]} [excludedProducts]
 * @property {boolean} [stackable]
 * @property {boolean} [autoApply]
 * @property {boolean} [allowManualEntry]
 * @property {boolean} [excludeDiscountedProducts] When true, blocks coupon on
 *   catalog price-rule discounted products
 * @property {number|null} [defaultUsageLimit]
 * @property {number|null} [defaultUsesPerCode]
 * @property {string} [notes]
 * @property {string} [country]
 * @property {string[]} [countries]
 * @property {{ group?: string }} [custom]
 */

async function readRespError(resp) {
  return resp.headers.get('x-error')
    || (await resp.text().catch(() => '')).trim()
    || `HTTP ${resp.status}`;
}

/** @type {{ locale: string, slugs: string[] }} */
/**
 * Map market tab + new-coupon country to AEM products index path (see catalog).
 * @returns {string} e.g. us/en_us
 */
/** @param {HTMLDialogElement | null | undefined} dlg */
function localePathForCouponCategoryIndex(dlg) {
  const c = primaryCouponCountryForCategoryIndex(dlg);
  if (c === 'ca') return 'ca/en_ca';
  if (c === 'mx') return 'us/en_us';
  return 'us/en_us';
}

/** @param {Record<string, unknown>} d */
function localePathFromCouponRecord(d) {
  const seg = parseCouponTypePath(String(d?.id || ''));
  const c = seg?.country || 'us';
  if (c === 'ca') return 'ca/en_ca';
  return 'us/en_us';
}

/** @param {ParentNode} root @param {Record<string, unknown>} d */
function hydrateCouponDetailScopePills(root, d) {
  const localePath = localePathFromCouponRecord(d);
  root.querySelectorAll('[data-cp-scope-pills]').forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    const kind = el.getAttribute('data-cp-scope-pills');
    const emptyText = el.getAttribute('data-cp-scope-empty') || 'None';
    const productsRaw = kind === 'included'
      ? (d.includedProducts ?? d.included_products)
      : (d.excludedProducts ?? d.excluded_products);
    const categoriesRaw = kind === 'included'
      ? (d.includedCategories ?? d.included_categories)
      : (d.excludedCategories ?? d.excluded_categories);
    hydrateProductScopePills(el, {
      productsRaw,
      categoriesRaw,
      localePath,
      emptyText,
    }).catch(() => {});
  });
}

/** @type {Array<{ destroy: () => void; refresh: () => Promise<void> }>} */
let couponProductSelectionFields = [];

/**
 * @param {HTMLDialogElement} dlg
 */
function wireCouponProductSelectionFields(dlg) {
  couponProductSelectionFields.forEach((f) => f.destroy());
  couponProductSelectionFields = [];

  const includedMount = dlg.querySelector('[data-cp-psf-mount="included"]');
  const excludedMount = dlg.querySelector('[data-cp-psf-mount="excluded"]');
  const productsIncluded = /** @type {HTMLInputElement | null} */ (
    dlg.querySelector('#cp-form-included-products')
  );
  const categoriesIncluded = /** @type {HTMLInputElement | null} */ (
    dlg.querySelector('#cp-form-included')
  );
  const productsExcluded = /** @type {HTMLInputElement | null} */ (
    dlg.querySelector('#cp-form-excluded-products')
  );
  const categoriesExcluded = /** @type {HTMLInputElement | null} */ (
    dlg.querySelector('#cp-form-excluded')
  );

  if (includedMount && productsIncluded && categoriesIncluded) {
    couponProductSelectionFields.push(mountProductSelectionField(includedMount, {
      productsInput: productsIncluded,
      categoriesInput: categoriesIncluded,
      getLocalePath: () => localePathForCouponCategoryIndex(dlg),
      label: 'Included products',
      emptyText: 'None — click to add products or categories.',
    }));
  }
  if (excludedMount && productsExcluded && categoriesExcluded) {
    couponProductSelectionFields.push(mountProductSelectionField(excludedMount, {
      productsInput: productsExcluded,
      categoriesInput: categoriesExcluded,
      getLocalePath: () => localePathForCouponCategoryIndex(dlg),
      label: 'Excluded products',
      emptyText: 'None — click to add products or categories.',
    }));
  }

  dlg.querySelectorAll('input.cp-new-country-cb, input.cp-edit-country-cb').forEach((el) => {
    el.addEventListener('change', () => {
      couponProductSelectionFields.forEach((f) => {
        f.refresh().catch(() => {});
      });
    });
  });

  couponProductSelectionFields.forEach((f) => {
    f.refresh().catch(() => {});
  });
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

/** API / id segment order — single `country` or multi `countries` (mutually exclusive). */
const COUPON_API_COUNTRIES = /** @type {const} */ (['us', 'ca', 'mx']);

/**
 * @param {string[]} selected lower-case country keys (any order)
 * @returns {string} first among {@link COUPON_API_COUNTRIES} present in `selected`, else `us`
 */
function firstCouponCountryInApiOrder(selected) {
  const set = new Set(selected.map((s) => String(s || '').trim().toLowerCase()));
  const hit = COUPON_API_COUNTRIES.find((k) => set.has(k));
  return hit || 'us';
}

/**
 * @param {HTMLDialogElement} dlg
 * @param {string} checkboxSelector e.g. `input.cp-new-country-cb`
 */
function readCouponCountryCheckboxValues(dlg, checkboxSelector) {
  const allowed = new Set(COUPON_API_COUNTRIES);
  return [...dlg.querySelectorAll(checkboxSelector)]
    .filter((el) => el instanceof HTMLInputElement && el.checked && !el.disabled)
    .map((el) => String(el.value || '').trim().toLowerCase())
    .filter((k) => allowed.has(k));
}

/**
 * @param {Record<string, unknown>} [d] coupon type list row or detail
 * @returns {string[]} `us` | `ca` | `mx` in API order
 */
function normalizeCouponCountries(d) {
  if (!d || typeof d !== 'object') return [];
  const rawCountries = d.countries ?? d.country_codes ?? d.markets ?? d.countryCodes;
  let keys = [];
  if (Array.isArray(rawCountries) && rawCountries.length) {
    const allowed = new Set(COUPON_API_COUNTRIES);
    keys = rawCountries
      .map((x) => String(x).trim().toLowerCase())
      .filter((k) => allowed.has(k));
  } else {
    const single = d.country ?? d.market;
    if (single != null && String(single).trim() !== '') {
      const k = String(single).trim().toLowerCase();
      if (COUPON_API_COUNTRIES.includes(k)) keys = [k];
    }
  }
  if (!keys.length) {
    const id = String(d.id ?? d.typeId ?? '').trim();
    const seg = parseCouponTypePath(id);
    if (seg) keys = [seg.country];
    else {
      const prefix = couponMarketPrefixFromId(id);
      if (prefix) keys = [prefix];
    }
  }
  const set = new Set(keys);
  return COUPON_API_COUNTRIES.filter((k) => set.has(k));
}

/**
 * @param {HTMLDialogElement} dlg
 * @returns {string[]}
 */
function readCouponCountriesFromForm(dlg) {
  const newSel = readCouponCountryCheckboxValues(dlg, 'input.cp-new-country-cb');
  const editSel = readCouponCountryCheckboxValues(dlg, 'input.cp-edit-country-cb');
  const raw = newSel.length ? newSel : editSel;
  const set = new Set(raw);
  return COUPON_API_COUNTRIES.filter((k) => set.has(k));
}

/**
 * @param {HTMLDialogElement} dlg
 */
function wireCouponCountryCheckboxGuards(dlg) {
  const groups = [
    dlg.querySelectorAll('input.cp-new-country-cb'),
    dlg.querySelectorAll('input.cp-edit-country-cb'),
  ];
  const guard = (/** @type {NodeListOf<HTMLInputElement>} */ list) => {
    if (!list.length) return;
    if (![...list].some((cb) => cb.checked)) {
      const first = list[0];
      if (first) first.checked = true;
    }
  };
  groups.forEach((list) => {
    [...list].forEach((cb) => {
      cb.addEventListener('change', () => guard(list));
    });
  });
}

/**
 * @param {HTMLDialogElement} dlg
 * @returns {string} first country for category index locale (us|ca|mx)
 */
function primaryCouponCountryForCategoryIndex(dlg) {
  if (dlg) {
    const fromNew = readCouponCountryCheckboxValues(dlg, 'input.cp-new-country-cb');
    if (fromNew.length) return firstCouponCountryInApiOrder(fromNew);
    const fromEdit = readCouponCountryCheckboxValues(dlg, 'input.cp-edit-country-cb');
    if (fromEdit.length) return firstCouponCountryInApiOrder(fromEdit);
  }
  const m = state.marketFilter;
  if (m === 'ca' || m === 'mx') return m;
  return 'us';
}

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
    const countries = normalizeCouponCountries(row);
    if (countries.length) return countries.includes(state.marketFilter);
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

/** Countries as market-style toggles (new coupon id builder). */
function newCouponCountryCheckboxesHtml() {
  const tabs = COUPON_MARKETS.filter((m) => m.key !== 'all')
    .map(({ key, label }) => `
      <label class="coupons-market-tab coupons-market-tab-toggle">
        <input type="checkbox" class="cp-new-country-cb" value="${escapeHtml(key)}" />
        <span class="coupons-market-tab-label">${escapeHtml(label)}</span>
      </label>`)
    .join('');
  return `
      <div class="coupons-field coupons-field-full" data-cp-new-countries>
        <span class="coupons-country-field-label" id="cp-new-country-legend">Countries</span>
        <div class="coupons-market-tabs coupons-market-tabs-form" role="group" aria-labelledby="cp-new-country-legend" aria-describedby="cp-new-country-hint">
          ${tabs}
        </div>
        <p id="cp-new-country-hint" class="coupons-field-hint">Select at least one. One market saves as <code>country</code>; several save as <code>countries</code> (not both). The coupon id uses the <strong>first</strong> in US → Canada → Mexico order.</p>
      </div>`;
}

/** Same toggles on edit — extra selections are UI-only until the API accepts multiple. */
function editCouponCountryFieldsHtml() {
  const tabs = COUPON_MARKETS.filter((m) => m.key !== 'all')
    .map(({ key, label }) => `
      <label class="coupons-market-tab coupons-market-tab-toggle">
        <input type="checkbox" class="cp-edit-country-cb" value="${escapeHtml(key)}" />
        <span class="coupons-market-tab-label">${escapeHtml(label)}</span>
      </label>`)
    .join('');
  return `
      <div class="coupons-field coupons-field-full" data-cp-edit-countries>
        <span class="coupons-country-field-label" id="cp-edit-country-legend">Countries</span>
        <div class="coupons-market-tabs coupons-market-tabs-form" role="group" aria-labelledby="cp-edit-country-legend">
          ${tabs}
        </div>
        <p class="coupons-field-hint">Select at least one. One market saves as <code>country</code>; several save as <code>countries</code> (not both).</p>
      </div>`;
}

/** Fields for “new coupon” id: country + year + program key (no manual full id). */
function newCouponIdFieldsHtml() {
  const y0 = new Date().getFullYear();
  return `
      ${newCouponCountryCheckboxesHtml()}
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

/** Single state badge (not an on/off pair). */
function statePillHtml(label) {
  return `<span class="coupons-pill coupons-pill-state">${escapeHtml(label)}</span>`;
}

/** @param {string} couponId */
function couponDiscountBasisStatePill(couponId) {
  return statePillHtml(
    couponDiscountAppliesToSalePrice(couponId) ? 'Sale price' : 'Regular price',
  );
}

/** @param {Record<string, unknown>} d */
function couponOnSaleEligibilityStatePill(d) {
  return statePillHtml(
    couponExcludesOnSaleProducts(d)
      ? 'Excludes products on sale'
      : 'Includes products on sale',
  );
}

/** @param {Record<string, unknown>} d coupon detail/list row */
function couponExcludesOnSaleProducts(d) {
  return !!(d.excludeDiscountedProducts ?? d.exclude_discounted_products);
}

/** @param {string} label @param {string} pillsHtml */
function couponDetailPillGroupHtml(label, pillsHtml) {
  return `<div class="coupons-modal-pill-group">
    <span class="coupons-modal-pill-group-label">${escapeHtml(label)}</span>
    <div class="coupons-modal-pills">${pillsHtml}</div>
  </div>`;
}

/**
 * Read-only table of a product-list coupon's discounted products for the detail
 * modal (replaces the included/excluded scope sections, which don't apply).
 * @param {Array<{ path?: string, sku?: string, price?: string|number }>} entries
 */
function couponDiscountedProductsSectionHtml(entries) {
  const rows = entries.map((e) => {
    const path = escapeHtml(String(e?.path ?? ''));
    const sku = e?.sku ? escapeHtml(String(e.sku)) : '—';
    const price = escapeHtml(String(e?.price ?? ''));
    return `<tr><td><code>${path}</code></td><td>${sku}</td><td>$${price}</td></tr>`;
  }).join('');
  return `<section class="coupons-modal-section">
    <h3 class="coupons-modal-section-title">Discounted products</h3>
    <p class="coupons-field-hint" style="margin:0 0 8px">Each product path (and optional variant SKU) is discounted to this absolute per-unit price when the coupon code is applied.</p>
    <table class="cp-plc-detail-grid">
      <thead><tr><th scope="col">Product path</th><th scope="col">SKU</th><th scope="col">Price</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function couponDetailModalInnerHtml(d) {
  const id = String(d.id ?? state.selectedCouponId ?? '');
  const name = d.name != null ? String(d.name) : '';
  const pathSeg = parseCouponTypePath(id);
  const countries = normalizeCouponCountries(d);
  const year = pathSeg ? pathSeg.year : '';
  const slugName = pathSeg ? pathSeg.name : '';

  const discountedProducts = Array.isArray(d.discountedProducts ?? d.discounted_products)
    ? (d.discountedProducts ?? d.discounted_products)
    : [];
  const isProductList = discountedProducts.length > 0;

  let heroMain = '—';
  let heroSub = '';
  if (isProductList) {
    heroMain = 'Product list';
    heroSub = `${discountedProducts.length} product${discountedProducts.length === 1 ? '' : 's'}`;
  } else if (d.discountType === 'fixed' && d.discountValue != null) {
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

  const listBanner = state.detailFromListFallback
    ? '<div class="coupons-modal-banner">List snapshot only — edit and delete use the API path and may be unavailable.</div>'
    : '';

  return `
    ${listBanner}
    <div class="coupons-modal-head">
      <div class="coupons-modal-badges">
        ${countries.map((k) => marketTagHtml(k)).join('')}
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
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Shipping benefit</span><span class="coupons-modal-stat-value">${escapeHtml(shippingBenefitModeLabel(couponShippingModeFromRow(d)))}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Total cap per code</span><span class="coupons-modal-stat-value">${escapeHtml(d.defaultUsageLimit != null ? String(d.defaultUsageLimit) : '—')}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Cap per customer</span><span class="coupons-modal-stat-value">${escapeHtml(d.defaultUsesPerCode != null ? String(d.defaultUsesPerCode) : '—')}</span></div>
    </div>
    <div class="coupons-modal-pill-groups" aria-label="Coupon behavior">
      ${isProductList ? '' : couponDetailPillGroupHtml('Discount calculation', couponDiscountBasisStatePill(id))}
      ${isProductList ? '' : couponDetailPillGroupHtml('On-sale products', couponOnSaleEligibilityStatePill(d))}
      ${couponDetailPillGroupHtml(
    'Program',
    [
      pillHtml('Shipping benefit', couponShippingModeFromRow(d) !== 'none'),
      pillHtml('Stacks with rules', d.stackable !== false),
      pillHtml('Auto-apply', !!d.autoApply),
      pillHtml('Manual entry', d.allowManualEntry !== false),
    ].join(''),
  )}
    </div>
    ${isProductList ? couponDiscountedProductsSectionHtml(discountedProducts) : `<section class="coupons-modal-section">
      <h3 class="coupons-modal-section-title">Included products</h3>
      <p class="coupons-field-hint" style="margin:0 0 8px">Products and categories the coupon applies to. Leave empty to allow any product unless excluded below.</p>
      <div class="coupons-modal-tags ps-pills" data-cp-scope-pills="included" data-cp-scope-empty="None (any product unless excluded below)"></div>
    </section>
    <section class="coupons-modal-section">
      <h3 class="coupons-modal-section-title">Excluded products</h3>
      <p class="coupons-field-hint" style="margin:0 0 8px">Products and categories that disqualify the coupon when present in the cart.</p>
      <div class="coupons-modal-tags ps-pills" data-cp-scope-pills="excluded" data-cp-scope-empty="None"></div>
    </section>`}
    ${d.notes && String(d.notes).trim()
    ? `<section class="coupons-modal-section"><h3 class="coupons-modal-section-title">Notes</h3><div class="coupons-modal-notes">${escapeHtml(String(d.notes).trim())}</div></section>`
    : ''}
    <div class="coupons-modal-codes" data-cp-modal-codes-mount>${renderCodesSection()}</div>`;
}

function closeCouponDetailDialog() {
  const el = document.querySelector('dialog.coupons-detail-dialog');
  if (!el) return;
  if (el.open) el.close();
  el.remove();
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
      setCouponDiscountApplyToSalePrice(state.selectedCouponId, false);
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

async function openCouponDetailModal() {
  closeCouponDetailDialog();
  const d = state.couponDetail;
  if (!d || !state.selectedCouponId) return;
  try {
    await fetchCodesForCoupon();
  } catch (err) {
    console.warn('[commerce-admin/coupons] load codes on modal open failed', {
      couponId: state.selectedCouponId,
      message: err?.message,
    });
    state.codes = [];
    state.codesNextCursor = '';
    setError(err.message || 'Could not load codes for this coupon.');
    showToast(err.message || 'Failed to load codes', 'error');
  }
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
  hydrateCouponDetailScopePills(humanWrap, d);

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
  const prevBodyOverflow = document.body.style.overflow;
  dialog.addEventListener('close', () => {
    document.body.style.overflow = prevBodyOverflow;
  }, { once: true });
  wireCouponDetailModal(dialog);
  bindCodesEvents(dialog);
  document.body.style.overflow = 'hidden';
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
  /** Overview grid sort (default: title A–Z). */
  overviewSortKey: /** @type {'title'|'id'|'discount'|'min'|'cap'|'freeship'|'stack'|'year'|'market'} */ ('title'),
  overviewSortDir: /** @type {'asc'|'desc'} */ ('asc'),
  /** Mock-only: coupon id → apply discount to sale price (default regular price). */
  couponDiscountApplyToSale: /** @type {Record<string, boolean>} */ ({}),
};

/** @param {string} couponId */
function couponDiscountAppliesToSalePrice(couponId) {
  return Boolean(state.couponDiscountApplyToSale[String(couponId || '').trim()]);
}

/** @param {string} couponId @param {boolean} appliesToSale */
function setCouponDiscountApplyToSalePrice(couponId, appliesToSale) {
  const id = String(couponId || '').trim();
  if (!id) return;
  if (appliesToSale) state.couponDiscountApplyToSale[id] = true;
  else delete state.couponDiscountApplyToSale[id];
}

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
  const discountedProducts = row.discountedProducts ?? row.discounted_products;
  if (Array.isArray(discountedProducts) && discountedProducts.length) {
    return `Product list (${discountedProducts.length})`;
  }
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

/** @param {object} row coupon list row */
function couponOverviewSortValue(row, key) {
  const id = couponIdFromRow(row);
  const pathSeg = parseCouponTypePath(id);
  switch (key) {
    case 'title': return String(row.name ?? '').toLowerCase();
    case 'id': return id.toLowerCase();
    case 'discount': {
      const n = Number(row.discountValue);
      return Number.isFinite(n) ? n : 0;
    }
    case 'min': {
      const n = Number(row.minimumOrderAmount);
      return Number.isFinite(n) ? n : 0;
    }
    case 'cap': {
      const n = Number(row.maximumDiscountAmount);
      return Number.isFinite(n) ? n : 0;
    }
    case 'freeship': return shippingBenefitModeSortRank(couponShippingModeFromRow(row));
    case 'stack': return row.stackable !== false ? 1 : 0;
    case 'year': return pathSeg && pathSeg.year ? Number(pathSeg.year) || 0 : 0;
    case 'market': return normalizeCouponCountries(row).join(',');
    default: return '';
  }
}

/**
 * @param {object[]} rows
 * @param {string} key
 * @param {'asc'|'desc'} dir
 */
function sortCouponOverviewRows(rows, key, dir) {
  const numeric = new Set(['discount', 'min', 'cap', 'freeship', 'stack', 'year']);
  const m = dir === 'desc' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const va = couponOverviewSortValue(a, key);
    const vb = couponOverviewSortValue(b, key);
    let cmp = 0;
    if (numeric.has(key)) {
      cmp = (Number(va) || 0) - (Number(vb) || 0);
    } else {
      cmp = String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true });
    }
    if (cmp !== 0) return m * cmp;
    return String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' });
  });
}

/**
 * @param {string} key
 * @param {string} label
 * @param {string} [extraClass]
 */
function couponSortableTh(key, label, extraClass = '') {
  const active = state.overviewSortKey === key;
  let aria = 'none';
  let ind = '';
  if (active) {
    aria = state.overviewSortDir === 'asc' ? 'ascending' : 'descending';
    ind = state.overviewSortDir === 'asc' ? ' ▲' : ' ▼';
  }
  const classAttr = extraClass.trim() ? ` class="${escapeHtml(extraClass.trim())}"` : '';
  return `<th scope="col"${classAttr} aria-sort="${aria}"><button type="button" class="pim-th-sort-btn" data-cp-sort="${escapeHtml(key)}">${escapeHtml(label)}${escapeHtml(ind)}</button></th>`;
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
    const ship = shippingBenefitModeLabel(couponShippingModeFromRow(row));
    const stack = yn(row.stackable !== false);
    const label = `Open coupon ${String(name)}`;
    const countries = normalizeCouponCountries(row);
    const mHtml = countries.length
      ? countries.map((k) => commerceMarketEmojiHtml(k)).join('')
      : commerceMarketEmojiHtml(couponMarketPrefixFromId(id));
    return `<tr class="coupons-grid-row coupons-row-open" data-cp-coupon-id="${escapeHtml(id)}" tabindex="0" role="button" aria-label="${escapeHtml(label)}">
      <td class="coupons-grid-lead coupons-grid-name">${escapeHtml(String(name))}</td>
      <td><code class="coupons-grid-id">${escapeHtml(id || '—')}</code></td>
      <td>${escapeHtml(disc)}</td>
      <td>${escapeHtml(min)}</td>
      <td>${escapeHtml(cap)}</td>
      <td>${escapeHtml(ship)}</td>
      <td>${escapeHtml(stack)}</td>
      <td class="coupons-grid-col-year">${commerceGroupBadgeHtml(year)}</td>
      <td class="coupons-grid-col-market">${mHtml}</td>
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

/** Copy for the leave guard when a coupon dialog was edited and not saved. */
const UNSAVED_COUPON_DIALOG_LEAVE = [
  'You have unsaved changes. If you leave now, your edits will be lost.',
  '',
  'Leave without saving?',
].join('\n');

/**
 * Stable snapshot of values in `root` for dirty checks (tree order).
 * @param {Element | null} root
 */
function serializeCouponsDialogFormSnapshot(root) {
  if (!root) return '';
  const parts = [];
  const els = root.querySelectorAll('input, textarea, select');
  els.forEach((el, i) => {
    if (el instanceof HTMLInputElement) {
      if (el.disabled) return;
      const t = el.type;
      if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image' || t === 'hidden') {
        return;
      }
      const key = el.id || `${el.name || 'field'}:${i}:${t}:${el.value}`;
      if (t === 'checkbox' || t === 'radio') {
        parts.push(`${key}\t${t}\t${el.checked ? '1' : '0'}`);
      } else {
        parts.push(`${key}\t${t}\t${el.value}`);
      }
    } else if (el instanceof HTMLTextAreaElement) {
      if (el.disabled) return;
      const key = el.id || `textarea:${i}`;
      parts.push(`${key}\tta\t${el.value}`);
    } else if (el instanceof HTMLSelectElement) {
      if (el.disabled) return;
      const key = el.id || `select:${i}`;
      parts.push(`${key}\tsel\t${el.value}`);
    }
  });
  return parts.join('\n');
}

async function openDialog(title, innerHtml, onSubmit, afterMount, dialogClass, submitLabel = 'Save') {
  const dialog = document.createElement('dialog');
  dialog.className = `coupons-dialog${dialogClass ? ` ${dialogClass}` : ''}`;
  dialog.innerHTML = `
    <div class="coupons-dialog-inner">
      <div class="coupons-dialog-scroll" tabindex="-1">
        <h2 class="coupons-dialog-title">${escapeHtml(title)}</h2>
        ${innerHtml}
      </div>
      <div class="coupons-dialog-actions">
        <button type="button" class="coupons-btn" data-cp-cancel>Cancel</button>
        <button type="button" class="coupons-btn coupons-btn-primary" data-cp-submit>${escapeHtml(submitLabel)}</button>
      </div>
    </div>`;
  document.body.appendChild(dialog);
  const prevBodyOverflow = document.body.style.overflow;
  const scrollRoot = dialog.querySelector('.coupons-dialog-scroll');
  let baseline = '';
  const recaptureBaseline = () => {
    baseline = serializeCouponsDialogFormSnapshot(scrollRoot);
  };
  const formIsDirty = () => Boolean(scrollRoot)
    && serializeCouponsDialogFormSnapshot(scrollRoot) !== baseline;
  const confirmLeaveIfDirty = () => {
    if (!formIsDirty()) return true;
    /* eslint-disable-next-line no-alert -- leave guard; matches other confirm flows in this page */
    return window.confirm(UNSAVED_COUPON_DIALOG_LEAVE);
  };
  const dismissDialog = () => {
    dialog.close();
    dialog.remove();
  };
  const tryDismiss = () => {
    if (!confirmLeaveIfDirty()) return;
    dismissDialog();
  };
  const onBeforeUnload = (e) => {
    if (!formIsDirty()) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  const onDialogClose = () => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.body.style.overflow = prevBodyOverflow;
    document.querySelector('datalist#cp-form-categories-datalist')?.remove();
    couponProductSelectionFields.forEach((f) => f.destroy());
    couponProductSelectionFields = [];
  };
  dialog.addEventListener('close', onDialogClose, { once: true });
  if (typeof afterMount === 'function') {
    await Promise.resolve(afterMount(dialog));
  }
  recaptureBaseline();
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(recaptureBaseline);
  });
  dialog.querySelector('[data-cp-cancel]')?.addEventListener('click', () => {
    tryDismiss();
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
      tryDismiss();
    }
  });
  wireDialogEscapeDismiss(dialog, () => {
    tryDismiss();
  });
  document.body.style.overflow = 'hidden';
  dialog.showModal();
}

function couponFormOptionRow(id, label, detail) {
  return `<div class="cp-form-option">
    <label class="cp-form-checkbox" for="${escapeHtml(id)}">
      <input type="checkbox" id="${escapeHtml(id)}" />
      <span class="cp-form-checkbox-label">${escapeHtml(label)}</span>
    </label>
    <p class="coupons-field-hint cp-form-option-detail">${detail}</p>
  </div>`;
}

/** @param {string} title @param {string} rowsHtml @param {string} [attrs] */
function couponFormOptionsSubgroupHtml(title, rowsHtml, attrs = '') {
  return `<div class="cp-form-options-subgroup"${attrs ? ` ${attrs}` : ''}>
    <h4 class="cp-form-options-subtitle">${escapeHtml(title)}</h4>
    <div class="cp-form-options-list">${rowsHtml}</div>
  </div>`;
}

/** @param {{ editMode?: boolean }} [opts] */
function couponFormOptionsSectionHtml(opts = {}) {
  const editMode = Boolean(opts.editMode);
  const subgroups = [];

  if (editMode) {
    subgroups.push(couponFormOptionsSubgroupHtml(
      'Discount calculation',
      couponFormOptionRow(
        'cp-form-apply-to-sale',
        'Calculate discount from sale price',
        'Which price the discount amount is based on. Unchecked uses regular price (default); checked uses the current sale price. UX mock only — not persisted yet.',
      ),
      'data-cp-discount-only',
    ));
  }

  subgroups.push(couponFormOptionsSubgroupHtml(
    'On-sale products',
    couponFormOptionRow(
      'cp-form-exclude-discounted',
      'Block coupon on products that are on sale',
      'Whether this coupon can be used at all on items that already have a catalog sale price. Separate from the discount calculation base above.',
    ),
    'data-cp-discount-only',
  ));

  subgroups.push(couponFormOptionsSubgroupHtml(
    'Checkout & stacking',
    [
      couponFormOptionRow(
        'cp-form-stackable',
        'Allow stacking with automatic pricing rules',
        'When enabled, this coupon can combine with catalog promotions and cart rules instead of being blocked.',
      ),
      couponFormOptionRow(
        'cp-form-auto',
        'Auto-apply hint',
        'Marks the coupon for automatic application when supported (for example via an affiliate URL parameter).',
      ),
      couponFormOptionRow(
        'cp-form-manual',
        'Allow manual code entry',
        'When enabled, customers can enter a coupon code at checkout. Turn off for auto-apply-only programs.',
      ),
    ].join(''),
  ));

  return `<div class="coupons-field coupons-field-full cp-form-options-group">
    <h3 class="cp-form-options-title">Behavior &amp; eligibility</h3>
    ${subgroups.join('')}
  </div>`;
}

function couponFormHtml({ idReadonly }) {
  const idBlock = idReadonly
    ? `<div class="coupons-field coupons-field-full">
        <label for="cp-form-id">Coupon ID</label>
        <input type="text" id="cp-form-id" autocomplete="off" readonly class="coupons-readonly" required />
        <p class="coupons-field-hint">Ids use <code>country-year-key</code> (e.g. <code>us-2026-spring-sale</code>).</p>
      </div>${editCouponCountryFieldsHtml()}`
    : `${newCouponIdFieldsHtml()}`;

  return `
    <p class="coupons-page-lead" style="margin-bottom:12px">Describe how this coupon behaves. Amounts are in storefront currency unless noted otherwise.</p>
    <div class="cp-form-tabs" role="tablist" aria-label="Coupon type">
      <button type="button" class="cp-form-tab" role="tab" data-cp-coupon-tab="discount" aria-selected="true">Discount</button>
      <button type="button" class="cp-form-tab" role="tab" data-cp-coupon-tab="productlist" aria-selected="false" tabindex="-1">Product list</button>
    </div>
    <div class="coupons-form-grid">
      ${idBlock}
      <div class="coupons-field coupons-field-full">
        <label for="cp-form-name">Display name</label>
        <input type="text" id="cp-form-name" autocomplete="off" required />
      </div>
      <div class="coupons-field" data-cp-discount-only>
        <label for="cp-form-discount-type">Discount style</label>
        <select id="cp-form-discount-type">
          <option value="percentage">Percentage off order</option>
          <option value="fixed">Fixed dollars off order</option>
        </select>
      </div>
      <div class="coupons-field" data-cp-discount-only>
        <label for="cp-form-discount-value">Discount value</label>
        <input type="number" id="cp-form-discount-value" min="0" step="any" placeholder="25 = 25% or $25" />
      </div>
      <div class="coupons-field">
        <label for="cp-form-min">Minimum order subtotal ($)</label>
        <input type="number" id="cp-form-min" min="0" step="any" placeholder="0 = none" />
      </div>
      <div class="coupons-field">
        <label for="cp-form-max-cap">Max discount cap ($)</label>
        <input type="number" id="cp-form-max-cap" min="0" step="any" placeholder="empty = no cap" />
      </div>
      ${couponProductListSectionHtml()}
      <div class="coupons-field coupons-field-full" data-cp-discount-only>
        <label>Included products</label>
        <p class="coupons-field-hint">Products and categories the coupon applies to. Leave empty for no include filter. Uses the product index for the primary selected country (see Countries above).</p>
        <div data-cp-psf-mount="included"></div>
        <input type="text" id="cp-form-included" autocomplete="off" />
        <input type="text" id="cp-form-included-products" autocomplete="off" />
      </div>
      <div class="coupons-field coupons-field-full" data-cp-discount-only>
        <label>Excluded products</label>
        <p class="coupons-field-hint">Products and categories that disqualify the coupon. Cannot be set together with included product paths.</p>
        <div data-cp-psf-mount="excluded"></div>
        <input type="text" id="cp-form-excluded" autocomplete="off" />
        <input type="text" id="cp-form-excluded-products" autocomplete="off" />
      </div>
      <div class="coupons-field coupons-field-full">
        <label for="cp-form-shipping">Shipping benefit</label>
        <select id="cp-form-shipping">
          ${shippingBenefitSelectOptionsHtml('none', escapeHtml)}
        </select>
        <p class="coupons-field-hint">Same options as cart rules: standard only, or standard and priority.</p>
      </div>
      ${couponFormOptionsSectionHtml({ editMode: idReadonly })}
      <div class="coupons-field">
        <label for="cp-form-def-limit">Total cap per code (default)</label>
        <input type="number" id="cp-form-def-limit" min="0" step="1" placeholder="empty = unlimited" />
      </div>
      <div class="coupons-field">
        <label for="cp-form-def-per-code">Cap per customer (default)</label>
        <input type="number" id="cp-form-def-per-code" min="0" step="1" placeholder="empty = unlimited" />
      </div>
      <div class="coupons-field coupons-field-full">
        <label for="cp-form-notes">Notes (internal)</label>
        <textarea id="cp-form-notes" rows="2" placeholder="Shown only in admin"></textarea>
      </div>
    </div>`;
}

const COUPON_MODE_SWITCH_EDIT_WARNING = 'Switching coupon type will clear the current settings and overwrite this coupon\'s saved definition when you save. Continue?';

/**
 * Show the fields for one coupon mode and hide the other's. Purely visual —
 * clearing the outgoing mode's values is the caller's job (wireCouponFormTabs),
 * so this is safe to call on initial mount without wiping loaded data.
 * @param {HTMLElement} dlg
 * @param {'discount'|'productlist'} mode
 */
function setCouponFormMode(dlg, mode) {
  const next = mode === 'productlist' ? 'productlist' : 'discount';
  dlg.dataset.cpCouponMode = next;
  dlg.querySelectorAll('[data-cp-coupon-tab]').forEach((tab) => {
    const active = tab.getAttribute('data-cp-coupon-tab') === next;
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    if (tab instanceof HTMLElement) tab.tabIndex = active ? 0 : -1;
  });
  dlg.querySelectorAll('[data-cp-discount-only]').forEach((el) => {
    if (el instanceof HTMLElement) el.hidden = next !== 'discount';
  });
  dlg.querySelectorAll('[data-cp-plc-only]').forEach((el) => {
    if (el instanceof HTMLElement) el.hidden = next !== 'productlist';
  });
}

/** Reset the flat-discount / scoping fields (the fields a product-list coupon rejects). */
function clearCouponDiscountModeFields(dlg) {
  const type = dlg.querySelector('#cp-form-discount-type');
  if (type instanceof HTMLSelectElement) type.value = 'percentage';
  ['#cp-form-discount-value', '#cp-form-included', '#cp-form-included-products',
    '#cp-form-excluded', '#cp-form-excluded-products'].forEach((sel) => {
    const el = dlg.querySelector(sel);
    if (el instanceof HTMLInputElement) el.value = '';
  });
  ['#cp-form-exclude-discounted', '#cp-form-apply-to-sale'].forEach((sel) => {
    const el = dlg.querySelector(sel);
    if (el instanceof HTMLInputElement) el.checked = false;
  });
  // Re-render the product-selection pills now that their backing inputs are empty.
  couponProductSelectionFields.forEach((f) => { f.refresh().catch(() => {}); });
}

/** Reset the discounted-products grid to a single empty row. */
function clearCouponProductListFields(dlg) {
  fillCouponProductList(dlg, []);
}

/**
 * @param {HTMLElement} dlg
 * @param {{ isEdit?: boolean }} [opts]
 */
function wireCouponFormTabs(dlg, { isEdit = false } = {}) {
  dlg.querySelectorAll('[data-cp-coupon-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-cp-coupon-tab') === 'productlist' ? 'productlist' : 'discount';
      const current = dlg.dataset.cpCouponMode === 'productlist' ? 'productlist' : 'discount';
      if (target === current) return;
      // Editing an existing coupon: switching type discards its current
      // definition and overwrites it on save, so confirm first.
      /* eslint-disable-next-line no-alert -- destructive: overwrites the saved coupon definition */
      if (isEdit && !window.confirm(COUPON_MODE_SWITCH_EDIT_WARNING)) return;
      // Drop the mode we're leaving so its (now conflicting) fields can't be sent.
      if (current === 'discount') clearCouponDiscountModeFields(dlg);
      else clearCouponProductListFields(dlg);
      setCouponFormMode(dlg, target);
    });
  });
  setCouponFormMode(
    dlg,
    dlg.dataset.cpCouponMode === 'productlist' ? 'productlist' : 'discount',
  );
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
  if (requireId && dlg.querySelector('input.cp-new-country-cb')) {
    const selected = readCouponCountryCheckboxValues(dlg, 'input.cp-new-country-cb');
    if (!selected.length) throw new Error('Select at least one country.');
    const country = firstCouponCountryInApiOrder(selected);
    const year = dlg.querySelector('#cp-new-year')?.value?.trim() || '';
    const labelRaw = dlg.querySelector('#cp-new-label')?.value?.trim() || '';
    if (!year || !labelRaw) {
      throw new Error('Year and program key are required');
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

  // The active tab decides which discount shape is persisted. The other tab's
  // fields are intentionally omitted from the body — a product-list coupon and
  // the flat discount/scoping fields are mutually exclusive and the API rejects
  // them together, so switching tabs and saving drops the now-irrelevant fields.
  const mode = dlg.dataset.cpCouponMode === 'productlist' ? 'productlist' : 'discount';

  const minRaw = dlg.querySelector('#cp-form-min')?.value;
  const minimumOrderAmount = minRaw != null && String(minRaw).trim() !== '' ? Number(minRaw) : 0;
  const maxCap = readOptionalInt(dlg.querySelector('#cp-form-max-cap')?.value);
  const shippingMode = normalizeShippingBenefitMode(dlg.querySelector('#cp-form-shipping')?.value);
  const shipFields = shippingBenefitFieldsFromMode(shippingMode);
  const stackable = !!dlg.querySelector('#cp-form-stackable')?.checked;
  const autoApply = !!dlg.querySelector('#cp-form-auto')?.checked;
  const allowManualEntry = !!dlg.querySelector('#cp-form-manual')?.checked;
  const defaultUsageLimit = readOptionalInt(dlg.querySelector('#cp-form-def-limit')?.value);
  const defaultUsesPerCode = readOptionalInt(dlg.querySelector('#cp-form-def-per-code')?.value);
  const notes = dlg.querySelector('#cp-form-notes')?.value?.trim() || '';

  const body = {
    id: id || state.selectedCouponId,
    name,
    minimumOrderAmount: Number.isFinite(minimumOrderAmount) ? minimumOrderAmount : 0,
    maximumDiscountAmount: maxCap,
    ...shipFields,
    stackable,
    autoApply,
    allowManualEntry,
    defaultUsageLimit,
    defaultUsesPerCode,
    notes,
  };

  if (mode === 'productlist') {
    body.discountedProducts = readCouponDiscountedProductsFromDom(dlg);
  } else {
    const discountType = dlg.querySelector('#cp-form-discount-type')?.value || 'percentage';
    const discountValRaw = dlg.querySelector('#cp-form-discount-value')?.value;
    const discountValue = Number(discountValRaw);
    if (!Number.isFinite(discountValue) || discountValue < 0) throw new Error('Discount value must be a valid number');
    const includedRaw = dlg.querySelector('#cp-form-included')?.value || '';
    const includedCategories = includedRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const excludedRaw = dlg.querySelector('#cp-form-excluded')?.value || '';
    const excludedCategories = excludedRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const includedProducts = parseProductConditionsInput(
      dlg.querySelector('#cp-form-included-products')?.value || '',
    );
    const excludedProducts = parseProductConditionsInput(
      dlg.querySelector('#cp-form-excluded-products')?.value || '',
    );
    if (includedProducts.length && excludedProducts.length) {
      throw new Error('Included and excluded product paths cannot both be set on the same coupon.');
    }
    body.discountType = discountType;
    body.discountValue = discountValue;
    body.includedCategories = includedCategories;
    body.excludedCategories = excludedCategories;
    body.includedProducts = includedProducts;
    body.excludedProducts = excludedProducts;
    body.excludeDiscountedProducts = !!dlg.querySelector('#cp-form-exclude-discounted')?.checked;
  }
  const seg = parseCouponTypePath(String(body.id || ''));
  const countries = readCouponCountriesFromForm(dlg);
  const hasCountryFields = dlg.querySelector('input.cp-new-country-cb')
    || dlg.querySelector('input.cp-edit-country-cb');
  if (hasCountryFields) {
    if (!countries.length) throw new Error('Select at least one country.');
    if (countries.length === 1) {
      const [only] = countries;
      body.country = only;
    } else {
      body.countries = countries;
    }
  } else if (seg && /^(us|ca|mx)$/.test(seg.country)) {
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

/**
 * Edit dialog: pre-check country toggles from API `countries` (or fallbacks).
 * @param {HTMLDialogElement} dlg
 * @param {object} d coupon type
 */
function applyCouponCountryCheckboxesFromDetail(dlg, d) {
  const editCbs = dlg.querySelectorAll('input.cp-edit-country-cb');
  if (!editCbs.length) return;
  const keys = normalizeCouponCountries(d);
  const resolved = keys.length ? keys : ['us'];
  editCbs.forEach((cb) => {
    if (cb instanceof HTMLInputElement) cb.checked = resolved.includes(cb.value);
  });
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
  const incList = d.includedCategories ?? d.included_categories;
  const inc = dlg.querySelector('#cp-form-included');
  if (inc) inc.value = Array.isArray(incList) ? incList.join(', ') : '';
  const exList = d.excludedCategories ?? d.excluded_categories;
  const ex = dlg.querySelector('#cp-form-excluded');
  if (ex) ex.value = Array.isArray(exList) ? exList.join(', ') : '';
  const incProdEl = dlg.querySelector('#cp-form-included-products');
  if (incProdEl) {
    incProdEl.value = formatProductConditionsForForm(d.includedProducts ?? d.included_products);
  }
  const exProdEl = dlg.querySelector('#cp-form-excluded-products');
  if (exProdEl) {
    exProdEl.value = formatProductConditionsForForm(d.excludedProducts ?? d.excluded_products);
  }
  const shipEl = dlg.querySelector('#cp-form-shipping');
  if (shipEl instanceof HTMLSelectElement) {
    shipEl.value = couponShippingModeFromRow(d);
  }
  dlg.querySelector('#cp-form-stackable').checked = d.stackable !== false;
  dlg.querySelector('#cp-form-exclude-discounted').checked = !!(
    d.excludeDiscountedProducts ?? d.exclude_discounted_products
  );
  dlg.querySelector('#cp-form-auto').checked = !!d.autoApply;
  dlg.querySelector('#cp-form-manual').checked = d.allowManualEntry !== false;
  dlg.querySelector('#cp-form-def-limit').value = d.defaultUsageLimit != null ? String(d.defaultUsageLimit) : '';
  dlg.querySelector('#cp-form-def-per-code').value = d.defaultUsesPerCode != null ? String(d.defaultUsesPerCode) : '';
  dlg.querySelector('#cp-form-notes').value = d.notes ?? '';
  const applySaleEl = dlg.querySelector('#cp-form-apply-to-sale');
  if (applySaleEl instanceof HTMLInputElement) {
    applySaleEl.checked = couponDiscountAppliesToSalePrice(String(d.id ?? state.selectedCouponId ?? ''));
  }
  applyCouponCountryCheckboxesFromDetail(dlg, d);

  // A non-empty discountedProducts array marks a product-list coupon: select
  // that tab and populate the grid. wireCouponFormTabs (called after this in the
  // afterMount hook) reads dlg.dataset.cpCouponMode to apply field visibility.
  const discountedProducts = d.discountedProducts ?? d.discounted_products;
  if (Array.isArray(discountedProducts) && discountedProducts.length) {
    dlg.dataset.cpCouponMode = 'productlist';
    fillCouponProductList(dlg, discountedProducts);
  } else {
    dlg.dataset.cpCouponMode = 'discount';
  }
}

function renderCodesSection() {
  if (!state.selectedCouponId) {
    return '<p class="coupons-empty">Select a coupon to show its codes.</p>';
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
    : '<tr><td colspan="4" class="coupons-empty" style="padding:16px">No codes for this coupon yet.</td></tr>';

  return `
    <h3 class="coupons-section-title">Codes for this coupon</h3>
    <div class="coupons-detail-actions">
      <button type="button" class="coupons-btn" data-cp-refresh-codes>Refresh</button>
      <button type="button" class="coupons-btn" data-cp-add-codes>Add new codes...</button>
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
  mount.querySelector('[data-cp-refresh-codes]')?.addEventListener('click', async () => {
    try {
      await fetchCodesForCoupon();
      setError('');
      afterCodesRefresh();
    } catch (err) {
      console.warn('[commerce-admin/coupons] refresh codes failed', {
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
  mount.querySelector('[data-cp-add-codes]')?.addEventListener('click', () => openAddCodesDialog());
  mount.querySelector('[data-cp-batch]')?.addEventListener('click', () => openBatchDialog());
}

function render() {
  const mount = document.getElementById('coupons-mount');
  if (!mount) return;

  const filtered = couponsVisibleForMarket();
  const sorted = sortCouponOverviewRows(filtered, state.overviewSortKey, state.overviewSortDir);
  const overviewBody = renderCouponsOverviewBody(sorted);

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
              ${couponSortableTh('title', 'Title')}
              ${couponSortableTh('id', 'Id')}
              ${couponSortableTh('discount', 'Discount')}
              ${couponSortableTh('min', 'Min order')}
              ${couponSortableTh('cap', 'Cap')}
              ${couponSortableTh('freeship', 'Shipping')}
              ${couponSortableTh('stack', 'Stack')}
              ${couponSortableTh('year', 'Year', 'coupons-grid-col-year')}
              ${couponSortableTh('market', 'Market', 'coupons-grid-col-market')}
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

  mount.querySelector('table.coupons-grid-table')?.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement | null} */ (e.target)?.closest('[data-cp-sort]');
    if (!btn || !(btn instanceof HTMLButtonElement)) return;
    e.preventDefault();
    e.stopPropagation();
    const key = btn.getAttribute('data-cp-sort');
    if (!key) return;
    const allowed = ['title', 'id', 'discount', 'min', 'cap', 'freeship', 'stack', 'year', 'market'];
    if (!allowed.includes(key)) return;
    if (state.overviewSortKey === key) {
      state.overviewSortDir = state.overviewSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.overviewSortKey = /** @type {typeof state.overviewSortKey} */ (key);
      state.overviewSortDir = 'asc';
    }
    render();
  });

  mount.querySelectorAll('tr.coupons-grid-row[data-cp-coupon-id]').forEach((rowEl) => {
    const openRow = async () => {
      const id = rowEl.getAttribute('data-cp-coupon-id') || '';
      if (!id) return;
      state.selectedCouponId = id;
      try {
        await refreshSelection();
        render();
        await openCouponDetailModal();
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
      await openCouponDetailModal();
    },
    async (dlg) => {
      dlg.querySelector('#cp-form-stackable').checked = true;
      dlg.querySelector('#cp-form-manual').checked = true;
      const yearEl = dlg.querySelector('#cp-new-year');
      const labelEl = dlg.querySelector('#cp-new-label');
      const previewEl = dlg.querySelector('#cp-new-id-preview');
      const syncPreview = () => {
        const selected = readCouponCountryCheckboxValues(dlg, 'input.cp-new-country-cb');
        const country = selected.length ? firstCouponCountryInApiOrder(selected) : 'us';
        const year = yearEl?.value || String(new Date().getFullYear());
        const slug = slugifyCouponLabelSegment(labelEl?.value || '');
        if (previewEl) {
          previewEl.textContent = slug ? `${country}-${year}-${slug}` : `${country}-${year}-…`;
        }
      };
      dlg.querySelectorAll('input.cp-new-country-cb').forEach((cb) => {
        if (cb instanceof HTMLInputElement) {
          cb.checked = ['us', 'ca', 'mx'].includes(state.marketFilter) && cb.value === state.marketFilter;
        }
      });
      if (!readCouponCountryCheckboxValues(dlg, 'input.cp-new-country-cb').length) {
        const us = dlg.querySelector('input.cp-new-country-cb[value="us"]');
        if (us instanceof HTMLInputElement) us.checked = true;
      }
      wireCouponCountryCheckboxGuards(dlg);
      [yearEl, labelEl].forEach((el) => {
        el?.addEventListener('input', syncPreview);
        el?.addEventListener('change', syncPreview);
      });
      dlg.querySelectorAll('input.cp-new-country-cb').forEach((cb) => {
        cb.addEventListener('change', syncPreview);
      });
      syncPreview();
      wireCouponProductSelectionFields(dlg);
      wireCouponProductListRows(dlg);
      wireCouponFormTabs(dlg);
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
      const applyToSale = !!dlg.querySelector('#cp-form-apply-to-sale')?.checked;
      await couponsApiFetch(
        `coupons/types/${encodeURIComponent(state.selectedCouponId)}`,
        { method: 'PUT', body: JSON.stringify(body) },
      );
      setCouponDiscountApplyToSalePrice(state.selectedCouponId, applyToSale);
      showToast(
        applyToSale
          ? 'Coupon updated. Discount basis (sale price) is a UX mock and was not saved yet.'
          : 'Coupon updated',
        'success',
      );
      await refreshSelection();
      afterCodesRefresh();
    },
    async (dlg) => {
      fillCouponForm(dlg, snap);
      wireCouponCountryCheckboxGuards(dlg);
      wireCouponProductSelectionFields(dlg);
      wireCouponProductListRows(dlg);
      wireCouponFormTabs(dlg, { isEdit: true });
    },
    'coupons-dialog-wide',
  );
}

function toDatetimeLocalValue(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseExpiresCellToLocal(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return toDatetimeLocalValue(d);
  return '';
}

function isCouponCodesTsvHeaderLine(parts) {
  const a = String(parts[0] || '').trim().toLowerCase();
  return a === 'code' || a === 'coupon code' || a === 'couponcode';
}

/**
 * First TSV column is the coupon code; optional Expires and limits in later columns.
 * @param {string} text
 * @return {Array<{ code: string, expiresLocal?: string, usageLimit?: number,
 *   usesPerCustomer?: number }>}
 */
function parseCouponCodesTsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const splitLines = raw.split(/\r\n|\n|\r/).map((l) => l.replace(/\r$/, ''));
  const trimmed = splitLines.filter((line) => line.trim());
  const allParts = trimmed.map((line) => line.split('\t').map((c) => c.trim()));
  const dataRows = allParts.length && isCouponCodesTsvHeaderLine(allParts[0])
    ? allParts.slice(1)
    : allParts;
  return dataRows
    .filter((parts) => parts[0])
    .map((parts) => {
      const code = parts[0];
      /** @type {{ code: string, expiresLocal?: string, usageLimit?: number,
       *   usesPerCustomer?: number }} */
      const row = { code };
      if (parts[1]) {
        const el = parseExpiresCellToLocal(parts[1]);
        if (el) row.expiresLocal = el;
      }
      const lim = readOptionalInt(parts[2]);
      if (lim != null) row.usageLimit = lim;
      const upc = readOptionalInt(parts[3]);
      if (upc != null) row.usesPerCustomer = upc;
      return row;
    });
}

/**
 * @param {{ code?: string, expiresLocal?: string, usageLimit?: number,
 *   usesPerCustomer?: number }} [row]
 */
function couponAddCodesRowHtml(row = {}) {
  const code = escapeHtml(String(row.code ?? ''));
  const exp = escapeHtml(String(row.expiresLocal ?? ''));
  const lim = row.usageLimit != null && `${row.usageLimit}` !== ''
    ? escapeHtml(String(row.usageLimit))
    : '';
  const per = row.usesPerCustomer != null && `${row.usesPerCustomer}` !== ''
    ? escapeHtml(String(row.usesPerCustomer))
    : '';
  const rmBtn = '<button type="button" class="cp-add-codes-remove" data-cp-add-code-remove '
    + 'aria-label="Remove row">×</button>';
  return `<tr data-cp-add-code-line>
    <td class="cp-add-codes-col-del">${rmBtn}</td>
    <td class="cp-add-codes-num-col"><span class="cp-add-codes-num"></span></td>
    <td><input type="text" class="cp-add-codes-input cp-add-codes-input-code" data-cp-add-code-val `
    + `autocomplete="off" placeholder="Coupon code" value="${code}" /></td>
    <td><input type="datetime-local" class="cp-add-codes-input" data-cp-add-code-exp value="${exp}" /></td>
    <td><input type="number" class="cp-add-codes-input" data-cp-add-code-limit min="0" step="1" `
    + `placeholder="∞" value="${lim}" /></td>
    <td><input type="number" class="cp-add-codes-input" data-cp-add-code-per min="0" step="1" `
    + `placeholder="∞" value="${per}" /></td>
  </tr>`;
}

/** @param {HTMLDialogElement} dlg */
function refreshAddCodesLineIndices(dlg) {
  const lines = dlg.querySelectorAll('tr[data-cp-add-code-line]');
  lines.forEach((tr, i) => {
    const num = tr.querySelector('.cp-add-codes-num');
    if (num) num.textContent = String(i + 1);
    const rm = tr.querySelector('[data-cp-add-code-remove]');
    if (rm instanceof HTMLButtonElement) {
      rm.disabled = lines.length <= 1;
    }
  });
}

/** @param {HTMLDialogElement} dlg */
function readCouponCodeBodiesFromAddGrid(dlg) {
  const typeId = state.selectedCouponId;
  const lines = [...dlg.querySelectorAll('tr[data-cp-add-code-line]')];
  return lines.map((tr) => {
    const code = tr.querySelector('[data-cp-add-code-val]')?.value?.trim() ?? '';
    /** @type {{ code: string, typeId: string, expiresAt?: string, usageLimit?: number,
     *   usesPerCustomer?: number }} */
    const body = { code, typeId };
    const expLocal = tr.querySelector('[data-cp-add-code-exp]')?.value ?? '';
    if (expLocal) {
      const iso = new Date(expLocal).toISOString();
      if (!Number.isNaN(Date.parse(iso))) body.expiresAt = iso;
    }
    const lim = readOptionalInt(tr.querySelector('[data-cp-add-code-limit]')?.value ?? '');
    if (lim != null) body.usageLimit = lim;
    const upc = readOptionalInt(tr.querySelector('[data-cp-add-code-per]')?.value ?? '');
    if (upc != null) body.usesPerCustomer = upc;
    return body;
  }).filter((b) => b.code);
}

/** @param {HTMLDialogElement} dlg */
function wireAddCodesGridPasteExpansion(dlg) {
  const tbody = dlg.querySelector('#cp-add-codes-tbody');
  if (!tbody) return;
  tbody.addEventListener('paste', (e) => {
    const { target, clipboardData } = e;
    if (!(target instanceof HTMLInputElement) || !target.matches('[data-cp-add-code-val]')) return;
    const text = clipboardData?.getData('text/plain') ?? '';
    if (!text.includes('\n') && !text.includes('\r')) return;
    const lines = text.split(/\r\n|\n|\r/).map((l) => l.replace(/\r$/, ''))
      .filter((l) => l.trim() !== '');
    if (lines.length <= 1) return;
    e.preventDefault();
    const startTr = target.closest('tr[data-cp-add-code-line]');
    if (!startTr || !tbody.contains(startTr)) return;
    const allRows = [...tbody.querySelectorAll('tr[data-cp-add-code-line]')];
    const startIdx = allRows.indexOf(/** @type {HTMLTableRowElement} */ (startTr));
    if (startIdx < 0) return;
    lines.forEach((lineText, j) => {
      const parts = lineText.split('\t').map((c) => c.trim());
      const code = (parts[0] || '').trim();
      if (!code) return;
      let tr = tbody.querySelectorAll('tr[data-cp-add-code-line]')[startIdx + j];
      if (!tr) {
        tbody.insertAdjacentHTML('beforeend', couponAddCodesRowHtml({}));
        const list = tbody.querySelectorAll('tr[data-cp-add-code-line]');
        tr = list[list.length - 1];
      }
      if (!tr) return;
      const codeEl = tr.querySelector('[data-cp-add-code-val]');
      if (codeEl instanceof HTMLInputElement) codeEl.value = code;
      const expEl = tr.querySelector('[data-cp-add-code-exp]');
      if (parts[1] && expEl instanceof HTMLInputElement) {
        const el = parseExpiresCellToLocal(parts[1]);
        if (el) expEl.value = el;
      }
      const limEl = tr.querySelector('[data-cp-add-code-limit]');
      const lim = readOptionalInt(parts[2]);
      if (lim != null && limEl instanceof HTMLInputElement) limEl.value = String(lim);
      const perEl = tr.querySelector('[data-cp-add-code-per]');
      const upc = readOptionalInt(parts[3]);
      if (upc != null && perEl instanceof HTMLInputElement) perEl.value = String(upc);
    });
    refreshAddCodesLineIndices(dlg);
  });
}

/**
 * @param {HTMLDialogElement} dlg
 * @param {Array<{ code: string, expiresLocal?: string, usageLimit?: number,
 *   usesPerCustomer?: number }>} parsed
 * @param {'replace' | 'append'} mode
 */
function applyCouponCodesTsvToGrid(dlg, parsed, mode) {
  const tbody = dlg.querySelector('#cp-add-codes-tbody');
  if (!tbody) return;
  if (!parsed.length) {
    showToast(
      'No valid rows — one code per line, or tab-separated columns starting with Code.',
      'error',
    );
    return;
  }
  if (mode === 'replace') {
    tbody.innerHTML = parsed.map((r) => couponAddCodesRowHtml(r)).join('');
  } else {
    parsed.forEach((r) => {
      tbody.insertAdjacentHTML('beforeend', couponAddCodesRowHtml(r));
    });
  }
  refreshAddCodesLineIndices(dlg);
  showToast(`${mode === 'replace' ? 'Replaced with' : 'Appended'} ${parsed.length} row(s)`, 'success');
}

/** @param {HTMLDialogElement} dlg */
function wireAddCodesDialog(dlg) {
  const tbody = dlg.querySelector('#cp-add-codes-tbody');
  dlg.querySelector('[data-cp-add-code-row-add]')?.addEventListener('click', () => {
    if (!tbody) return;
    tbody.insertAdjacentHTML('beforeend', couponAddCodesRowHtml({}));
    refreshAddCodesLineIndices(dlg);
  });
  tbody?.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (!t.closest('[data-cp-add-code-remove]')) return;
    const line = t.closest('tr[data-cp-add-code-line]');
    const all = tbody?.querySelectorAll('tr[data-cp-add-code-line]') ?? [];
    if (!line || all.length <= 1) return;
    line.remove();
    refreshAddCodesLineIndices(dlg);
  });
  const ta = /** @type {HTMLTextAreaElement | null} */ (dlg.querySelector('#cp-add-codes-tsv-paste'));
  dlg.querySelector('[data-cp-add-codes-tsv-clear]')?.addEventListener('click', () => {
    if (ta) ta.value = '';
  });
  dlg.querySelector('[data-cp-add-codes-tsv-replace]')?.addEventListener('click', () => {
    try {
      const parsed = parseCouponCodesTsv(ta?.value ?? '');
      applyCouponCodesTsvToGrid(dlg, parsed, 'replace');
    } catch (err) {
      showToast(err?.message || 'Import failed', 'error');
    }
  });
  dlg.querySelector('[data-cp-add-codes-tsv-append]')?.addEventListener('click', () => {
    try {
      const parsed = parseCouponCodesTsv(ta?.value ?? '');
      applyCouponCodesTsvToGrid(dlg, parsed, 'append');
    } catch (err) {
      showToast(err?.message || 'Import failed', 'error');
    }
  });
  refreshAddCodesLineIndices(dlg);
  wireAddCodesGridPasteExpansion(dlg);
}

function openAddCodesDialog() {
  if (!state.selectedCouponId) return;
  const idEsc = escapeHtml(state.selectedCouponId);
  const intro = [
    '<p class="coupons-page-lead" style="margin-bottom:10px">Create one or more codes for ',
    `<strong>${idEsc}</strong>. Edit the grid, paste a column from Excel `,
    'into <strong>Code</strong> (multiple rows expand the grid), or use ',
    '<strong>Import from spreadsheet (TSV)</strong> — one code per line works; you can also use ',
    'tab-separated <code>Code</code>, optional <code>Expires</code>, <code>Usage limit</code>, and ',
    '<code>Uses per customer</code>.</p>',
  ].join('');
  const tsvHint = '<p class="coupons-field-hint" style="margin-top:8px">Paste one code per line '
    + '(from a single spreadsheet column), or tab-separated columns: '
    + '<strong>Code</strong> (required); optional <strong>Expires</strong> (parseable date); '
    + '<strong>Total use limit</strong>; <strong>Uses per customer</strong>. '
    + 'A header row whose first cell is <code>Code</code> is skipped.</p>';
  const inner = `${intro}
    <div class="cp-add-codes-lines-header">
      <h3 class="cp-add-codes-lines-title">Codes to create</h3>
      <button type="button" class="coupons-btn" data-cp-add-code-row-add>Add row</button>
    </div>
    <div class="cp-add-codes-lines-wrap">
      <div class="cp-add-codes-lines-scroll">
        <table class="coupons-data-table cp-add-codes-grid" aria-label="Codes to create">
          <thead>
            <tr>
              <th scope="col" class="cp-add-codes-col-del"><span class="pim-sr-only">Remove</span></th>
              <th scope="col" class="cp-add-codes-num-col">#</th>
              <th scope="col">Code</th>
              <th scope="col">Expires</th>
              <th scope="col">Usage limit</th>
              <th scope="col">Uses / customer</th>
            </tr>
          </thead>
          <tbody id="cp-add-codes-tbody">${couponAddCodesRowHtml({})}</tbody>
        </table>
      </div>
      <details class="cp-add-codes-tsv-import">
        <summary>Import from spreadsheet (TSV)</summary>
        ${tsvHint}
        <textarea id="cp-add-codes-tsv-paste" class="cp-add-codes-tsv-textarea" rows="7" spellcheck="false" placeholder="SAVE20&#10;SAVE21&#10;or: SAVE22&#9;2026-12-31T12:00&#9;100&#9;1"></textarea>
        <div class="cp-add-codes-tsv-actions">
          <button type="button" class="coupons-btn coupons-btn-primary" data-cp-add-codes-tsv-replace>Replace rows from paste</button>
          <button type="button" class="coupons-btn" data-cp-add-codes-tsv-append>Append rows from paste</button>
          <button type="button" class="coupons-btn" data-cp-add-codes-tsv-clear>Clear box</button>
        </div>
      </details>
    </div>`;
  openDialog(
    'Add new codes...',
    inner,
    async (dlg) => {
      const bodies = readCouponCodeBodiesFromAddGrid(dlg);
      if (!bodies.length) throw new Error('Add at least one code in the grid.');
      const sub = dlg.querySelector('[data-cp-submit]');
      if (sub instanceof HTMLButtonElement) sub.disabled = true;
      const fails = [];
      try {
        /* eslint-disable no-await-in-loop -- serial POSTs are gentler on the API */
        for (let bi = 0; bi < bodies.length; bi += 1) {
          const body = bodies[bi];
          try {
            await couponsApiFetch('coupons', {
              method: 'POST',
              body: JSON.stringify(body),
            });
          } catch (err) {
            fails.push({ code: body.code, message: err?.message || String(err) });
          }
        }
        /* eslint-enable no-await-in-loop */
      } finally {
        if (sub instanceof HTMLButtonElement) sub.disabled = false;
      }
      if (fails.length === bodies.length) {
        const samp = fails.slice(0, 3).map((f) => `${f.code}: ${f.message}`).join('; ');
        throw new Error(`No codes were created (${fails.length}). ${samp}${fails.length > 3 ? '...' : ''}`);
      }
      await fetchCodesForCoupon();
      afterCodesRefresh();
      if (fails.length) {
        console.warn('[commerce-admin/coupons] create codes partial failure', fails);
        const ok = bodies.length - fails.length;
        showToast(`Created ${ok} of ${bodies.length} code(s). Failures: open the console.`, 'error');
      } else {
        showToast(`Created ${bodies.length} code(s)`, 'success');
      }
    },
    async (dlg) => {
      wireAddCodesDialog(dlg);
    },
    'coupons-dialog-wide',
    'Create codes',
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
