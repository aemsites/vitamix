import { loadCSS } from './aem.js';
import {
  getCompareSlug, getStoredCompareItems, setStoredCompareItems, MAX_COMPARE_ITEMS,
} from './compare-storage.js';

export {
  COMPARE_STORAGE_EVENT,
  getCompareSlug,
  getStoredCompareItems,
  getStoredCompareSlugs,
  isInStoredCompare,
  MAX_COMPARE_ITEMS,
  setStoredCompareItems,
} from './compare-storage.js';

/** Default (English) toast text; callers can pass localized overrides via `options`. */
const DEFAULT_ADDED_MESSAGE = 'Successfully added to comparison';
const DEFAULT_REMOVED_MESSAGE = 'Removed from comparison';
const DEFAULT_LIMIT_MESSAGE = `You can compare up to ${MAX_COMPARE_ITEMS} products. Remove one to add another.`;
const DEFAULT_VIEW_COMPARISON_LABEL = 'View Comparison';

/** How long the compare toast stays visible, in ms. */
const TOAST_VISIBLE_MS = 3000;

let toastHideTimer;

/**
 * Finds the header's compare nav link, if present, so callers can reuse the same URL
 * ("View Comparison") instead of guessing at one.
 * @returns {string|null}
 */
export function getHeaderCompareHref() {
  const link = document.querySelector('header li .icon-compare')?.closest('li')?.querySelector('a[href]');
  return link ? link.getAttribute('href') : null;
}

/**
 * Shows a transient compare-list toast (add/remove/limit-reached), with small round thumbnails
 * of every item currently in the comparison list and a "View Comparison" link (reusing the
 * header's compare link) when one is available.
 * @param {string} message
 * @param {Object} [options]
 * @param {string} [options.viewComparisonLabel] - Localized override for the link text
 */
function showCompareToast(message, options = {}) {
  loadCSS(`${window.hlx?.codeBasePath || ''}/styles/add-to-compare.css`);
  let toast = document.querySelector('.add-to-compare-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'add-to-compare-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.innerHTML = '';

  const text = document.createElement('p');
  text.className = 'add-to-compare-toast-message';
  text.textContent = message;
  toast.appendChild(text);

  const items = getStoredCompareItems().filter((item) => item.image);
  if (items.length) {
    const thumbs = document.createElement('div');
    thumbs.className = 'add-to-compare-toast-thumbs';
    items.forEach((item) => {
      const img = document.createElement('img');
      img.className = 'add-to-compare-toast-thumb';
      img.src = item.image;
      img.alt = item.title || '';
      img.loading = 'lazy';
      thumbs.appendChild(img);
    });
    toast.appendChild(thumbs);
  }

  const viewHref = getHeaderCompareHref();
  if (viewHref) {
    const link = document.createElement('a');
    link.className = 'add-to-compare-toast-link';
    link.href = viewHref;
    link.textContent = options.viewComparisonLabel || DEFAULT_VIEW_COMPARISON_LABEL;
    toast.appendChild(link);
  }

  // Restart the show/hide cycle even if a toast is already visible (rapid repeat clicks).
  toast.classList.remove('add-to-compare-toast-visible');
  // eslint-disable-next-line no-void
  void toast.offsetWidth;
  toast.classList.add('add-to-compare-toast-visible');
  clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => {
    toast.classList.remove('add-to-compare-toast-visible');
  }, TOAST_VISIBLE_MS);
}

/**
 * Best-effort product thumbnail: the first variant's first image - the same image PDP and
 * product-list (PLP) show as the product's primary/default image - falling back to the
 * product's own top-level image (e.g. for PDP callers, which pass one directly with no
 * `variants` array of their own).
 * @param {Object} product
 * @returns {string}
 */
function getProductThumb(product) {
  return product?.variants?.[0]?.image || product?.image || '';
}

/**
 * Removes a product from the compare-products widget's stored list and shows a confirmation
 * toast.
 * @param {string} value - Product slug, path, or URL
 * @param {Object} [options]
 * @param {string} [options.removedMessage] - Localized override for the toast text
 * @param {string} [options.viewComparisonLabel] - Localized override for the toast link text
 */
export function removeFromCompare(value, options = {}) {
  const slug = getCompareSlug(value);
  setStoredCompareItems(getStoredCompareItems().filter((item) => item.slug !== slug));
  showCompareToast(options.removedMessage || DEFAULT_REMOVED_MESSAGE, options);
}

/**
 * Adds a product to the localStorage-backed comparison list used by PDP and product-list.
 * The list is capped at MAX_COMPARE_ITEMS and shows a toast after adding or reaching the limit.
 * @param {Object} product - { url, title, image? }
 * @param {Object} [options]
 * @param {string} [options.addedMessage] - Localized override for the "added" toast text
 * @param {string} [options.limitMessage] - Localized override for the "limit reached" toast text
 * @param {string} [options.viewComparisonLabel] - Localized override for the toast link text
 * @returns {Promise<boolean>} Whether the add succeeded
 */
export default async function addToCompare(product, options = {}) {
  const slug = getCompareSlug(product.url || product.slug);
  if (!slug) return false;
  const current = getStoredCompareItems();
  if (current.some((item) => item.slug === slug)) return true;

  if (current.length >= MAX_COMPARE_ITEMS) {
    showCompareToast(options.limitMessage || DEFAULT_LIMIT_MESSAGE, options);
    return false;
  }

  setStoredCompareItems([...current, {
    slug,
    title: product.title || '',
    image: getProductThumb(product),
  }]);
  showCompareToast(options.addedMessage || DEFAULT_ADDED_MESSAGE, options);
  return true;
}
