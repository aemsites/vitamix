/* eslint-env es2020 */
import { apiFetch, commerceAdminHref, getApiEnvironment } from './commerce-otp-api.js';
import {
  catalogApiPath, categorySlugFromName, fetchCatalogProduct, listCatalogSummaries,
} from './commerce-catalog-io.js';
import { categoryColorClass } from './commerce-category.js';
import { PB_ORG, PB_SITE } from './commerce-pbus-config.js';
import { fetchImageSheet, planImageSync } from './product-image-sync.js';
import { escapeHtml, showToast } from './commerce-otp-ui.js';
import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';
import { openProductSelectorModal } from './product-selection-field.js';
import { parseCommaList } from './product-selector.js';
import { getProductCreateContext, resolveImageUrlForLocale } from './pim.js';
import { OPTION_PRESETS, TAX_PRESETS } from './product-create-presets.js';

const ASSETS_APP = 'https://da.live/app/aemsites/vitamix/tools/product-assets/app?ref=product-assets';
const LOCALES = ['us/en_us', 'ca/en_us', 'ca/fr_ca', 'mx/en_us', 'mx/es_mx', 'vr/en_us'];
const STEPS = ['Product assets', 'Product & pricing', 'Buttons', 'Review & create'];
const BUTTON_SETTINGS = ['addToCart', 'comingSoon', 'findDealer', 'findLocally', 'retired'];
const MARKET_CURRENCIES = {
  us: 'USD', ca: 'CAD', mx: 'MXN', vr: 'USD',
};

function priceAmount(text) {
  const amount = text.trim().replace(/^[A-Z]*\$\s*/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || !Number.isFinite(Number(amount))) {
    throw new Error('Enter a valid non-negative price with up to two decimal places.');
  }
  return Number(amount).toFixed(2);
}

function colorLabel(slug) {
  return slug.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function colorKey(label) {
  return String(label || '').trim().toLowerCase().replace(/[\s-]+/g, '-');
}

function priceCents(amount) {
  const cents = Number(priceAmount(String(amount ?? ''))) * 100;
  const rounded = Math.round(cents);
  if (!Number.isSafeInteger(rounded)) throw new Error('Price exceeds the supported range.');
  return rounded;
}

function bundleComponent(product, catalogPlan, currency) {
  const label = product.name || product.sku;
  if (product.bundleItems?.length || product.type === 'bundle' || product.custom?.type === 'bundle') {
    throw new Error(`${label}: Bundles cannot be added as components.`);
  }
  if (!product.sku || !product.name || product.price?.currency !== currency) {
    throw new Error(`${label}: A component needs a SKU, name and price in ${currency}.`);
  }
  const weight = priceCents(product.price?.final);
  const taxFields = (row) => ({
    ...(row.taxCode != null ? { taxCode: row.taxCode } : {}),
    ...(row.taxData != null ? { taxData: row.taxData } : {}),
  });
  if (!product.variants?.length) {
    if (product.type && product.type !== 'simple') {
      throw new Error(`${label}: Only simple products or products with matching color variants are compatible.`);
    }
    return {
      weight, sku: product.sku, name: product.name, ...taxFields(product),
    };
  }
  if (!catalogPlan.variantPlans.length) {
    throw new Error(`${label}: A product without colors can only bundle simple products.`);
  }
  const variants = catalogPlan.variantPlans.map(({ colorSlug }, index) => {
    const parentColor = catalogPlan.nextProduct.variants[index].options[0].value;
    const matches = product.variants.filter((variant) => variant.options?.some(
      (option) => option.id === 'color' && colorKey(option.value) === colorKey(colorSlug),
    ));
    if (matches.length !== 1 || !matches[0].sku
      || matches[0].options.some((option) => option.id !== 'color')) {
      throw new Error(`${label}: Needs exactly one compatible ${parentColor} variant, with no additional options.`);
    }
    const variant = matches[0];
    return {
      sku: variant.sku,
      name: variant.name || `${product.name} ${parentColor}`,
      options: [{ id: 'color', name: parentColor }],
      ...taxFields(product),
      ...taxFields(variant),
    };
  });
  return { weight, variants };
}

function pricedBundleItems(components, amount) {
  const total = BigInt(priceCents(amount));
  const weights = components.map((component) => BigInt(component.weight));
  const sum = weights.reduce((value, weight) => value + weight, 0n);
  if (sum === 0n && total > 0n) {
    throw new Error('Cannot allocate a positive bundle price when all component prices are zero.');
  }
  const cents = weights.map((weight) => (sum ? (total * weight) / sum : 0n));
  const remainders = weights.map((weight, index) => ({
    index, remainder: sum ? (total * weight) % sum : 0n,
  })).sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });
  const remaining = Number(total - cents.reduce((value, share) => value + share, 0n));
  remainders.slice(0, remaining).forEach(({ index }) => { cents[index] += 1n; });
  return components.map(({ weight, preview, ...component }, index) => {
    const share = cents[index];
    const final = `${share / 100n}.${String(share % 100n).padStart(2, '0')}`;
    const price = { final, regular: final };
    return component.variants
      ? { variants: component.variants.map((variant) => ({ ...variant, price: { ...price } })) }
      : { ...component, price };
  });
}

function bundleSummary(product) {
  if (!product.bundleItems) return '';
  const total = product.bundleItems.reduce((sum, component) => (
    sum + priceCents((component.variants?.[0] || component).price.final)
  ), 0);
  const formattedTotal = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: product.price.currency,
  }).format(total / 100);
  return `<h3>Virtual Bundle</h3><ul>${product.bundleItems.map((component) => {
    const rows = component.variants || [component];
    return rows.map((row) => `<li>${escapeHtml(row.name)} (${escapeHtml(row.sku)})
      &mdash; ${escapeHtml(product.price.currency)} ${escapeHtml(row.price.final)}</li>`).join('');
  }).join('')}</ul><p><strong>Calculated bundle price:
    ${escapeHtml(product.price.currency)} ${escapeHtml(formattedTotal)}</strong></p>`;
}

function settingsSummary(product) {
  const { weight } = product;
  return `<ul>
    ${product.taxCode ? `<li>Tax: ${escapeHtml(product.taxCode)} /
      ${escapeHtml(product.taxData.UDF10)} / ${escapeHtml(product.taxData.UDF11)}</li>` : ''}
    ${weight ? `<li>Weight: ${escapeHtml(String(weight.value))} ${escapeHtml(weight.unit)}</li>` : ''}
    <li>Condition: ${product.itemCondition === 'NewCondition' ? 'New' : 'Refurbished'}</li>
    ${product.custom.promoButton ? `<li>promoButton: ${escapeHtml(product.custom.promoButton)}</li>` : ''}
  </ul>${product.custom.options?.length ? `<h3>Options</h3><ul>${product.custom.options.map(
    (option) => `<li>${escapeHtml(option.name)} (${escapeHtml(option.sku)}) &mdash;
      ${escapeHtml(product.price.currency)} ${escapeHtml(option.finalPrice)}</li>`,
  ).join('')}</ul>` : ''}`;
}

function input(label, name, attributes = '') {
  return `<label>${escapeHtml(label)}<input name="${name}" ${attributes}></label>`;
}

function validateRows(rows) {
  rows.forEach((row, i) => {
    const path = String(row?.Path ?? row?.path ?? '').trim();
    if (!path || /(^|\/)\.\.?($|\/)|[\\?#]/.test(path)) {
      throw new Error(`Image row ${i + 1} has a missing or invalid Path. Correct it in Product Assets.`);
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^https?:\/\//i.test(path)) {
      throw new Error(`Image row ${i + 1} must use a relative path or HTTP(S) URL.`);
    }
    const relative = path.replace(/^\/+/, '');
    if (!/^https?:\/\//i.test(path) && relative.includes('/')
      && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(relative.split('/')[0])) {
      throw new Error(`Image row ${i + 1} has an ambiguous color folder. Use lowercase hyphenated color names.`);
    }
    const video = String(row?.Video ?? row?.video ?? '').trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(video) && !/^https?:\/\//i.test(video)) {
      throw new Error(`Image row ${i + 1} has an invalid Video URL.`);
    }
  });
}

/** Structure comes from the same market-filtered folders used by image sync. */
export function planProductCreate(rows, urlKey, locale) {
  validateRows(rows);
  const market = locale.split('/')[0];
  const initial = planImageSync({}, rows, urlKey, market);
  if (!initial.productImages.length && !initial.unmatched.length) {
    throw new Error('No images are available for this market. Set up and publish product assets first.');
  }
  const variants = initial.unmatched.map(({ colorSlug }) => ({
    options: [{ id: 'color', value: colorLabel(colorSlug) }],
  }));
  return planImageSync({ variants }, rows, urlKey, market);
}

function gallery(title, images, metaImage) {
  if (!images.length) return '';
  return `<section class="product-create-gallery">
    ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
    <div class="product-create-images">
    ${images.map((media) => `
      <a class="product-create-thumbnail${media.url === metaImage ? ' product-create-social' : ''}"
        href="${escapeHtml(media.url)}" target="_blank" rel="noopener noreferrer"
        title="${escapeHtml(media.label || title || 'Product image')}${media.url === metaImage ? ' (social image)' : ''}">
        <img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.label || title)}" loading="lazy">
        ${media.video ? '<span class="product-create-video" aria-label="Includes video">Video</span>' : ''}
      </a>`).join('')}</div></section>`;
}

function assetOverview(plans) {
  const groups = new Map();
  let metaImage;
  plans.forEach((plan) => {
    metaImage ||= plan.metaImage;
    [
      { colorSlug: '', images: plan.productImages },
      ...plan.variantPlans,
    ].forEach(({ colorSlug, images }) => {
      const group = groups.get(colorSlug) || new Map();
      images.forEach((media) => group.set(media.url, media));
      groups.set(colorSlug, group);
    });
  });
  return [...groups].map(([color, images]) => gallery(
    colorLabel(color),
    [...images.values()],
    metaImage,
  )).join('');
}

function reviewSummary(products, plans) {
  const markets = new Map();
  products.forEach((product) => {
    const market = product.path.split('/')[1];
    if (!markets.has(market)) markets.set(market, []);
    markets.get(market).push(product);
  });
  return `<h3 class="product-create-review-name">${escapeHtml(products[0].name)}</h3>
    <div class="product-create-review-markets">${[...markets].map(([market, entries]) => {
    const product = entries[0];
    const marketName = {
      us: 'United States', ca: 'Canada', mx: 'Mexico', vr: 'Rest of World',
    }[market];
    const price = new Intl.NumberFormat('en-US', {
      style: 'currency', currency: product.price.currency,
    }).format(Number(product.price.final));
    const marketPlans = new Map(entries.map((entry) => {
      const catalog = entry.path.split('/').slice(1, 3).join('/');
      return [catalog, plans.get(catalog)];
    }));
    const skuRows = new Map();
    entries.forEach((entry) => {
      (entry.variants?.length ? entry.variants : [entry]).forEach((row) => {
        skuRows.set(row.sku, row);
      });
    });
    return `<article class="product-create-review-market">
      <div class="product-create-review-market-heading">
        <span class="product-create-flag product-create-flag-${market}">
          <img src="/icons/flag-${market}.svg" alt="${marketName}">
        </span>
        <div><strong>${marketName}</strong><div class="product-create-review-locales">
          ${entries.map((entry) => escapeHtml(entry.path.split('/')[2])).join(' / ')}
        </div></div>
        <div class="product-create-review-price">${escapeHtml(price)}
          <small>${escapeHtml(product.price.currency)}</small></div>
      </div>
      ${assetOverview(marketPlans)}
      <div class="product-create-review-skus">${[...skuRows.values()].map((row) => `<span class="product-create-review-sku">
        <span>${escapeHtml(row.options?.find((option) => option.id === 'color')?.value || 'Product')}</span>
        <code>${escapeHtml(row.sku)}</code></span>`).join('')}
      </div>
    </article>`;
  }).join('')}</div>
    <details class="product-create-review-details"><summary>Detailed summary</summary>
      <p><strong>Availability: OutOfStock</strong> for the product and every variant.
        <strong>Robots: noindex.</strong> These are not access controls; the product URL can be public.</p>
      ${products.map((product) => `<section class="product-create-review-catalog">
        <h3>${escapeHtml(product.path.split('/').slice(1, 3).join('/'))}</h3>
        <p>Type: ${escapeHtml(product.type)} &middot; Brand: ${escapeHtml(product.brand)}</p>
        <p>Parent SKU: <code>${escapeHtml(product.sku)}</code></p>
        <p>Path: <code>${escapeHtml(product.path)}</code></p>
        <p><a href="${escapeHtml(product.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(product.url)}</a></p>
        <div class="pim-cat-tags">${product.custom.categories.map((category) => (
    `<span class="pim-cat-tag ${categoryColorClass(category.name)}">${escapeHtml(category.name)}</span>`
  )).join('')}</div>
        <ul>${BUTTON_SETTINGS.map((setting) => `<li>${setting}: ${product.custom[setting]}</li>`).join('')}</ul>
        ${settingsSummary(product)}${bundleSummary(product)}
      </section>`).join('')}
    </details>`;
}

function waitForImage(img) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (loaded) => {
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      if (loaded) resolve();
      else reject(new Error('An image preview could not load. Fix and publish the assets, then Check again.'));
    };
    timer = setTimeout(() => finish(false), 15000);
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.loading = 'eager';
    if (img.complete) finish(img.naturalWidth > 0);
  });
}

export function startProductCreate({ locale = 'us/en_us', categories = [] } = {}) {
  if (getApiEnvironment() !== 'prod') {
    showToast('Product creation is only available in production.', 'error');
    return;
  }
  if (document.querySelector('.product-create-dialog')) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'product-create-dialog';
  dialog.setAttribute('aria-labelledby', 'productCreateTitle');
  dialog.innerHTML = `
    <header><h2 id="productCreateTitle">Add new product</h2><p data-progress aria-live="polite"></p></header>
    <form novalidate><div class="product-create-body">
      <section data-step="0">
        <p>Published product assets determine the type, colors and image assignments.
          Set up the images before continuing.</p>
        <div class="product-create-fields">
          ${input('URL key', 'urlKey', 'required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="200"')}
          <label>Placement<select name="placement"><option value="">Household</option><option value="commercial/">Commercial</option></select></label>
        </div>
        <fieldset class="product-create-catalogs">
          <legend>Catalogs</legend>
          <p>Select one or more countries. Canada includes English and French; Mexico includes English and Spanish.</p>
          <div class="product-create-catalog-options">
            ${['us', 'ca', 'mx', 'vr'].map((market) => {
    const label = {
      us: 'United States', ca: 'Canada (English and French)', mx: 'Mexico (English and Spanish)', vr: 'Rest of World',
    }[market];
    return `<label class="product-create-catalog" title="${label}">
              <input type="checkbox" name="locale" value="${market}" aria-label="${label}" ${market === locale.split('/')[0] ? 'checked' : ''}>
              <span class="product-create-catalog-pill">
                <span class="product-create-flag product-create-flag-${market}">
                  <img src="/icons/flag-${market}.svg" alt="">
                </span>
              </span>
            </label>`;
  }).join('')}
          </div>
        </fieldset>
        <p>Catalog path: <code data-path></code></p>
        <p data-assets-help hidden><a href="${ASSETS_APP}" target="_blank" rel="noopener noreferrer">Set up product assets</a>
          in a new tab, then return here and check again.</p>
        <button type="button" data-check>Check assets</button>
        <p data-assets-status role="status"></p><div data-assets-preview></div>
      </section>
      <section data-step="1" hidden>
        <div class="product-create-fields">
          ${input('Product name', 'name', 'required')}
          <label data-product-sku>Product SKU<input name="sku" required></label>
        </div>
        <h3>Categories</h3>
        <p>Click categories to select or deselect them.</p>
        <div class="pim-cat-tags product-create-categories">
          <span data-categories class="product-create-category-choices"></span>
          <button type="button" class="pim-cat-tag product-create-category-ghost" data-add-category>+ Add category</button>
          <input name="newCategory" aria-label="New category" placeholder="Category name; Enter to add" hidden>
        </div>
        <p data-category-status role="status"></p>
        <h3>Price</h3>
        <p>Each country's price applies to all variants and languages in that country.</p>
        <div data-prices class="product-create-prices"></div>
        <div data-variants></div>
        <p>Colors and galleries come from Product Assets. To change structure, go Back,
          update and publish the assets, then Check again. SKUs are shared across all markets.
          Variant names and URLs are generated automatically.</p>
      </section>
      <section data-step="2" hidden>
        <div class="product-create-fields product-create-tax">
          <label>Tax classification<select name="taxPreset">
            <option value="">Not set</option>
            ${TAX_PRESETS.map((preset, index) => `<option value="${index}">${escapeHtml(
    `${preset.taxCode} / ${preset.taxData.UDF10} / ${preset.taxData.UDF11}`,
  )}</option>`).join('')}
          </select></label>
        </div>
        <div class="product-create-fields">
          ${input('Weight', 'weight', 'type="number" min="0" step="any" inputmode="decimal"')}
          <label>Weight unit<select name="weightUnit">
            <option value="lb">lb</option><option value="kg">kg</option>
            <option value="oz">oz</option><option value="g">g</option>
          </select></label>
        </div>
        <div class="product-create-buttons">
          ${BUTTON_SETTINGS.map((setting) => `<label class="product-create-button-toggle">
            <input type="checkbox" name="${setting}"${setting === 'addToCart' ? ' checked' : ''}>
            <span>${setting}</span>
          </label>`).join('')}
          <label class="product-create-promo">promo:
            <input name="promoButton" aria-label="Promotional button text">
          </label>
        </div>
        <div class="product-create-bundle">
          <label class="product-create-bundle-toggle"><input type="checkbox" name="virtualBundle"> Virtual Bundle</label>
          <div data-bundle-editor hidden>
            <div data-bundle-products></div>
            <button type="button" data-bundle-pick>Add products…</button>
          </div>
        </div>
        <div class="product-create-options-section">
          <label class="product-create-options-toggle"><input type="checkbox" name="showOptions"
            aria-controls="product-create-option-fields" aria-expanded="false"> Options</label>
          <div id="product-create-option-fields" role="region" aria-label="Options" hidden>
            <div class="product-create-options">
              ${OPTION_PRESETS.map((option, index) => `<label class="product-create-option-choice">
                <input type="checkbox" name="productOption" value="${index}">
                <span>${escapeHtml(option.name)} <small>${escapeHtml(option.sku)}</small></span>
              </label>`).join('')}
            </div>
          </div>
        </div>
        <div class="product-create-advanced">
          <label class="product-create-advanced-toggle"><input type="checkbox" name="advancedSettings"
            aria-controls="product-create-advanced-fields" aria-expanded="false"> Advanced Settings</label>
          <div id="product-create-advanced-fields" role="region" aria-label="Advanced Settings" hidden>
            <div class="product-create-fields">
              <label>Condition<select name="itemCondition">
                <option value="NewCondition">New</option>
                <option value="RefurbishedCondition">Refurbished</option>
              </select></label>
            </div>
          </div>
        </div>
      </section>
      <section data-step="3" hidden>
        <div data-review></div>
        <div data-review-json hidden><pre></pre></div>
      </section>
      <p class="product-create-error" role="alert" hidden></p>
    </div><footer>
      <button type="button" data-json-toggle aria-pressed="false" hidden>JSON</button>
      <button type="button" data-cancel>Cancel</button>
      <button type="button" data-back hidden>Back</button>
      <button type="submit" data-next disabled>Next</button>
    </footer></form>`;

  const form = dialog.querySelector('form');
  const error = dialog.querySelector('[role="alert"]');
  const next = dialog.querySelector('[data-next]');
  const back = dialog.querySelector('[data-back]');
  const check = dialog.querySelector('[data-check]');
  const cancel = dialog.querySelector('[data-cancel]');
  const jsonToggle = dialog.querySelector('[data-json-toggle]');
  const preview = dialog.querySelector('[data-assets-preview]');
  const status = dialog.querySelector('[data-assets-status]');
  const assetsHelp = dialog.querySelector('[data-assets-help]');
  const field = (name) => form.elements.namedItem(name);
  const value = (name) => field(name).value.trim();
  const selectedLocales = () => {
    const markets = [...form.querySelectorAll('input[name="locale"]:checked')]
      .map((option) => option.value);
    return LOCALES.filter((catalog) => markets.includes(catalog.split('/')[0]));
  };
  const path = (catalog) => `/${catalog}/products/${value('placement')}${value('urlKey')}`;
  let step = 0;
  let plan;
  let products = [];
  let bundlePaths = [];
  let bundleComponents = new Map();
  let catalogOptions = new Map();
  let preparing = false;
  let plans = new Map();
  let checkedRows;
  const detailDrafts = new Map();
  const categoryChoices = new Map(categories.map((category) => [
    category.name.trim().toLowerCase(),
    { name: category.name, url_key: category.slug || categorySlugFromName(category.name) },
  ]));
  const selectedCategories = new Set();
  const created = new Set();
  let saving = false;
  let checking = false;
  let dirty = false;
  let revision = 0;

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
  }

  async function loadCatalogOptions() {
    const selected = [...form.querySelectorAll('input[name="productOption"]:checked')]
      .map((option) => OPTION_PRESETS[Number(option.value)]);
    if (!selected.length) return new Map();
    const summaries = await listCatalogSummaries();
    const entries = await Promise.all(selectedLocales().map(async (catalog) => {
      const options = await Promise.all(selected.map(async (preset) => {
        const label = `${catalog}: ${preset.name} (${preset.sku})`;
        const matches = summaries.filter((row) => (
          row.sku === preset.sku && row.path.startsWith(`/${catalog}/products/`)
        ));
        if (matches.length !== 1) {
          throw new Error(`${label}: Expected one catalog product for this SKU; found ${matches.length}.`);
        }
        const product = await fetchCatalogProduct(matches[0].path);
        if (!product || product.sku !== preset.sku) {
          throw new Error(`${label}: Catalog product is missing or its SKU has changed.`);
        }
        const currency = MARKET_CURRENCIES[catalog.split('/')[0]];
        if (product.price?.currency !== currency) {
          throw new Error(`${label}: Option price must be in ${currency}.`);
        }
        let finalPrice;
        try {
          finalPrice = priceAmount(String(product.price.final ?? ''));
        } catch (err) {
          throw new Error(`${label}: ${err.message}`);
        }
        return {
          name: product.name,
          sku: product.sku,
          path: matches[0].path,
          type: 'radio',
          required: '1',
          price: finalPrice,
          finalPrice,
        };
      }));
      return [catalog, options];
    }));
    return new Map(entries);
  }

  async function loadBundleComponents(paths) {
    if (!paths.length) throw new Error('Select at least one product for the virtual bundle.');
    const entries = await Promise.all(selectedLocales().map(async (catalog) => {
      const components = await Promise.all(paths.map(async (suffix) => {
        const componentPath = `/${catalog}${suffix}`;
        try {
          if (componentPath === path(catalog)) throw new Error('A bundle cannot contain itself.');
          const product = await fetchCatalogProduct(componentPath);
          if (!product) throw new Error('Product does not exist in this catalog.');
          const currency = MARKET_CURRENCIES[catalog.split('/')[0]];
          const component = bundleComponent(product, plans.get(catalog), currency);
          const image = product.images?.[0]?.url
            || product.variants?.find((variant) => variant.images?.length)?.images[0]?.url;
          return {
            ...component,
            preview: {
              name: product.name,
              image: image ? resolveImageUrlForLocale(catalog, image) : '',
            },
          };
        } catch (err) {
          throw new Error(`${componentPath}: ${err.message}`);
        }
      }));
      const skus = components.flatMap((component) => (
        component.variants || [component]
      )).map((row) => row.sku);
      if (new Set(skus).size !== skus.length) {
        throw new Error(`${catalog}: Bundle components must have distinct SKUs.`);
      }
      return [catalog, components];
    }));
    return new Map(entries);
  }

  function renderBundleProducts() {
    const components = bundleComponents.values().next().value || [];
    const prices = new Map();
    try {
      const markets = new Set();
      bundleComponents.forEach((items, catalog) => {
        const market = catalog.split('/')[0];
        if (markets.has(market) || !items.length) return;
        markets.add(market);
        prices.set(market, pricedBundleItems(items, priceAmount(value(`price-${market}`))));
      });
    } catch (err) {
      prices.clear();
      showError(err.message);
    }
    dialog.querySelector('[data-bundle-products]').innerHTML = bundlePaths.map((suffix, index) => {
      const component = components[index];
      const name = component?.preview?.name || suffix;
      const image = component?.preview?.image;
      const amounts = [...prices].map(([market, items]) => {
        const item = items[index];
        const amount = (item.variants?.[0] || item).price.final;
        const currency = MARKET_CURRENCIES[market];
        const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency })
          .format(Number(amount));
        return `<span>${escapeHtml(market.toUpperCase())} ${escapeHtml(currency)} ${escapeHtml(formatted)}</span>`;
      }).join('');
      return `<div class="product-create-bundle-item">
        ${image ? `<img class="product-create-bundle-thumb" src="${escapeHtml(image)}" alt="" width="36" height="36" loading="lazy">`
    : '<span class="product-create-bundle-thumb product-create-bundle-no-image" aria-label="No product image"></span>'}
        <span class="product-create-bundle-item-label">${escapeHtml(name)}</span>
        <span class="product-create-bundle-prices">${amounts}</span>
        <button type="button" class="product-create-bundle-remove" data-bundle-remove="${index}" aria-label="Remove ${escapeHtml(name)}">Remove</button></div>`;
    }).join('');
    dialog.querySelector('[data-bundle-pick]').textContent = bundlePaths.length
      ? 'Edit products…' : 'Add products…';
  }

  field('virtualBundle').addEventListener('change', () => {
    dialog.querySelector('[data-bundle-editor]').hidden = !field('virtualBundle').checked;
  });
  field('advancedSettings').addEventListener('change', () => {
    const enabled = field('advancedSettings').checked;
    dialog.querySelector('#product-create-advanced-fields').hidden = !enabled;
    field('advancedSettings').setAttribute('aria-expanded', String(enabled));
  });
  field('showOptions').addEventListener('change', () => {
    const enabled = field('showOptions').checked;
    dialog.querySelector('#product-create-option-fields').hidden = !enabled;
    field('showOptions').setAttribute('aria-expanded', String(enabled));
  });
  jsonToggle.addEventListener('click', () => {
    const showJson = jsonToggle.getAttribute('aria-pressed') !== 'true';
    jsonToggle.setAttribute('aria-pressed', String(showJson));
    jsonToggle.textContent = showJson ? 'Summary' : 'JSON';
    dialog.querySelector('[data-review]').hidden = showJson;
    dialog.querySelector('[data-review-json]').hidden = !showJson;
  });
  dialog.querySelector('[data-bundle-products]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-bundle-remove]');
    if (!button) return;
    const index = Number(button.dataset.bundleRemove);
    bundlePaths.splice(index, 1);
    bundleComponents.forEach((components) => components.splice(index, 1));
    dirty = true;
    renderBundleProducts();
  });
  dialog.querySelector('[data-bundle-pick]').addEventListener('click', async () => {
    try {
      const catalog = selectedLocales()[0];
      let checkedPaths;
      let checkedComponents;
      const selection = await openProductSelectorModal({
        title: 'Virtual Bundle products',
        localePath: catalog,
        products: bundlePaths.map((suffix) => `/${catalog}${suffix}`).join(', '),
        categories: '',
        productsOnly: true,
        fixedLocale: true,
        validateSelection: async ({ products: picked }) => {
          checkedPaths = [...new Set(parseCommaList(picked).map((productPath) => {
            const prefix = `/${catalog}/products/`;
            if (!productPath.startsWith(prefix) || productPath.includes('|')) {
              throw new Error('Select whole products from this catalog, not individual SKUs.');
            }
            return productPath.slice(catalog.length + 1);
          }))];
          checkedComponents = await loadBundleComponents(checkedPaths);
        },
      });
      if (!selection || !dialog.isConnected) return;
      bundlePaths = checkedPaths;
      bundleComponents = checkedComponents;
      dirty = true;
      error.hidden = true;
      renderBundleProducts();
    } catch (err) {
      showError(err.message || 'Could not open the bundle product picker.');
    }
  });

  function renderCategoryChoices() {
    dialog.querySelector('[data-categories]').innerHTML = [...categoryChoices]
      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
      .map(([key, category]) => `<button type="button"
        class="pim-cat-tag ${categoryColorClass(category.name)}${selectedCategories.has(key) ? ' pim-cat-tag-active' : ''}"
        data-category-key="${escapeHtml(key)}" aria-pressed="${selectedCategories.has(key)}">
        ${selectedCategories.has(key) ? '<span aria-hidden="true">&#10003; </span>' : ''}${escapeHtml(category.name)}</button>`).join('');
  }

  dialog.querySelector('[data-categories]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-category-key]');
    if (!button) return;
    const key = button.dataset.categoryKey;
    if (selectedCategories.has(key)) selectedCategories.delete(key);
    else selectedCategories.add(key);
    dirty = true;
    renderCategoryChoices();
  });
  dialog.querySelector('[data-add-category]').addEventListener('click', () => {
    field('newCategory').hidden = false;
    dialog.querySelector('[data-add-category]').hidden = true;
    field('newCategory').focus();
  });
  function addCategory() {
    const name = value('newCategory');
    const slug = categorySlugFromName(name);
    if (!name || !slug || /[,\t\r\n]/.test(name)) {
      showError('Enter a category name without commas or line breaks.');
      return;
    }
    const key = name.toLowerCase();
    if (!categoryChoices.has(key)) {
      if ([...categoryChoices.values()].some((category) => category.url_key === slug)) {
        showError('This name creates the same URL key as an existing category. Select that category instead.');
        return;
      }
      categoryChoices.set(key, { name, url_key: slug });
    }
    selectedCategories.add(key);
    field('newCategory').value = '';
    field('newCategory').hidden = true;
    dialog.querySelector('[data-add-category]').hidden = false;
    dirty = true;
    error.hidden = true;
    dialog.querySelector('[data-category-status]').textContent = `Selected category: ${name}`;
    renderCategoryChoices();
    dialog.querySelector('[data-add-category]').focus();
  }
  field('newCategory').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      field('newCategory').value = '';
      field('newCategory').hidden = true;
      dialog.querySelector('[data-add-category]').hidden = false;
      dialog.querySelector('[data-add-category]').focus();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addCategory();
  });
  renderCategoryChoices();

  function changeStep(index) {
    step = index;
    dialog.querySelectorAll('[data-step]').forEach((section) => {
      section.hidden = Number(section.dataset.step) !== step;
    });
    dialog.querySelector('[data-progress]').textContent = `Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`;
    back.hidden = step === 0;
    next.textContent = step === 3 ? 'Create product' : 'Next';
    next.disabled = step === 0 && !plan;
    jsonToggle.hidden = step !== 3;
    jsonToggle.setAttribute('aria-pressed', 'false');
    jsonToggle.textContent = 'JSON';
    dialog.querySelector('[data-review]').hidden = false;
    dialog.querySelector('[data-review-json]').hidden = true;
    error.hidden = true;
    if (step === 2 && bundlePaths.length) renderBundleProducts();
    dialog.querySelector('.product-create-body').scrollTop = 0;
    dialog.querySelector(`[data-step="${step}"] input, [data-step="${step}"] select, [data-next]`).focus();
  }

  function dismiss() {
    if (saving) return;
    const message = created.size
      ? `${created.size} catalogs have been created and will remain. Close without creating the remaining catalogs?`
      : 'Discard this new product and close?';
    if (dirty && !window.confirm(message)) return;
    revision += 1;
    dialog.close();
    dialog.remove();
  }

  function invalidate() {
    revision += 1;
    plan = undefined;
    plans = new Map();
    checkedRows = undefined;
    next.disabled = true;
    preview.replaceChildren();
    status.textContent = 'Check assets for the selected product and catalog.';
    assetsHelp.hidden = true;
    dialog.querySelector('[data-path]').textContent = selectedLocales().map((catalog) => path(catalog)).join(', ');
    check.textContent = 'Check assets';
  }

  function updateCatalogPlans() {
    dialog.querySelector('[data-path]').textContent = selectedLocales()
      .map((catalog) => path(catalog)).join(', ');
    if (!checkedRows) return;
    plans = new Map();
    plan = undefined;
    next.disabled = true;
    error.hidden = true;
    try {
      if (!selectedLocales().length) throw new Error('Select at least one country to continue.');
      selectedLocales().forEach((catalog) => {
        try {
          plans.set(catalog, planProductCreate(checkedRows, value('urlKey'), catalog));
        } catch (err) {
          throw new Error(`${catalog}: ${err.message}`);
        }
      });
      plan = plans.values().next().value;
      next.disabled = false;
    } catch (err) {
      showError(err.message);
    }
  }

  function populateDetails() {
    if (value('placement') === 'commercial/') {
      if (!categoryChoices.has('commercial')) {
        categoryChoices.set('commercial', { name: 'Commercial', url_key: 'commercial' });
      }
      selectedCategories.add('commercial');
      renderCategoryChoices();
    }
    const colors = new Set([...plans.values()].flatMap((candidate) => (
      candidate.variantPlans.map((group) => group.colorSlug)
    )));
    const configurable = [...plans.values()]
      .every((candidate) => candidate.variantPlans.length > 0);
    dialog.querySelector('[data-product-sku]').hidden = configurable;
    field('sku').required = !configurable;
    const markets = [...new Set(selectedLocales().map((catalog) => catalog.split('/')[0]))];
    dialog.querySelector('[data-prices]').innerHTML = markets.map((market) => `
      <fieldset class="product-create-price" data-market="${market}">
        <legend><span class="product-create-flag product-create-flag-${market}">
          <img src="/icons/flag-${market}.svg" alt="${market === 'vr' ? 'Rest of World' : market.toUpperCase()}">
        </span> ${MARKET_CURRENCIES[market]}</legend>
        <input name="price-${market}" aria-label="${market.toUpperCase()} price in ${MARKET_CURRENCIES[market]}"
          required inputmode="decimal" placeholder="0.00" data-currency="${MARKET_CURRENCIES[market]}">
      </fieldset>`).join('');
    dialog.querySelector('[data-variants]').innerHTML = colors.size
      ? `<h3>Variant SKUs</h3><div class="product-create-fields">${[...colors].map((color) => (
        input(`${colorLabel(color)} SKU`, `sku-${color}`, 'required')
      )).join('')}</div>`
      : '';
    dialog.querySelectorAll('[data-step="1"] input').forEach((item) => {
      item.value = detailDrafts.get(`${value('urlKey')}/${item.name}`) || '';
      if (item.dataset.currency) formatPrice(item);
    });
  }

  function rememberDetails() {
    dialog.querySelectorAll('[data-step="1"] input').forEach((item) => {
      detailDrafts.set(`${value('urlKey')}/${item.name}`, item.value);
    });
  }

  function formatPrice(item) {
    item.setCustomValidity('');
    if (!item.value.trim()) return;
    try {
      item.value = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: item.dataset.currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(priceAmount(item.value)));
    } catch (err) {
      item.setCustomValidity(err.message);
    }
  }

  function validateStep() {
    if (step === 1 && !field('newCategory').hidden && value('newCategory')) {
      showError('Press Enter to add the new category before continuing.');
      field('newCategory').focus();
      return false;
    }
    if (step === 0 && !selectedLocales().length) {
      showError('Select at least one catalog before checking product assets.');
      form.querySelector('input[name="locale"]').focus();
      return false;
    }
    return [...dialog.querySelectorAll(`[data-step="${step}"] input, [data-step="${step}"] select`)]
      .filter((item) => !item.closest('[hidden]')).every((item) => {
        if (item.tagName === 'INPUT' && item.type !== 'checkbox') item.value = item.value.trim();
        return item.reportValidity();
      });
  }

  function buildProduct(catalog) {
    const catalogPlan = plans.get(catalog);
    const market = catalog.split('/')[0];
    const amount = priceAmount(value(`price-${market}`));
    const price = { currency: MARKET_CURRENCIES[market], final: amount, regular: amount };
    const url = `https://www.vitamix.com${path(catalog)}`;
    const taxPreset = value('taxPreset') === '' ? undefined : TAX_PRESETS[Number(value('taxPreset'))];
    const tax = taxPreset
      ? { taxCode: taxPreset.taxCode, taxData: { ...taxPreset.taxData } } : {};
    const condition = value('itemCondition');
    const weightValue = value('weight');
    if (weightValue && (!Number.isFinite(Number(weightValue)) || Number(weightValue) < 0)) {
      throw new Error('Enter a valid non-negative weight.');
    }
    const physical = () => {
      if (!weightValue) return {};
      const weight = { value: Number(weightValue), unit: value('weightUnit') };
      return { weight, shippingDimensions: { weight: { ...weight } } };
    };
    const variants = catalogPlan.nextProduct.variants.map((variant, i) => ({
      ...variant,
      sku: value(`sku-${catalogPlan.variantPlans[i].colorSlug}`),
      name: `${value('name')} ${colorLabel(catalogPlan.variantPlans[i].colorSlug)}`,
      url: `${url}?color=${catalogPlan.variantPlans[i].colorSlug}`,
      price: { ...price },
      availability: 'OutOfStock',
      itemCondition: condition,
      ...physical(),
    }));
    const sku = variants.length ? value('urlKey') : value('sku');
    const skus = [sku, ...variants.map((variant) => variant.sku)];
    if (new Set(skus).size !== skus.length) throw new Error('Product and variant SKUs must be distinct.');
    const result = {
      ...catalogPlan.nextProduct,
      sku,
      name: value('name'),
      path: path(catalog),
      urlKey: value('urlKey'),
      url,
      type: variants.length ? 'configurable' : 'simple',
      brand: 'Vitamix',
      availability: 'OutOfStock',
      metadata: { robots: 'noindex', visibility: 'embargoed' },
      itemCondition: condition,
      ...tax,
      ...physical(),
      custom: {
        categories: [...selectedCategories].map((key) => ({ ...categoryChoices.get(key) })),
        ...Object.fromEntries(BUTTON_SETTINGS.map((setting) => [
          setting, field(setting).checked ? 'Yes' : 'No',
        ])),
        ...(field('virtualBundle').checked ? { type: 'bundle' } : {}),
        ...(value('promoButton') ? { promoButton: value('promoButton') } : {}),
        ...(catalogOptions.get(catalog)?.length
          ? { options: catalogOptions.get(catalog).map((option) => ({ ...option })) } : {}),
      },
      price,
    };
    if (variants.length) {
      result.variants = variants;
      result.options = [{
        id: 'color',
        label: 'Color',
        values: variants.map((variant, i) => ({
          id: catalogPlan.variantPlans[i].colorSlug, value: variant.options[0].value,
        })),
      }];
    } else {
      delete result.variants;
    }
    if (field('virtualBundle').checked) {
      const components = bundleComponents.get(catalog);
      if (!components?.length) throw new Error(`${catalog}: Select compatible bundle products.`);
      const componentSkus = components.flatMap((component) => (
        component.variants || [component]
      )).map((row) => row.sku);
      if (skus.some((item) => componentSkus.includes(item))) {
        throw new Error(`${catalog}: Bundle and component SKUs must be distinct.`);
      }
      result.type = 'bundle';
      result.bundleItems = pricedBundleItems(components, amount);
    }
    return result;
  }

  async function inspectAssets() {
    if (!validateStep() || checking) return;
    const requestRevision = revision;
    checking = true;
    check.disabled = true;
    next.disabled = true;
    plan = undefined;
    checkedRows = undefined;
    preview.replaceChildren();
    error.hidden = true;
    assetsHelp.hidden = true;
    status.textContent = 'Checking published product assets...';
    try {
      const rows = await fetchImageSheet(value('urlKey'));
      if (revision !== requestRevision) return;
      const allAssets = planProductCreate(rows, value('urlKey'), '');
      preview.innerHTML = assetOverview(new Map([['all', allAssets]]));
      await Promise.all([...preview.querySelectorAll('img')].map(waitForImage));
      if (revision !== requestRevision) return;
      checkedRows = rows;
      status.textContent = '';
      updateCatalogPlans();
    } catch (err) {
      if (revision !== requestRevision) return;
      status.textContent = '';
      assetsHelp.hidden = false;
      showError(err.message || 'Could not check product assets.');
    } finally {
      checking = false;
      check.disabled = false;
      check.textContent = 'Check again';
    }
  }

  form.addEventListener('input', (event) => {
    dirty = true;
    if (event.target.name === 'promoButton') {
      event.target.closest('.product-create-promo')
        .classList.toggle('product-create-promo-selected', Boolean(value('promoButton')));
    }
    if (event.target.name === 'urlKey') invalidate();
    if (event.target.dataset.currency) event.target.setCustomValidity('');
  });
  form.addEventListener('focusout', (event) => {
    if (event.target.dataset.currency) formatPrice(event.target);
  });
  form.addEventListener('focusin', (event) => {
    if (!event.target.dataset.currency || !event.target.value) return;
    try {
      event.target.value = priceAmount(event.target.value);
    } catch (err) {
      event.target.setCustomValidity(err.message);
    }
  });
  form.addEventListener('change', (event) => {
    if (['locale', 'placement'].includes(event.target.name)) updateCatalogPlans();
  });
  check.addEventListener('click', inspectAssets);
  cancel.addEventListener('click', dismiss);
  wireDialogEscapeDismiss(dialog, dismiss);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); dismiss(); });
  back.addEventListener('click', () => {
    if (saving || created.size) return;
    if (step === 1) rememberDetails();
    changeStep(step - 1);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving || checking || preparing || !validateStep()) return;
    error.hidden = true;
    if (step === 0) {
      if (!plan) return;
      populateDetails();
      changeStep(1);
    } else if (step === 1) {
      try {
        dialog.querySelectorAll('[data-currency]').forEach(formatPrice);
        if (!validateStep()) return;
        rememberDetails();
        changeStep(2);
      } catch (err) {
        showError(err.message);
      }
    } else if (step === 2) {
      preparing = true;
      next.disabled = true;
      back.disabled = true;
      next.textContent = 'Checking...';
      const settings = dialog.querySelector('[data-step="2"]');
      settings.inert = true;
      try {
        catalogOptions = await loadCatalogOptions();
        if (field('virtualBundle').checked) {
          bundleComponents = await loadBundleComponents(bundlePaths);
        }
        if (!dialog.isConnected) return;
        const catalogs = selectedLocales();
        products = catalogs.map(buildProduct);
        dialog.querySelector('[data-review]').innerHTML = reviewSummary(products, plans);
        dialog.querySelector('[data-review-json] pre').textContent = JSON.stringify(products, null, 2);
        changeStep(3);
      } catch (err) {
        showError(err.message);
      } finally {
        preparing = false;
        settings.inert = false;
        next.disabled = false;
        back.disabled = false;
        next.textContent = step === 3 ? 'Create product' : 'Next';
      }
    } else {
      saving = true;
      next.disabled = true;
      back.disabled = true;
      cancel.disabled = true;
      next.textContent = 'Creating...';
      try {
        if (getApiEnvironment() !== 'prod') throw new Error('Product creation is only available in production.');
        const pending = products.filter((product) => !created.has(product.path));
        const outcomes = await Promise.allSettled(pending
          .map(async (product) => {
            const response = await apiFetch(PB_ORG, PB_SITE, catalogApiPath(product.path), {
              method: 'PUT',
              headers: { 'If-None-Match': '*' },
              body: JSON.stringify(product),
            });
            if (response.status === 412) {
              throw new Error(`${product.path}: A product already exists at this path. Nothing was overwritten.`);
            }
            if (!response.ok) {
              throw new Error(response.headers.get('x-error') || `Create failed (HTTP ${response.status}): ${await response.text()}`);
            }
            if (response.status !== 201) {
              throw new Error(
                `${product.path}: The API did not confirm creation. Check the catalog before retrying.`,
              );
            }
            created.add(product.path);
          }));
        const failures = outcomes.flatMap((outcome, i) => (
          outcome.status === 'rejected' ? [`${pending[i].path}: ${outcome.reason.message}`] : []
        ));
        if (failures.length) {
          throw new Error(`${created.size} of ${products.length} catalogs created. ${failures.join(' ')} Retry only attempts catalogs not yet confirmed created.`);
        }
        const params = new URLSearchParams({
          catalog: selectedLocales()[0], product: products[0].path,
        });
        dialog.close();
        dialog.remove();
        window.location.href = commerceAdminHref(`product-detail.html?${params}`);
      } catch (err) {
        showError(err.message || 'Could not create product.');
      } finally {
        saving = false;
        next.disabled = false;
        back.disabled = created.size > 0;
        cancel.disabled = false;
        next.textContent = 'Create product';
      }
    }
  });
  document.body.append(dialog);
  invalidate();
  dialog.showModal();
  changeStep(0);
}

document.getElementById('productCreateBtn')?.addEventListener('click', () => {
  startProductCreate(getProductCreateContext());
});
