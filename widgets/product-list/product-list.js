/* eslint-disable max-len */
import {
  fetchPlaceholders, loadCSS, toClassName,
} from '../../scripts/aem.js';
import { formatPrice } from '../../scripts/scripts.js';
import { loadFragment } from '../../blocks/fragment/fragment.js';
import addToCompare, { useWidgetCompare, isInStoredCompare, removeFromCompare } from '../../scripts/add-to-compare.js';
import { createCallouts, createStarRating } from '../../scripts/product-badges.js';
import lookupProductListProducts, { getWidgetLocaleAndLanguage, getFacetDefinitions } from './products.js';

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

  // Only the compare-products widget path tracks membership client-side (Magento's server-side
  // compare list has no easy client-side "is this already in it?" check), so the toggle-to-
  // "Remove from Compare" state only applies there.
  const widgetMode = useWidgetCompare();
  const updateLabel = () => {
    const inCompare = widgetMode && isInStoredCompare(product.url);
    btn.textContent = inCompare ? (copy.removeFromCompare || 'Remove from Compare') : (copy.compare || 'Compare');
    btn.classList.toggle('product-list-widget-compare-btn-active', inCompare);
  };
  updateLabel();

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (widgetMode && isInStoredCompare(product.url)) {
      removeFromCompare(product.url, { viewComparisonLabel: copy.viewComparison });
    } else {
      addToCompare(product, {
        addedMessage: copy.addedToComparison,
        limitMessage: copy.compareLimitReached,
        viewComparisonLabel: copy.viewComparison,
      });
    }
    updateLabel();
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

function createProductColors(product, onSelect) {
  const colors = document.createElement('div');
  colors.className = 'product-list-colors';
  if (!hasVariants(product)) return colors;

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
  if (!bullets.length) return document.createElement('div');
  const list = document.createElement('ul');
  list.className = 'product-list-widget-bullets';
  bullets.forEach((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  return list;
}

function createProductPrice(product, ph) {
  const price = document.createElement('p');
  price.className = 'product-list-widget-price';
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
  wrap.className = 'product-list-widget-cta button-container';
  const link = document.createElement('a');
  link.href = product.url || '#';
  link.className = 'button emphasis';
  link.textContent = copy.viewDetails;
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
  const colors = createProductColors(product, (variant, swatch) => {
    updateCardImage(img, product, variant);
    setSelectedSwatch(colors, swatch.dataset.color);
  });
  const reviews = createStarRating(product);
  const bullets = createProductBullets(product);
  const price = createProductPrice(product, ph);
  const cta = createProductCta(product, copy);

  const initialVariant = findVariantBySlug(product, activeColorSlug)
    || getSortedVariants(product)[0]
    || null;
  updateCardImage(img, product, initialVariant);
  if (initialVariant) setSelectedSwatch(colors, toClassName(initialVariant.color));

  card.append(imageWrap, title, colors, reviews, bullets, price, cta);

  card.addEventListener('click', (e) => {
    if (e.target.closest('button, a.button')) return;
    const detailsLink = cta.querySelector('a');
    if (detailsLink) detailsLink.click();
    else if (title.querySelector('a')) title.querySelector('a').click();
  });

  return card;
}

function buildInitialConfig(widget) {
  const config = {};
  Object.entries(widget.dataset).forEach(([key, value]) => {
    if (key === 'source' || !FILTER_PARAM_KEYS.includes(key)) return;
    config[key] = value;
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
    const facetValues = Object.keys(facets[key] || {}).sort((a, b) => a.localeCompare(b));
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

function renderDropdownFilters(container, facets, filterConfig, copy, onSelect) {
  container.innerHTML = '';
  FACET_KEYS.forEach((key) => {
    const facetValues = Object.keys(facets[key] || {}).sort((a, b) => a.localeCompare(b));
    const isEmpty = facetValues.length === 0;

    const details = document.createElement('details');
    details.className = 'product-list-widget-filter-dropdown';
    details.classList.toggle('product-list-widget-filter-dropdown-disabled', isEmpty);

    const summary = document.createElement('summary');
    summary.textContent = copy[key] || FACET_LABELS[key] || key;
    if (isEmpty) {
      summary.setAttribute('aria-disabled', 'true');
      summary.addEventListener('click', (e) => e.preventDefault());
    }
    details.appendChild(summary);

    if (!isEmpty) {
      const menu = document.createElement('menu');

      facetValues.forEach((facetValue) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        if (key === 'color') btn.appendChild(createFacetSwatch(facetValue));
        btn.append(`${facetValue} (${facets[key][facetValue]})`);
        btn.addEventListener('click', () => onSelect(key, facetValue));
        menu.appendChild(btn);
      });

      details.appendChild(menu);
      details.addEventListener('toggle', () => {
        if (!details.open) return;
        container.querySelectorAll('.product-list-widget-filter-dropdown[open]').forEach((openDetails) => {
          if (openDetails !== details) openDetails.open = false;
        });
      });
    }

    container.appendChild(details);
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

  const filtersTrigger = widget.querySelector('.product-list-filters-trigger');
  const filtersCount = widget.querySelector('.product-list-filters-count');
  const filterDropdowns = widget.querySelector('.product-list-filter-dropdowns');
  const countEl = widget.querySelector('#product-list-widget-results-count');
  const countLabel = widget.querySelector('.product-list-item-count-label');
  const sortLabel = widget.querySelector('.product-list-sort-label');
  const sortByEl = widget.querySelector('#product-list-widget-sortby');
  const sortButtons = widget.querySelectorAll('.product-list-sort menu button');
  const activeFilters = widget.querySelector('.product-list-active-filters');
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

  filtersTrigger.querySelector('.product-list-filters-trigger-label').textContent = copy.filters;
  countLabel.textContent = copy.items;
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
    activeFilters.hidden = tags.length === 0;
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

  const displayResults = (results, activeColorSlug) => {
    resultsEl.innerHTML = '';
    if (!results.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    results.forEach((product) => {
      resultsEl.appendChild(createProductListCard(product, ph, copy, activeColorSlug));
    });
  };

  runSearch = async (filterConfig = getFilterConfig()) => {
    const facets = FACET_KEYS.reduce((acc, key) => ({ ...acc, [key]: {} }), {});
    const results = await lookupProductListProducts(filterConfig, facets, widget.productListDataset);
    widget.productListLastFacets = facets;
    const sortKey = sortByEl.dataset.sort || 'featured';
    const sorts = {
      'price-asc': (a, b) => Number(a.price) - Number(b.price),
      'price-desc': (a, b) => Number(b.price) - Number(a.price),
      'reviews-desc': (a, b) => Number(b.reviewCount) - Number(a.reviewCount),
    };
    // 'featured' (Most Popular) keeps the row order from plp-data-{dataset}.json as-is.
    if (sorts[sortKey]) results.sort(sorts[sortKey]);
    countEl.textContent = String(results.length);
    const activeColor = (filterConfig.color || '').split(',')[0].trim();
    displayResults(results, activeColor ? toClassName(activeColor) : null);
    updateFilterUi(filterConfig, facets);
    syncFilterConfigToUrl(filterConfig, widget);
  };

  sortButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      sortByEl.textContent = btn.textContent;
      sortByEl.dataset.sort = btn.dataset.sort;
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
