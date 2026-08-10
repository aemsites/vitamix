/* eslint-disable max-len */
import {
  fetchPlaceholders, toClassName, buildBlock, decorateBlock, loadBlock,
} from '../../scripts/aem.js';
import { getLocaleAndLanguage, formatPrice } from '../../scripts/scripts.js';
import {
  createCallouts, createStarRating, fetchReviewsData, getReviewsBySlug, slugFromUrl,
} from '../../scripts/product-badges.js';

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
 * Parses a raw product-index row, transforming price/array fields.
 * @param {Object} data - Raw product data object from the product index
 * @param {string} locale - Locale code
 * @param {string} language - Language code
 * @returns {Object} Parsed product object with transformed values
 */
function parseProduct(data, locale, language) {
  const parsed = {};
  Object.entries(data).forEach(([key, value]) => {
    switch (key) {
      case 'image':
        parsed[key] = value.startsWith('./') ? buildProductsUrl(locale, language, value.substring(2)) : value;
        break;
      case 'price':
      case 'regularPrice':
      case 'originalPrice':
        parsed[key] = parseFloat(value, 10);
        break;
      case 'collections':
      case 'variantSkus':
      case 'visibility':
        parsed[key] = value ? value.split(',').map((s) => s.trim()) : [];
        break;
      default:
        parsed[key] = typeof value === 'string' ? value.trim() : value;
        break;
    }
  });
  return parsed;
}

/**
 * Resolves authored product links to full product objects, lazily building and caching a URL-keyed product index.
 * @param {Array<string>} pathnames - Product pathnames to resolve
 * @returns {Promise<Array<Object>>} Matching parent product objects
 */
async function lookupProducts(pathnames) {
  const { locale, language } = getLocaleAndLanguage();

  if (!window.productRowIndex) {
    const corsProxyFetch = async (url) => {
      const corsProxy = 'https://fcors.org/?url=';
      const corsKey = '&key=Mg23N96GgR8O3NjU';
      const fullUrl = `https://main--vitamix--aemsites.aem.network${url}`;
      return fetch(`${corsProxy}${encodeURIComponent(fullUrl)}${corsKey}`);
    };

    const isProd = window.location.hostname.includes('vitamix.com') || window.location.hostname.includes('.aem.network');
    const indexPath = window.location.pathname.includes('/commercial/') ? 'commercial/products' : 'products';
    const indexUrl = `/${locale}/${language}/${indexPath}/index.json?include=all`;
    const resp = await (isProd ? fetch(indexUrl) : corsProxyFetch(indexUrl));
    const { data } = await resp.json();
    if (!isProd && resp.ok) {
      data.forEach((product) => {
        if (product.image) product.image = `https://main--vitamix--aemsites.aem.network/${locale}/${language}/products/${product.image.substring(2)}`;
      });
    }

    const reviewsBySlug = getReviewsBySlug(await fetchReviewsData(locale, language));

    const parentsBySku = {};
    const variants = [];
    data.forEach((d) => {
      const product = parseProduct(d, locale, language);
      if (product.sku && !product.parentSku) parentsBySku[product.sku] = product;
      else variants.push(product);
    });

    variants.forEach((variant) => {
      const parent = parentsBySku[variant.parentSku];
      if (!parent) return;
      parent.variants = parent.variants || [];
      parent.variants.push(variant);
      parent.colors = parent.colors || [];
      parent.colors.push(variant.color);
    });

    const urlLookup = {};
    Object.values(parentsBySku).forEach((product) => {
      let url;
      if (product.url) url = new URL(product.url, window.location.origin).pathname;
      else if (product.urlKey) url = buildProductsUrl(locale, language, product.urlKey);
      if (!url) {
        // eslint-disable-next-line no-console
        console.warn(product.sku, 'has no URL key');
        return;
      }
      product.url = url;
      const reviews = reviewsBySlug[slugFromUrl(url)];
      product.reviewCount = reviews?.reviewCount ?? 0;
      product.reviewAverage = reviews?.reviewAverage ?? 0;
      urlLookup[url] = product;
    });

    window.productRowIndex = urlLookup;
  }

  return pathnames.map((path) => window.productRowIndex[path]).filter((e) => e);
}

/**
 * Checks whether a product has any color/style variants.
 * @param {Object} product - Product data object
 * @returns {boolean} true if the product has at least one variant
 */
function hasVariants(product) {
  return product.variants && product.variants.length > 0;
}

/**
 * Builds an `<img>` element for a product, preferring its first variant's image if present.
 * @param {Object} product - Product data object
 * @returns {HTMLImageElement} Lazy-loaded product image element
 */
function createProductImage(product) {
  const img = document.createElement('img');
  img.loading = 'lazy';
  if (hasVariants(product)) {
    const variant = product.variants[0];
    if (variant.image) img.src = variant.image;
    if (variant.title) img.alt = variant.title;
  }
  if (!img.src) img.src = product.image || '';
  if (!img.alt) img.alt = product.title || '';
  return img;
}

/**
 * Builds an `<h3>` product title linking to the product's PDP.
 * @param {Object} product - Product data object
 * @returns {HTMLHeadingElement} Product title element
 */
function createProductTitle(product) {
  const title = document.createElement('h3');
  const link = document.createElement('a');
  link.href = product.url || '#';
  link.textContent = product.title || '';
  title.appendChild(link);
  return title;
}

/**
 * Builds a row of color swatches for a product's variants, sorted by COLOR_ORDER.
 * @param {Object} product - Product data object with variants
 * @returns {HTMLDivElement} `.colors` container with one swatch per available color
 */
function createProductColors(product) {
  const colors = document.createElement('div');
  colors.className = 'colors';
  if (!hasVariants(product)) return colors;

  const sortedVariants = [...product.variants].sort((a, b) => {
    const colorA = COLOR_ORDER[toClassName(a.color)] ?? 9;
    const colorB = COLOR_ORDER[toClassName(b.color)] ?? 9;
    return colorA - colorB;
  });

  sortedVariants.forEach((variant) => {
    const { color, availability } = variant;
    if (!color) return;
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.title = color;
    swatch.dataset.color = toClassName(color);
    const inner = document.createElement('div');
    inner.className = 'color-swatch-inner';
    inner.style.backgroundColor = `var(--color-${toClassName(color)})`;
    if (availability !== 'InStock') inner.classList.add('color-swatch-oos');
    swatch.appendChild(inner);
    colors.appendChild(swatch);
  });
  return colors;
}

/**
 * Builds the price display, including a struck-through regular price and a "Save $X" tag when on sale.
 * @param {Object} product - Product data object
 * @param {Object} ph - Placeholder object with localized text
 * @returns {HTMLDivElement} `.price` element
 */
function createProductPrice(product, ph) {
  const wrap = document.createElement('div');
  wrap.className = 'price';

  const price = document.createElement('p');
  price.textContent = product.price ? formatPrice(product.price, ph) : '';
  wrap.append(price);

  const regular = product.originalPrice || product.regularPrice;
  if (regular && regular > product.price) {
    const regularPrice = document.createElement('del');
    regularPrice.textContent = formatPrice(regular, ph);
    price.append(' ', regularPrice);

    const savings = (regular - product.price).toFixed(2);
    const save = document.createElement('span');
    save.className = 'product-badge product-badge-tier-alert save';
    save.textContent = `${ph.save || 'Save'} ${formatPrice(savings, ph)}`;
    wrap.append(save);
  }

  return wrap;
}

/**
 * Builds the "Shop Now" call-to-action link for a product.
 * @param {Object} product - Product data object
 * @param {Object} ph - Placeholder object with localized text
 * @returns {HTMLParagraphElement} Button container element
 */
function createShopNowButton(product, ph) {
  const p = document.createElement('p');
  p.className = 'shop-now button-container';
  const a = document.createElement('a');
  a.href = product.url || '#';
  a.className = 'button link';
  a.textContent = ph.shopNow || 'Shop Now';
  p.append(a);
  return p;
}

/**
 * Transforms one authored row into a styled slide populated with the resolved product's data.
 * @param {HTMLElement} row - Row element containing image and body cells
 * @param {Object} ph - Placeholder object with localized text/badge labels
 * @returns {Promise<void>}
 */
async function styleRowAsSlide(row, ph) {
  const [image, body] = row.children;
  if (!body) return;

  const link = body.querySelector('a[href]');
  if (!link) return;

  let pathname;
  try {
    pathname = new URL(link.href, window.location.origin).pathname;
  } catch {
    return;
  }

  const [product] = await lookupProducts([pathname]);
  if (!product) {
    link.classList.add('linkchecker-invalid-link');
    return;
  }
  link.parentElement.remove();

  const description = body.firstElementChild;
  if (description) description.classList.add('description');

  const img = image.querySelector('picture') || createProductImage(product);
  image.replaceChildren(img);
  const badges = createCallouts(product, ph);
  if (badges.children.length > 0) image.append(badges);

  const title = createProductTitle(product);
  body.prepend(title);

  const colors = createProductColors(product);
  if (colors.children.length > 0) title.after(colors);

  const rating = createStarRating(product);
  if (rating.children.length > 0) (colors.children.length > 0 ? colors : title).after(rating);

  const footer = document.createElement('div');
  footer.className = 'slide-footer';
  if (product.price) footer.append(createProductPrice(product, ph));
  footer.append(createShopNowButton(product, ph));
  body.append(footer);
}

/**
 * Wires slide-click (navigate to PDP) and swatch-click (navigate with ?color=) behavior.
 * @param {HTMLElement} container - Element containing `li.carousel-slide` items
 */
function wireSlideClicks(container) {
  container.addEventListener('click', (e) => {
    const { target } = e;
    const slide = target.closest('li.carousel-slide');
    if (!slide) return;
    const link = slide.querySelector('a[href]');
    const color = target.closest('[data-color]');
    if (color) {
      const url = new URL(link.href, window.location.origin);
      url.searchParams.set('color', color.dataset.color);
      window.location.href = url.href;
    } else if (link) {
      link.click();
    }
  });
}

/**
 * Assigns the same `.slide-image`/`.slide-body` classes the generic carousel block would assign.
 * @param {HTMLElement} row - Row element containing image and body cells
 */
function classifySlideCells(row) {
  const [image, body] = row.children;
  if (image) image.classList.add('slide-image');
  if (body) body.classList.add('slide-body');
}

/**
 * Transforms each row into a styled slide and wraps them in a generic carousel block.
 * @param {HTMLElement} block - product-row block element with product rows
 * @param {Object} ph - Placeholder object with localized text/badge labels
 * @returns {Promise<void>}
 */
async function buildProductRowCarousel(block, ph) {
  const rows = [...block.children];
  await Promise.all(rows.map((row) => styleRowAsSlide(row, ph)));

  const elems = [...block.children].map((row) => (
    [...row.children].map((cell) => ({ elems: [...cell.children] }))
  ));
  const carousel = buildBlock('carousel', elems);
  carousel.classList.add(...block.classList);
  if (![...carousel.classList].some((c) => c.startsWith('slides-'))) {
    carousel.classList.add('slides-4');
  }
  block.replaceWith(carousel);
  decorateBlock(carousel);
  await loadBlock(carousel);
  wireSlideClicks(carousel);
}

/**
 * Transforms each row into a styled slide and lays them out in a static, non-scrolling grid.
 * @param {HTMLElement} block - product-row block element with product rows
 * @param {Object} ph - Placeholder object with localized text/badge labels
 * @returns {Promise<void>}
 */
async function buildProductRowGrid(block, ph) {
  const rows = [...block.children];
  await Promise.all(rows.map((row) => styleRowAsSlide(row, ph)));
  rows.forEach(classifySlideCells);

  const ul = document.createElement('ul');

  rows.forEach((row) => {
    const li = document.createElement('li');
    li.className = 'carousel-slide';
    li.append(...row.children);
    ul.append(li);
  });

  block.replaceChildren(ul);
  wireSlideClicks(block);
}

export default async function decorate(block) {
  const { locale, language } = getLocaleAndLanguage();
  const ph = await fetchPlaceholders(`/${locale}/${language}/products/config`);
  const isCarousel = block.classList.contains('carousel');
  if (isCarousel) await buildProductRowCarousel(block, ph);
  else await buildProductRowGrid(block, ph);
}
