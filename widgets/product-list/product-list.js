/* eslint-disable max-len */
import {
  fetchPlaceholders, loadCSS, loadScript, toClassName, toCamelCase,
} from '../../scripts/aem.js';
import { formatPrice, getLocaleAndLanguage } from '../../scripts/scripts.js';
import { loadFragment } from '../../blocks/fragment/fragment.js';
import lookupProductListProducts from './products.js';

const COMPARE_STORAGE_KEY = 'vitamix-compare-list';
const MAX_COMPARE = 4;
const HIDDEN_CATEGORIES = ['Products', 'Commercial', 'Shop'];

const FACET_KEYS = ['series', 'collection', 'colors', 'productType', 'categories'];
const FILTER_PARAM_KEYS = [...FACET_KEYS, 'fulltext'];

const DRAWER_FACET_GROUPS = [
  { key: 'series', labelKey: 'blendingPrograms' },
  { key: 'collection', labelKey: 'collections' },
  { key: 'productType', labelKey: 'type' },
  { key: 'colors', labelKey: 'color' },
  { key: 'categories', labelKey: 'lifestyle' },
];

const DROPDOWN_FACET_GROUPS = [
  { key: 'collection', labelKey: 'collections' },
  { key: 'productType', labelKey: 'type' },
  { key: 'colors', labelKey: 'color' },
  { key: 'series', labelKey: 'blendingPrograms' },
];

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

function getCompareList() {
  try {
    const raw = sessionStorage.getItem(COMPARE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCompareList(list) {
  sessionStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_COMPARE)));
}

function addToCompareList(productUrl) {
  const normalized = productUrl.split('?')[0].split('#')[0];
  const list = getCompareList();
  if (list.includes(normalized)) return list;
  if (list.length >= MAX_COMPARE) return list;
  list.push(normalized);
  saveCompareList(list);
  return list;
}

function getComparePageUrl(list) {
  const { locale, language } = getLocaleAndLanguage();
  const base = `/${locale}/${language}/products/compare`;
  if (!list.length) return base;
  return `${base}?compare-products=${list.map(encodeURIComponent).join(',')}`;
}

function hasVariants(product) {
  return product.variants && product.variants.length > 0;
}

function getAvailableColors(product) {
  if (!hasVariants(product)) return [];
  return product.variants.filter((v) => v.color && v.availability === 'InStock');
}

function isOnSale(product) {
  const regular = product.originalPrice || product.regularPrice;
  return regular && product.price && Number(regular) > Number(product.price);
}

function getProductCallouts(product, copy) {
  const callouts = [];
  const collections = (product.collections || []).join(' ').toLowerCase();
  const title = (product.title || '').toLowerCase();

  if (isOnSale(product)) callouts.push({ type: 'sale', label: copy.sale });
  if (collections.includes('new') || title.includes('new')) {
    callouts.push({ type: 'new', label: copy.new });
  }
  if (collections.includes('bestseller') || title.includes('best seller')) {
    callouts.push({ type: 'bestseller', label: copy.bestSeller });
  }
  if (title.includes('bundle') || collections.includes('bundle') || collections.includes('kitchen systems')) {
    callouts.push({ type: 'bundle', label: copy.bundleSave });
  }
  if (collections.includes('exclusive')) callouts.push({ type: 'exclusive', label: copy.exclusive });

  return callouts.slice(0, 2);
}

function getProductBullets(product) {
  const source = product.description || product.title || '';
  if (!source) return [];
  return source
    .split(/[.•]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10 && s.length < 120)
    .slice(0, 3);
}

function getReviewsId(product) {
  const sku = product.sku || product.urlKey || product.title || '';
  return toClassName(String(sku)).replace(/-/g, '');
}

function createProductImage(product) {
  const wrap = document.createElement('div');
  wrap.className = 'product-list-widget-image-wrap';

  const img = document.createElement('img');
  img.loading = 'lazy';
  if (hasVariants(product)) {
    const variant = product.variants[0];
    if (variant.image) img.src = variant.image;
    if (variant.title) img.alt = variant.title;
  }
  if (!img.src) img.src = product.image || '';
  if (!img.alt) img.alt = product.title || '';
  wrap.appendChild(img);
  return wrap;
}

function createCallouts(product, copy) {
  const wrap = document.createElement('div');
  wrap.className = 'product-list-widget-callouts';
  getProductCallouts(product, copy).forEach(({ type, label }) => {
    const badge = document.createElement('span');
    badge.className = `product-list-widget-callout product-list-widget-callout-${type}`;
    badge.textContent = label;
    wrap.appendChild(badge);
  });
  return wrap;
}

function createCompareButton(product, copy) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'product-list-widget-compare-btn';
  btn.setAttribute('aria-label', copy.addToComparison);
  btn.innerHTML = '<span aria-hidden="true">+</span>';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const list = addToCompareList(product.url);
    btn.classList.add('added');
    btn.setAttribute('aria-label', copy.addedToComparison);
    btn.title = copy.addedToComparison;
    if (list.length) {
      btn.dataset.compareUrl = getComparePageUrl(list);
    }
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

function createProductColors(product) {
  const colors = document.createElement('div');
  colors.className = 'product-list-colors';
  if (!hasVariants(product)) return colors;

  const sortedVariants = [...product.variants].sort((a, b) => {
    const colorA = COLOR_ORDER[toClassName(a.color)] ?? 9;
    const colorB = COLOR_ORDER[toClassName(b.color)] ?? 9;
    return colorA - colorB;
  });

  sortedVariants.forEach((variant) => {
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
    colors.appendChild(swatch);
  });
  return colors;
}

function createProductReviews(product) {
  const wrap = document.createElement('div');
  wrap.className = 'product-list-widget-reviews';
  wrap.innerHTML = `<div data-bv-show="inline_rating" data-bv-product-id="${getReviewsId(product)}"></div>`;
  return wrap;
}

function createProductBullets(product) {
  const bullets = getProductBullets(product);
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

async function handleAddToCart(button, product, copy) {
  button.textContent = copy.adding;
  button.setAttribute('aria-disabled', 'true');
  try {
    const { cartApi } = await import('../../scripts/minicart/api.js');
    const { updateMagentoCacheSections, getMagentoCache } = await import('../../scripts/storage/util.js');
    const currentCache = getMagentoCache();
    if (!currentCache?.customer) await updateMagentoCacheSections(['customer']);
    const sku = hasVariants(product) ? product.variants[0].sku : product.sku;
    await cartApi.addToCart(sku, {}, 1);
    button.textContent = copy.addedToCart;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('product-list-widget: add to cart failed', e);
    button.textContent = copy.addToCart;
    button.removeAttribute('aria-disabled');
  }
}

function createProductCta(product, copy) {
  const wrap = document.createElement('p');
  wrap.className = 'product-list-widget-cta button-container';
  const inStockColors = getAvailableColors(product);
  const singleColor = !hasVariants(product) || inStockColors.length <= 1;
  const link = document.createElement('a');
  link.href = product.url || '#';
  link.className = 'button emphasis';

  if (singleColor && product.sku) {
    link.textContent = copy.addToCart;
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await handleAddToCart(link, product, copy);
    });
  } else {
    link.textContent = copy.viewDetails;
  }
  wrap.appendChild(link);
  return wrap;
}

function singleColorCard(product) {
  const inStockColors = getAvailableColors(product);
  return !hasVariants(product) || inStockColors.length <= 1;
}

function createProductListCard(product, ph, copy) {
  const card = document.createElement('div');
  card.className = 'product-list-widget-product-card';
  card.setAttribute('role', 'listitem');

  const imageWrap = createProductImage(product);
  imageWrap.append(createCallouts(product, copy), createCompareButton(product, copy));

  const title = createProductTitle(product);
  const colors = createProductColors(product);
  const reviews = createProductReviews(product);
  const bullets = createProductBullets(product);
  const price = createProductPrice(product, ph);
  const cta = createProductCta(product, copy);

  card.append(imageWrap, title, colors, reviews, bullets, price, cta);

  card.addEventListener('click', (e) => {
    if (e.target.closest('button, a.button')) return;
    const swatch = e.target.closest('[data-color]');
    const detailsLink = cta.querySelector('a');
    if (swatch && detailsLink) {
      const url = new URL(detailsLink.href, window.location.origin);
      url.searchParams.set('color', swatch.dataset.color);
      window.location.href = url.href;
      return;
    }
    if (detailsLink && !singleColorCard(product)) detailsLink.click();
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
  const params = new URLSearchParams(window.location.search);
  params.forEach((value, key) => {
    if (FILTER_PARAM_KEYS.includes(key)) config[key] = value.trim();
  });
  return config;
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
  window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
}

function countActiveFilters(filterConfig, baseConfig) {
  return FACET_KEYS.reduce((count, key) => {
    const val = filterConfig[key];
    if (!val || val === baseConfig[key]) return count;
    return count + val.split(',').filter(Boolean).length;
  }, 0);
}

function getSelectedFilterTags(filterConfig, baseConfig) {
  const tags = [];
  FACET_KEYS.forEach((key) => {
    const val = filterConfig[key];
    if (!val || val === baseConfig[key]) return;
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

function syncFilterConfigToUrl(filterConfig) {
  const params = new URLSearchParams();
  Object.entries(filterConfig).forEach(([key, value]) => {
    const v = value != null ? String(value).trim() : '';
    if (v) params.set(key, v);
  });
  const search = params.toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ''}`;
  window.history.replaceState(null, '', url);
}

function wireLifestyleCards(widget, runSearch, getFilterConfig, setFilterConfig) {
  const cards = widget.querySelectorAll('.product-list-lifestyle-card');
  cards.forEach((card) => {
    card.addEventListener('click', () => {
      const next = { ...getFilterConfig() };
      cards.forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');

      Object.keys(next).forEach((key) => {
        if (FACET_KEYS.includes(key)) delete next[key];
      });

      [...card.attributes].forEach((attr) => {
        if (!attr.name.startsWith('data-filter-')) return;
        const facetKey = toCamelCase(attr.name.replace('data-filter-', ''));
        next[facetKey] = attr.value;
      });

      setFilterConfig(next);
      runSearch(next);
    });
  });
}

function renderFilterTags(container, tags, copy, onRemove) {
  container.innerHTML = '';
  if (!tags.length) return;
  tags.forEach(({ key, value }) => {
    const tag = document.createElement('button');
    tag.type = 'button';
    tag.className = 'product-list-widget-filter-tag';
    tag.textContent = value;
    tag.setAttribute('aria-label', `${copy.clearAll}: ${value}`);
    tag.addEventListener('click', () => onRemove(key, value));
    container.appendChild(tag);
  });
}

function renderDrawerFacets(listEl, facets, filterConfig, copy, ph, onChange) {
  listEl.innerHTML = '';
  DRAWER_FACET_GROUPS.forEach(({ key, labelKey }) => {
    const facetValues = Object.keys(facets[key] || {}).sort((a, b) => a.localeCompare(b));
    const visibleValues = key === 'categories'
      ? facetValues.filter((v) => !HIDDEN_CATEGORIES.includes(v))
      : facetValues;
    if (!visibleValues.length) return;

    const details = document.createElement('details');
    details.className = 'product-list-widget-facet-group';
    details.open = (filterConfig[key] || '').length > 0;

    const summary = document.createElement('summary');
    summary.textContent = copy[labelKey] || ph[key] || key;
    details.appendChild(summary);

    const options = document.createElement('div');
    options.className = 'product-list-widget-facet-options';
    const selected = (filterConfig[key] || '').split(',').map((t) => t.trim());

    visibleValues.forEach((facetValue) => {
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
      label.textContent = `${facetValue} (${facets[key][facetValue]})`;
      options.append(input, label);
    });

    details.appendChild(options);
    listEl.appendChild(details);
  });
}

function renderDropdownFilters(container, facets, filterConfig, copy, ph, onSelect) {
  container.innerHTML = '';
  DROPDOWN_FACET_GROUPS.forEach(({ key, labelKey }) => {
    const facetValues = Object.keys(facets[key] || {}).sort((a, b) => a.localeCompare(b));
    if (!facetValues.length) return;

    const details = document.createElement('details');
    details.className = 'product-list-widget-filter-dropdown';

    const summary = document.createElement('summary');
    const selected = (filterConfig[key] || '').split(',').map((t) => t.trim()).filter(Boolean);
    summary.textContent = selected[0] || copy[labelKey] || ph[key] || key;
    details.appendChild(summary);

    const menu = document.createElement('menu');
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.textContent = copy.viewAll;
    allBtn.addEventListener('click', () => onSelect(key, null));
    menu.appendChild(allBtn);

    facetValues.forEach((facetValue) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${facetValue} (${facets[key][facetValue]})`;
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

function setDrawerInputsFromConfig(widget, filterConfig) {
  widget.querySelectorAll('.product-list-facet-drawer input[type="checkbox"]').forEach((input) => {
    const selected = (filterConfig[input.name] || '').split(',').map((t) => t.trim());
    input.checked = selected.includes(input.value);
  });
}

async function loadBazaarvoice(ph) {
  if (window.bvCallback) return;
  window.bvCallback = () => {};
  const lang = ph.languageCode || 'en_US';
  await loadScript(`https://apps.bazaarvoice.com/deployments/vitamix/main_site/production/${lang}/bv.js`);
}

/**
 * Decorates the product-list widget with lifestyle filters, facet UI, and enhanced product cards.
 * @param {HTMLElement} widget - Widget root element
 */
export default async function decorate(widget) {
  stripQueryParams(['show']);
  delete widget.dataset.show;
  const { locale, language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadWidgetCopy(lang);
  const ph = await fetchPlaceholders(`/${locale}/${language}/products/config`);
  const baseConfig = buildInitialConfig(widget);
  widget.productListFilterConfig = { ...baseConfig };
  widget.productListBaseConfig = { ...baseConfig };

  loadCSS(`${window.hlx?.codeBasePath || ''}/widgets/product-list/product-list.css`);
  loadCSS(`${window.hlx?.codeBasePath || ''}/styles/color-swatches.css`);

  const lifestyleHeading = widget.querySelector('.product-list-lifestyle-heading');
  const recommenderLink = widget.querySelector('.product-list-lifestyle-recommender');
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

  lifestyleHeading.textContent = copy.shopByLifestyle;
  if (recommenderLink) {
    recommenderLink.textContent = copy.blenderRecommender;
    recommenderLink.href = `/${locale}/${language}/blender-recommender`;
  }
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
    name: copy.productName,
  };
  sortButtons.forEach((btn) => {
    btn.textContent = sortLabels[btn.dataset.sort] || btn.dataset.sort;
  });

  const lifestyleSection = widget.querySelector('.product-list-lifestyle');
  const lifestyleCarousel = widget.querySelector('.product-list-lifestyle-carousel');
  if (widget.dataset.highlights) {
    const fragment = await loadFragment(`/${locale}/${language}/${widget.dataset.highlights}`);
    if (fragment && lifestyleCarousel) lifestyleCarousel.replaceChildren(...fragment.childNodes);
    else if (lifestyleSection) lifestyleSection.hidden = true;
  } else if (lifestyleSection) {
    lifestyleSection.hidden = true;
  }

  const getFilterConfig = () => ({ ...widget.productListFilterConfig });
  const setFilterConfig = (config) => {
    widget.productListFilterConfig = { ...config };
  };

  let runSearch;

  const updateFilterUi = (filterConfig, facets) => {
    const activeCount = countActiveFilters(filterConfig, widget.productListBaseConfig);
    filtersCount.textContent = activeCount ? `(${activeCount})` : '';
    const tags = getSelectedFilterTags(filterConfig, widget.productListBaseConfig);
    activeFilters.hidden = tags.length === 0;
    renderFilterTags(filterTags, tags, copy, (key, value) => {
      const next = removeFilterValue(getFilterConfig(), key, value);
      setFilterConfig(next);
      setDrawerInputsFromConfig(widget, next);
      runSearch(next);
    });
    renderDrawerFacets(drawerList, facets, filterConfig, copy, ph, () => {});
    renderDropdownFilters(filterDropdowns, facets, filterConfig, copy, ph, (key, value) => {
      const next = { ...getFilterConfig() };
      if (value) next[key] = value;
      else delete next[key];
      setFilterConfig(next);
      setDrawerInputsFromConfig(widget, next);
      runSearch(next);
    });
  };

  const displayResults = (results) => {
    resultsEl.innerHTML = '';
    if (!results.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    results.forEach((product) => {
      resultsEl.appendChild(createProductListCard(product, ph, copy));
    });
    loadBazaarvoice(ph);
  };

  runSearch = async (filterConfig = getFilterConfig()) => {
    const facets = FACET_KEYS.reduce((acc, key) => ({ ...acc, [key]: {} }), {});
    const results = await lookupProductListProducts(filterConfig, facets);
    const sortKey = sortByEl.dataset.sort || 'featured';
    const sorts = {
      name: (a, b) => a.title.localeCompare(b.title),
      'price-asc': (a, b) => Number(a.price) - Number(b.price),
      'price-desc': (a, b) => Number(b.price) - Number(a.price),
      featured: (a, b) => Number(b.price) - Number(a.price),
    };
    results.sort(sorts[sortKey] || sorts.featured);
    countEl.textContent = String(results.length);
    displayResults(results);
    updateFilterUi(filterConfig, facets);
    syncFilterConfigToUrl(filterConfig);
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
    widget.querySelectorAll('.product-list-lifestyle-card').forEach((c) => c.classList.remove('selected'));
    runSearch(widget.productListBaseConfig);
  });

  wireLifestyleCards(widget, runSearch, getFilterConfig, setFilterConfig);
  await runSearch(getFilterConfig());
}
