const STORAGE_KEY = 'vitamix-compare-products';

export const COMPARE_STORAGE_EVENT = 'vitamix:compare-products-updated';
export const MAX_COMPARE_ITEMS = 4;

/**
 * Returns the lowercase final path segment used as a product's comparison identity.
 * Accepts a slug, path, or absolute URL for backwards compatibility.
 * @param {string} value
 * @returns {string}
 */
export function getCompareSlug(value) {
  if (!value || typeof value !== 'string') return '';
  let pathname = value;
  try {
    pathname = new URL(value, 'https://compare.invalid').pathname;
  } catch {
    pathname = value.replace(/[?#].*$/, '');
  }
  return pathname.split('/').filter(Boolean).pop()?.toLowerCase() || '';
}

/**
 * Normalizes one stored entry to `{ slug, title, image }`. Accepts legacy bare strings and
 * `{ url }` entries so existing localStorage state is migrated without losing selections.
 * @param {string|Object} raw
 * @returns {{slug: string, title: string, image: string}|null}
 */
function normalizeStoredItem(raw) {
  const value = typeof raw === 'string' ? raw : raw?.slug || raw?.url;
  const slug = getCompareSlug(value);
  if (!slug) return null;
  return {
    slug,
    title: typeof raw === 'object' ? raw.title || '' : '',
    image: typeof raw === 'object' ? raw.image || '' : '',
  };
}

/** @returns {Array<{slug: string, title: string, image: string}>} */
export function getStoredCompareItems() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    const normalized = parsed.map(normalizeStoredItem).filter((item) => {
      if (!item || seen.has(item.slug)) return false;
      seen.add(item.slug);
      return true;
    }).slice(0, MAX_COMPARE_ITEMS);
    if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        // Keep the normalized in-memory selection when storage is read-only.
      }
    }
    return normalized;
  } catch {
    return [];
  }
}

/** @returns {string[]} */
export function getStoredCompareSlugs() {
  return getStoredCompareItems().map((item) => item.slug);
}

/** @param {string} value @returns {boolean} */
export function isInStoredCompare(value) {
  return getStoredCompareSlugs().includes(getCompareSlug(value));
}

/**
 * @param {Array<{slug?: string, url?: string, title?: string, image?: string}>} items
 * @returns {Array<{slug: string, title: string, image: string}>}
 */
export function setStoredCompareItems(items) {
  const seen = new Set();
  const unique = [];
  (items || []).forEach((raw) => {
    const item = normalizeStoredItem(raw);
    if (!item || seen.has(item.slug)) return;
    seen.add(item.slug);
    unique.push(item);
  });
  const capped = unique.slice(0, MAX_COMPARE_ITEMS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // localStorage unavailable (e.g. private browsing) - state just won't persist
  }
  window.dispatchEvent(new CustomEvent(COMPARE_STORAGE_EVENT, { detail: { items: capped } }));
  return capped;
}
