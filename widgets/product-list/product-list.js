/* eslint-disable max-len */
import {
  fetchPlaceholders, loadCSS, toClassName,
} from '../../scripts/aem.js';
import { formatPrice, buildVideo } from '../../scripts/scripts.js';
import { loadFragment } from '../../blocks/fragment/fragment.js';
import addToCompare, { useWidgetCompare, isInStoredCompare, getHeaderCompareHref } from '../../scripts/add-to-compare.js';
import { createCallouts, createStarRating } from '../../scripts/plp-data.js';
import lookupProductListProducts, { getWidgetLocaleAndLanguage, getFacetDefinitions } from './products.js';

const marketingFragmentCache = new Map();

const LIFESTYLE_TILE_SELECTOR = '.block > div, .block > ul > li';
const LIFESTYLE_TILE_SELECTED_SELECTOR = '.block > div.selected, .block > ul > li.selected';

// Populated at runtime from the "* Facet" columns discovered in plp-data.json.
let FACET_KEYS = [];
let FACET_LABELS = {};
let FILTER_PARAM_KEYS = ['fulltext'];

function setFacetDefinitions(facetDefs) {
  FACET_KEYS = facetDefs.map((d) => d.key);
  FACET_LABELS = Object.fromEntries(facetDefs.map((d) => [d.key, d.label]));
  FILTER_PARAM_KEYS = [...FACET_KEYS, 'fulltext'];
}

const COLOR_ORDER = {
  black: 1,
  'shadow-black': 1,
  1100001: 1,
  1100002: 1,
  'black-stainless-metal-finish': 1,
  red: 2,
  'candy-apple': 2,
  'candy-apple-red': 2,
  ruby: 2,
  white: 3,
  'polar-white': 3,
  onyx: 4,
  'abalone-grey': 4,
  graphite: 4,
  'nano-gray': 4,
  'graphite-metal-finish': 4,
  slate: 4,
  'pearl-gray': 4,
  'black-diamond': 4,
  'brushed-stainless': 4,
  grey: 4,
  platinum: 4,
  espresso: 5,
  'copper-metal-finish': 5,
  reflection: 5,
  'brushed-stainless-metal-finish': 5,
  'brushed-gold': 5,
  cream: 5,
};

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

function hasVariants(product) {
  return product.variants && product.variants.length > 0;
}

function createProductImage() {
  const wrap = document.createElement('div');
  wrap.className = 'product-list-widget-image-wrap';
  const img = document.createElement('img');
  img.loading = 'lazy';
  wrap.appendChild(img);
  return { wrap, img };
}

function getSortedVariants(product) {
  if (!hasVariants(product)) return [];
  return [...product.variants].sort((a, b) => {
    const colorA = COLOR_ORDER[toClassName(a.color)] ?? 9;
    const colorB = COLOR_ORDER[toClassName(b.color)] ?? 9;
    return colorA - colorB;
  });
}

function findVariantBySlug(product, colorSlug) {
  if (!hasVariants(product) || !colorSlug) return null;
  return product.variants.find((v) => v.color && toClassName(v.color) === colorSlug) || null;
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

function setSelectedSwatch(colorsEl, colorSlug) {
  colorsEl.querySelectorAll('.color-swatch').forEach((el) => {
    el.classList.toggle('selected', el.dataset.color === colorSlug);
  });
}

function createCompareButton(product, copy) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'product-list-widget-compare-btn pdp-compare-button';

  const icon = document.createElement('span');
  icon.className = 'product-list-widget-compare-icon';
  icon.setAttribute('aria-hidden', 'true');
  btn.appendChild(icon);

  // Only the compare-products widget path tracks membership client-side (Magento's server-side
  // compare list has no easy client-side "is this already in it?" check), so the "already added"
  // (checkmark) state only applies there.
  const widgetMode = useWidgetCompare();
  const updateState = () => {
    const inCompare = widgetMode && isInStoredCompare(product.url);
    const label = inCompare
      ? (copy.viewComparisonList || 'View Comparison List')
      : (copy.addToComparisonList || 'Add to Comparison list');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.classList.toggle('product-list-widget-compare-btn-active', inCompare);
  };
  updateState();

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (widgetMode && isInStoredCompare(product.url)) {
      // Already added: the checkmark navigates to the comparison list rather than removing it.
      const viewHref = getHeaderCompareHref();
      if (viewHref) window.location.href = viewHref;
      return;
    }
    addToCompare(product, {
      addedMessage: copy.addedToComparison,
      limitMessage: copy.compareLimitReached,
      viewComparisonLabel: copy.viewComparison,
    });
    updateState();
  });

  return btn;
}

function createProductTitle(product) {
  const title = document.createElement('h4');
  const link = document.createElement('a');
  link.href = product.url || '#';
  link.textContent = product.title || '';
  title.appendChild(link);
  return title;
}

function createProductColors(product, copy, onSelect) {
  const colors = document.createElement('div');
  colors.className = 'product-list-colors';
  if (!hasVariants(product)) return colors;

  const label = document.createElement('span');
  label.className = 'product-list-widget-colors-label';
  label.textContent = copy.colorOptions;
  colors.appendChild(label);

  getSortedVariants(product).forEach((variant) => {
    const { color, availability } = variant;
    if (!color) return;
    const colorSlug = toClassName(color);
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch';
    swatch.title = color;
    swatch.dataset.color = colorSlug;
    swatch.setAttribute('aria-label', color);
    const inner = document.createElement('span');
    inner.className = 'product-list-color-inner';
    inner.style.backgroundColor = `var(--color-${colorSlug}, #888)`;
    if (availability !== 'InStock') inner.classList.add('product-list-color-swatch-oos');
    swatch.appendChild(inner);
    swatch.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onSelect(variant, swatch);
    });
    colors.appendChild(swatch);
  });
  return colors;
}

function createProductBullets(product) {
  const bullets = product.bullets || [];
  if (!bullets.length) return null;
  const list = document.createElement('ul');
  list.className = 'product-list-widget-bullets';
  bullets.forEach((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  return list;
}

/**
 * The variant (sale) prices available for a product, used to decide whether it has a single
 * fixed price or a range of prices across its variants.
 * @param {Object} product
 * @returns {number[]}
 */
function getVariantPrices(product) {
  if (!hasVariants(product)) return [];
  return product.variants
    .map((v) => Number(v.price))
    .filter((p) => Number.isFinite(p) && p > 0);
}

/**
 * Whether a product's variants actually have differing sale prices - only then should the card
 * show "Starting At" instead of a single plain price.
 * @param {Object} product
 * @returns {boolean}
 */
function hasVaryingPrice(product) {
  const prices = getVariantPrices(product);
  return prices.length > 1 && Math.min(...prices) !== Math.max(...prices);
}

function createProductPrice(product, ph, copy) {
  const price = document.createElement('p');
  price.className = 'product-list-widget-price';
  if (!product.price) return price;

  const varyingPrice = hasVaryingPrice(product);
  const amount = document.createElement('span');
  amount.className = 'product-list-widget-price-amount';

  if (varyingPrice) {
    const label = document.createElement('span');
    label.className = 'product-list-widget-price-label';
    label.textContent = copy.startingAt;
    price.append(label);
    amount.textContent = formatPrice(Math.min(...getVariantPrices(product)), ph);
  } else {
    amount.textContent = formatPrice(product.price, ph);
  }
  price.append(amount);

  const regular = product.originalPrice || product.regularPrice;
  if (regular && Number(regular) > Number(product.price)) {
    const regularPrice = document.createElement('del');
    regularPrice.textContent = formatPrice(regular, ph);
    amount.append(' ', regularPrice);
  }
  return price;
}

function createProductCta(product, copy) {
  const wrap = document.createElement('p');
  wrap.className = 'product-list-widget-cta button-container';
  const link = document.createElement('a');
  link.href = product.url || '#';
  link.className = 'button link';
  link.textContent = copy.shopNow;
  wrap.appendChild(link);
  return wrap;
}

function createProductListCard(product, ph, copy, activeColorSlug) {
  const card = document.createElement('div');
  card.className = 'product-list-widget-product-card';
  card.setAttribute('role', 'listitem');

  const { wrap: imageWrap, img } = createProductImage();
  imageWrap.append(createCallouts(product, copy), createCompareButton(product, copy));

  const title = createProductTitle(product);
  const colors = createProductColors(product, copy, (variant, swatch) => {
    updateCardImage(img, product, variant);
    setSelectedSwatch(colors, swatch.dataset.color);
  });
  const reviews = createStarRating(product);
  const bullets = createProductBullets(product);
  const price = createProductPrice(product, ph, copy);
  const cta = createProductCta(product, copy);

  const initialVariant = findVariantBySlug(product, activeColorSlug)
    || getSortedVariants(product)[0]
    || null;
  updateCardImage(img, product, initialVariant);
  if (initialVariant) setSelectedSwatch(colors, toClassName(initialVariant.color));

  card.append(imageWrap, title, colors, reviews);
  if (bullets) card.appendChild(bullets);
  card.append(price, cta);

  card.addEventListener('click', (e) => {
    if (e.target.closest('button, a.button')) return;
    const detailsLink = cta.querySelector('a');
    if (detailsLink) detailsLink.click();
    else if (title.querySelector('a')) title.querySelector('a').click();
  });

  return card;
}

/**
 * Fetches a marketing fragment's .plain.html and rewrites relative media URLs.
 * @param {string} pathname - Same-origin fragment pathname
 * @returns {Promise<HTMLElement|null>} Root content element, or null on failure
 */
async function fetchMarketingFragment(pathname) {
  if (marketingFragmentCache.has(pathname)) {
    return marketingFragmentCache.get(pathname).cloneNode(true);
  }
  const resp = await fetch(`${pathname}.plain.html`);
  if (!resp.ok) return null;
  const main = document.createElement('div');
  main.innerHTML = await resp.text();
  const resetAttributeBase = (tag, attr) => {
    main.querySelectorAll(`${tag}[${attr}^="./media_"]`).forEach((elem) => {
      elem[attr] = new URL(elem.getAttribute(attr), new URL(pathname, window.location)).href;
    });
  };
  resetAttributeBase('img', 'src');
  resetAttributeBase('source', 'srcset');
  resetAttributeBase('a', 'href');
  const root = main.firstElementChild || main;
  marketingFragmentCache.set(pathname, root.cloneNode(true));
  return root;
}

/**
 * Turns standalone paragraph links into buttons (mirrors decorateButtons for fragment CTAs).
 * @param {HTMLElement} root
 */
function decorateMarketingButtons(root) {
  root.querySelectorAll('p a[href]').forEach((a) => {
    a.title = a.title || a.textContent;
    const p = a.closest('p');
    const text = a.textContent.trim();
    if (a.href === text || p.textContent.trim() !== text) return;
    a.className = 'button';
    const strong = a.closest('strong');
    const em = a.closest('em');
    if (strong && em) {
      a.classList.add('accent');
      (strong.contains(em) ? strong : em).replaceWith(a);
    } else if (strong) {
      a.classList.add('emphasis');
      strong.replaceWith(a);
    } else if (em) {
      a.classList.add('link');
      em.replaceWith(a);
    }
    p.className = 'button-container';
  });
}

/**
 * Converts an authored `.mp4` link into a video, using a sibling picture as poster.
 * @param {HTMLElement} image
 * @returns {HTMLVideoElement|null}
 */
function buildMarketingVideo(image) {
  const picture = image.querySelector('picture');
  const video = buildVideo(image);
  if (!video) return null;
  if (picture) {
    const img = picture.querySelector('img');
    if (img) video.poster = img.src;
    picture.remove();
  }
  return video;
}

/**
 * Sets marketing body background (charcoal by default) and light/dark text contrast.
 * @param {HTMLElement} body
 */
function applyMarketingColor(body) {
  body.style.setProperty('--marketing-color', 'var(--color-charcoal)');
  const [r, g, b] = getComputedStyle(body).backgroundColor.match(/\d+/g).map(Number);
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  body.classList.add(luminance > 128 ? 'light' : 'dark');
}

/**
 * Builds a product-list marketing card from a plp-data fragment row, matching product-row
 * marketing slide visuals (image/video + titled body with CTA).
 * @param {Object} item - Marketing list item ({ isMarketing, url, title, ... })
 * @returns {Promise<HTMLElement|null>}
 */
async function createMarketingCard(item) {
  const fragment = await fetchMarketingFragment(item.url);
  if (!fragment) return null;

  const card = document.createElement('div');
  card.className = 'product-list-widget-product-card product-list-widget-marketing-card';
  card.setAttribute('role', 'listitem');

  const image = document.createElement('div');
  image.className = 'slide-image';
  const body = document.createElement('div');
  body.className = 'slide-body';

  [...fragment.children].forEach((child) => {
    const hasMedia = child.querySelector?.('picture, a[href*=".mp4"]')
      || child.matches?.('picture, a[href*=".mp4"]');
    if (hasMedia) image.append(child);
    else body.append(child);
  });

  buildMarketingVideo(image);
  decorateMarketingButtons(body);
  card.append(image, body);

  const heading = body.querySelector('h1, h2, h3, h4, h5, h6');
  if (heading) item.title = heading.textContent.trim() || item.title;

  card.addEventListener('click', (e) => {
    if (e.target.closest('a, button, video')) return;
    const link = card.querySelector('a[href]');
    if (link) link.click();
  });

  return card;
}

/**
 * Builds the initial filter config from the widget's authored defaults (dataset, set from the
 * block's own href query params), then layers the live page URL's matching query params on top
 * so a shared/bookmarked/reloaded link's filters are honored instead of silently dropped.
 * @param {HTMLElement} widget
 * @returns {Object}
 */
function buildInitialConfig(widget) {
  const config = {};
  Object.entries(widget.dataset).forEach(([key, value]) => {
    if (key === 'source' || !FILTER_PARAM_KEYS.includes(key)) return;
    config[key] = value;
  });
  const urlParams = new URLSearchParams(window.location.search);
  FILTER_PARAM_KEYS.forEach((key) => {
    const value = urlParams.get(key);
    if (value) config[key] = value;
  });
  return config;
}

function isWidgetConfigPage() {
  return /\/widgets\/[^/]+\/[^/]+\.html$/.test(window.location.pathname);
}

function stripQueryParams(keys) {
  const params = new URLSearchParams(window.location.search);
  let changed = false;
  keys.forEach((key) => {
    if (params.has(key)) {
      params.delete(key);
      changed = true;
    }
  });
  if (!changed) return;
  const search = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash || ''}`);
}

function countActiveFilters(filterConfig) {
  return FACET_KEYS.reduce((count, key) => {
    const val = filterConfig[key];
    if (!val) return count;
    return count + val.split(',').filter(Boolean).length;
  }, 0);
}

function getSelectedFilterTags(filterConfig) {
  const tags = [];
  FACET_KEYS.forEach((key) => {
    const val = filterConfig[key];
    if (!val) return;
    val.split(',').map((t) => t.trim()).filter(Boolean).forEach((value) => {
      tags.push({ key, value });
    });
  });
  return tags;
}

function removeFilterValue(filterConfig, facetKey, value) {
  const next = { ...filterConfig };
  const tokens = (next[facetKey] || '').split(',').map((t) => t.trim()).filter((t) => t && t !== value);
  if (tokens.length) next[facetKey] = tokens.join(', ');
  else delete next[facetKey];
  return next;
}

function syncFilterConfigToUrl(filterConfig, widget) {
  if (widget?.classList?.contains('product-list-config-mode') || isWidgetConfigPage()) return;

  const params = new URLSearchParams(window.location.search);
  FILTER_PARAM_KEYS.forEach((key) => params.delete(key));
  Object.entries(filterConfig).forEach(([key, value]) => {
    if (!FILTER_PARAM_KEYS.includes(key)) return;
    const v = value != null ? String(value).trim() : '';
    if (v) params.set(key, v);
    else params.delete(key);
  });
  const search = params.toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash || ''}`;
  window.history.replaceState(null, '', url);
}

function findFacetMatchForLabel(label, facets) {
  const normalized = label.trim().toLowerCase();
  const slug = toClassName(label.trim());
  if (!normalized) return null;
  for (let i = 0; i < FACET_KEYS.length; i += 1) {
    const key = FACET_KEYS[i];
    const match = Object.keys(facets[key] || {}).find((value) => {
      const facetValue = value.trim().toLowerCase();
      return facetValue === normalized || (slug && facetValue === slug);
    });
    if (match) return { key, value: match };
  }
  return null;
}

function clearLifestyleFragmentSelection(widget) {
  const section = widget.querySelector('.product-list-lifestyle');
  if (!section) return;
  section.querySelectorAll(LIFESTYLE_TILE_SELECTED_SELECTOR).forEach((el) => {
    el.classList.remove('selected');
  });
}

function setDrawerInputsFromConfig(widget, filterConfig) {
  widget.querySelectorAll('.product-list-facet-drawer input[type="checkbox"]').forEach((input) => {
    const selected = (filterConfig[input.name] || '').split(',').map((t) => t.trim());
    input.checked = selected.includes(input.value);
  });
}

function applyFacetFilter(match, widget, runSearch, setFilterConfig, tile) {
  const next = { ...widget.productListBaseConfig };
  next[match.key] = match.value;
  clearLifestyleFragmentSelection(widget);
  if (tile) tile.classList.add('selected');
  setFilterConfig(next);
  setDrawerInputsFromConfig(widget, next);
  runSearch(next);
}

function wireLifestyleFragment(widget, runSearch, setFilterConfig, getAllFacets) {
  const section = widget.querySelector('.product-list-lifestyle');
  if (!section || section.dataset.lifestyleWired === 'true') return;
  section.dataset.lifestyleWired = 'true';

  section.addEventListener('click', (e) => {
    const tile = e.target.closest(LIFESTYLE_TILE_SELECTOR);
    if (!tile || !section.contains(tile)) return;

    const heading = tile.querySelector('h1, h2, h3, h4, h5, h6');
    if (!heading) return;

    const match = findFacetMatchForLabel(heading.textContent, getAllFacets());
    if (!match) return;

    e.preventDefault();
    applyFacetFilter(match, widget, runSearch, setFilterConfig, tile);
  });
}

/**
 * Sorts facet values by descending count (most products first), falling back to alphabetical
 * order for ties, e.g. "Ascent X Series (7)" ranks above "Legacy Series (3)" in the Series filter.
 * @param {string[]} values
 * @param {Object.<string, number>} counts
 * @returns {string[]}
 */
function sortFacetValuesByCount(values, counts) {
  return [...values].sort((a, b) => (counts[b] - counts[a]) || a.localeCompare(b));
}

function createFacetSwatch(facetValue) {
  const swatch = document.createElement('span');
  swatch.className = 'color-swatch product-list-widget-facet-swatch';
  const inner = document.createElement('span');
  inner.className = 'product-list-color-inner';
  inner.style.backgroundColor = `var(--color-${toClassName(facetValue)}, #888)`;
  swatch.appendChild(inner);
  return swatch;
}

function renderFilterTags(container, tags, copy, onRemove) {
  container.innerHTML = '';
  if (!tags.length) return;
  tags.forEach(({ key, value }) => {
    const tag = document.createElement('button');
    tag.type = 'button';
    tag.className = 'product-list-widget-filter-tag';
    if (key === 'color') tag.appendChild(createFacetSwatch(value));
    tag.append(value);
    tag.setAttribute('aria-label', `${copy.clearAll}: ${value}`);
    tag.addEventListener('click', () => onRemove(key, value));
    container.appendChild(tag);
  });
}

function renderDrawerFacets(listEl, facets, filterConfig, copy, onChange) {
  listEl.innerHTML = '';
  FACET_KEYS.forEach((key) => {
    const facetValues = sortFacetValuesByCount(Object.keys(facets[key] || {}), facets[key] || {});
    const isEmpty = facetValues.length === 0;

    const details = document.createElement('details');
    details.className = 'product-list-widget-facet-group';
    details.classList.toggle('product-list-widget-facet-group-disabled', isEmpty);
    details.open = !isEmpty && (filterConfig[key] || '').length > 0;

    const summary = document.createElement('summary');
    summary.textContent = copy[key] || FACET_LABELS[key] || key;
    if (isEmpty) {
      summary.setAttribute('aria-disabled', 'true');
      summary.addEventListener('click', (e) => e.preventDefault());
    }
    details.appendChild(summary);

    if (!isEmpty) {
      const options = document.createElement('div');
      options.className = 'product-list-widget-facet-options';
      const selected = (filterConfig[key] || '').split(',').map((t) => t.trim());

      facetValues.forEach((facetValue) => {
        const id = `product-list-widget-filter-${key}-${toClassName(facetValue)}`;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = id;
        input.name = key;
        input.value = facetValue;
        input.checked = selected.includes(facetValue);
        input.addEventListener('change', onChange);

        const label = document.createElement('label');
        label.setAttribute('for', id);
        if (key === 'color') label.appendChild(createFacetSwatch(facetValue));
        label.append(`${facetValue} (${facets[key][facetValue]})`);
        options.append(input, label);
      });

      details.appendChild(options);
    }

    listEl.appendChild(details);
  });
}

/** Marks an open toolbar dropdown - a plain div/button implementation (no <details>/<summary>/
 *  <menu>, which some Chrome versions handle unreliably) with explicit JS-driven open/close
 *  state instead of relying on native disclosure-element semantics. */
const DROPDOWN_OPEN_CLASS = 'product-list-widget-dropdown-open';

function isDropdownOpen(dropdown) {
  return dropdown.classList.contains(DROPDOWN_OPEN_CLASS);
}

function openDropdown(dropdown) {
  const trigger = dropdown.querySelector('.product-list-widget-dropdown-trigger');
  const menu = dropdown.querySelector('.product-list-widget-dropdown-menu');
  dropdown.classList.add(DROPDOWN_OPEN_CLASS);
  trigger?.setAttribute('aria-expanded', 'true');
  if (menu) menu.hidden = false;
}

function closeDropdown(dropdown) {
  const trigger = dropdown.querySelector('.product-list-widget-dropdown-trigger');
  const menu = dropdown.querySelector('.product-list-widget-dropdown-menu');
  dropdown.classList.remove(DROPDOWN_OPEN_CLASS);
  trigger?.setAttribute('aria-expanded', 'false');
  if (menu) menu.hidden = true;
}

/**
 * Closes every open dropdown in `root` except `keep` (pass null to close all).
 * @param {HTMLElement} root
 * @param {HTMLElement|null} keep
 */
function closeSiblingDropdowns(root, keep) {
  root.querySelectorAll(`.product-list-widget-dropdown.${DROPDOWN_OPEN_CLASS}`).forEach((dropdown) => {
    if (dropdown !== keep) closeDropdown(dropdown);
  });
}

/**
 * Opens `dropdown` (closing any other open one in the same toolbar) and moves focus onto the
 * current value (or the first option), matching the standard listbox-button pattern - this
 * fires for both mouse and keyboard opens, which is harmless for mouse users and essential for
 * keyboard ones.
 * @param {HTMLElement} dropdown
 */
function openDropdownAndFocus(dropdown) {
  closeSiblingDropdowns(dropdown.closest('.product-list-toolbar') || dropdown.parentElement, dropdown);
  openDropdown(dropdown);
  const menu = dropdown.querySelector('.product-list-widget-dropdown-menu');
  (menu?.querySelector('[aria-selected="true"]') || menu?.querySelector('.product-list-widget-dropdown-option'))?.focus();
}

function toggleDropdown(dropdown) {
  if (isDropdownOpen(dropdown)) closeDropdown(dropdown);
  else openDropdownAndFocus(dropdown);
}

function createDropdownChevron() {
  const chevron = document.createElement('span');
  chevron.className = 'product-list-widget-dropdown-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  return chevron;
}

/**
 * Renders the desktop toolbar's per-facet single-select dropdowns - a plain div/button listbox-
 * button widget (see DROPDOWN_OPEN_CLASS) with listbox roles/aria-selected, roving-arrow-key
 * navigation, click-outside/Escape-to-close and focus-follows-open, all wired once in decorate()
 * via wireDropdowns().
 * @param {HTMLElement} container
 * @param {Object} facets
 * @param {Object} filterConfig
 * @param {Object} copy
 * @param {Function} onSelect
 */
function renderDropdownFilters(container, facets, filterConfig, copy, onSelect) {
  container.innerHTML = '';
  FACET_KEYS.forEach((key) => {
    const facetValues = sortFacetValuesByCount(Object.keys(facets[key] || {}), facets[key] || {});
    const isEmpty = facetValues.length === 0;
    const selectedValue = (filterConfig[key] || '').trim();

    const dropdown = document.createElement('div');
    dropdown.className = 'product-list-widget-dropdown product-list-widget-filter-dropdown';
    dropdown.dataset.facetKey = key;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'product-list-widget-dropdown-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    label.className = 'product-list-widget-filter-dropdown-label';
    label.textContent = copy[key] || FACET_LABELS[key] || key;
    trigger.append(label, createDropdownChevron());
    if (isEmpty) {
      trigger.disabled = true;
    } else {
      trigger.addEventListener('click', () => toggleDropdown(dropdown));
    }
    dropdown.appendChild(trigger);

    if (!isEmpty) {
      const menu = document.createElement('div');
      menu.className = 'product-list-widget-dropdown-menu';
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', copy[key] || FACET_LABELS[key] || key);
      menu.hidden = true;

      facetValues.forEach((facetValue) => {
        const isSelected = facetValue === selectedValue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'product-list-widget-dropdown-option';
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', String(isSelected));
        if (key === 'color') btn.appendChild(createFacetSwatch(facetValue));
        const optionLabel = document.createElement('span');
        optionLabel.className = 'product-list-widget-filter-dropdown-option-label';
        optionLabel.textContent = `${facetValue} (${facets[key][facetValue]})`;
        btn.appendChild(optionLabel);
        if (isSelected) {
          const check = document.createElement('span');
          check.className = 'product-list-widget-filter-dropdown-check';
          check.setAttribute('aria-hidden', 'true');
          check.textContent = '✓';
          btn.appendChild(check);
        }
        btn.addEventListener('click', () => {
          closeDropdown(dropdown);
          onSelect(key, facetValue);
        });
        menu.appendChild(btn);
      });

      dropdown.appendChild(menu);
    }

    container.appendChild(dropdown);
  });
}

/**
 * Wires the toolbar dropdowns' interaction affordances once (not re-run on every search/render,
 * since the filter dropdowns themselves are rebuilt on every re-render; the sort dropdown is
 * static markup): click-outside-to-close, focus-leaves-to-close, and roving keyboard navigation
 * (Arrow Up/Down, Home, End, Escape) within an open dropdown's option list. Covers both the
 * per-facet filter dropdowns and the sort dropdown, which share the same markup pattern.
 * @param {HTMLElement} container - .product-list-toolbar
 */
function wireDropdowns(container) {
  document.addEventListener('click', (e) => {
    if (container.contains(e.target)) return;
    closeSiblingDropdowns(container, null);
  });

  container.addEventListener('focusout', (e) => {
    const dropdown = e.target.closest('.product-list-widget-dropdown');
    if (!dropdown || dropdown.contains(e.relatedTarget)) return;
    closeDropdown(dropdown);
  });

  container.addEventListener('keydown', (e) => {
    const dropdown = e.target.closest('.product-list-widget-dropdown');
    if (!dropdown) return;
    const trigger = dropdown.querySelector('.product-list-widget-dropdown-trigger');
    const options = [...dropdown.querySelectorAll('.product-list-widget-dropdown-option')];

    if (e.target === trigger) {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && options.length) {
        e.preventDefault();
        if (!isDropdownOpen(dropdown)) openDropdownAndFocus(dropdown);
        options[e.key === 'ArrowDown' ? 0 : options.length - 1].focus();
      } else if (e.key === 'Escape' && isDropdownOpen(dropdown)) {
        e.preventDefault();
        closeDropdown(dropdown);
      }
      return;
    }

    const index = options.indexOf(e.target);
    if (index === -1) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      options[(index + 1) % options.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      options[(index - 1 + options.length) % options.length].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      options[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      options[options.length - 1].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown(dropdown);
      trigger?.focus();
    }
  });
}

function getFilterConfigFromInputs(widget) {
  const config = { ...widget.productListBaseConfig };
  widget.querySelectorAll('.product-list-facet-drawer input[type="checkbox"]:checked').forEach((input) => {
    const { name, value } = input;
    if (config[name]) config[name] += `, ${value}`;
    else config[name] = value;
  });
  return config;
}

/**
 * Decorates the product-list widget with lifestyle filters, facet UI, and enhanced product cards.
 * @param {HTMLElement} widget - Widget root element
 */
export default async function decorate(widget) {
  const configMode = widget.classList.contains('product-list-config-mode');
  if (!configMode && !isWidgetConfigPage()) {
    stripQueryParams(['show']);
  }
  delete widget.dataset.show;
  const { locale, language } = getWidgetLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadWidgetCopy(lang);
  const ph = await fetchPlaceholders(`/${locale}/${language}/products/config`);
  widget.productListDataset = widget.dataset.dataset || 'blenders';
  setFacetDefinitions(await getFacetDefinitions(widget.productListDataset));
  const baseConfig = buildInitialConfig(widget);
  widget.productListFilterConfig = { ...baseConfig };
  widget.productListBaseConfig = { ...baseConfig };

  loadCSS(`${window.hlx?.codeBasePath || ''}/widgets/product-list/product-list.css`);
  loadCSS(`${window.hlx?.codeBasePath || ''}/styles/color-swatches.css`);

  const toolbar = widget.querySelector('.product-list-toolbar');
  const filtersTrigger = widget.querySelector('.product-list-filters-trigger');
  const filtersCount = widget.querySelector('.product-list-filters-count');
  const filterDropdowns = widget.querySelector('.product-list-filter-dropdowns');
  // Two copies exist (one in the toolbar for desktop, one in the active-filters row for
  // mobile - see product-list.html/css), so update both from a shared class instead of an id.
  const countEls = widget.querySelectorAll('.product-list-widget-results-count');
  const countLabels = widget.querySelectorAll('.product-list-item-count-label');
  const sortDropdown = widget.querySelector('.product-list-sort');
  const sortTrigger = widget.querySelector('.product-list-sort .product-list-widget-dropdown-trigger');
  const sortLabel = widget.querySelector('.product-list-sort-label');
  const sortByEl = widget.querySelector('#product-list-widget-sortby');
  const sortButtons = widget.querySelectorAll('.product-list-sort .product-list-widget-dropdown-option');
  const activeFilters = widget.querySelector('.product-list-active-filters');
  const activeFiltersTags = widget.querySelector('.product-list-active-filters-tags');
  const clearAllBtn = widget.querySelector('.product-list-clear-all');
  const filterTags = widget.querySelector('.product-list-filter-tags');
  const drawer = widget.querySelector('.product-list-facet-drawer');
  const drawerTitle = widget.querySelector('.product-list-facet-drawer-title');
  const drawerClose = widget.querySelector('.product-list-facet-drawer-close');
  const drawerCancel = widget.querySelector('.product-list-facet-drawer-cancel');
  const drawerApply = widget.querySelector('.product-list-facet-drawer-apply');
  const drawerList = widget.querySelector('.product-list-facet-drawer-list');
  const resultsEl = widget.querySelector('.product-list-results');
  const emptyEl = widget.querySelector('.product-list-empty');

  if (!resultsEl) return;

  if (toolbar) wireDropdowns(toolbar);

  if (sortDropdown && sortTrigger) {
    sortTrigger.addEventListener('click', () => toggleDropdown(sortDropdown));
  }

  filtersTrigger.querySelector('.product-list-filters-trigger-label').textContent = copy.filters;
  countLabels.forEach((label) => { label.textContent = copy.items; });
  sortLabel.textContent = copy.sortBy;
  sortByEl.textContent = copy.featured;
  drawerTitle.textContent = copy.filters;
  drawerCancel.textContent = copy.cancel;
  drawerApply.textContent = copy.applyFilters;
  clearAllBtn.textContent = copy.clearAll;
  emptyEl.textContent = copy.noResults;

  const sortLabels = {
    featured: copy.featured,
    'price-desc': copy.priceHighToLow,
    'price-asc': copy.priceLowToHigh,
    'reviews-desc': copy.reviewsHighToLow,
  };
  sortButtons.forEach((btn) => {
    btn.textContent = sortLabels[btn.dataset.sort] || btn.dataset.sort;
    btn.setAttribute('aria-selected', String(btn.dataset.sort === (sortByEl.dataset.sort || 'featured')));
  });

  const lifestyleSection = widget.querySelector('.product-list-lifestyle');
  if (widget.dataset.highlights) {
    const highlightsPath = widget.dataset.highlights.startsWith('/')
      ? widget.dataset.highlights
      : `/${locale}/${language}/${widget.dataset.highlights}`;
    const fragment = await loadFragment(highlightsPath);
    if (fragment && lifestyleSection) {
      lifestyleSection.replaceChildren(...fragment.childNodes);
    } else if (lifestyleSection) {
      lifestyleSection.hidden = true;
    }
  } else if (lifestyleSection) {
    lifestyleSection.hidden = true;
  }

  const getFilterConfig = () => ({ ...widget.productListFilterConfig });
  const setFilterConfig = (config) => {
    widget.productListFilterConfig = { ...config };
  };

  let runSearch;

  const updateFilterUi = (filterConfig, facets) => {
    const activeCount = countActiveFilters(filterConfig);
    filtersCount.textContent = activeCount ? `(${activeCount})` : '';
    const tags = getSelectedFilterTags(filterConfig);
    // On mobile the item count always shows in this row; only the tags/clear-all portion
    // (and, on desktop, the whole row) hides when there's nothing selected - see product-list.css.
    activeFilters.classList.toggle('product-list-active-filters-empty', tags.length === 0);
    activeFiltersTags.hidden = tags.length === 0;
    renderFilterTags(filterTags, tags, copy, (key, value) => {
      const next = removeFilterValue(getFilterConfig(), key, value);
      setFilterConfig(next);
      setDrawerInputsFromConfig(widget, next);
      runSearch(next);
    });
    renderDrawerFacets(drawerList, facets, filterConfig, copy, () => {});
    renderDropdownFilters(filterDropdowns, facets, filterConfig, copy, (key, value) => {
      const next = { ...getFilterConfig() };
      if (value) next[key] = value;
      else delete next[key];
      setFilterConfig(next);
      setDrawerInputsFromConfig(widget, next);
      runSearch(next);
    });
  };

  let searchGeneration = 0;

  const displayResults = async (results, activeColorSlug) => {
    const generation = searchGeneration;
    resultsEl.innerHTML = '';
    if (!results.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    const cards = await Promise.all(results.map((item) => (
      item.isMarketing
        ? createMarketingCard(item)
        : createProductListCard(item, ph, copy, activeColorSlug)
    )));
    if (generation !== searchGeneration) return;
    cards.filter(Boolean).forEach((card) => {
      resultsEl.appendChild(card);
      if (card.classList.contains('product-list-widget-marketing-card')) {
        const body = card.querySelector('.slide-body');
        if (body) applyMarketingColor(body);
      }
    });
  };

  runSearch = async (filterConfig = getFilterConfig()) => {
    searchGeneration += 1;
    const facets = FACET_KEYS.reduce((acc, key) => ({ ...acc, [key]: {} }), {});
    const results = await lookupProductListProducts(filterConfig, facets, widget.productListDataset);
    widget.productListLastFacets = facets;
    const sortKey = sortByEl.dataset.sort || 'featured';
    const byMarketingLast = (a, b, cmp) => {
      if (a.isMarketing && b.isMarketing) return 0;
      if (a.isMarketing) return 1;
      if (b.isMarketing) return -1;
      return cmp(a, b);
    };
    const sorts = {
      'price-asc': (a, b) => byMarketingLast(a, b, (x, y) => Number(x.price) - Number(y.price)),
      'price-desc': (a, b) => byMarketingLast(a, b, (x, y) => Number(y.price) - Number(x.price)),
      'reviews-desc': (a, b) => byMarketingLast(a, b, (x, y) => Number(y.reviewCount) - Number(x.reviewCount)),
    };
    // 'featured' (Most Popular) keeps the row order from plp-data-{dataset}.json as-is.
    if (sorts[sortKey]) results.sort(sorts[sortKey]);
    countEls.forEach((el) => { el.textContent = String(results.length); });
    const activeColor = (filterConfig.color || '').split(',')[0].trim();
    await displayResults(results, activeColor ? toClassName(activeColor) : null);
    updateFilterUi(filterConfig, facets);
    syncFilterConfigToUrl(filterConfig, widget);
  };

  sortButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      sortByEl.textContent = btn.textContent;
      sortByEl.dataset.sort = btn.dataset.sort;
      sortButtons.forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      if (sortDropdown) closeDropdown(sortDropdown);
      runSearch(getFilterConfig());
    });
  });

  const openDrawer = () => {
    setDrawerInputsFromConfig(widget, getFilterConfig());
    drawer.classList.add('visible');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('product-list-widget-drawer-open');
  };

  const closeDrawer = () => {
    drawer.classList.remove('visible');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('product-list-widget-drawer-open');
  };

  filtersTrigger.addEventListener('click', openDrawer);
  drawerClose.addEventListener('click', closeDrawer);
  drawerCancel.addEventListener('click', closeDrawer);
  drawer.addEventListener('click', (e) => {
    if (e.target === drawer) closeDrawer();
  });
  drawerApply.addEventListener('click', () => {
    const next = getFilterConfigFromInputs(widget);
    setFilterConfig(next);
    closeDrawer();
    runSearch(next);
  });
  clearAllBtn.addEventListener('click', () => {
    setFilterConfig({ ...widget.productListBaseConfig });
    setDrawerInputsFromConfig(widget, widget.productListBaseConfig);
    clearLifestyleFragmentSelection(widget);
    runSearch(widget.productListBaseConfig);
  });

  const allFacets = FACET_KEYS.reduce((acc, key) => ({ ...acc, [key]: {} }), {});
  await lookupProductListProducts({}, allFacets, widget.productListDataset);
  widget.productListAllFacets = allFacets;

  wireLifestyleFragment(
    widget,
    runSearch,
    setFilterConfig,
    () => widget.productListAllFacets || {},
  );

  widget.productListApplyDatasetDefaults = async () => {
    widget.productListDataset = widget.dataset.dataset || 'blenders';
    setFacetDefinitions(await getFacetDefinitions(widget.productListDataset));
    const base = buildInitialConfig(widget);
    widget.productListBaseConfig = { ...base };
    widget.productListFilterConfig = { ...base };
    setDrawerInputsFromConfig(widget, base);
    clearLifestyleFragmentSelection(widget);
    await runSearch(base);
  };

  await runSearch(getFilterConfig());
}
