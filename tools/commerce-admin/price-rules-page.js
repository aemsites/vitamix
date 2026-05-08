/**
 * Pricing mock UI (no API). Entry points: cart-rules.html (rules overview + detail modal),
 * promotions.html (promotion list + modal), or data-pr-app="both" for combined Rules /
 * Promotions tabs.
 * Promotion detail modal reuses classes from coupons.css — include that stylesheet on any
 * page that opens the promotion modal (promotions.html does). Sale-line thumbnails use the
 * same AEM index + image query as catalog (`pim.js` fetch / resolve helpers).
 * Cart rule detail modals reuse coupons.css (load on cart-rules.html).
 * Coupons: coupons.html (ProductBus).
 */
import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';
import { createDetailModalHeaderCloseAndJson } from './commerce-detail-modal-json.js';
import { mountPromoteProductionInToolbar } from './commerce-promote-production.js';
import { PB_ORG, PB_SITE } from './commerce-pbus-config.js';
import { escapeHtml } from './commerce-otp-ui.js';
import {
  fetchProductsIndexForLocale,
  getParentProducts,
  getUrlKeyFromProduct,
  resolveImageUrlForLocale,
} from './pim.js';

/** @return {'both' | 'cart-rules' | 'promotions'} */
function getPrAppMode() {
  const raw = document.body?.getAttribute('data-pr-app')?.trim().toLowerCase() ?? '';
  if (raw === 'cart-rules' || raw === 'rules') return 'cart-rules';
  if (raw === 'promotions' || raw === 'promotion') return 'promotions';
  if (raw === 'both') return 'both';
  return 'both';
}

const PR_APP_MODE = getPrAppMode();

/** @typedef {object} RuleRow
 * @property {string} name
 * @property {string} description
 * @property {string} minimumValue
 * @property {string} salesAmountOff
 * @property {string} freeShipping
 * @property {string} coupons
 * @property {string} products
 * @property {string} categories
 */
/** @typedef {object} PromotionRow
 * @property {string} start
 * @property {string} end
 * @property {string} product
 * @property {string} regularPrice
 * @property {string} salePrice
 */
/** @typedef {object} PromotionSet
 * @property {string} id
 * @property {string} title
 * @property {PromotionRow[]} rows
 */

/**
 * @typedef {{
 *   label: string,
 *   rules: RuleRow[],
 *   promotions: Record<string, PromotionSet[]>,
 * }} CountryMock
 */

const US_PROMO_ROWS = [
  {
    start: '4/9/2026 12am',
    end: '4/20/2026 11:59pm',
    product: 'https://www.vitamix.com/us/en_us/products/certified-reconditioned-a3500',
    regularPrice: '$549.95',
    salePrice: '$429.95',
  },
  {
    start: '4/9/2026 12am',
    end: '4/20/2026 11:59pm',
    product: 'https://www.vitamix.com/us/en_us/products/certified-reconditioned-a2500',
    regularPrice: '$449.95',
    salePrice: '$349.95',
  },
  {
    start: '4/9/2026 12am',
    end: '4/20/2026 11:59pm',
    product: 'https://www.vitamix.com/us/en_us/products/certified-reconditioned-propel-750',
    regularPrice: '$449.95',
    salePrice: '$349.95',
  },
  {
    start: '4/9/2026 12am',
    end: '4/20/2026 11:59pm',
    product: 'https://www.vitamix.com/us/en_us/products/certified-reconditioned-explorian-with-programs',
    regularPrice: '$379.95',
    salePrice: '$329.95',
  },
  {
    start: '4/9/2026 12am',
    end: '4/20/2026 11:59pm',
    product: 'https://www.vitamix.com/us/en_us/products/certified-reconditioned-explorian',
    regularPrice: '$319.95',
    salePrice: '$269.95',
  },
];

/** @type {Record<string, CountryMock>} */
const MOCK = {
  us: {
    label: 'United States',
    rules: [
      {
        name: 'Free Shipping >=  $150',
        description: 'Free Shipping for Orders over $150',
        minimumValue: '150',
        salesAmountOff: '',
        freeShipping: 'Yes',
        coupons: '',
        products: 'HH Only',
        categories: '',
      },
      {
        name: '25% off total order + Free Shipping - Affiliate',
        description: '25% off total order + Free Shipping - Affiliate',
        minimumValue: '',
        salesAmountOff: '25%',
        freeShipping: 'Yes',
        coupons: '2026/affiliates-25-off',
        products: '',
        categories: '',
      },
    ],
    promotions: {
      2026: [
        {
          id: 'certified-reconditioned-april',
          title: 'Certified Reconditioned — April window',
          rows: US_PROMO_ROWS,
        },
        {
          id: 'loyalty-bonus-mock',
          title: 'Loyalty tier bonus (mock)',
          rows: US_PROMO_ROWS.slice(0, 2),
        },
      ],
      2025: [
        {
          id: 'archive-holiday',
          title: 'Holiday 2025 (archived mock)',
          rows: [
            {
              start: '11/20/2025 12am',
              end: '12/1/2025 11:59pm',
              product: 'https://www.vitamix.com/us/en_us/products/explorian-series-e310',
              regularPrice: '$379.95',
              salePrice: '$349.95',
            },
          ],
        },
      ],
    },
  },
  ca: {
    label: 'Canada',
    rules: [
      {
        name: 'Free Shipping threshold (CA)',
        description: 'Free shipping over minimum cart (mock)',
        minimumValue: '175',
        salesAmountOff: '',
        freeShipping: 'Yes',
        coupons: '',
        products: '',
        categories: '',
      },
      {
        name: 'Partner stack (mock)',
        description: 'Stack partner coupon with standard rules (mock)',
        minimumValue: '',
        salesAmountOff: '15%',
        freeShipping: 'No',
        coupons: '2026/partner-stack',
        products: '',
        categories: 'Ascent',
      },
    ],
    promotions: {
      2026: [
        {
          id: 'fr-ca-refurb-spring',
          title: 'Refurb spotlight — FR-CA (mock)',
          rows: [
            {
              start: '4/9/2026 12am',
              end: '4/20/2026 11:59pm',
              product: 'https://www.vitamix.com/ca/fr_ca/products/ascent-x2',
              regularPrice: '$729.95',
              salePrice: '$649.95',
            },
            {
              start: '4/9/2026 12am',
              end: '4/20/2026 11:59pm',
              product: 'https://www.vitamix.com/ca/fr_ca/products/explorian-series-e310',
              regularPrice: '$449.95',
              salePrice: '$399.95',
            },
          ],
        },
      ],
    },
  },
  mx: {
    label: 'Mexico',
    rules: [
      {
        name: 'MX default shipping rule (mock)',
        description: 'Baseline shipping behavior for MX storefront',
        minimumValue: '2500',
        salesAmountOff: '',
        freeShipping: 'Yes',
        coupons: '',
        products: '',
        categories: '',
      },
    ],
    promotions: {
      2026: [
        {
          id: 'mx-launch-promo',
          title: 'Launch promo table (mock)',
          rows: [
            {
              start: '5/1/2026 12am',
              end: '5/31/2026 11:59pm',
              product: 'https://www.vitamix.com/',
              regularPrice: '$9,999 MXN',
              salePrice: '$8,499 MXN',
            },
          ],
        },
      ],
    },
  },
};

const COUNTRIES = /** @type {const} */ (['us', 'ca', 'mx']);
const AREAS = /** @type {const} */ (['rules', 'promotions']);

/**
 * @type {{
 *   country: (typeof COUNTRIES)[number],
 *   area: (typeof AREAS)[number],
 *   promoListSearch: string,
 *   promoListYearFilter: string,
 *   cartRuleSearch: string,
 * }}
 */
const state = {
  country: 'us',
  area: PR_APP_MODE === 'promotions' ? 'promotions' : 'rules',
  promoListSearch: '',
  promoListYearFilter: '',
  cartRuleSearch: '',
};

function sortedYears(map) {
  return Object.keys(map || {}).sort((a, b) => Number(b) - Number(a));
}

/**
 * @param {PromotionRow[]} rows
 * @param {Map<string, string>} [thumbByProductUrl] - storefront product URL → catalog thumb URL
 */
function promotionTableHtml(rows, thumbByProductUrl) {
  if (!rows.length) {
    return '<p class="pr-empty">No rows in this promotion (mock).</p>';
  }
  const thumbs = thumbByProductUrl && thumbByProductUrl.size ? thumbByProductUrl : null;
  const labelTh = ['Start', 'End', 'Product', 'Regular Price', 'Sale Price']
    .map((h) => `<th scope="col">${escapeHtml(h)}</th>`)
    .join('');
  const th = `<th class="pim-col-thumb" scope="col"><span class="pim-sr-only">Image</span></th>${labelTh}`;
  const body = rows
    .map((r) => {
      const href = escapeHtml(r.product);
      const imgSrc = thumbs?.get(r.product) || '';
      const thumbCell = imgSrc
        ? `<img src="${escapeHtml(imgSrc)}" alt="" loading="lazy" width="48" height="48" class="pim-thumb-img" />`
        : '<span class="pim-thumb-placeholder" aria-hidden="true"></span>';
      return `<tr>
        <td class="pim-col-thumb pr-promo-table-thumb">${thumbCell}</td>
        <td>${escapeHtml(r.start)}</td>
        <td>${escapeHtml(r.end)}</td>
        <td><a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a></td>
        <td>${escapeHtml(r.regularPrice)}</td>
        <td>${escapeHtml(r.salePrice)}</td>
      </tr>`;
    })
    .join('');
  return `<div class="pr-table-wrap"><table class="pr-data-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/**
 * @typedef {object} PromoListRow
 * @property {string} countryKey
 * @property {string} countryLabel
 * @property {string} year
 * @property {string} id
 * @property {string} title
 * @property {number} rowCount
 * @property {PromotionRow[]} rows
 */

/** All promotion sets for the current country (flat list). */
function allPromotionRowsForCountry() {
  const ck = state.country;
  const c = MOCK[ck];
  if (!c?.promotions) return [];
  /** @type {PromoListRow[]} */
  const rows = [];
  sortedYears(c.promotions).forEach((year) => {
    (c.promotions[year] || []).forEach((p) => {
      rows.push({
        countryKey: ck,
        countryLabel: c.label,
        year,
        id: p.id,
        title: p.title,
        rowCount: Array.isArray(p.rows) ? p.rows.length : 0,
        rows: p.rows,
      });
    });
  });
  return rows;
}

function filteredPromotionRows() {
  let list = allPromotionRowsForCountry();
  const yf = state.promoListYearFilter.trim();
  if (yf) list = list.filter((r) => r.year === yf);
  const q = state.promoListSearch.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (r) => r.title.toLowerCase().includes(q) || r.id.toLowerCase().includes(q),
    );
  }
  return list;
}

function promotionYearFilterOptionsHtml() {
  const c = MOCK[state.country];
  const years = c?.promotions ? sortedYears(c.promotions) : [];
  const curY = state.promoListYearFilter.trim();
  const allSel = !curY ? ' selected' : '';
  const opts = [`<option value=""${allSel}>All years</option>`].concat(
    years.map((y) => {
      const sel = y === curY ? ' selected' : '';
      return `<option value="${escapeHtml(y)}"${sel}>${escapeHtml(y)}</option>`;
    }),
  );
  return opts.join('');
}

function closePromotionDetailDialog() {
  document.querySelector('dialog.pr-promo-detail-dialog')?.remove();
}

function promoMarketTagHtml(countryKey) {
  const m = String(countryKey || '').toLowerCase();
  const labels = { us: 'US', ca: 'CA', mx: 'MX' };
  const classes = { us: 'coupons-tag-us', ca: 'coupons-tag-ca', mx: 'coupons-tag-mx' };
  const label = labels[m];
  if (!label) return '<span class="coupons-tag coupons-tag-muted">—</span>';
  return `<span class="coupons-tag ${classes[m]}">${label}</span>`;
}

function promoPillHtml(label, on) {
  const cl = on ? 'coupons-pill coupons-pill-on' : 'coupons-pill coupons-pill-off';
  return `<span class="${cl}">${escapeHtml(label)}</span>`;
}

function ruleSlugFromName(name) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return s.slice(0, 56) || 'rule';
}

function closeCartRuleDetailDialog() {
  document.querySelector('dialog.pr-cart-rule-dialog')?.remove();
}

function closeAllPricingDetailDialogs() {
  closePromotionDetailDialog();
  closeCartRuleDetailDialog();
}

function wireCartRuleDetailDialog(dialog) {
  const shut = () => {
    dialog.close();
    dialog.remove();
  };
  wireDialogEscapeDismiss(dialog, shut);
  dialog.querySelector('[data-pr-cart-rule-modal-done]')?.addEventListener('click', shut);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) shut();
  });
}

/**
 * @param {string} countryKey
 * @param {string} countryLabel
 * @param {RuleRow} rule
 * @param {number} ruleIndex
 */
function cartRuleDetailModalInnerHtml(countryKey, countryLabel, rule, ruleIndex) {
  const slug = ruleSlugFromName(rule.name);
  const path = `${countryKey.toUpperCase()} / rules / ${slug}`;
  const minDisplay = rule.minimumValue != null && String(rule.minimumValue).trim() !== ''
    ? `$${String(rule.minimumValue).trim()}`
    : 'None';
  const offDisplay = rule.salesAmountOff != null && String(rule.salesAmountOff).trim() !== ''
    ? String(rule.salesAmountOff).trim()
    : '—';
  const fs = /^yes$/i.test(String(rule.freeShipping || '').trim());
  const hasMin = Boolean(rule.minimumValue != null && String(rule.minimumValue).trim() !== '');
  const hasOff = Boolean(rule.salesAmountOff != null && String(rule.salesAmountOff).trim() !== '');
  let heroMain = '—';
  let heroSub = 'Cart / catalog rule (mock)';
  if (hasOff) {
    heroMain = offDisplay;
    heroSub = 'off qualifying subtotal (mock)';
  } else if (fs && hasMin) {
    heroMain = `≥ ${minDisplay}`;
    heroSub = 'cart for free shipping (mock)';
  } else if (fs) {
    heroMain = 'Free shipping';
    heroSub = 'benefit on qualifying orders (mock)';
  }

  const scopeParts = [rule.products, rule.categories]
    .map((x) => (x != null ? String(x).trim() : ''))
    .filter(Boolean);
  const scopeTags = scopeParts.length
    ? scopeParts.map((p) => `<span class="coupons-mini-tag">${escapeHtml(p)}</span>`).join('')
    : '<span class="coupons-muted">Default scope</span>';

  const pills = [
    promoPillHtml('Free shipping', fs),
    promoPillHtml('Order minimum', hasMin),
    promoPillHtml('Percent / amount off', hasOff),
    promoPillHtml('Mock data', true),
  ].join('');

  return `
    <div class="coupons-modal-banner">Mock cart rule — not connected to live AEM or commerce.</div>
    <div class="coupons-modal-head">
      <div class="coupons-modal-badges">
        ${promoMarketTagHtml(countryKey)}
        <span class="coupons-tag coupons-tag-slug">${escapeHtml(slug)}</span>
        <span class="coupons-tag coupons-tag-year">#${ruleIndex + 1}</span>
      </div>
      <h2 class="coupons-modal-title">${escapeHtml(rule.name)}</h2>
      <p class="coupons-modal-idline"><code>${escapeHtml(path)}</code></p>
    </div>
    <div class="coupons-modal-hero">
      <div class="coupons-modal-hero-inner">
        <span class="coupons-modal-hero-kicker">Primary effect</span>
        <span class="coupons-modal-hero-value">${escapeHtml(heroMain)}</span>
        <span class="coupons-modal-hero-note">${escapeHtml(heroSub)}</span>
      </div>
    </div>
    <div class="coupons-modal-stats" role="list">
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Market</span><span class="coupons-modal-stat-value">${escapeHtml(countryLabel)}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Minimum cart</span><span class="coupons-modal-stat-value">${escapeHtml(minDisplay)}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Amount off</span><span class="coupons-modal-stat-value">${escapeHtml(offDisplay)}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Free shipping</span><span class="coupons-modal-stat-value">${escapeHtml(fs ? 'Yes' : 'No')}</span></div>
    </div>
    <div class="coupons-modal-pills" aria-label="Rule flags">${pills}</div>
    <section class="coupons-modal-section">
      <h3 class="coupons-modal-section-title">Description</h3>
      <div class="coupons-modal-notes">${escapeHtml(rule.description || '—')}</div>
    </section>
    <section class="coupons-modal-section">
      <h3 class="coupons-modal-section-title">Product / category scope</h3>
      <div class="coupons-modal-tags">${scopeTags}</div>
    </section>`;
}

function openCartRuleDetailModal(countryKey, ruleIndex) {
  const c = MOCK[countryKey];
  const rules = Array.isArray(c?.rules) ? c.rules : [];
  const rule = rules[ruleIndex];
  if (!rule) return;
  closeCartRuleDetailDialog();
  const humanHtml = cartRuleDetailModalInnerHtml(countryKey, c.label, rule, ruleIndex);
  const dialog = document.createElement('dialog');
  dialog.className = 'pr-cart-rule-dialog coupons-detail-dialog';

  const toolbar = document.createElement('div');
  toolbar.className = 'commerce-detail-modal-toolbar';
  const scroll = document.createElement('div');
  scroll.className = 'coupons-detail-dialog-scroll';

  const bodyHost = document.createElement('div');
  const shut = () => {
    dialog.close();
    dialog.remove();
  };
  const toolbarMain = document.createElement('div');
  toolbarMain.className = 'commerce-detail-modal-toolbar-main';
  mountPromoteProductionInToolbar(toolbarMain, {
    org: PB_ORG,
    site: PB_SITE,
    entityKind: 'cart-rule',
    getPayload: () => ({
      country: countryKey,
      ruleIndex,
      rule,
    }),
  });
  const header = createDetailModalHeaderCloseAndJson({
    bodyHost,
    getHumanNode() {
      const w = document.createElement('div');
      w.innerHTML = humanHtml;
      return w;
    },
    getJsonValue: () => rule,
    onClose: shut,
  });
  toolbar.append(toolbarMain, header.headerRight);
  header.resetToHuman();

  scroll.append(bodyHost);
  const footer = document.createElement('footer');
  footer.className = 'coupons-modal-footer';
  footer.innerHTML = '<button type="button" class="coupons-btn coupons-btn-primary" data-pr-cart-rule-modal-done>Done</button>';
  dialog.append(toolbar, scroll, footer);
  document.body.appendChild(dialog);
  wireCartRuleDetailDialog(dialog);
  dialog.showModal();
}

function renderCartRulesOverview() {
  const ck = state.country;
  const c = MOCK[ck];
  const rules = Array.isArray(c?.rules) ? c.rules : [];
  const q = state.cartRuleSearch.trim().toLowerCase();
  const nameDescMatch = (r) => {
    const n = String(r.name).toLowerCase();
    const d = String(r.description).toLowerCase();
    return n.includes(q) || d.includes(q);
  };
  const filtered = !q ? rules : rules.filter(nameDescMatch);
  const searchVal = escapeHtml(state.cartRuleSearch);
  const mTag = promoMarketTagHtml(ck);

  let tbodyHtml;
  if (!rules.length) {
    tbodyHtml = '<tr><td colspan="5" class="pr-empty-cell">No rules for this country (mock).</td></tr>';
  } else if (!filtered.length) {
    tbodyHtml = '<tr><td colspan="5" class="pr-empty-cell">No rules match your search.</td></tr>';
  } else {
    tbodyHtml = filtered
      .map((r) => {
        const idx = rules.indexOf(r);
        const min = r.minimumValue != null && String(r.minimumValue).trim() !== ''
          ? `$${escapeHtml(String(r.minimumValue))}`
          : '—';
        const off = r.salesAmountOff != null && String(r.salesAmountOff).trim() !== ''
          ? escapeHtml(String(r.salesAmountOff))
          : '—';
        const ship = /^yes$/i.test(String(r.freeShipping || '').trim()) ? 'Yes' : 'No';
        const scope = [r.products, r.categories]
          .map((x) => (x != null ? String(x).trim() : ''))
          .filter(Boolean)
          .join(' · ') || '—';
        const scopeShort = scope.length > 56 ? `${escapeHtml(scope.slice(0, 53))}…` : escapeHtml(scope);
        const label = `Open rule ${r.name}`;
        return `<tr class="pr-promo-grid-row pr-cart-rule-row" role="button" tabindex="0" aria-label="${escapeHtml(label)}"
            data-pr-cart-rule-open data-pr-country="${escapeHtml(ck)}" data-pr-rule-idx="${idx}">
            <td class="pr-cart-rule-lead"><div class="coupons-grid-lead-badges">${mTag}</div><strong>${escapeHtml(r.name)}</strong></td>
            <td>${min}</td>
            <td>${off}</td>
            <td>${ship}</td>
            <td class="pr-cart-rule-scope">${scopeShort}</td>
          </tr>`;
      })
      .join('');
  }

  return `<div class="pr-promo-toolbar pim-toolbar">
      <input type="search" id="pr-cart-rule-search" class="pim-search pr-promo-search-wide" placeholder="Search rule name or description…" aria-label="Search cart rules" value="${searchVal}" />
      <span class="pim-count pr-promo-count">${filtered.length} rule${filtered.length === 1 ? '' : 's'}</span>
    </div>
    <div class="pr-promo-table-wrap pim-list-wrapper">
      <table class="pr-data-table pr-promo-grid-table" aria-label="Cart rules">
        <thead>
          <tr>
            <th scope="col">Market · Rule</th>
            <th scope="col">Min cart</th>
            <th scope="col">Off</th>
            <th scope="col">Free ship</th>
            <th scope="col">Scope</th>
          </tr>
        </thead>
        <tbody>${tbodyHtml}</tbody>
      </table>
    </div>`;
}

function catalogLocaleFromVitamixProductUrl(productUrl) {
  try {
    const u = new URL(productUrl);
    const m = u.pathname.match(/\/(us|ca|mx)\/([a-z]{2}_[a-z]{2})\//i);
    if (m) return `${m[1].toLowerCase()}/${m[2].toLowerCase()}`;
  } catch {
    /* ignore */
  }
  return '';
}

function pickCatalogLocaleForPromotionRows(rows, countryKey) {
  const locales = rows.map((r) => catalogLocaleFromVitamixProductUrl(r.product)).filter(Boolean);
  if (locales.length) {
    const counts = new Map();
    locales.forEach((loc) => {
      counts.set(loc, (counts.get(loc) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  if (countryKey === 'ca') return 'ca/en_ca';
  if (countryKey === 'mx') return 'us/en_us';
  return 'us/en_us';
}

function urlKeyFromVitamixProductUrl(productUrl) {
  try {
    const u = new URL(productUrl);
    const marker = '/products/';
    const i = u.pathname.indexOf(marker);
    if (i === -1) return '';
    return u.pathname.slice(i + marker.length).replace(/\/$/, '');
  } catch {
    return '';
  }
}

/**
 * @param {PromotionRow[]} rows
 * @param {string} countryKey
 * @returns {Promise<Map<string, string>>}
 */
async function buildThumbUrlMapForPromotionRows(rows, countryKey) {
  const map = new Map();
  if (!rows.length) return map;
  const locale = pickCatalogLocaleForPromotionRows(rows, countryKey);
  try {
    const json = await fetchProductsIndexForLocale(locale);
    const raw = Array.isArray(json) ? json : (json?.data ?? []);
    const data = Array.isArray(raw) ? raw : [];
    const parents = getParentProducts(data);
    const byUrlKey = new Map();
    parents.forEach((p) => {
      const k = getUrlKeyFromProduct(p);
      if (!k || !p.image) return;
      byUrlKey.set(String(k).toLowerCase(), resolveImageUrlForLocale(locale, p.image));
    });
    rows.forEach((r) => {
      const slug = urlKeyFromVitamixProductUrl(r.product);
      const src = slug ? byUrlKey.get(String(slug).toLowerCase()) : '';
      if (src) map.set(r.product, src);
    });
  } catch (err) {
    /* eslint-disable-next-line no-console -- intentional: index/CORS failures are non-fatal */
    console.warn('[commerce-admin/promotions] catalog index for thumbnails failed', {
      locale,
      message: err?.message || String(err),
    });
  }
  return map;
}

/**
 * @param {string} countryKey
 * @param {string} year
 * @param {string} countryLabel
 * @param {PromotionSet} set
 * @param {Map<string, string>} thumbByProductUrl
 */
function promotionDetailModalInnerHtml(countryKey, year, countryLabel, set, thumbByProductUrl) {
  const { id } = set;
  const fullPath = `${countryKey.toUpperCase()} / promotions / ${year} / ${id}`;
  const rows = Array.isArray(set.rows) ? set.rows : [];
  const n = rows.length;
  const starts = rows.map((r) => r.start);
  const ends = rows.map((r) => r.end);
  const uniformDates = n > 0 && new Set(starts).size === 1 && new Set(ends).size === 1;
  const heroMain = uniformDates ? String(starts[0]) : String(n);
  const heroSub = uniformDates
    ? `through ${ends[0]} · ${n} product line${n === 1 ? '' : 's'}`
    : 'sale line entries in this promotion (dates vary per row)';
  const uniqProducts = new Set(rows.map((r) => r.product)).size;
  const pills = [
    promoPillHtml('Multi-line', n > 1),
    promoPillHtml('Uniform window', uniformDates),
    promoPillHtml('Mock data', true),
  ].join('');

  return `
    <div class="coupons-modal-banner">Mock promotion preview — not connected to live commerce.</div>
    <div class="coupons-modal-head">
      <div class="coupons-modal-badges">
        ${promoMarketTagHtml(countryKey)}
        <span class="coupons-tag coupons-tag-year">${escapeHtml(year)}</span>
        <span class="coupons-tag coupons-tag-slug">${escapeHtml(id)}</span>
      </div>
      <h2 class="coupons-modal-title">${escapeHtml(set.title)}</h2>
      <p class="coupons-modal-idline"><code>${escapeHtml(fullPath)}</code></p>
    </div>
    <div class="coupons-modal-hero">
      <div class="coupons-modal-hero-inner">
        <span class="coupons-modal-hero-kicker">${uniformDates ? 'Sale window' : 'Sale lines'}</span>
        <span class="coupons-modal-hero-value">${escapeHtml(heroMain)}</span>
        <span class="coupons-modal-hero-note">${escapeHtml(heroSub)}</span>
      </div>
    </div>
    <div class="coupons-modal-stats" role="list">
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Market</span><span class="coupons-modal-stat-value">${escapeHtml(countryLabel)}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Calendar year</span><span class="coupons-modal-stat-value">${escapeHtml(year)}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Sale lines</span><span class="coupons-modal-stat-value">${String(n)}</span></div>
      <div class="coupons-modal-stat" role="listitem"><span class="coupons-modal-stat-label">Unique products</span><span class="coupons-modal-stat-value">${String(uniqProducts)}</span></div>
    </div>
    <div class="coupons-modal-pills" aria-label="Promotion shape">${pills}</div>
    <section class="coupons-modal-section">
      <h3 class="coupons-modal-section-title">Sale line table</h3>
      ${promotionTableHtml(rows, thumbByProductUrl)}
    </section>`;
}

function wirePromotionDetailDialog(dialog) {
  const shut = () => {
    dialog.close();
    dialog.remove();
  };
  wireDialogEscapeDismiss(dialog, shut);
  dialog.querySelector('[data-pr-promo-modal-done]')?.addEventListener('click', shut);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) shut();
  });
}

/**
 * @param {string} countryKey
 * @param {string} year
 * @param {string} promoId
 */
async function openPromotionDetailModal(countryKey, year, promoId) {
  const c = MOCK[countryKey];
  const set = (c?.promotions?.[year] || []).find((x) => x.id === promoId);
  if (!set) return;
  closePromotionDetailDialog();
  const rows = Array.isArray(set.rows) ? set.rows : [];
  const thumbByProductUrl = await buildThumbUrlMapForPromotionRows(rows, countryKey);
  const humanHtml = promotionDetailModalInnerHtml(
    countryKey,
    year,
    c.label,
    set,
    thumbByProductUrl,
  );
  const dialog = document.createElement('dialog');
  dialog.className = 'pr-promo-detail-dialog coupons-detail-dialog';

  const toolbar = document.createElement('div');
  toolbar.className = 'commerce-detail-modal-toolbar';
  const scroll = document.createElement('div');
  scroll.className = 'coupons-detail-dialog-scroll';

  const bodyHost = document.createElement('div');
  const shut = () => {
    dialog.close();
    dialog.remove();
  };
  const toolbarMain = document.createElement('div');
  toolbarMain.className = 'commerce-detail-modal-toolbar-main';
  mountPromoteProductionInToolbar(toolbarMain, {
    org: PB_ORG,
    site: PB_SITE,
    entityKind: 'promotion',
    getPayload: () => ({
      country: countryKey,
      year,
      id: set.id,
      promotion: set,
    }),
  });
  const header = createDetailModalHeaderCloseAndJson({
    bodyHost,
    getHumanNode() {
      const w = document.createElement('div');
      w.innerHTML = humanHtml;
      return w;
    },
    getJsonValue: () => set,
    onClose: shut,
  });
  toolbar.append(toolbarMain, header.headerRight);
  header.resetToHuman();

  scroll.append(bodyHost);
  const footer = document.createElement('footer');
  footer.className = 'coupons-modal-footer';
  footer.innerHTML = '<button type="button" class="coupons-btn coupons-btn-primary" data-pr-promo-modal-done>Done</button>';
  dialog.append(toolbar, scroll, footer);
  document.body.appendChild(dialog);
  wirePromotionDetailDialog(dialog);
  dialog.showModal();
}

function renderPromotionsListPanel() {
  const list = filteredPromotionRows();
  const searchVal = escapeHtml(state.promoListSearch);
  const c = MOCK[state.country];
  const hasYears = c?.promotions && sortedYears(c.promotions).length > 0;

  let tbodyHtml;
  if (!hasYears) {
    tbodyHtml = '<tr><td colspan="4" class="pr-empty-cell">No promotion folders for this country (mock).</td></tr>';
  } else if (!list.length) {
    tbodyHtml = '<tr><td colspan="4" class="pr-empty-cell">No promotions match your filters.</td></tr>';
  } else {
    tbodyHtml = list
      .map((r) => {
        const label = `Open promotion ${r.title}`;
        return `<tr class="pr-promo-grid-row" role="button" tabindex="0" aria-label="${escapeHtml(label)}"
            data-pr-promo-open data-pr-country="${escapeHtml(r.countryKey)}" data-pr-year="${escapeHtml(r.year)}" data-pr-id="${escapeHtml(r.id)}">
            <td>${escapeHtml(r.year)}</td>
            <td class="pr-promo-col-title">${escapeHtml(r.title)}</td>
            <td><code class="pr-promo-id-code">${escapeHtml(r.id)}</code></td>
            <td>${r.rowCount}</td>
          </tr>`;
      })
      .join('');
  }

  return `<div class="pr-promo-toolbar pim-toolbar">
      <input type="search" id="pr-promo-search" class="pim-search pr-promo-search-wide" placeholder="Search title or promotion id…" aria-label="Search promotions" value="${searchVal}" />
      <div class="pr-promo-toolbar-right">
        <div class="pr-promo-filter-field">
          <label class="pr-promo-filter-label" for="pr-promo-year">Year</label>
          <select id="pr-promo-year" class="pim-index-select pr-promo-year-select" aria-label="Filter by year">
            ${promotionYearFilterOptionsHtml()}
          </select>
        </div>
        <span class="pim-count pr-promo-count">${list.length} promotion${list.length === 1 ? '' : 's'}</span>
      </div>
    </div>
    <div class="pr-promo-table-wrap pim-list-wrapper">
      <table class="pr-data-table pr-promo-grid-table" aria-label="Promotions">
        <thead>
          <tr>
            <th scope="col">Year</th>
            <th scope="col">Title</th>
            <th scope="col">Id</th>
            <th scope="col">Rows</th>
          </tr>
        </thead>
        <tbody>${tbodyHtml}</tbody>
      </table>
    </div>`;
}

function renderMockBanner() {
  const couponsLink = '<a href="coupons.html">Open Coupons</a> for code-based discounts (R2 / ProductBus API).';
  const peerCart = '<a href="cart-rules.html">Cart Rules</a>';
  const peerPromo = '<a href="promotions.html">Promotions</a>';
  if (PR_APP_MODE === 'cart-rules') {
    return `<div class="price-rules-mock-banner"><strong>Mock data only.</strong> Cart rules overview by country — click a row for a detail modal (like <a href="coupons.html">Coupons</a>). See ${peerPromo}. ${couponsLink}</div>`;
  }
  if (PR_APP_MODE === 'promotions') {
    return `<div class="price-rules-mock-banner"><strong>Mock data only.</strong> Filter the promotion list by country, year, and search — open a row for details in a modal. See ${peerCart}. ${couponsLink}</div>`;
  }
  return `<div class="price-rules-mock-banner"><strong>Mock data only.</strong> Rules and promotions preview for US, CA, and MX. ${couponsLink}</div>`;
}

function renderCountryTabs() {
  return COUNTRIES.map((key) => {
    const sel = key === state.country ? 'true' : 'false';
    const { label } = MOCK[key];
    return `<button type="button" class="pr-tab" role="tab" aria-selected="${sel}" data-pr-country="${key}">${escapeHtml(label)}</button>`;
  }).join('');
}

function renderAreaTabs() {
  const labels = { rules: 'Rules', promotions: 'Promotions' };
  return AREAS.map((key) => {
    const sel = key === state.area ? 'true' : 'false';
    return `<button type="button" class="pr-tab" role="tab" aria-selected="${sel}" data-pr-area="${key}">${escapeHtml(labels[key])}</button>`;
  }).join('');
}

function renderPromotionsPanel() {
  return `<h2 class="pr-section-title">Promotions</h2>
    <p class="pr-section-hint">Filter the list, then open a row for the full promotion table (mock).</p>
    ${renderPromotionsListPanel()}`;
}

/** Promotions page (`promotions.html`): list only — page `h1` already names the tool. */
function renderPromotionsStandaloneMount() {
  return `<p class="pr-section-hint pr-promo-standalone-hint">Filter by year or search, then click a row for sale-line details (mock).</p>
    ${renderPromotionsListPanel()}`;
}

function renderRulesPanel() {
  const heading = PR_APP_MODE === 'cart-rules' ? 'Cart Rules' : 'Rules';
  return `<h2 class="pr-section-title">${escapeHtml(heading)}</h2>
    <p class="pr-section-hint">Search or open a row for rule detail in a <strong>modal</strong> (mock, like
      <a href="coupons.html">Coupons</a>). Overview columns omit coupon ids — use Coupons for programs.</p>
    ${renderCartRulesOverview()}
    <p class="pr-section-hint" style="margin-top:16px">Coupon <strong>programs</strong> (types, codes, batches) live in
      <a href="coupons.html">Coupons</a> — ProductBus <code>…/coupons/types</code> and <code>…/coupons</code>.</p>`;
}

/** Cart rules page (`cart-rules.html`): overview only; the page title is the main heading. */
function renderCartRulesStandaloneMount() {
  return `<p class="pr-section-hint pr-promo-standalone-hint">Search or click a row for rule detail in a modal (mock). Coupon programs are in <a href="coupons.html">Coupons</a>.</p>
    ${renderCartRulesOverview()}`;
}

function renderRulesBlockForPage() {
  return PR_APP_MODE === 'cart-rules' ? renderCartRulesStandaloneMount() : renderRulesPanel();
}

function render() {
  const mount = document.getElementById('price-rules-mount');
  if (!mount) return;

  const panels = {
    rules: renderRulesBlockForPage(),
    promotions: PR_APP_MODE === 'promotions' ? renderPromotionsStandaloneMount() : renderPromotionsPanel(),
  };

  const areaTabsHtml = PR_APP_MODE === 'both'
    ? `<div class="pr-area-tabs" role="tablist" aria-label="Pricing data type">${renderAreaTabs()}</div>`
    : '';

  mount.innerHTML = `
    ${renderMockBanner()}
    <div class="pr-country-tabs" role="tablist" aria-label="Country">${renderCountryTabs()}</div>
    ${areaTabsHtml}
    <div class="pr-panel" role="tabpanel">${panels[state.area]}</div>
  `;

  mount.querySelectorAll('[data-pr-country]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-pr-country');
      if (!key || key === state.country) return;
      state.country = /** @type {(typeof COUNTRIES)[number]} */ (key);
      state.promoListSearch = '';
      state.promoListYearFilter = '';
      state.cartRuleSearch = '';
      closeAllPricingDetailDialogs();
      render();
    });
  });

  if (PR_APP_MODE === 'both') {
    mount.querySelectorAll('[data-pr-area]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-pr-area');
        if (!key || key === state.area) return;
        state.area = /** @type {typeof state.area} */ (key);
        render();
      });
    });
  }

  if (state.area === 'rules') {
    const crSearch = mount.querySelector('#pr-cart-rule-search');
    if (crSearch) {
      crSearch.addEventListener('input', () => {
        state.cartRuleSearch = crSearch.value;
        const start = crSearch.selectionStart;
        const end = crSearch.selectionEnd;
        render();
        const next = document.getElementById('pr-cart-rule-search');
        if (next) {
          next.focus();
          if (typeof start === 'number' && typeof end === 'number') {
            next.setSelectionRange(start, end);
          }
        }
      });
    }
    const openRuleFromRow = (row) => {
      const ck = row.getAttribute('data-pr-country') || '';
      const idxRaw = row.getAttribute('data-pr-rule-idx');
      const idx = idxRaw != null ? Number(idxRaw) : NaN;
      if (!ck || Number.isNaN(idx)) return;
      openCartRuleDetailModal(ck, idx);
    };
    mount.querySelectorAll('tr.pr-cart-rule-row[data-pr-cart-rule-open]').forEach((row) => {
      row.addEventListener('click', () => {
        openRuleFromRow(row);
      });
      row.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openRuleFromRow(row);
        }
      });
    });
  }

  if (state.area === 'promotions') {
    const search = mount.querySelector('#pr-promo-search');
    if (search) {
      search.addEventListener('input', () => {
        state.promoListSearch = search.value;
        const start = search.selectionStart;
        const end = search.selectionEnd;
        render();
        const next = document.getElementById('pr-promo-search');
        if (next) {
          next.focus();
          if (typeof start === 'number' && typeof end === 'number') {
            next.setSelectionRange(start, end);
          }
        }
      });
    }
    mount.querySelector('#pr-promo-year')?.addEventListener('change', (e) => {
      const t = /** @type {HTMLSelectElement} */ (e.target);
      state.promoListYearFilter = t.value;
      render();
    });

    const openFromRow = (row) => {
      const ck = row.getAttribute('data-pr-country') || '';
      const year = row.getAttribute('data-pr-year') || '';
      const id = row.getAttribute('data-pr-id') || '';
      if (!ck || !year || !id) return;
      openPromotionDetailModal(ck, year, id).catch((err) => {
        /* eslint-disable-next-line no-console -- modal/index failures */
        console.warn('[commerce-admin/promotions] open promotion modal failed', {
          message: err?.message || String(err),
        });
      });
    };

    mount.querySelectorAll('tr.pr-promo-grid-row[data-pr-promo-open]').forEach((row) => {
      row.addEventListener('click', () => {
        openFromRow(row);
      });
      row.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openFromRow(row);
        }
      });
    });
  }
}

render();
