/**
 * Price rules — static UI mock (no API). Structure: country → rules | promotions.
 * Coupons are managed separately — see coupons.html (ProductBus coupons API).
 */
import { escapeHtml } from './commerce-otp-ui.js';

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
 *   promoYear: string,
 *   promoId: string,
 * }}
 */
const state = {
  country: 'us',
  area: 'rules',
  promoYear: '',
  promoId: '',
};

function sortedYears(map) {
  return Object.keys(map || {}).sort((a, b) => Number(b) - Number(a));
}

function firstKey(map, preferredYear) {
  const years = sortedYears(map);
  if (!years.length) return '';
  if (preferredYear && years.includes(preferredYear)) return preferredYear;
  return years[0];
}

function firstItem(list, preferredId) {
  if (!list || !list.length) return null;
  if (preferredId) {
    const found = list.find((x) => x.id === preferredId);
    if (found) return found;
  }
  return list[0];
}

function ensureNavDefaults() {
  const c = MOCK[state.country];
  if (!c) return;

  const py = firstKey(c.promotions, state.promoYear);
  state.promoYear = py;
  const plist = py ? c.promotions[py] : [];
  const p = firstItem(plist, state.promoId);
  state.promoId = p ? p.id : '';
}

function rulesTableHtml(rows) {
  if (!rows.length) {
    return '<p class="pr-empty">No rules in this mock.</p>';
  }
  const head = ['Name', 'Description', 'Minimum Value', 'Sales Amount Off', 'Free Shipping', 'Coupons', 'Products', 'Categories'];
  const th = head.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('');
  const body = rows
    .map(
      (r) => `<tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.description)}</td>
      <td>${escapeHtml(r.minimumValue)}</td>
      <td>${escapeHtml(r.salesAmountOff)}</td>
      <td>${escapeHtml(r.freeShipping)}</td>
      <td>${escapeHtml(r.coupons)}</td>
      <td>${escapeHtml(r.products)}</td>
      <td>${escapeHtml(r.categories)}</td>
    </tr>`,
    )
    .join('');
  return `<div class="pr-table-wrap"><table class="pr-data-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function promotionTableHtml(rows) {
  if (!rows.length) {
    return '<p class="pr-empty">No rows in this promotion (mock).</p>';
  }
  const th = ['Start', 'End', 'Product', 'Regular Price', 'Sale Price']
    .map((h) => `<th scope="col">${escapeHtml(h)}</th>`)
    .join('');
  const body = rows
    .map((r) => {
      const url = escapeHtml(r.product);
      return `<tr>
        <td>${escapeHtml(r.start)}</td>
        <td>${escapeHtml(r.end)}</td>
        <td><a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></td>
        <td>${escapeHtml(r.regularPrice)}</td>
        <td>${escapeHtml(r.salePrice)}</td>
      </tr>`;
    })
    .join('');
  return `<div class="pr-table-wrap"><table class="pr-data-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
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
  const c = MOCK[state.country];
  const years = sortedYears(c.promotions);
  if (!years.length) {
    return '<p class="pr-empty">No promotion folders for this country (mock).</p>';
  }
  const treeParts = [];
  years.forEach((year) => {
    treeParts.push(`<div class="pr-tree-year">${escapeHtml(year)}</div>`);
    (c.promotions[year] || []).forEach((p) => {
      const cur = p.id === state.promoId && year === state.promoYear ? 'true' : 'false';
      treeParts.push(
        `<button type="button" class="pr-tree-item" aria-current="${cur}" data-pr-promo-year="${escapeHtml(year)}" data-pr-promo-id="${escapeHtml(p.id)}">${escapeHtml(p.title)}</button>`,
      );
    });
  });
  const set = (c.promotions[state.promoYear] || []).find((x) => x.id === state.promoId);
  const path = `${state.country.toUpperCase()} / promotions / ${state.promoYear} / ${set ? set.id : '…'}`;
  const detail = set
    ? `<div class="pr-detail-head">
         <h3 class="pr-detail-title">${escapeHtml(set.title)}</h3>
         <p class="pr-detail-path">${escapeHtml(path)}</p>
       </div>
       ${promotionTableHtml(set.rows)}`
    : '<p class="pr-empty">Select a promotion.</p>';

  return `<h2 class="pr-section-title">Promotions</h2>
    <p class="pr-section-hint">Folder: year → named promotion → row table (mock JSON shape).</p>
    <div class="pr-split">
      <nav class="pr-tree" aria-label="Promotions by year">${treeParts.join('')}</nav>
      <div class="pr-detail">${detail}</div>
    </div>`;
}

function renderRulesPanel() {
  const c = MOCK[state.country];
  return `<h2 class="pr-section-title">Rules</h2>
    <p class="pr-section-hint">Cart / catalog rules table (mock columns aligned to AEM <code>config/pricing-rules/{country}/rules.json</code>).</p>
    ${rulesTableHtml(c.rules)}
    <p class="pr-section-hint" style="margin-top:16px">Coupon <strong>programs</strong> (types, codes, batches) live in <a href="coupons.html">Coupons</a> — ProductBus <code>…/coupons/types</code> and <code>…/coupons</code>, not in this mock.</p>`;
}

function render() {
  const mount = document.getElementById('price-rules-mount');
  if (!mount) return;

  ensureNavDefaults();

  const panels = {
    rules: renderRulesPanel(),
    promotions: renderPromotionsPanel(),
  };

  mount.innerHTML = `
    <div class="price-rules-mock-banner">
      <strong>Mock data only.</strong> Rules and promotions preview navigation for US, CA, and MX.
      <a href="coupons.html">Open Coupons</a> for code-based discounts (R2 / ProductBus API).
    </div>
    <div class="pr-country-tabs" role="tablist" aria-label="Country">${renderCountryTabs()}</div>
    <div class="pr-area-tabs" role="tablist" aria-label="Pricing data type">${renderAreaTabs()}</div>
    <div class="pr-panel" role="tabpanel">${panels[state.area]}</div>
  `;

  mount.querySelectorAll('[data-pr-country]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-pr-country');
      if (!key || key === state.country) return;
      state.country = key;
      state.promoYear = '';
      state.promoId = '';
      render();
    });
  });

  mount.querySelectorAll('[data-pr-area]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-pr-area');
      if (!key || key === state.area) return;
      state.area = /** @type {typeof state.area} */ (key);
      render();
    });
  });

  mount.querySelectorAll('[data-pr-promo-year]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const year = btn.getAttribute('data-pr-promo-year') || '';
      const id = btn.getAttribute('data-pr-promo-id') || '';
      state.promoYear = year;
      state.promoId = id;
      render();
    });
  });
}

render();
