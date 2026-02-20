import { loadCSS, toClassName } from '../../scripts/aem.js';

const DEBUG = typeof window !== 'undefined' && (
  new URLSearchParams(window.location.search).has('compare-products-debug')
  || new URLSearchParams(window.location.search).has('compare-products')
);

function debug(...args) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('[compare-products]', ...args);
  }
}

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

const FEATURES_BY_SERIES_PATH_DEFAULT = '/us/en_us/products/config/features-by-series.json';

/**
 * Get features-by-series path for current locale.
 * E.g. /ca/fr_ca/... -> /ca/fr_ca/products/config/...
 * @returns {string}
 */
function getFeaturesBySeriesPath() {
  const match = window.location.pathname.match(/^(\/[^/]+\/[^/]+)\//);
  if (match) {
    return `${match[1]}/products/config/features-by-series.json`;
  }
  return FEATURES_BY_SERIES_PATH_DEFAULT;
}

/**
 * Fetch features-by-series config (same-origin only; no fcors).
 * @returns {Promise<Object|null>} Parsed JSON or null
 */
async function fetchFeaturesBySeries() {
  const path = getFeaturesBySeriesPath();
  const url = new URL(path, window.location.origin).href;
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
 * Normalize series name for matching: remove "Vitamix", trailing " Series", trim, strip ®™.
 * @param {string} s - Series or product name
 * @returns {string} Normalized string for comparison
 */
function normalizeSeriesForMatch(s) {
  if (!s || typeof s !== 'string') return '';
  const t = s
    .replace(/\s*®\s*|\s*™\s*/gi, ' ')
    .replace(/\bVitamix\b/gi, '')
    .replace(/\s+series\s*$/gi, '')
    .replace(/\s+série\s*$/gi, '')
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

/**
 * Product paths from ?compare-products= (comma-separated).
 * Each path replaces that product's series column.
 * @returns {string[]} Array of product paths; empty if not set
 */
function getCompareProductsParamPaths() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('compare-products');
  debug('getCompareProductsParamPaths: raw=', raw);
  if (!raw || typeof raw !== 'string') return [];
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // keep raw if invalid encoding
  }
  const paths = decoded
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        if (s.startsWith('http')) return new URL(s).pathname;
        const url = new URL(s, window.location.origin);
        return url.pathname;
      } catch {
        return s.startsWith('/') ? s : `/${s}`;
      }
    });
  debug('getCompareProductsParamPaths: parsed paths=', paths);
  return paths;
}

/** True when ?compare-products= was set (single or multiple paths). */
function getCompareProductsParam() {
  return getCompareProductsParamPaths().length > 0;
}

/** Map row header text (EN/FR) to FEATURE_KEYS for table column replacement */
const ROW_LABEL_TO_FEATURE = {
  series: 'Series',
  série: 'Series',
  'blending programs': 'Blending Programs',
  'programmes de fusion': 'Blending Programs',
  'variable speed control': 'Variable Speed Control',
  'commande de vitesse variable': 'Variable Speed Control',
  'touch buttons': 'Touch Buttons',
  'boutons tactiles': 'Touch Buttons',
  pulse: 'Pulse',
  impulsion: 'Pulse',
  'digital timer': 'Digital Timer',
  'minuteur numérique': 'Digital Timer',
  'self-detect technology': 'Self-Detect Technology',
  "technologie d'autodétection": 'Self-Detect Technology',
  'tamper indicator': 'Tamper Indicator',
  'indicateur de falsification': 'Tamper Indicator',
  'plus 15 second': 'Plus 15 Second Button',
  '+15 secondes': 'Plus 15 Second Button',
  warranty: 'Warranty',
  garantie: 'Warranty',
  dimensions: 'Dimensions (L × W × H)',
  couleurs: 'Colors',
  colors: 'Colors',
};

/** Feature keys that use series-level data from the original table; do not replace cell content. */
const SERIES_INHERITED_FEATURE_KEYS = new Set([
  'Blending Programs',
  'Variable Speed Control',
  'Touch Buttons',
  'Pulse',
  'Digital Timer',
  'Self-Detect Technology',
  'Tamper Indicator',
  'Plus 15 Second Button',
  'Dimensions (L × W × H)',
]);

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

  debug('fetchProductPage: path=', path, 'fullUrl=', fullUrl, 'useFcors=', useFcors());

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

  debug('fetchProductPage: path=', path, 'status=', resp.status, 'ok=', resp.ok);
  if (!resp.ok) return { html: null, status: resp.status };
  const html = await resp.text();
  debug('fetchProductPage: path=', path, 'htmlLength=', html?.length);
  return { html, status: resp.status };
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
  if (!jsonLdScript?.textContent) {
    debug('parseProductFromPage: no JSON-LD script', path);
    return null;
  }
  let ld;
  try {
    ld = JSON.parse(jsonLdScript.textContent);
  } catch (e) {
    debug('parseProductFromPage: JSON parse error', path, e);
    return null;
  }
  if (ld['@type'] !== 'Product' || !ld.name) {
    debug('parseProductFromPage: not Product or no name', path, '@type=', ld['@type'], 'name=', ld?.name);
    return null;
  }

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
  debug('fetchProduct: start', path);
  const { html, status } = await fetchProductPage(path);
  if (!html) {
    debug('fetchProduct: no html', path, 'status=', status);
    return { product: null, errorStatus: status };
  }
  const product = parseProductFromPage(html, path);
  debug('fetchProduct: parsed', path, 'product=', product ? { name: product.name, series: getProductSeries(product) } : null);
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
 * Find which table column index (1-based, 0 = row header) matches the given series.
 * Uses first table's first tbody row and second table's thead for labels.
 * @param {HTMLElement} container - .widget-container (section that has tables + widget)
 * @param {string} series - Product series name
 * @returns {number} 1-based column index or 1 if no match
 */
function findColumnIndexForSeries(container, series) {
  const tables = container.querySelectorAll('.table.comparison .table-comparison-scroll table');
  const firstTable = tables[0];
  if (!firstTable) {
    debug('findColumnIndexForSeries: no first table');
    return 1;
  }
  const firstDataRow = firstTable.querySelector('tbody tr');
  if (!firstDataRow) {
    debug('findColumnIndexForSeries: no first tbody tr');
    return 1;
  }
  const headerTable = tables[1] || firstTable;
  const theadRow = headerTable.querySelector('thead tr');
  const bodyCells = [...firstDataRow.children];
  const targetNorm = normalizeSeriesForMatch(series).toLowerCase();
  debug('findColumnIndexForSeries: series=', series, 'targetNorm=', targetNorm, 'cellCount=', bodyCells.length);
  if (!targetNorm) return 1;
  for (let i = 1; i < bodyCells.length; i += 1) {
    let columnText = (firstDataRow.children[i]?.textContent || '').trim();
    if (theadRow?.children[i]) {
      const thText = (theadRow.children[i].textContent || '').trim();
      if (thText) columnText = `${thText} ${columnText}`;
    }
    const cellNorm = normalizeSeriesForMatch(columnText).toLowerCase();
    const matches = cellNorm && (
      cellNorm === targetNorm
      || cellNorm.includes(targetNorm)
      || targetNorm.includes(cellNorm)
    );
    if (matches) {
      debug('findColumnIndexForSeries: match at column', i, 'cellText=', columnText.slice(0, 60));
      return i;
    }
  }
  debug('findColumnIndexForSeries: no match, using column 1');
  return 1;
}

/**
 * Create color swatches DOM for comparison table (same structure as table block).
 * @param {Object} product - Product with options[].values (color names)
 * @returns {DocumentFragment}
 */
function createColorSwatchesForProduct(product) {
  const frag = document.createDocumentFragment();
  const wrap = document.createElement('div');
  wrap.className = 'table-comparison-color-swatches';
  const colorOpt = product?.options?.find((o) => o.id === 'color');
  const values = colorOpt?.values || [];
  values.forEach((opt) => {
    const label = opt.value || '';
    const slug = toClassName(label);
    const swatch = document.createElement('div');
    swatch.className = 'table-comparison-color-swatch';
    swatch.title = label;
    const inner = document.createElement('div');
    inner.className = 'table-comparison-color-inner';
    inner.style.backgroundColor = slug ? `var(--color-${slug}, #888)` : '#888';
    swatch.appendChild(inner);
    wrap.appendChild(swatch);
  });
  frag.appendChild(wrap);
  return frag;
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
    return url.startsWith('http') || url.startsWith('/')
      ? url : new URL(url, window.location.origin).pathname;
  }
  const images = product?.images;
  if (Array.isArray(images) && images.length > 0) {
    const [{ url }] = images;
    return url.startsWith('http') || url.startsWith('/')
      ? url : new URL(url, window.location.origin).pathname;
  }
  return '';
}

/**
 * Replace one column in all comparison tables with the specific product's data.
 * @param {HTMLElement} container - .widget-container (section that has tables + widget)
 * @param {number} columnIndex - Column index (0 = row header, 1 = first product)
 * @param {Object} product - Parsed product from fetchProduct
 * @param {Object} [featuresBySeries] - Optional features-by-series config
 */
function replaceColumnWithProduct(container, columnIndex, product, featuresBySeries) {
  const tables = container.querySelectorAll('.table.comparison .table-comparison-scroll table');
  if (!tables.length) return;

  const productUrl = product.path?.startsWith('http')
    ? product.path
    : new URL(product.path || '', window.location.origin).href;
  const imageUrl = getProductImageUrl(product, 0);
  const priceOrVariant = product?.price || product?.variants?.[0]?.price;
  const { now: priceNow, save: priceSave } = formatPrice(priceOrVariant);
  const priceText = priceSave ? `Now ${priceNow} | ${priceSave}` : `From ${priceNow}`;
  const learnMoreText = 'En savoir plus'; // could be localized

  tables.forEach((table, tableIndex) => {
    const theadRow = table.querySelector('thead tr');
    const isFirstTable = tableIndex === 0;

    if (isFirstTable && theadRow) {
      const th = theadRow.children[columnIndex];
      if (th) {
        th.innerHTML = '';
        if (imageUrl) {
          const picture = document.createElement('picture');
          const img = document.createElement('img');
          img.loading = 'lazy';
          img.alt = product.name || '';
          img.src = imageUrl;
          img.width = 320;
          img.height = 440;
          picture.appendChild(img);
          th.appendChild(picture);
        }
      }
    }

    const bodyRows = table.querySelectorAll('tbody tr');
    bodyRows.forEach((row, rowIndex) => {
      const cells = [...row.children];
      const cell = cells[columnIndex];
      if (!cell || cell.tagName !== 'TD') return;

      if (isFirstTable && row.classList.contains('table-comparison-row-header-empty') && rowIndex === 0) {
        cell.innerHTML = `
          <p><strong>${(product.name || '').replace(/</g, '&lt;')}</strong></p>
          <p>${priceText.replace(/</g, '&lt;')}</p>
          <p><strong><a href="${productUrl.replace(/"/g, '&quot;')}">${learnMoreText}</a></strong></p>
        `;
        return;
      }

      const headerCell = row.querySelector('th');
      const headerText = (headerCell?.textContent || '').trim().toLowerCase();
      const normalized = headerText.replace(/\s+/g, ' ').trim();
      const featureKey = ROW_LABEL_TO_FEATURE[normalized]
        || Object.keys(ROW_LABEL_TO_FEATURE).find((k) => normalized.includes(k));

      if (featureKey === 'Colors') {
        cell.textContent = '';
        cell.appendChild(createColorSwatchesForProduct(product));
        return;
      }

      if (featureKey === 'Series') {
        const p = document.createElement('p');
        p.textContent = product.name || '—';
        cell.textContent = '';
        cell.appendChild(p);
        return;
      }

      if (featureKey && SERIES_INHERITED_FEATURE_KEYS.has(featureKey)) {
        return;
      }

      if (featureKey && featureKey !== 'Colors') {
        const value = getFeatureValue(product, featureKey, featuresBySeries);
        if (value === 'Yes') {
          cell.innerHTML = '<p><span class="icon icon-check"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><title>Check</title><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg></span></p>';
        } else {
          cell.textContent = value || '—';
          if (!cell.querySelector('p')) {
            const p = document.createElement('p');
            p.textContent = cell.textContent;
            cell.textContent = '';
            cell.appendChild(p);
          }
        }
      }
    });
  });
}

/**
 * Hide table columns whose index is not in the used set.
 * Keeps row header column 0 and selected product columns.
 * @param {HTMLElement} container - .widget-container
 * @param {Set<number>} usedColumnIndices - Column indices to keep (e.g. 0, 1, 2, 5)
 */
function hideUnusedColumns(container, usedColumnIndices) {
  const tables = container.querySelectorAll('.table.comparison .table-comparison-scroll table');
  tables.forEach((table) => {
    const colgroup = table.querySelector('colgroup');
    if (colgroup) {
      [...colgroup.children].forEach((col, index) => {
        if (usedColumnIndices.has(index)) {
          col.classList.add('compare-products-column-visible');
        } else {
          col.style.display = 'none';
        }
      });
    }
    [...table.querySelectorAll('thead tr'), ...table.querySelectorAll('tbody tr')].forEach((tr) => {
      [...tr.children].forEach((cell, index) => {
        if (usedColumnIndices.has(index)) {
          cell.classList.add('compare-products-column-visible');
        } else {
          cell.style.display = 'none';
        }
      });
    });
  });
  debug('hideUnusedColumns: kept columns', [...usedColumnIndices].sort((a, b) => a - b));
}

/**
 * Remove the widget wrapper on the next task so widget block can finish.
 * @param {HTMLElement} widget - Widget root
 */
function removeWidgetWrapperLater(widget) {
  setTimeout(() => {
    const wrapper = widget.closest('.widget-wrapper');
    if (wrapper) wrapper.remove();
  }, 0);
}

/**
 * When compare-products=path[,path2,...] is set: inject each product into its matching
 * series column, hide other columns, then remove widget.
 * @param {HTMLElement} widget - Widget root
 * @returns {Promise<boolean>} true if the param was set and handling was done
 */
async function handleCompareProductsParam(widget) {
  const paths = getCompareProductsParamPaths();
  debug('handleCompareProductsParam: paths=', paths);
  if (paths.length === 0) {
    debug('handleCompareProductsParam: no paths, skip');
    return false;
  }

  const container = widget.closest('.widget-container');
  debug(
    'handleCompareProductsParam: container=',
    container ? 'found' : 'NOT FOUND (need .widget-container on page)',
  );
  if (!container) return false;

  debug('handleCompareProductsParam: fetching featuresBySeries and', paths.length, 'products');
  const featuresBySeries = await fetchFeaturesBySeries();
  const results = await Promise.all(paths.map((path) => fetchProduct(path)));
  debug('handleCompareProductsParam: results=', results.map((r, i) => ({ path: paths[i], hasProduct: !!r.product, errorStatus: r.errorStatus })));

  const usedColumnIndices = new Set([0]);
  let anyReplaced = false;
  results.forEach(({ product }, i) => {
    if (!product) {
      debug('handleCompareProductsParam: skip path (no product)', paths[i]);
      return;
    }
    const series = getProductSeries(product);
    const columnIndex = findColumnIndexForSeries(container, series);
    debug('handleCompareProductsParam: replace column', 'path=', paths[i], 'series=', series, 'columnIndex=', columnIndex);
    usedColumnIndices.add(columnIndex);
    replaceColumnWithProduct(container, columnIndex, product, featuresBySeries || undefined);
    anyReplaced = true;
  });

  if (anyReplaced) {
    hideUnusedColumns(container, usedColumnIndices);
    container.classList.add('compare-products-columns-filtered');
    container.dataset.compareProductsVisible = String(usedColumnIndices.size - 1);
  }

  debug(
    'handleCompareProductsParam: done, anyReplaced=',
    anyReplaced,
    'visibleColumns=',
    usedColumnIndices.size - 1,
  );
  removeWidgetWrapperLater(widget);
  return true;
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
 * If ?compare-products=path is set, inject that product into the matching series column.
 * Otherwise use ?productComparison=path1,path2 to show the widget comparison grid.
 * @param {HTMLElement} widget - Widget root
 */
export default async function decorate(widget) {
  const paths = getCompareProductsParamPaths();
  debug('decorate: compare-products paths=', paths.length ? paths : 'none');
  const handled = await handleCompareProductsParam(widget);
  debug('decorate: handled=', handled);
  if (handled) return;

  if (getCompareProductsParam()) {
    removeWidgetWrapperLater(widget);
    return;
  }

  const comparisonPaths = getProductComparisonPaths();
  if (comparisonPaths.length === 0) {
    removeWidgetWrapperLater(widget);
    return;
  }

  const [featuresBySeries, ...slotResults] = await Promise.all([
    fetchFeaturesBySeries(),
    ...comparisonPaths.map((path) => fetchProduct(path)),
  ]);

  const slots = slotResults.map(({ product, errorStatus }, i) => ({
    path: comparisonPaths[i],
    product,
    errorStatus,
  }));

  const allFailed = slots.every((slot) => !slot.product);
  if (allFailed) {
    removeWidgetWrapperLater(widget);
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
