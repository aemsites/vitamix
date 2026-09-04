import {
  fetchPlaceholders, loadCSS, toClassName,
} from '../../scripts/aem.js';
import { formatPrice } from '../../scripts/scripts.js';
import {
  getStoredComparePaths, setStoredCompareItems, MAX_COMPARE_ITEMS,
} from '../../scripts/add-to-compare.js';
import lookupProductListProducts, { getWidgetLocaleAndLanguage } from '../product-list/products.js';

/** Show "add a product" grid until this many products are in the comparison */
const MAX_COMPARISON_PRODUCTS = MAX_COMPARE_ITEMS;

/** Query param carrying the comma-separated product paths being compared. */
const COMPARE_PARAM = 'compare-products';

/** Sentinel for a comparison-feature bullet with no ":value" part (a plain included feature). */
const CHECK_VALUE = ':check:';

/**
 * Load widget copy from the widget's local JSON.
 * @param {string} lang - Language key (e.g. en, fr)
 * @returns {Promise<Object>} Copy for that language
 */
async function loadWidgetCopy(lang) {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const url = `${window.hlx?.codeBasePath || ''}${jsonPath}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const key = data[lang] ? lang : 'en';
  return data[key] || {};
}

/**
 * Normalize a product path/URL to a pathname for comparison-by-path matching.
 * @param {string} value - Path or absolute URL
 * @returns {string}
 */
function normalizePath(value) {
  if (!value || typeof value !== 'string') return '';
  let pathname = value;
  try {
    pathname = new URL(value, window.location.origin).pathname;
  } catch {
    pathname = value;
  }
  const trimmed = pathname.replace(/#.*$/, '').replace(/\?.*$/, '').trim();
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return (withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash).toLowerCase();
}

/**
 * Reads the selected comparison paths from the `compare-products` query param.
 * @returns {string[]}
 */
function getComparePaths() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(COMPARE_PARAM);
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean).map(normalizePath);
}

/**
 * Builds a `{ url, title, image }` entry for localStorage from a full product object.
 * @param {Object} product
 * @returns {{url: string, title: string, image: string}}
 */
function toStoredItem(product) {
  return {
    url: product.url,
    title: product.title || '',
    image: product.variants?.[0]?.image || product.image || '',
  };
}

/**
 * Navigates to the current page with an updated `compare-products` param, persisting the same
 * products (with title/image, for the compare toast's thumbnails) to localStorage so they're
 * picked up as a fallback on future visits without the param.
 * @param {Object[]} products - Full product objects to compare (order matters)
 */
function goToComparePaths(products) {
  const stored = setStoredCompareItems(products.map(toStoredItem));
  const paths = stored.map((item) => item.url);
  const url = new URL(window.location.href);
  if (paths.length) url.searchParams.set(COMPARE_PARAM, paths.join(','));
  else url.searchParams.delete(COMPARE_PARAM);
  window.location.href = url.toString();
}

/**
 * Writes the given paths into the `compare-products` query param via pushState (no reload),
 * used to reflect a localStorage fallback into the URL on initial load.
 * @param {string[]} paths
 */
function pushComparePathsToUrl(paths) {
  const url = new URL(window.location.href);
  if (paths.length) url.searchParams.set(COMPARE_PARAM, paths.join(','));
  else url.searchParams.delete(COMPARE_PARAM);
  window.history.pushState(null, '', url.toString());
}

function findProductByPath(products, path) {
  const key = normalizePath(path);
  return products.find((product) => normalizePath(product.url) === key) || null;
}

function hasVariants(product) {
  return product.variants && product.variants.length > 0;
}

/**
 * Parses a product's `comparisonFeatures` bullets ("Label: Value" or a bare "Label") into an
 * ordered list of [label, value] pairs. A bare label (no ":") is treated as an included
 * feature and given the CHECK_VALUE sentinel so it renders as a checkmark.
 * @param {Object} product
 * @returns {Array<[string, string]>}
 */
function parseFeatureEntries(product) {
  const bullets = product?.comparisonFeatures || [];
  return bullets.map((raw) => {
    const idx = raw.indexOf(':');
    if (idx === -1) return [raw.trim(), CHECK_VALUE];
    return [raw.slice(0, idx).trim(), raw.slice(idx + 1).trim() || CHECK_VALUE];
  }).filter(([label]) => label);
}

/**
 * Builds the ordered union of feature labels across all slots (order of first appearance),
 * and a label -> Map(product -> value) lookup.
 * @param {{ product: Object|null }[]} slots
 * @returns {{ labels: string[], valuesByLabel: Map<string, Map<Object, string>> }}
 */
function buildFeatureMatrix(slots) {
  const labels = [];
  const valuesByLabel = new Map();
  slots.forEach(({ product }) => {
    if (!product) return;
    parseFeatureEntries(product).forEach(([label, value]) => {
      if (!valuesByLabel.has(label)) {
        valuesByLabel.set(label, new Map());
        labels.push(label);
      }
      valuesByLabel.get(label).set(product, value);
    });
  });
  return { labels, valuesByLabel };
}

function createRemoveButton(copy, product, path, onRemove) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'compare-products-widget-remove';
  btn.setAttribute('aria-label', `${copy.remove} ${product?.title || copy.product} ${copy.fromComparison}`);
  btn.textContent = '×';
  btn.addEventListener('click', () => onRemove(path));
  return btn;
}

function createProductImage() {
  const wrap = document.createElement('div');
  wrap.className = 'compare-products-widget-image-wrap';
  const img = document.createElement('img');
  img.loading = 'lazy';
  wrap.appendChild(img);
  return { wrap, img };
}

function updateCardImage(img, product, variant) {
  if (variant && variant.image) {
    img.src = variant.image;
    img.alt = variant.title || product.title || '';
  } else {
    img.src = product.image || '';
    img.alt = product.title || '';
  }
}

function createProductColors(product, onSelect) {
  const colors = document.createElement('div');
  colors.className = 'compare-products-widget-colors';
  if (!hasVariants(product)) return colors;

  product.variants.forEach((variant, i) => {
    const { color, availability } = variant;
    if (!color) return;
    const colorSlug = toClassName(color);
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = `color-swatch${i === 0 ? ' selected' : ''}`;
    swatch.title = color;
    swatch.dataset.color = colorSlug;
    swatch.setAttribute('aria-label', color);
    const inner = document.createElement('span');
    inner.className = 'compare-products-widget-color-inner';
    inner.style.backgroundColor = `var(--color-${colorSlug}, #888)`;
    if (availability !== 'InStock') inner.classList.add('compare-products-widget-color-swatch-oos');
    swatch.appendChild(inner);
    swatch.addEventListener('click', (e) => {
      e.preventDefault();
      colors.querySelectorAll('.color-swatch').forEach((el) => el.classList.remove('selected'));
      swatch.classList.add('selected');
      onSelect(variant);
    });
    colors.appendChild(swatch);
  });
  return colors;
}

/**
 * Builds a compact star-rating element from reviews.json data (reviewAverage/reviewCount),
 * replacing the previous per-product Bazaarvoice inline_rating widget.
 * @param {Object} product - Product with reviewAverage (0-5) and reviewCount
 * @returns {HTMLElement}
 */
function createStarRating(product) {
  const wrap = document.createElement('div');
  wrap.className = 'compare-products-widget-reviews';
  const count = product.reviewCount || 0;
  if (!count) return wrap;

  const average = product.reviewAverage || 0;
  const fillPercent = Math.max(0, Math.min(100, (average / 5) * 100));

  const stars = document.createElement('span');
  stars.className = 'compare-products-widget-stars';
  stars.setAttribute('role', 'img');
  stars.setAttribute('aria-label', `${average} out of 5 stars`);
  stars.innerHTML = `
    <span class="compare-products-widget-stars-track" aria-hidden="true">★★★★★</span>
    <span class="compare-products-widget-stars-fill" aria-hidden="true" style="width: ${fillPercent}%">★★★★★</span>
  `;

  const countEl = document.createElement('span');
  countEl.className = 'compare-products-widget-reviews-count';
  countEl.textContent = `(${count})`;

  wrap.append(stars, countEl);
  return wrap;
}

function createProductPrice(product, ph) {
  const price = document.createElement('p');
  price.className = 'compare-products-widget-price';
  price.textContent = product.price ? formatPrice(product.price, ph) : '';
  const regular = product.originalPrice || product.regularPrice;
  if (regular && Number(regular) > Number(product.price)) {
    const regularPrice = document.createElement('del');
    regularPrice.textContent = formatPrice(regular, ph);
    price.append(' ', regularPrice);
  }
  return price;
}

function createProductCta(product, copy) {
  const wrap = document.createElement('p');
  wrap.className = 'compare-products-widget-cta button-container';
  const link = document.createElement('a');
  link.href = product.url || '#';
  link.className = 'button emphasis';
  link.textContent = copy.viewDetails;
  wrap.appendChild(link);
  return wrap;
}

/**
 * Builds a placeholder cell for a selected path that no longer resolves to a product.
 * @param {string} path - Product path
 * @param {Object} copy - Widget copy
 * @param {Function} onRemove - Callback when the remove button is clicked
 * @returns {HTMLElement}
 */
function buildPlaceholderCell(path, copy, onRemove) {
  const cell = document.createElement('div');
  cell.className = 'compare-products-widget-cell compare-products-widget-product-cell compare-products-widget-product-cell-placeholder';
  cell.append(createRemoveButton(copy, null, path, onRemove));

  const msg = document.createElement('p');
  msg.className = 'compare-products-widget-placeholder-msg';
  msg.textContent = copy.noResults;
  cell.appendChild(msg);

  const link = document.createElement('a');
  link.href = path;
  link.className = 'button link';
  link.textContent = copy.viewDetails;
  cell.appendChild(link);

  return cell;
}

/**
 * Builds one product's header cell: image, colors, title, reviews, price and CTA.
 * @param {Object} product - Product from the product-list data source
 * @param {string} path - Path this slot was requested with (for removal)
 * @param {Object} ph - Price/locale placeholders
 * @param {Object} copy - Widget copy
 * @param {Function} onRemove - Callback when the remove button is clicked
 * @returns {HTMLElement}
 */
function buildProductCell(product, path, ph, copy, onRemove) {
  const cell = document.createElement('div');
  cell.className = 'compare-products-widget-cell compare-products-widget-product-cell';

  const { wrap: imageWrap, img } = createProductImage();
  const colors = createProductColors(product, (variant) => updateCardImage(img, product, variant));
  updateCardImage(img, product, product.variants?.[0]);

  const title = document.createElement('h3');
  title.className = 'compare-products-widget-title';
  title.textContent = product.title || '';

  const reviews = createStarRating(product);
  const price = createProductPrice(product, ph);
  const cta = createProductCta(product, copy);

  cell.append(
    createRemoveButton(copy, product, path, onRemove),
    imageWrap,
    colors,
    title,
    reviews,
    price,
    cta,
  );

  return cell;
}

/**
 * Builds one feature-row value cell for a slot. Marks it as differing when its display value
 * doesn't match the row's most common value, so the consumer's eye is drawn to the exceptions.
 * @param {string|undefined} value - Raw value ('—' sentinel handled by caller) or CHECK_VALUE
 * @param {boolean} differs - Whether this cell's value differs from the row's most common value
 * @returns {HTMLElement}
 */
function buildFeatureValueCell(value, differs) {
  const cell = document.createElement('div');
  cell.className = `compare-products-widget-cell compare-products-widget-feature-value${differs ? ' compare-products-widget-feature-value-diff' : ''}`;
  if (value === CHECK_VALUE) {
    const check = document.createElement('span');
    check.className = 'compare-products-widget-feature-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '✓';
    cell.appendChild(check);
    cell.append(' Yes');
  } else {
    cell.textContent = value || '—';
  }
  return cell;
}

/**
 * Given a row's per-slot display values, finds which ones differ from the most common value.
 * @param {string[]} values - One display value per slot ('—' for missing)
 * @returns {boolean[]} Parallel array: true where that value differs from the row's mode
 */
function findDiffs(values) {
  const counts = new Map();
  values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  if (counts.size <= 1) return values.map(() => false);
  let mode = values[0];
  let modeCount = 0;
  counts.forEach((count, v) => {
    if (count > modeCount) {
      modeCount = count;
      mode = v;
    }
  });
  return values.map((v) => v !== mode);
}

/**
 * Builds a "ghost" product cell: a faded silhouette of a product card with an "add product"
 * overlay, shown in place of a second column when only one product is being compared, so the
 * empty slot itself invites the shopper to fill it.
 * @param {Object} copy - Widget copy
 * @param {Function} onAdd - Callback when the overlay is clicked
 * @returns {HTMLElement}
 */
function buildGhostCell(copy, onAdd) {
  const cell = document.createElement('div');
  cell.className = 'compare-products-widget-cell compare-products-widget-product-cell compare-products-widget-ghost-cell';

  const silhouette = document.createElement('div');
  silhouette.className = 'compare-products-widget-ghost-silhouette';
  silhouette.setAttribute('aria-hidden', 'true');
  const image = document.createElement('div');
  image.className = 'compare-products-widget-ghost-image';
  const title = document.createElement('div');
  title.className = 'compare-products-widget-ghost-bar compare-products-widget-ghost-bar-title';
  const price = document.createElement('div');
  price.className = 'compare-products-widget-ghost-bar compare-products-widget-ghost-bar-price';
  const cta = document.createElement('div');
  cta.className = 'compare-products-widget-ghost-bar compare-products-widget-ghost-bar-cta';
  silhouette.append(image, title, price, cta);

  const overlay = document.createElement('button');
  overlay.type = 'button';
  overlay.className = 'compare-products-widget-ghost-overlay';
  overlay.setAttribute('aria-label', copy.addAProductToCompare);
  const plus = document.createElement('span');
  plus.className = 'compare-products-widget-ghost-plus';
  plus.setAttribute('aria-hidden', 'true');
  plus.textContent = '+';
  const label = document.createElement('span');
  label.className = 'compare-products-widget-ghost-label';
  label.textContent = copy.addAProductToCompare;
  overlay.append(plus, label);
  overlay.addEventListener('click', onAdd);

  cell.append(silhouette, overlay);
  return cell;
}

/** Blank filler cell under the ghost column so feature rows stay aligned. */
function buildGhostFeatureCell() {
  const cell = document.createElement('div');
  cell.className = 'compare-products-widget-cell compare-products-widget-feature-value compare-products-widget-ghost-feature-cell';
  return cell;
}

/**
 * Renders the aligned comparison grid: a header row of product cells, followed by one row per
 * comparison-feature label, each cell in the same column as its product. Feature rows whose
 * values differ across products are visually called out so shoppers can spot the differences.
 * @param {HTMLElement} gridEl - Grid container
 * @param {{ path: string, product: Object|null }[]} slots
 * @param {Object} ph - Price/locale placeholders
 * @param {Object} copy - Widget copy
 * @param {Function} onRemove - Callback when a product's remove button is clicked
 * @param {{ onAdd: Function }|null} [ghost] - When set, appends a ghost "add product" column
 */
function renderComparisonGrid(gridEl, slots, ph, copy, onRemove, ghost = null) {
  gridEl.innerHTML = '';
  const totalCols = slots.length + (ghost ? 1 : 0);
  gridEl.style.setProperty('--compare-products-widget-cols', String(totalCols || 1));
  gridEl.hidden = slots.length === 0;
  if (slots.length === 0) return;

  const headerRow = document.createElement('div');
  headerRow.className = 'compare-products-widget-row';
  headerRow.setAttribute('role', 'row');
  const cornerCell = document.createElement('div');
  cornerCell.className = 'compare-products-widget-cell compare-products-widget-corner-cell';
  headerRow.appendChild(cornerCell);
  slots.forEach(({ path, product }) => {
    const cell = product
      ? buildProductCell(product, path, ph, copy, onRemove)
      : buildPlaceholderCell(path, copy, onRemove);
    headerRow.appendChild(cell);
  });
  if (ghost) headerRow.appendChild(buildGhostCell(copy, ghost.onAdd));
  gridEl.appendChild(headerRow);

  const { labels, valuesByLabel } = buildFeatureMatrix(slots);
  labels.forEach((label, rowIndex) => {
    const valuesByProduct = valuesByLabel.get(label);
    const displayValues = slots.map(({ product }) => {
      const raw = product ? valuesByProduct.get(product) : undefined;
      return raw === CHECK_VALUE ? CHECK_VALUE : (raw || '—');
    });
    const diffs = findDiffs(displayValues);

    const row = document.createElement('div');
    row.className = `compare-products-widget-row compare-products-widget-feature-row ${rowIndex % 2 ? 'row-odd' : 'row-even'}`;
    row.setAttribute('role', 'row');

    const labelCell = document.createElement('div');
    labelCell.className = 'compare-products-widget-cell compare-products-widget-feature-label';
    labelCell.textContent = label;
    row.appendChild(labelCell);

    displayValues.forEach((value, i) => {
      row.appendChild(buildFeatureValueCell(value, diffs[i]));
    });
    if (ghost) row.appendChild(buildGhostFeatureCell());

    gridEl.appendChild(row);
  });
}

/** Strip diacritics so search matching/highlighting is accent-insensitive. */
function removeAccents(str) {
  if (!str) return '';
  return str.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function normalizeForSearch(str) {
  return removeAccents((str || '').toLowerCase());
}

/**
 * Wraps the first match of `term` in `text` with a <mark>, matching accent/case-insensitively
 * while preserving the original text's accents/casing in the output.
 * @param {string} text - Original display text
 * @param {string} term - Raw search term (not yet normalized)
 * @returns {string} HTML string
 */
function highlightMatch(text, term) {
  if (!text || !term) return text || '';
  const textNorm = normalizeForSearch(text);
  const termNorm = normalizeForSearch(term);
  const start = textNorm.indexOf(termNorm);
  if (start === -1) return text;
  // Diacritic-stripping only removes combining marks, so codepoint offsets still line up
  // with the original string closely enough for our (short, mostly-ASCII) product names.
  const end = start + termNorm.length;
  const before = text.slice(0, start);
  const match = text.slice(start, end);
  const after = text.slice(end);
  return `${before}<mark>${match}</mark>${after}`;
}

/**
 * Builds one compact result row for the add-to-comparison modal: thumbnail, name, price.
 * @param {Object} product - Product from the product-list data source
 * @param {Object} ph - Price/locale placeholders
 * @param {string} query - Current search query (for highlighting)
 * @param {Function} onPick - Callback when the row is chosen
 * @returns {HTMLElement}
 */
function buildModalResultRow(product, ph, query, onPick) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'compare-products-widget-modal-item';

  const thumb = document.createElement('img');
  thumb.className = 'compare-products-widget-modal-item-thumb';
  thumb.loading = 'lazy';
  thumb.src = product.variants?.[0]?.image || product.image || '';
  thumb.alt = '';

  const name = document.createElement('span');
  name.className = 'compare-products-widget-modal-item-name';
  name.innerHTML = highlightMatch(product.title || '', query);

  const price = document.createElement('span');
  price.className = 'compare-products-widget-modal-item-price';
  price.textContent = product.price ? formatPrice(product.price, ph) : '';

  row.append(thumb, name, price);
  row.addEventListener('click', () => onPick(product));
  return row;
}

/**
 * Filters candidates by title (accent/case-insensitive substring match) and sorts
 * title-starts-with-query matches first, like a typical quick-search experience.
 * @param {Object[]} candidates
 * @param {string} query
 * @returns {Object[]}
 */
function filterCandidates(candidates, query) {
  const termNorm = normalizeForSearch(query);
  if (!termNorm) return candidates;
  return candidates
    .map((product) => ({ product, idx: normalizeForSearch(product.title || '').indexOf(termNorm) }))
    .filter(({ idx }) => idx !== -1)
    .sort((a, b) => a.idx - b.idx)
    .map(({ product }) => product);
}

/**
 * Opens the "add a product" modal: a search box that quick-filters + highlights matches,
 * over a compact thumbnail/name/price result list. Picking a result adds it to the comparison.
 * @param {Object[]} candidates - Products not already in the comparison
 * @param {Object} ph - Price/locale placeholders
 * @param {Object} copy - Widget copy
 * @param {Object[]} currentProducts - Currently selected products (for adding on top of)
 */
function openAddProductModal(candidates, ph, copy, currentProducts) {
  const dialog = document.createElement('dialog');
  dialog.className = 'compare-products-widget-modal';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'compare-products-widget-modal-close';
  closeBtn.setAttribute('aria-label', copy.remove || 'Close');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => dialog.close());

  const heading = document.createElement('h2');
  heading.className = 'compare-products-widget-modal-heading';
  heading.textContent = copy.addAProductToCompare;

  const searchWrap = document.createElement('div');
  searchWrap.className = 'compare-products-widget-modal-search';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = copy.search || 'Search';
  searchInput.setAttribute('aria-label', copy.search || 'Search');
  searchWrap.appendChild(searchInput);

  const list = document.createElement('div');
  list.className = 'compare-products-widget-modal-list';

  const renderResults = () => {
    const query = searchInput.value.trim();
    const results = filterCandidates(candidates, query);
    list.innerHTML = '';
    if (!results.length) {
      const empty = document.createElement('p');
      empty.className = 'compare-products-widget-modal-empty';
      empty.textContent = copy.noResults;
      list.appendChild(empty);
      return;
    }
    results.forEach((product) => {
      list.appendChild(buildModalResultRow(product, ph, query, (picked) => {
        goToComparePaths([...currentProducts, picked]);
      }));
    });
  };

  searchInput.addEventListener('input', renderResults);

  dialog.append(closeBtn, heading, searchWrap, list);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => {
    const {
      left, right, top, bottom,
    } = dialog.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX < left || clientX > right || clientY < top || clientY > bottom) {
      dialog.close();
    }
  });

  document.body.appendChild(dialog);
  renderResults();
  dialog.showModal();
  searchInput.focus();
}

/**
 * Renders the compact "add a product" trigger (instead of a full grid of every other
 * product), which opens the quick-search modal.
 * @param {HTMLElement} container
 * @param {Object[]} candidates - Products not already in the comparison
 * @param {Object[]} currentProducts - Currently selected products
 * @param {Object} ph
 * @param {Object} copy
 */
function renderAddTrigger(container, candidates, currentProducts, ph, copy) {
  container.innerHTML = '';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'compare-products-widget-add-trigger';
  trigger.textContent = copy.addAProductToCompare;
  trigger.disabled = candidates.length === 0;
  if (trigger.disabled) trigger.title = copy.allSelected;
  trigger.addEventListener('click', () => openAddProductModal(candidates, ph, copy, currentProducts));
  container.appendChild(trigger);
}

/**
 * Decorates the compare-products widget: reads the `compare-products` query param, renders an
 * aligned comparison grid (sourced from the same plp-data-{dataset}.json + products index the
 * product-list widget uses) with feature rows that highlight differences, and a compact
 * "add a product" trigger that opens a quick-search modal.
 * @param {HTMLElement} widget - Widget root element
 */
export default async function decorate(widget) {
  const { locale, language } = getWidgetLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadWidgetCopy(lang);
  const ph = await fetchPlaceholders(`/${locale}/${language}/products/config`);

  loadCSS(`${window.hlx?.codeBasePath || ''}/widgets/compare-products/compare-products.css`);
  loadCSS(`${window.hlx?.codeBasePath || ''}/styles/color-swatches.css`);

  const gridEl = widget.querySelector('.compare-products-widget-grid');
  const addSectionEl = widget.querySelector('.compare-products-widget-add-section');
  if (!gridEl || !addSectionEl) return;

  const dataset = widget.dataset.dataset || 'blenders';
  const allProducts = (await lookupProductListProducts({}, {}, dataset))
    .filter((product) => !product.isMarketing);

  let selectedPaths = getComparePaths();
  if (selectedPaths.length === 0) {
    // No products selected via the URL - fall back to the localStorage-persisted list (if any)
    // and reflect it into the URL so the page is shareable/bookmarkable from here on.
    const storedPaths = getStoredComparePaths().map(normalizePath);
    if (storedPaths.length) {
      selectedPaths = storedPaths;
      pushComparePathsToUrl(selectedPaths);
    }
  }
  const slots = selectedPaths.map((path) => ({
    path,
    product: findProductByPath(allProducts, path),
  }));
  const currentProducts = slots.filter((slot) => slot.product).map((slot) => slot.product);

  const onRemove = (path) => {
    const key = normalizePath(path);
    goToComparePaths(currentProducts.filter((product) => normalizePath(product.url) !== key));
  };

  const excludeSet = new Set(selectedPaths.map(normalizePath));
  const candidates = allProducts.filter((product) => !excludeSet.has(normalizePath(product.url)));

  // With exactly one product selected, invite adding a second right in the grid via a ghost
  // column instead of the below-grid trigger; otherwise (0, or 2+) use the compact trigger.
  const showGhost = slots.length === 1 && candidates.length > 0;
  const ghost = showGhost
    ? { onAdd: () => openAddProductModal(candidates, ph, copy, currentProducts) }
    : null;

  renderComparisonGrid(gridEl, slots, ph, copy, onRemove, ghost);

  if (showGhost || slots.length >= MAX_COMPARISON_PRODUCTS) {
    addSectionEl.innerHTML = '';
  } else {
    renderAddTrigger(addSectionEl, candidates, currentProducts, ph, copy);
  }
}
