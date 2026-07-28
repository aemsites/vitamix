import { loadCSS, fetchPlaceholders } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';
import { lookupProducts, createProductCard } from '../../blocks/plp/plp.js';

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
 * Returns true if the product is on sale (has a lower price than regular).
 * @param {Object} product - Product from index (with price, regularPrice)
 * @returns {boolean}
 */
function isOnSale(product) {
  const regular = product.regularPrice != null ? Number(product.regularPrice) : NaN;
  const current = product.price != null ? Number(product.price) : NaN;
  return Number.isFinite(regular) && Number.isFinite(current) && regular > current;
}

/**
 * Decorates the sales-plp widget: loads product index, filters to sale products,
 * and renders them using the same card layout as the PLP block.
 * @param {HTMLElement} widget - Widget root element
 */
export default async function decorate(widget) {
  const { locale, language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadWidgetCopy(lang);
  const ph = await fetchPlaceholders(`/${locale}/${language}/products/config`);

  // Load PLP block styles so product cards match the PLP block
  loadCSS(`${window.hlx?.codeBasePath || ''}/blocks/plp/plp.css`);

  const resultsEl = widget.querySelector('.plp-results');
  const countEl = widget.querySelector('#sales-plp-results-count');
  const resultsLabelEl = widget.querySelector('.sales-plp-results-label');
  const emptyEl = widget.querySelector('.sales-plp-empty');

  if (!resultsEl || !countEl || !resultsLabelEl || !emptyEl) return;

  resultsLabelEl.textContent = copy.results || 'products on sale';
  emptyEl.textContent = copy.noSaleProducts || 'Sorry, no products are on sale at the moment. Please check back, as we regularly launch promotions.';

  let products = [];
  try {
    products = await lookupProducts({});
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('sales-plp: failed to load product index', e);
  }

  const saleProducts = products.filter(isOnSale).sort((a, b) => (b.price ?? 0) - (a.price ?? 0));

  if (saleProducts.length === 0) {
    resultsEl.hidden = true;
    countEl.textContent = '0';
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;
  resultsEl.hidden = false;
  countEl.textContent = String(saleProducts.length);
  resultsEl.innerHTML = '';

  saleProducts.forEach((product) => {
    resultsEl.appendChild(createProductCard(product, ph));
  });
}
