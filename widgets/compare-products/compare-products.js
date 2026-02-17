import { loadCSS, toClassName } from '../../scripts/aem.js';

const FEATURE_KEYS = [
  'Series',
  'Blending Programs',
  'Variable Speed Control',
  'Touch Buttons',
  'Pulse',
  'Digital Timer',
  'Self-Detect Technology',
  'Tamper Indicator',
  'Plus 15 Second Button',
  'Warranty',
  'Dimensions (L × W × H)',
];

/** Map page spec labels to our feature keys (for product specs lookup) */
const SPEC_LABEL_MAP = {
  Dimensions: 'Dimensions (L × W × H)',
  Warranty: 'Warranty',
};

const FEATURES_BY_SERIES_PATH = '/us/en_us/products/config/features-by-series.json';

/**
 * Fetch features-by-series config (same-origin only; no fcors).
 * @returns {Promise<Object|null>} Parsed JSON or null
 */
async function fetchFeaturesBySeries() {
  const url = new URL(FEATURES_BY_SERIES_PATH, window.location.origin).href;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

/**
 * Get series name from product (for features-by-series lookup).
 * @param {Object} product - Product with .custom, .name
 * @returns {string} Series name or ''
 */
function getProductSeries(product) {
  if (!product) return '';
  const c = product.custom || {};
  return (c.series || c.collection || product.name || '').trim();
}

/**
 * Normalize series name for matching: remove "Vitamix", trim, strip ®™.
 * @param {string} s - Series or product name
 * @returns {string} Normalized string for comparison
 */
function normalizeSeriesForMatch(s) {
  if (!s || typeof s !== 'string') return '';
  const t = s
    .replace(/\s*®\s*|\s*™\s*/gi, ' ')
    .replace(/\bVitamix\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

/**
 * Find features row for a series in features-by-series.data.
 * @param {Object} featuresBySeries - { data: Array<{ Series: string, ... }> }
 * @param {string} series - Series name from product
 * @returns {Object|null} Row object or null
 */
function getSeriesFeaturesRow(featuresBySeries, series) {
  const { data } = featuresBySeries || {};
  if (!data?.length || !series) return null;
  const norm = normalizeSeriesForMatch(series);
  if (!norm) return null;
  const normLower = norm.toLowerCase();
  const exact = data.find((row) => normalizeSeriesForMatch(row.Series).toLowerCase() === normLower);
  if (exact) return exact;
  return data.find((row) => {
    const rowNorm = normalizeSeriesForMatch(row.Series).toLowerCase();
    return rowNorm === normLower || rowNorm.includes(normLower) || normLower.includes(rowNorm);
  }) || null;
}

/**
 * Resolve product comparison paths from window.location query
 * (e.g. ?productComparison=/path1,/path2).
 * @returns {string[]} Array of product paths (e.g. /us/en_us/products/ascent-x2)
 */
function getProductComparisonPaths() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('productComparison');
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        const url = new URL(s, window.location.origin);
        return url.pathname;
      } catch {
        return s;
      }
    });
}

const AEM_NETWORK_ORIGIN = 'https://main--vitamix--aemsites.aem.network';

/**
 * Whether to use fcors proxy (localhost, .aem.page, .aem.live).
 * @returns {boolean}
 */
function useFcors() {
  const { hostname } = window.location;
  return hostname === 'localhost'
    || hostname.endsWith('.aem.page')
    || hostname.endsWith('.aem.live');
}

/**
 * Fetch product page HTML (no .json). Uses fcors from aem.network on
 * localhost / .aem.page / .aem.live.
 * @param {string} path - Product path (e.g. /us/en_us/products/ascent-x2)
 * @returns {Promise<{ html: string|null, status: number }>}
 */
async function fetchProductPage(path) {
  const pathOnly = path.startsWith('http') ? new URL(path).pathname : path;
  const fullUrl = path.startsWith('http') ? path : `${AEM_NETWORK_ORIGIN}${pathOnly}`;

  let resp;
  if (useFcors()) {
    const corsProxy = 'https://fcors.org/?url=';
    const corsKey = '&key=Mg23N96GgR8O3NjU';
    const proxyUrl = `${corsProxy}${encodeURIComponent(fullUrl)}${corsKey}`;
    resp = await fetch(proxyUrl);
  } else {
    const url = path.startsWith('http') ? path : new URL(path, window.location.origin).href;
    resp = await fetch(url);
  }
  if (!resp.ok) return { html: null, status: resp.status };
  return { html: await resp.text(), status: resp.status };
}

/**
 * Parse Product Specifications from main content (h3#product-specifications + ul > li).
 * @param {Document} doc - Parsed document
 * @returns {Object.<string, string>} Map of spec label -> value
 */
function parseSpecsFromPage(doc) {
  const specs = {};
  const heading = doc.querySelector('h3#product-specifications, [id="product-specifications"]');
  if (!heading) return specs;
  const list = heading.closest('div')?.querySelector('ul');
  if (!list) return specs;
  list.querySelectorAll(':scope > li').forEach((li) => {
    const strong = li.querySelector('strong');
    const label = strong?.textContent?.replace(/:$/, '').trim();
    if (!label) return;
    let value = '';
    const next = strong?.nextSibling;
    if (next?.nodeType === Node.TEXT_NODE) {
      value = next.textContent.trim();
    }
    const nextP = li.querySelector('p');
    if (nextP && (value === '' || value.length < 3)) {
      value = nextP.textContent.trim();
    }
    if (value === '' && strong?.nextElementSibling) {
      value = strong.nextElementSibling.textContent.trim();
    }
    if (label && value) specs[label] = value;
  });
  return specs;
}

/**
 * Parse warranty text from a section heading (e.g. "10-Year Full Warranty").
 * @param {Document} doc - Parsed document
 * @returns {string} Warranty text or ''
 */
function parseWarrantyFromPage(doc) {
  const headings = [...doc.querySelectorAll('main h3')];
  const h = headings.find((el) => /warranty/i.test(el.textContent || ''));
  if (!h) return '';
  const strong = h.querySelector('strong');
  return (strong?.textContent || h.textContent || '').trim();
}

/**
 * Parse variant sections (main .section[data-sku][data-color]) for first image per variant.
 * @param {Document} doc - Parsed document
 * @param {string} baseUrl - Base URL for resolving relative image src
 * @returns {Array<{sku:string, color:string, imageUrl:string}>}
 */
function parseVariantSectionsFromPage(doc, baseUrl) {
  const variants = [];
  doc.querySelectorAll('main .section[data-sku][data-color]').forEach((section) => {
    const { sku, color } = section.dataset;
    const img = section.querySelector('picture img, img');
    let imageUrl = img?.getAttribute('src') || '';
    if (imageUrl && !imageUrl.startsWith('http') && baseUrl) {
      try {
        imageUrl = new URL(imageUrl, baseUrl).href;
      } catch {
        // keep relative
      }
    }
    variants.push({ sku, color, imageUrl });
  });
  return variants;
}

/**
 * Build product object from fetched HTML (JSON-LD + parsed specs and variants).
 * @param {string} html - Full page HTML
 * @param {string} path - Product path
 * @returns {Object|null} Normalized product object or null
 */
function parseProductFromPage(html, path) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const canonical = doc.querySelector('link[rel="canonical"]')?.href;
  const baseUrl = canonical || new URL(path, window.location.origin).href;

  const jsonLdScript = doc.querySelector('script[type="application/ld+json"]');
  if (!jsonLdScript?.textContent) return null;
  let ld;
  try {
    ld = JSON.parse(jsonLdScript.textContent);
  } catch {
    return null;
  }
  if (ld['@type'] !== 'Product' || !ld.name) return null;

  const offers = ld.offers || [];
  const firstOffer = offers[0];
  const listPrice = firstOffer?.priceSpecification?.price;
  const finalPrice = firstOffer?.price ?? listPrice;
  const price = {
    currency: firstOffer?.priceCurrency || 'USD',
    regular: listPrice != null ? String(listPrice) : String(finalPrice),
    final: String(finalPrice ?? '0'),
  };

  const pageSpecs = parseSpecsFromPage(doc);
  const warrantyHeading = parseWarrantyFromPage(doc);
  if (warrantyHeading) pageSpecs.Warranty = warrantyHeading;

  const variantSections = parseVariantSectionsFromPage(doc, baseUrl);

  const variants = offers.map((offer) => {
    const sectionMatch = variantSections.find((v) => v.sku === offer.sku);
    const imageUrl = sectionMatch?.imageUrl || (Array.isArray(offer.image) ? offer.image[0] : '') || ld.image?.[0] || '';
    const colorOpt = offer.options?.find((o) => o.id === 'color');
    return {
      sku: offer.sku,
      name: offer.name,
      options: offer.options || [],
      images: imageUrl ? [{ url: imageUrl }] : (offer.image || []).map((u) => ({ url: u })),
      price: {
        currency: offer.priceCurrency || 'USD',
        regular: String(offer.priceSpecification?.price ?? offer.price ?? price.regular),
        final: String(offer.price ?? price.final),
      },
      color: colorOpt?.value,
    };
  });

  const colorValues = variants
    .filter((v) => v.color)
    .map((v) => ({ value: v.color, uid: v.options?.find((o) => o.id === 'color')?.uid || '' }));
  let options;
  if (colorValues.length) {
    options = [{
      id: 'color', label: 'Color', position: 1, values: colorValues,
    }];
  } else if (ld.custom?.options) {
    options = [{ id: 'color', label: 'Color', values: colorValues }];
  } else {
    options = [];
  }

  const images = Array.isArray(ld.image) ? ld.image.map((u) => ({ url: u })) : [];

  return {
    name: ld.name,
    path,
    url: ld.url || baseUrl,
    images,
    price,
    variants,
    options,
    custom: ld.custom || {},
    specs: pageSpecs,
  };
}

/**
 * Fetch product by loading the live page (no .json) and parsing HTML.
 * @param {string} path - Product path
 * @returns {Promise<{ product: Object|null, errorStatus?: number }>}
 */
async function fetchProduct(path) {
  const { html, status } = await fetchProductPage(path);
  if (!html) return { product: null, errorStatus: status };
  const product = parseProductFromPage(html, path);
  return { product, errorStatus: product ? undefined : status };
}

/**
 * Get feature value for a product (page specs, then custom fallbacks, then features-by-series).
 * @param {Object} product - Normalized product (has .specs from page)
 * @param {string} key - Feature label (e.g. 'Series', 'Warranty')
 * @param {Object} [featuresBySeries] - Optional { data } from features-by-series.json
 * @returns {string} Display value
 */
function getFeatureValue(product, key, featuresBySeries) {
  const specs = product?.specs || {};
  const custom = product?.custom || {};

  const mapKey = SPEC_LABEL_MAP[key] || key;
  const direct = specs[key] ?? specs[mapKey];

  if (key === 'Dimensions (L × W × H)') {
    const seriesRow = getSeriesFeaturesRow(featuresBySeries, getProductSeries(product));
    if (seriesRow) {
      const sheetVal = seriesRow[key];
      if (sheetVal != null && String(sheetVal).trim() !== '') return String(sheetVal).trim();
    }
    if (direct) return direct;
    return '—';
  }

  if (key === 'Series') {
    const seriesRow = getSeriesFeaturesRow(featuresBySeries, getProductSeries(product));
    if (seriesRow?.Series) return String(seriesRow.Series).trim();
    return custom.series || custom.collection || '—';
  }

  if (direct) return direct;

  if (key === 'Warranty') {
    const opts = custom.options;
    if (Array.isArray(opts) && opts.length > 0) {
      const name = opts[0].name || '';
      const match = name.match(/(\d+)\s*yr|(\d+)\s*year/i);
      if (match) return `${match[1] || match[2]} Years`;
      if (name) return name;
    }
  }

  const seriesRow = getSeriesFeaturesRow(featuresBySeries, getProductSeries(product));
  if (seriesRow) {
    const sheetVal = seriesRow[key];
    if (sheetVal != null && String(sheetVal).trim() !== '') return String(sheetVal).trim();
  }

  return '—';
}

/**
 * Format price for display.
 * @param {Object} price - { currency, regular, final }
 * @returns {{ now: string, save: string|null }}
 */
function formatPrice(price) {
  if (!price || price.final == null) return { now: '', save: null };
  const now = `$${parseFloat(price.final).toFixed(2)}`;
  const regular = parseFloat(price.regular);
  const finalVal = parseFloat(price.final);
  const save = regular > finalVal
    ? `Save $${(regular - finalVal).toFixed(2)} | Was $${regular.toFixed(2)}`
    : null;
  return { now, save };
}

/**
 * Resolve image URL for display (variant or product level).
 * @param {Object} product - Product JSON
 * @param {number} variantIndex - Selected variant index
 * @returns {string} Image URL
 */
function getProductImageUrl(product, variantIndex = 0) {
  const variants = product?.variants;
  if (Array.isArray(variants) && variants[variantIndex]?.images?.length > 0) {
    const [{ url }] = variants[variantIndex].images;
    return url.startsWith('http') || url.startsWith('/') ? url : new URL(url, window.location.origin).pathname;
  }
  const images = product?.images;
  if (Array.isArray(images) && images.length > 0) {
    const [{ url }] = images;
    return url.startsWith('http') || url.startsWith('/') ? url : new URL(url, window.location.origin).pathname;
  }
  return '';
}

/**
 * Build a placeholder card when a product failed to load.
 * @param {string} path - Product path (for link)
 * @param {number} index - Index (for remove)
 * @param {Function} onRemove - Callback when remove is clicked
 * @param {number} [errorStatus] - HTTP status when failed (e.g. 404)
 * @returns {HTMLElement}
 */
function buildPlaceholderCard(path, index, onRemove, errorStatus) {
  const col = document.createElement('div');
  col.className = 'compare-products-product compare-products-product-placeholder';
  col.dataset.index = String(index);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'button button close compare-products-product-remove';
  removeBtn.setAttribute('aria-label', 'Remove from comparison');
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => onRemove(index));

  const msg = document.createElement('p');
  msg.className = 'compare-products-product-placeholder-msg';
  msg.textContent = errorStatus === 404
    ? 'Product not found (404).'
    : 'Could not load this product.';

  const link = document.createElement('a');
  link.href = path.startsWith('http') ? path : new URL(path, window.location.origin).href;
  link.textContent = 'Try opening the product page';
  link.className = 'button link';

  col.append(removeBtn, msg, link);
  return col;
}

/**
 * Build one product card DOM node.
 * @param {Object} product - Product JSON
 * @param {number} index - Index in products array (for remove)
 * @param {Function} onRemove - Callback when remove is clicked
 * @returns {HTMLElement}
 */
function buildProductCard(product, index, onRemove) {
  const col = document.createElement('div');
  col.className = 'compare-products-product';
  col.dataset.index = String(index);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'button button close compare-products-product-remove';
  removeBtn.setAttribute('aria-label', `Remove ${product.name} from comparison`);
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => onRemove(index));

  const imgWrap = document.createElement('div');
  imgWrap.className = 'compare-products-product-image-wrap';
  const img = document.createElement('img');
  img.src = getProductImageUrl(product, 0);
  img.alt = '';
  img.loading = 'lazy';
  imgWrap.appendChild(img);

  const colorsWrap = document.createElement('div');
  colorsWrap.className = 'compare-products-product-colors';
  const options = product?.options?.find((o) => o.id === 'color');
  const variants = product?.variants || [];
  if (options?.values?.length) {
    options.values.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `compare-products-product-color ${i === 0 ? 'selected' : ''}`;
      btn.setAttribute('aria-label', opt.value);
      btn.title = opt.value;
      const colorSlug = toClassName(opt.value);
      btn.style.backgroundColor = colorSlug
        ? `var(--color-${colorSlug}, var(--color-gray-300))`
        : 'var(--color-gray-300)';
      btn.dataset.variantIndex = String(i);
      btn.addEventListener('click', () => {
        colorsWrap.querySelectorAll('.compare-products-product-color').forEach((c) => c.classList.remove('selected'));
        btn.classList.add('selected');
        const idx = parseInt(btn.dataset.variantIndex, 10);
        img.src = getProductImageUrl(product, idx);
      });
      colorsWrap.appendChild(btn);
    });
  }

  const nameEl = document.createElement('h3');
  nameEl.className = 'compare-products-product-name';
  nameEl.textContent = product.name || '';

  const priceEl = document.createElement('div');
  priceEl.className = 'compare-products-product-price';
  const price = product?.price || variants[0]?.price;
  const { now, save } = formatPrice(price);
  priceEl.innerHTML = `<span class="compare-products-product-price-now">Now ${now}</span>`;
  if (save) {
    const saveEl = document.createElement('span');
    saveEl.className = 'compare-products-product-price-save';
    saveEl.textContent = save;
    priceEl.appendChild(saveEl);
  }

  const cta = document.createElement('a');
  cta.className = 'button emphasis';
  const { path: productPath, url: productUrl } = product || {};
  cta.href = productPath || productUrl || '#';
  cta.textContent = 'VIEW DETAILS';

  col.append(removeBtn, imgWrap, colorsWrap, nameEl, priceEl, cta);
  return col;
}

/**
 * Build features table body (feature rows with one cell per product/slot).
 * @param {{ path: string, product: Object|null }[]} slots - One slot per requested path
 * @param {HTMLElement} tableEl - Table container
 * @param {Object} [featuresBySeries] - Optional { data } from features-by-series.json for fallbacks
 */
function buildFeaturesTable(slots, tableEl, featuresBySeries) {
  const columnCount = slots.length;
  tableEl.style.setProperty('--compare-cols', String(columnCount));
  tableEl.innerHTML = '';

  FEATURE_KEYS.forEach((key, rowIndex) => {
    const row = document.createElement('div');
    row.className = `compare-products-features-row ${rowIndex % 2 ? 'row-odd' : 'row-even'}`;
    const nameCell = document.createElement('div');
    nameCell.className = `compare-products-features-cell feature-name ${rowIndex % 2 ? 'row-odd' : 'row-even'}`;
    nameCell.textContent = key;
    row.appendChild(nameCell);
    slots.forEach((slot) => {
      const cell = document.createElement('div');
      cell.className = `compare-products-features-cell ${rowIndex % 2 ? 'row-odd' : 'row-even'}`;
      const value = slot.product
        ? getFeatureValue(slot.product, key, featuresBySeries)
        : '—';
      if (value === 'Yes') {
        const check = document.createElement('span');
        check.className = 'compare-products-features-cell-check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = '✓';
        cell.appendChild(check);
      } else {
        cell.textContent = value;
      }
      row.appendChild(cell);
    });
    tableEl.appendChild(row);
  });
}

/**
 * Render the full compare view: product cards + features table.
 * @param {HTMLElement} widget - Widget root
 * @param {{ path: string, product: Object|null }[]} slots - One slot per requested path
 * @param {Object} [featuresBySeries] - Optional { data } from features-by-series.json for fallbacks
 */
function render(widget, slots, featuresBySeries) {
  const productsContainer = widget.querySelector('.compare-products-products');
  const featuresTable = widget.querySelector('.compare-products-features-table');
  if (!productsContainer || !featuresTable) return;

  widget.style.setProperty('--compare-cols', String(slots.length));
  productsContainer.innerHTML = '';

  const removeProduct = (index) => {
    const next = slots.filter((_, i) => i !== index);
    if (next.length === 0) {
      widget.dispatchEvent(new CustomEvent('compare-products-empty'));
      return;
    }
    render(widget, next, featuresBySeries);
  };

  slots.forEach((slot, index) => {
    const card = slot.product
      ? buildProductCard(slot.product, index, removeProduct)
      : buildPlaceholderCard(slot.path, index, removeProduct, slot.errorStatus);
    productsContainer.appendChild(card);
  });

  buildFeaturesTable(slots, featuresTable, featuresBySeries);
}

/**
 * Initialize compare-products widget: read config, fetch products, render.
 * @param {HTMLElement} widget - Widget root
 */
export default async function decorate(widget) {
  const paths = getProductComparisonPaths();
  if (paths.length === 0) {
    widget.querySelector('.compare-products-products')?.appendChild(
      Object.assign(document.createElement('p'), {
        textContent: 'Add product paths to compare (productComparison).',
        className: 'compare-products-empty',
      }),
    );
    return;
  }

  const [featuresBySeries, ...slotResults] = await Promise.all([
    fetchFeaturesBySeries(),
    ...paths.map((path) => fetchProduct(path)),
  ]);

  const slots = slotResults.map(({ product, errorStatus }, i) => ({
    path: paths[i],
    product,
    errorStatus,
  }));

  const allFailed = slots.every((slot) => !slot.product);
  if (allFailed) {
    widget.querySelector('.compare-products-products')?.appendChild(
      Object.assign(document.createElement('p'), {
        textContent: 'Could not load product data.',
        className: 'compare-products-empty',
      }),
    );
    return;
  }

  render(widget, slots, featuresBySeries || undefined);
}

// Load CSS
const start = () => {
  loadCSS('/widgets/compare-products/compare-products.css');
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
