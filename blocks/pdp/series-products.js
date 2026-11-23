import { toClassName } from '../../scripts/aem.js';
import { formatPrice, getLocaleAndLanguage } from '../../scripts/scripts.js';
import { buildProductIndexBySlug, fetchProductIndex } from '../../scripts/plp-data.js';

function createCard(product, ph, currentPath) {
  const item = document.createElement('li');
  item.className = 'pdp-series-card';
  const selected = product.url.replace(/\/$/, '') === currentPath;
  item.classList.toggle('is-selected', selected);

  const link = document.createElement('a');
  link.className = 'pdp-series-product';
  link.href = product.url;
  if (selected) link.setAttribute('aria-current', 'page');

  const imageUrl = product.image || product.variants?.find((variant) => variant.image)?.image;
  if (imageUrl) {
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.width = 160;
    image.height = 140;
    link.append(image);
  }

  const name = document.createElement('span');
  name.className = 'pdp-series-name';
  name.textContent = product.title;
  link.append(name);

  if (Number.isFinite(product.price)) {
    const price = document.createElement('strong');
    price.className = 'pdp-series-price';
    price.textContent = formatPrice(product.price, ph);
    link.append(price);
  }
  item.append(link);

  const colors = new Map();
  product.variants?.forEach((variant) => {
    if (variant.color) colors.set(toClassName(variant.color), variant.color);
  });
  if (colors.size) {
    const swatches = document.createElement('div');
    swatches.className = 'pdp-series-colors';
    colors.forEach((color, slug) => {
      const swatch = document.createElement('a');
      swatch.className = 'pdp-series-swatch color-swatch';
      const url = new URL(product.url, window.location.origin);
      url.searchParams.set('color', slug);
      swatch.href = `${url.pathname}${url.search}`;
      swatch.title = color;
      swatch.setAttribute('aria-label', `${product.title} - ${color}`);
      swatch.style.backgroundColor = `var(--color-${slug})`;
      swatches.append(swatch);
    });
    item.append(swatches);
  }
  return item;
}

/**
 * Populate the series picker without delaying the PDP's purchase controls.
 * Only category slugs (not the free-form series label) determine membership.
 */
export default function renderSeriesProducts(ph, jsonLdData) {
  const category = jsonLdData.custom.categories?.find(({ url_key: slug }) => slug?.endsWith('-series'));
  if (!category) return null;

  const container = document.createElement('section');
  container.className = 'pdp-series-products';
  container.setAttribute('aria-label', category.name || ph.series || 'Series');
  container.setAttribute('aria-busy', 'true');
  const heading = document.createElement('h2');
  heading.textContent = category.name || ph.series || 'Series';
  const list = document.createElement('ul');
  list.className = 'pdp-series-list';
  for (let i = 0; i < 3; i += 1) {
    const skeleton = document.createElement('li');
    skeleton.className = 'pdp-series-card pdp-series-skeleton';
    skeleton.setAttribute('aria-hidden', 'true');
    list.append(skeleton);
  }
  container.append(heading, list);

  const populate = async () => {
    const { locale, language } = getLocaleAndLanguage();
    const commercial = !!jsonLdData.custom.isCommercial
      || window.location.pathname.includes('/commercial/');
    const data = await fetchProductIndex(locale, language, { commercial });
    if (!Array.isArray(data)) throw new Error('Product index has no data rows');

    const bySlug = buildProductIndexBySlug(data, locale, language);
    const products = Object.values(bySlug).filter((product) => (
      product.categoriesUrlKey?.split(',').map((slug) => slug.trim()).includes(category.url_key)
    ));
    const currentPath = window.location.pathname.replace(/\/$/, '');
    if (!products.some((product) => product.url.replace(/\/$/, '') === currentPath)) {
      products.push({
        url: currentPath,
        title: jsonLdData.name,
        image: Array.isArray(jsonLdData.image) ? jsonLdData.image[0] : jsonLdData.image,
        price: Number.parseFloat(jsonLdData.offers?.[0]?.price),
      });
    }
    products.sort((a, b) => a.title.localeCompare(b.title, language.replace('_', '-'), { numeric: true }));

    list.replaceChildren(...products.map((product) => createCard(product, ph, currentPath)));
    container.setAttribute('aria-busy', 'false');
  };

  populate().catch((error) => {
    // An optional discovery feature must not interrupt purchasing.
    // eslint-disable-next-line no-console
    console.error('pdp-series-products: failed to load series', error);
    const message = document.createElement('li');
    message.className = 'pdp-series-error';
    message.setAttribute('role', 'status');
    message.textContent = ph.seriesProductsUnavailable || 'Unable to load products in this series.';
    list.replaceChildren(message);
    container.setAttribute('aria-busy', 'false');
  });
  return container;
}
