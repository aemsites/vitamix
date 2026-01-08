/* eslint-disable max-len */
import {
  fetchPlaceholders,
  readBlockConfig,
  toClassName,
  toCamelCase,
  buildBlock,
  decorateBlock,
  loadBlock,
} from '../../scripts/aem.js';

import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/**
 * Constructs a localized product URL path.
 * @param {string} locale - Locale code
 * @param {string} language - Language code
 * @param {string} path - Product-specific path or URL key
 * @returns {string} Fully constructed product URL path
 */
function buildProductsUrl(locale, language, path) {
  return `/${locale}/${language}/products/${path}`;
}

/**
 * Parses raw product data from index and transforms values.
 * @param {Object} data - Raw product data object from the product index
 * @param {string} locale - Locale code
 * @param {string} language - Language code
 * @returns {Object} Parsed product object with transformed values
 */
function parseData(data, locale, language) {
  const parsed = {};
  Object.entries(data).forEach(([key, value]) => {
    switch (key) {
      case 'image':
        // convert relative image paths to full localized URLs
        parsed[key] = value.startsWith('./') ? buildProductsUrl(locale, language, value.substring(2)) : value;
        break;
      case 'price':
      case 'regularPrice':
        // convert price strings to numeric values
        parsed[key] = parseFloat(value, 10);
        break;
      case 'categories':
      case 'categoriesUrlKey':
      case 'collections':
      case 'productType':
      case 'series':
      case 'variantSkus':
      case 'visibility':
        // split comma-separated values into trimmed arrays
        parsed[key] = value ? value.split(',').map((s) => s.trim()) : [];
        break;
      default:
        parsed[key] = value.trim();
        break;
    }
  });
  if (parsed.collections) parsed.collection = parsed.collections; // hacky
  return parsed;
}

/**
 * Fetches and filters products from the product index.
 * @param {Array<string>|Object} config - Array of product URL paths or object with filter criteria
 * @param {Object} facets - Optional object to populate with facet counts for UI filters.
 * @returns {Promise<Array<Object>>} Array of filtered parent product objects (with nested variants)
 */
export async function lookupProducts(config, facets = {}) {
  const { locale, language } = await getLocaleAndLanguage();
  const corsProxyFetch = async (url) => {
    const corsProxy = 'https://fcors.org/?url=';
    const corsKey = '&key=Mg23N96GgR8O3NjU';
    const fullUrl = `https://main--vitamix--aemsites.aem.network${url}`;
    return fetch(`${corsProxy}${encodeURIComponent(fullUrl)}${corsKey}`);
  };

  if (!window.productIndex) {
    // fetch the main product index
    const isProd = window.location.hostname.includes('vitamix.com') || window.location.hostname.includes('.aem.network');
    const pathname = `/${locale}/${language}/products/index.json?include=all`;
    const resp = await (isProd ? fetch(pathname) : corsProxyFetch(pathname));
    const { data } = await resp.json();

    // separate products into parents (standalone products) and variants (color/style options)
    const parentProductsBySKU = {};
    const variants = [];
    const orphanedProducts = [];

    // categorize all products as either parents or variants
    data.forEach((d) => {
      const product = parseData(d, locale, language);

      if (product.sku && !product.parentSku) {
        // products without a parentSku are standalone parent products
        parentProductsBySKU[product.sku] = product;
      } else {
        // products with a parentSku are variants
        variants.push(product);
      }
    });

    // attach variants to their parent products
    variants.forEach((variant) => {
      const parent = parentProductsBySKU[variant.parentSku];
      if (parent) {
        // add variant to parent's variants array
        parent.variants = parent.variants || [];
        parent.variants.push(variant);
        // add variant color to parent's colors array
        parent.colors = parent.colors || [];
        parent.colors.push(variant.color);
      } else {
        // variant references a parent SKU that doesn't exist in the index
        orphanedProducts.push(variant);
        // eslint-disable-next-line no-console
        console.warn(variant.sku, 'has no parent product');
      }
    });

    // build a URL-based lookup table
    const urlLookup = {};

    Object.values(parentProductsBySKU).forEach((product) => {
      if (product.urlKey) {
        const url = buildProductsUrl(locale, language, product.urlKey);
        urlLookup[url] = product;
        product.url = url;
      } else {
        // product is missing a URL key and won't be accessible via URL
        // eslint-disable-next-line no-console
        console.warn(product.sku, 'has no URL key');
      }
    });

    window.productIndex = {
      data, // raw product data
      lookup: urlLookup, // URL-based product lookup
      parents: Object.values(parentProductsBySKU), // all parent products with variants
    };
  }

  // simple array lookup: return products by their URL paths
  if (Array.isArray(config)) {
    const pathnames = config;
    // filter out any paths that don't exist in the index
    return (pathnames.map((path) => window.productIndex.lookup[path]).filter((e) => e));
  }

  // filtering mode: filter products by multiple criteria and calculate facet counts

  // extract all facet keys from the facets object for dynamic filter UI
  const facetKeys = Object.keys(facets);

  // extract all filter criteria keys from the config object
  const filterKeys = Object.keys(config);

  // map singular filter names to their plural product property names
  const cleanKeys = {
    category: 'categories',
    collection: 'collections',
  };

  // parse comma-separated filter values into trimmed token arrays for matching
  const tokens = {};
  filterKeys.forEach((key) => {
    tokens[key] = config[key].split(',').map((t) => t.trim());
  });
  // filter products based on all configured criteria (must match ALL filters)
  const results = window.productIndex.parents.filter((product) => {
    // track which individual filters matched for this product
    const filterMatches = {};

    // check if this product matches ALL the filter criteria
    const matchedAll = filterKeys.every((filterKey) => {
      // map the filter key to the actual product property name (e.g., category -> categories)
      const key = cleanKeys[filterKey] || filterKey;
      let matched = false;

      // array-based filter matching (categories, productType, etc.)
      if (product[key]) {
        // product matches if ANY of its values match ANY of the filter tokens
        matched = tokens[filterKey].some((t) => product[key].includes(t));
      }

      // special case: full-text search on product title
      if (key === 'fulltext') {
        const fulltext = product.title.toLowerCase();
        matched = fulltext.includes(config.fulltext.toLowerCase());
      }

      // store whether this specific filter matched for facet counting
      filterMatches[filterKey] = matched;

      return matched;
    });

    // calculate facet counts for the filter UI (e.g., "Red (5)", "Blue (3)")
    facetKeys.forEach((facetKey) => {
      // intelligent facet counting: include products that match ALL OTHER filters
      let includeInFacet = true;
      Object.keys(filterMatches).forEach((filterKey) => {
        // exclude this product from facet count if any OTHER filter didn't match
        if (filterKey !== facetKey && !filterMatches[filterKey]) includeInFacet = false;
      });

      // if this product qualifies for inclusion in the facet counts
      if (includeInFacet) {
        // check if the product has any values for this facet field
        if (product[facetKey]) {
          product[facetKey].forEach((val) => {
            if (facets[facetKey][val]) {
              // increment existing count
              facets[facetKey][val] += 1;
            } else {
              // initialize count for a new facet value
              facets[facetKey][val] = 1;
            }
          });
        }
      }
    });

    return (matchedAll);
  });
  return results;
}

/**
 * Checks if a product has any variants.
 * @param {Object} product - Product data object
 * @returns {boolean} `true` if the product has at least one variant
 */
function hasVariants(product) {
  return product.variants && product.variants.length > 0;
}

/**
 * Creates a product image element with lazy loading.
 * @param {Object} product - Product data object
 * @returns {HTMLImageElement} Product image element
 */
function createProductImage(product) {
  const img = document.createElement('img');
  img.loading = 'lazy';
  if (hasVariants(product)) {
    const variant = product.variants[0];
    const { image, title } = variant;
    if (image) img.src = image;
    if (title) img.alt = title;
  }
  if (!img.src) img.src = product.image || '';
  if (!img.alt) img.alt = product.title || '';
  return img;
}

/**
 * Creates a product title heading with a link to the product page.
 * @param {Object} product - Product data object
 * @param {string} h - HTML heading tag to use (default: 'h4')
 * @returns {HTMLHeadingElement} Product title element
 */
function createProductTitle(product, h = 'h4') {
  const title = document.createElement(h);
  const link = document.createElement('a');
  link.href = product.url || '#';
  link.textContent = product.title || '';
  title.appendChild(link);
  return title;
}

/**
 * Creates a product price display element.
 * @param {Object} product - Product data object
 * @returns {HTMLParagraphElement} Product price element
 */
function createProductPrice(product) {
  const price = document.createElement('p');
  price.className = 'plp-price';
  price.textContent = product.price ? `$${product.price}` : '';
  return price;
}

/**
 * Creates color swatches showing available colors and their availability status.
 * @param {Object} product - Product data object with colors and availability
 * @returns {HTMLDivElement} Container element with color swatches
 */
function createProductColors(product) {
  const COLOR_ORDER = {
    /* black */
    black: 1,
    'shadow-black': 1,
    1100001: 1,
    1100002: 1,
    'black-stainless-metal-finish': 1,
    /* red */
    red: 2,
    'candy-apple': 2,
    'candy-apple-red': 2,
    ruby: 2,
    /* white */
    white: 3,
    'polar-white': 3,
    /* gray */
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
    /* tan */
    espresso: 5,
    'copper-metal-finish': 5,
    reflection: 5,
    'brushed-stainless-metal-finish': 5,
    'brushed-gold': 5,
    cream: 5,
  };

  const colors = document.createElement('div');
  colors.className = 'plp-colors';
  if (hasVariants(product)) {
    const sortedVariants = [...product.variants].sort((a, b) => {
      const colorA = COLOR_ORDER[toClassName(a.color)] ?? 9;
      const colorB = COLOR_ORDER[toClassName(b.color)] ?? 9;
      return colorA - colorB;
    });

    sortedVariants.forEach((variant) => {
      const { color, availability } = variant;
      if (color) {
        const colorSwatch = document.createElement('div');
        colorSwatch.className = 'plp-color-swatch';
        colorSwatch.title = color;
        colorSwatch.dataset.color = toClassName(color);
        const colorInner = document.createElement('div');
        colorInner.className = 'plp-color-inner';
        colorInner.style.backgroundColor = `var(--color-${toClassName(color)})`;
        colorSwatch.appendChild(colorInner);
        colors.appendChild(colorSwatch);
        // mark out-of-stock colors
        if (availability !== 'InStock') {
          colorInner.classList.add('plp-color-swatch-oos');
        }
      }
    });
  }
  return colors;
}

/**
 * Creates a button element for product actions.
 * @param {Object} product - Product data object
 * @param {Object} ph - Placeholder object with localized text strings
 * @param {string} label - Button label text used for CSS class and placeholder lookup
 * @param {string} btnClass - Additional CSS class for the button (optional)
 * @returns {HTMLParagraphElement} Button container element
 */
function createProductButton(product, ph, label, btnClass) {
  const button = document.createElement('p');
  button.classList.add(`plp-${toClassName(label)}`, 'button-container');
  button.innerHTML = `<a href="${product.url}" class="button ${btnClass}">${ph[toCamelCase(label)]}</a>`;
  return button;
}

/**
 * Creates a product card DOM element for display in the product listing.
 * @param {Object} product - Product data object with title, price, colors, etc.
 * @param {Object} ph - Placeholder object with localized text strings
 * @returns {HTMLElement} Product card element
 */
function createProductCard(product, ph) {
  const card = document.createElement('div');
  card.className = 'plp-product-card';

  const image = createProductImage(product);
  const title = createProductTitle(product);
  const price = createProductPrice(product);
  const colors = createProductColors(product);
  const viewDetails = createProductButton(product, ph, 'View Details', 'emphasis');
  const compare = createProductButton(product, ph, 'Compare');

  card.append(image, title, price, colors, viewDetails, compare);
  card.addEventListener('click', (e) => {
    const { target } = e;
    const color = target.closest('[data-color]');
    if (color) {
      const { href } = viewDetails.querySelector('a');
      const url = new URL(href, window.location.origin);
      url.searchParams.set('color', color.dataset.color);
      window.location.href = url.href;
    } else {
      viewDetails.querySelector('a').click();
    }
  });

  return card;
}

/**
 * Transforms a row of authored content into a styled carousel slide with product data.
 * @param {HTMLElement} content - Row element containing image and body content
 * @param {Object} ph - Placeholder object with localized text strings
 * @returns {Promise<void>}
 */
async function styleRowAsSlide(content, ph) {
  const [image, body] = content.children;
  const link = body.querySelector('a[href]');
  link.parentElement.remove();
  const { pathname } = new URL(link.href);
  const [product] = await lookupProducts([pathname]);

  // replace or add product image with lazy loading
  let img = image.querySelector('picture');
  if (!img) {
    img = createProductImage(product);
    image.replaceChildren(img);
  }

  // product title as a link to PDP
  let title = body.querySelector('h2, h3, h4, h5, h6');
  if (!title) {
    title = createProductTitle(product, 'h3');
    body.prepend(title);
  }

  // color options
  const colors = createProductColors(product);
  if (colors && colors.children.length > 0) {
    const colorOptions = document.createElement('p');
    colorOptions.className = 'eyebrow';
    colorOptions.textContent = ph.colorOptions || 'Color options';
    body.insertBefore(colorOptions, title.nextSibling);
    body.insertBefore(colors, colorOptions.nextSibling);
  }

  // footer
  const footer = document.createElement('div');
  footer.className = 'slide-footer';

  // starting at price
  if (product.price) {
    const startingAt = document.createElement('p');
    startingAt.className = 'eyebrow';
    startingAt.textContent = ph.startingAt || 'Starting at';

    const price = createProductPrice(product);
    if (product.regularPrice && product.regularPrice > product.price) {
      const savings = (product.regularPrice - product.price).toFixed(2);
      const saleInfo = document.createElement('span');
      saleInfo.textContent = `| ${ph.save || 'Save'} $${savings}`;
      const regularPrice = document.createElement('del');
      regularPrice.textContent = `$${product.regularPrice}`;
      saleInfo.prepend(regularPrice);
      price.append(saleInfo);
    }

    footer.append(startingAt, price);
  }

  // "Shop Now" button
  const shopNow = createProductButton(product, ph, 'Shop Now');
  footer.append(shopNow);
  body.append(footer);
}

/**
 * Builds a product carousel from a block containing product links.
 * Transforms each row into a styled slide and wraps them in a carousel block.
 * @param {HTMLElement} block - PLP block element with product rows
 * @param {Object} ph - Placeholder object with localized text strings
 * @returns {Promise<void>}
 */
async function buildProductCarousel(block, ph) {
  const rows = [...block.children];
  await Promise.all(rows.map((row) => styleRowAsSlide(row, ph)));

  const elems = [...block.children].map((row) => (
    [...row.children].map((cell) => ({ elems: [...cell.children] }))
  ));
  const carousel = buildBlock('carousel', elems);
  carousel.classList.add(...block.classList);
  block.replaceWith(carousel);
  decorateBlock(carousel);
  await loadBlock(carousel);
  carousel.addEventListener('click', (e) => {
    const { target } = e;
    const slide = target.closest('li.carousel-slide');
    if (slide) {
      const link = slide.querySelector('a[href]');
      const color = target.closest('[data-color]');
      if (color) {
        const url = new URL(link.href, window.location.origin);
        url.searchParams.set('color', color.dataset.color);
        window.location.href = url.href;
      } else if (link) {
        link.click();
      }
    }
  });
}

/**
 * Builds complete product listing page with filtering, sorting, and search functionality.
 * @param {HTMLElement} block - PLP block element to transform into a product listing
 * @param {Object} ph - Placeholder object with localized text strings for UI labels
 * @param {Object} config - Initial filter configuration from block config
 * @returns {void}
 */
function buildFiltering(block, ph, config) {
  block.innerHTML = `<div class="plp-controls">
      <input id="fulltext" placeholder="${ph.typeToSearch}">
      <p class="plp-results-count"><span id="plp-results-count"></span> ${ph.results}</p>
      <button class="plp-filter-button secondary">${ph.filter}</button>
      <button class="plp-sort-button secondary">${ph.sort}</button>
    </div>
    <div class="plp-facets"></div>
    <div class="plp-sortby">
      <p>${ph.sortBy} <span data-sort="featured" id="plp-sortby">${ph.featured}</span></p>
      <ul>
        <li data-sort="featured">${ph.featured}</li>
        <li data-sort="price-desc">${ph.priceHighToLow}</li>
        <li data-sort="price-asc">${ph.priceLowToHigh}</li>
        <li data-sort="name">${ph.productName}</li>
      </ul>
    </div>
    <div class="plp-results"></div>`;

  const resultsElement = block.querySelector('.plp-results');
  const facetsElement = block.querySelector('.plp-facets');
  block.querySelector('.plp-filter-button').addEventListener('click', () => {
    block.querySelector('.plp-facets').classList.toggle('visible');
  });

  // utility function to add the same event listener to multiple elements
  const addEventListeners = (elements, event, callback) => {
    elements.forEach((e) => {
      e.addEventListener(event, callback);
    });
  };

  addEventListeners([
    block.querySelector('.plp-sort-button'),
    block.querySelector('.plp-sortby p'),
  ], 'click', () => {
    block.querySelector('.plp-sortby ul').classList.toggle('visible');
  });

  const sortList = block.querySelector('.plp-sortby ul');
  const selectSort = (selected) => {
    [...sortList.children].forEach((li) => li.classList.remove('selected'));
    selected.classList.add('selected');
    const sortBy = document.getElementById('plp-sortby');
    sortBy.textContent = selected.textContent;
    sortBy.dataset.sort = selected.dataset.sort;
    block.querySelector('.plp-sortby ul').classList.remove('visible');
    // eslint-disable-next-line no-use-before-define
    runSearch(createFilterConfig());
  };

  sortList.addEventListener('click', (event) => {
    selectSort(event.target);
  });

  // highlights search terms in product titles by wrapping matches in a span.
  const highlightResults = (res) => {
    const fulltext = document.getElementById('fulltext').value;
    if (fulltext) {
      res.querySelectorAll('h4').forEach((title) => {
        const content = title.textContent;
        const offset = content.toLowerCase().indexOf(fulltext.toLowerCase());
        if (offset >= 0) {
          title.innerHTML = `${content.substring(0, offset)}<span class="highlight">${content.substring(offset, offset + fulltext.length)}</span>${content.substring(offset + fulltext.length)}`;
        }
      });
    }
  };

  // renders product cards to the results area and highlights search terms
  const displayResults = async (results) => {
    resultsElement.innerHTML = '';
    results.forEach((product) => {
      resultsElement.append(createProductCard(product, ph));
    });
    highlightResults(resultsElement);
  };

  // gets all currently selected filter checkboxes
  const getSelectedFilters = () => [...block.querySelectorAll('input[type="checkbox"]:checked')];

  // creates a filter configuration object from selected filters and search input
  const createFilterConfig = () => {
    const filterConfig = { ...config };
    getSelectedFilters().forEach((checked) => {
      const facetKey = checked.name;
      const facetValue = checked.value;
      if (filterConfig[facetKey]) filterConfig[facetKey] += `, ${facetValue}`;
      else filterConfig[facetKey] = facetValue;
    });
    filterConfig.fulltext = document.getElementById('fulltext').value;
    return (filterConfig);
  };

  // renders the filter facets UI with checkboxes, selected filter tags, and counts
  const displayFacets = (facets, filters) => {
    const selected = getSelectedFilters().map((check) => check.value);
    facetsElement.innerHTML = `<div>
        <div class="plp-filters">
          <h2>${ph.filters}</h2>
          <div class="plp-filters-selected"></div>
          <p><button class="plp-filters-clear secondary">${ph.clearAll}</button></p>
          <div class="plp-filters-facetlist"></div>
        </div>
        <div class="plp-apply-filters">
          <button>See Results</button>
        </div>
      </div>`;

    addEventListeners([
      facetsElement.querySelector('.plp-apply-filters button'),
      facetsElement.querySelector(':scope > div'),
      facetsElement,
    ], 'click', (event) => {
      if (event.currentTarget === event.target) block.querySelector('.plp-facets').classList.remove('visible');
    });

    const selectedFilters = block.querySelector('.plp-filters-selected');
    selected.forEach((tag) => {
      const span = document.createElement('span');
      span.className = 'plp-filters-tag';
      span.textContent = tag;
      span.addEventListener('click', () => {
        document.getElementById(`plp-filter-${tag}`).checked = false;
        const filterConfig = createFilterConfig();
        // eslint-disable-next-line no-use-before-define
        runSearch(filterConfig);
      });
      selectedFilters.append(span);
    });

    facetsElement.querySelector('.plp-filters-clear').addEventListener('click', () => {
      selected.forEach((tag) => {
        document.getElementById(`plp-filter-${tag}`).checked = false;
      });
      const filterConfig = createFilterConfig();
      // eslint-disable-next-line no-use-before-define
      runSearch(filterConfig);
    });

    // build facet filter lists
    const facetsList = block.querySelector('.plp-filters-facetlist');
    const facetKeys = Object.keys(facets);
    facetKeys.forEach((facetKey) => {
      const filter = filters[facetKey];
      const filterValues = filter ? filter.split(',').map((t) => t.trim()) : [];
      const div = document.createElement('div');
      div.className = 'plp-facet';
      const h3 = document.createElement('h3');
      h3.textContent = ph[facetKey];
      div.append(h3);
      const facetValues = Object.keys(facets[facetKey]).sort((a, b) => a.localeCompare(b));
      facetValues.forEach((facetValue) => {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = facetValue;
        input.checked = filterValues.includes(facetValue);
        input.id = `plp-filter-${facetValue}`;
        input.name = facetKey;
        const label = document.createElement('label');
        label.setAttribute('for', input.id);
        label.textContent = `${facetValue} (${facets[facetKey][facetValue]})`;
        div.append(input, label);
        input.addEventListener('change', () => {
          const filterConfig = createFilterConfig();
          // eslint-disable-next-line no-use-before-define
          runSearch(filterConfig);
        });
      });
      facetsList.append(div);
    });
  };

  // converts a price string to a numeric value for sorting
  const getPrice = (string) => +string;

  // main search function that filters, sorts, and displays products
  const runSearch = async (filterConfig = config) => {
    const facets = {
      series: {}, collection: {}, colors: {}, productType: {},
    };
    const sorts = {
      name: (a, b) => a.title.localeCompare(b.title),
      'price-asc': (a, b) => getPrice(a.price) - getPrice(b.price),
      'price-desc': (a, b) => getPrice(b.price) - getPrice(a.price),
      featured: (a, b) => getPrice(b.price) - getPrice(a.price),
    };
    const results = await lookupProducts(filterConfig, facets);
    const sortBy = document.getElementById('plp-sortby') ? document.getElementById('plp-sortby').dataset.sort : 'featured';
    results.sort(sorts[sortBy]);
    block.querySelector('#plp-results-count').textContent = results.length;
    displayResults(results, null);
    displayFacets(facets, filterConfig);
  };

  const fulltextElement = block.querySelector('#fulltext');
  fulltextElement.addEventListener('input', () => {
    runSearch(createFilterConfig());
  });

  if (!Object.keys(config).includes('fulltext')) {
    fulltextElement.style.display = 'none';
  }

  runSearch(config);
}

export default async function decorate(block) {
  const { locale, language } = await getLocaleAndLanguage();
  const ph = await fetchPlaceholders(`/${locale}/${language}/products/config`);
  const config = readBlockConfig(block);
  const isCarousel = block.classList.contains('carousel');

  if (isCarousel) await buildProductCarousel(block, ph);
  else buildFiltering(block, ph, config);
}
