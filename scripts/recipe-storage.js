/**
 * Client-side recipe lists: recently viewed (max 10) and user-saved recipes.
 * Each entry uses pathname (no query/hash) plus ISO timestamps.
 */

const RECENT_KEY = 'vitamix-recipe-recent';
const SAVED_KEY = 'vitamix-recipe-saved';
const MAX_RECENT = 10;

/**
 * @param {string} pathname
 * @returns {string}
 */
export function normalizeRecipePath(pathname) {
  if (!pathname || typeof pathname !== 'string') return '';
  const noHash = pathname.split('#')[0];
  const noQuery = noHash.split('?')[0];
  return noQuery || '';
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota, private mode, or disabled storage
  }
}

/**
 * @param {unknown[]} arr
 * @returns {{ pathname: string, viewedAt?: string, addedAt?: string }[]}
 */
function coerceEntries(arr) {
  return arr.filter((e) => e && typeof e.pathname === 'string' && e.pathname.length > 0);
}

/**
 * @returns {{ pathname: string, viewedAt: string }[]}
 */
export function getRecentlyViewedRecipes() {
  return coerceEntries(readJson(RECENT_KEY, []));
}

/**
 * Adds or refreshes the current pathname at the front; caps at 10.
 * @param {string} pathname
 */
export function recordRecipeView(pathname) {
  const normalized = normalizeRecipePath(pathname);
  if (!normalized) return;

  let recent = getRecentlyViewedRecipes();
  const viewedAt = new Date().toISOString();
  recent = recent.filter((e) => e.pathname !== normalized);
  recent.unshift({ pathname: normalized, viewedAt });
  recent = recent.slice(0, MAX_RECENT);
  writeJson(RECENT_KEY, recent);
}

/**
 * @returns {{ pathname: string, addedAt: string }[]}
 */
export function getSavedRecipes() {
  return coerceEntries(readJson(SAVED_KEY, []));
}

/**
 * @param {string} pathname
 * @returns {boolean}
 */
export function isRecipeSaved(pathname) {
  const normalized = normalizeRecipePath(pathname);
  if (!normalized) return false;
  return getSavedRecipes().some((e) => e.pathname === normalized);
}

/**
 * @param {string} pathname
 */
export function addSavedRecipe(pathname) {
  const normalized = normalizeRecipePath(pathname);
  if (!normalized) return;

  let saved = getSavedRecipes();
  if (saved.some((e) => e.pathname === normalized)) return;
  saved = [{ pathname: normalized, addedAt: new Date().toISOString() }, ...saved];
  writeJson(SAVED_KEY, saved);
}

/**
 * @param {string} pathname
 */
export function removeSavedRecipe(pathname) {
  const normalized = normalizeRecipePath(pathname);
  if (!normalized) return;
  const saved = getSavedRecipes().filter((e) => e.pathname !== normalized);
  writeJson(SAVED_KEY, saved);
}

/**
 * @param {string} pathname
 * @returns {boolean} true if saved after toggle, false if removed
 */
export function toggleSavedRecipe(pathname) {
  if (isRecipeSaved(pathname)) {
    removeSavedRecipe(pathname);
    return false;
  }
  addSavedRecipe(pathname);
  return true;
}
