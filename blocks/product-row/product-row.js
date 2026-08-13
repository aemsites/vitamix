/* eslint-disable max-len */
import {
  fetchPlaceholders, toClassName, buildBlock, decorateBlock, loadBlock,
} from '../../scripts/aem.js';
import { getLocaleAndLanguage, formatPrice, buildVideo } from '../../scripts/scripts.js';
import {
  createCallouts, createStarRating, fetchReviewsData, getReviewsBySlug, slugFromUrl,
  fetchPlpData, getBadgesBySlug, PLP_DATASETS, fetchProductIndex, buildProductIndexBySlug,
} from '../../scripts/plp-data.js';

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
 * Resolves authored product links to full product objects, lazily building and caching a slug-keyed product index.
 * @param {Array<string>} pathnames - Product pathnames to resolve
 * @returns {Promise<Array<Object>>} Matching parent product objects
 */
async function lookupProducts(pathnames) {
  const { locale, language } = getLocaleAndLanguage();

  if (!window.productRowIndex) {
    const commercial = window.location.pathname.includes('/commercial/');
    const [data, reviewsRows, plpRowsByDataset] = await Promise.all([
      fetchProductIndex(locale, language, { commercial }),
      fetchReviewsData(locale, language),
      Promise.all(PLP_DATASETS.map((dataset) => fetchPlpData(locale, language, dataset))),
    ]);
    const reviewsBySlug = getReviewsBySlug(reviewsRows);
    const badgesBySlug = getBadgesBySlug(plpRowsByDataset.flat());
    const bySlug = buildProductIndexBySlug(data, locale, language);

    Object.entries(bySlug).forEach(([slug, product]) => {
      const reviews = reviewsBySlug[slug];
      product.reviewCount = reviews ? reviews.reviewCount : 0;
      product.reviewAverage = reviews ? reviews.reviewAverage : 0;
      product.badge = badgesBySlug[slug] || '';
    });

    window.productRowIndex = bySlug;
  }

  return pathnames.map((path) => window.productRowIndex[slugFromUrl(path)]).filter((e) => e);
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
 * Resolves an authored row's link (if any) to a product, or null if the row is not a product
 * @param {HTMLElement} row - Row element containing image and body cells
 * @returns {Promise<Object|null>} Resolved product, or null
 */
async function resolveRowProduct(row) {
  const [, body] = row.children;
  if (!body) return null;

  const link = body.querySelector('a[href]');
  if (!link) return null;

  let pathname;
  try {
    pathname = new URL(link.href, window.location.origin).pathname;
  } catch {
    return null;
  }

  const [product] = await lookupProducts([pathname]);
  if (!product) {
    link.classList.add('linkchecker-invalid-link');
    return null;
  }
  return product;
}

/**
 * Converts an authored `.mp4` link in the image cell into a video.
 * @param {HTMLElement} image - Row's image cell
 * @returns {HTMLVideoElement|null} Created video, or null if no video link was found
 */
function buildRowVideo(image) {
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
 * Transforms one authored row into a styled slide populated with the resolved product's data.
 * @param {HTMLElement} row - Row element containing image and body cells
 * @param {Object} ph - Placeholder object with localized text/badge labels
 * @returns {Promise<void>}
 */
async function styleRowAsSlide(row, ph) {
  const [image, body] = row.children;
  const video = buildRowVideo(image);

  const product = await resolveRowProduct(row);
  if (!product) {
    row.classList.add('marketing');
    return;
  }

  const link = body.querySelector('a[href]');
  link.parentElement.remove();

  const description = body.firstElementChild;
  if (description) description.classList.add('description');

  if (!video) {
    const img = image.querySelector('picture') || createProductImage(product);
    image.replaceChildren(img);
  }
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
 * Returns the perceived luminance (0-255) of an element's computed background color.
 * @param {Element} el - Element with a resolved background-color
 * @returns {number}
 */
function getLuminance(el) {
  const [r, g, b] = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/**
 * Finds a block variant matching a defined `--color-*` custom property.
 * @param {HTMLElement} block - product-row block element
 * @returns {string|undefined} Matching color token, if any
 */
function getMarketingColor(block) {
  return [...block.classList].find(
    (c) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${c}`).trim(),
  );
}

/**
 * Sets the marketing tile's background to the block's color variant (or charcoal by default),
 * then adds a `light`/`dark` class to the slide body so text stays readable against it.
 * @param {HTMLElement} li - Marketing slide element, already inserted into the document
 * @param {string} colorOverride - Color token matching a --color-* custom property, or undefined
 */
function applyMarketingColor(li, colorOverride) {
  const body = li.querySelector(':scope > .slide-body');
  if (!body) return;
  body.style.setProperty('--marketing-color', `var(--color-${colorOverride || 'charcoal'})`);
  const luminance = getLuminance(body);
  body.classList.add(luminance > 128 ? 'light' : 'dark');
}

/**
 * Transforms each row into a styled slide and wraps them in a generic carousel block.
 * @param {HTMLElement} block - product-row block element with product rows
 * @param {Object} ph - Placeholder object with localized text/badge labels
 * @param {string} colorOverride - Color token for marketing tiles, or undefined
 * @returns {Promise<void>}
 */
async function buildProductRowCarousel(block, ph, colorOverride) {
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

  const slides = [...carousel.querySelectorAll(':scope > ul > li.carousel-slide')];
  rows.forEach((row, i) => {
    if (row.classList.contains('marketing') && slides[i]) {
      slides[i].classList.add('marketing');
      applyMarketingColor(slides[i], colorOverride);
    }
  });

  wireSlideClicks(carousel);
}

/**
 * Transforms each row into a styled slide and lays them out in a static, non-scrolling grid.
 * @param {HTMLElement} block - product-row block element with product rows
 * @param {Object} ph - Placeholder object with localized text/badge labels
 * @param {string} colorOverride - Color token for marketing tiles, or undefined
 * @returns {Promise<void>}
 */
async function buildProductRowGrid(block, ph, colorOverride) {
  const rows = [...block.children];
  await Promise.all(rows.map((row) => styleRowAsSlide(row, ph)));
  rows.forEach(classifySlideCells);

  const ul = document.createElement('ul');
  const marketingSlides = [];

  rows.forEach((row) => {
    const li = document.createElement('li');
    li.className = 'carousel-slide';
    if (row.classList.contains('marketing')) {
      li.classList.add('marketing');
      marketingSlides.push(li);
    }
    li.append(...row.children);
    ul.append(li);
  });

  block.replaceChildren(ul);
  marketingSlides.forEach((li) => applyMarketingColor(li, colorOverride));
  wireSlideClicks(block);
}

export default async function decorate(block) {
  const { locale, language } = getLocaleAndLanguage();
  const ph = await fetchPlaceholders(`/${locale}/${language}/products/config`);
  const colorOverride = getMarketingColor(block);
  const isCarousel = block.classList.contains('carousel');
  if (isCarousel) await buildProductRowCarousel(block, ph, colorOverride);
  else await buildProductRowGrid(block, ph, colorOverride);
}
