/**
 * Client-side Edge recipe lists: recently viewed (max 10) and saved slugs.
 * Magento locales do not use this module — they still post to the legacy
 * recipebook. Saved entries are slugs (last path segment), matching
 * `custom.recipes` on the customer record.
 */

import {
  slugFromRecipePathname,
  stripTrailingRecipeId,
} from '../blocks/recipe/recipe-slug.js';

const RECENT_KEY = 'vitamix-recipe-recent';
const SAVED_KEY = 'vitamix-recipe-saved';
const MAX_RECENT = 10;

/**
 * Cookbook slug for a recipe pathname (no query/hash, `-r###` stripped).
 * @param {unknown} pathname
 * @returns {string}
 */
export function recipeSlugFromPathname(pathname) {
  if (pathname == null) return '';
  const noHash = String(pathname).split('#')[0];
  const noQuery = noHash.split('?')[0];
  const slug = stripTrailingRecipeId(slugFromRecipePathname(noQuery));
  if (!slug || slug === 'recipes') return '';
  return slug;
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function coerceSlug(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (trimmed.includes('/')) return recipeSlugFromPathname(trimmed);
    return stripTrailingRecipeId(slugFromRecipePathname(trimmed));
  }
  if (typeof raw === 'object') {
    const row = /** @type {Record<string, unknown>} */ (raw);
    if (typeof row.slug === 'string' && row.slug.trim()) {
      return recipeSlugFromPathname(row.slug);
    }
    if (typeof row.pathname === 'string' && row.pathname.trim()) {
      return recipeSlugFromPathname(row.pathname);
    }
  }
  return '';
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
 * @returns {{ slug: string, addedAt?: string, viewedAt?: string, pathname?: string }[]}
 */
function coerceSavedEntries(arr) {
  const seen = new Set();
  return arr.flatMap((item) => {
    const slug = coerceSlug(item);
    if (!slug || seen.has(slug)) return [];
    seen.add(slug);
    const addedAt = item && typeof item === 'object' && typeof item.addedAt === 'string'
      ? item.addedAt
      : undefined;
    return [{ slug, addedAt }];
  });
}

/**
 * @param {unknown[]} arr
 * @returns {{ slug: string, viewedAt?: string }[]}
 */
function coerceRecentEntries(arr) {
  const seen = new Set();
  return arr.flatMap((item) => {
    const slug = coerceSlug(item);
    if (!slug || seen.has(slug)) return [];
    seen.add(slug);
    const viewedAt = item && typeof item === 'object' && typeof item.viewedAt === 'string'
      ? item.viewedAt
      : undefined;
    return [{ slug, viewedAt }];
  });
}

/**
 * Remote-first merge of cookbook slugs (customer record, then localStorage).
 * @param {unknown} remote
 * @param {unknown} local
 * @returns {string[]}
 */
export function mergeRecipeSlugLists(remote, local) {
  const seen = new Set();
  const out = [];
  const push = (item) => {
    const slug = coerceSlug(item);
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    out.push(slug);
  };
  (Array.isArray(remote) ? remote : []).forEach(push);
  (Array.isArray(local) ? local : []).forEach(push);
  return out;
}

/**
 * @returns {{ slug: string, viewedAt?: string }[]}
 */
export function getRecentlyViewedRecipes() {
  return coerceRecentEntries(readJson(RECENT_KEY, []));
}

/**
 * Adds or refreshes the current recipe at the front; caps at 10.
 * @param {string} pathname
 */
export function recordRecipeView(pathname) {
  const slug = recipeSlugFromPathname(pathname);
  if (!slug) return;
  const viewedAt = new Date().toISOString();
  let recent = getRecentlyViewedRecipes().filter((entry) => entry.slug !== slug);
  recent.unshift({ slug, viewedAt });
  recent = recent.slice(0, MAX_RECENT);
  writeJson(RECENT_KEY, recent);
}

/**
 * @returns {{ slug: string, addedAt?: string }[]}
 */
export function getSavedRecipeEntries() {
  return coerceSavedEntries(readJson(SAVED_KEY, []));
}

/**
 * @returns {string[]}
 */
export function getSavedRecipeSlugs() {
  return getSavedRecipeEntries().map((entry) => entry.slug);
}

/**
 * Replace the saved list, keeping `addedAt` when the slug was already stored.
 * @param {unknown} slugs
 */
export function setSavedRecipeSlugs(slugs) {
  const previous = new Map(getSavedRecipeEntries().map((entry) => [entry.slug, entry.addedAt]));
  const now = new Date().toISOString();
  const unique = mergeRecipeSlugLists(slugs, []);
  const entries = unique.map((slug) => ({
    slug,
    addedAt: previous.get(slug) || now,
  }));
  writeJson(SAVED_KEY, entries);
}

/**
 * @param {unknown} slugOrPath
 * @returns {boolean}
 */
export function isRecipeSaved(slugOrPath) {
  const slug = coerceSlug(slugOrPath);
  if (!slug) return false;
  return getSavedRecipeSlugs().includes(slug);
}

/**
 * @param {unknown} slugOrPath
 */
export function addSavedRecipe(slugOrPath) {
  const slug = coerceSlug(slugOrPath);
  if (!slug || isRecipeSaved(slug)) return;
  const entries = [
    { slug, addedAt: new Date().toISOString() },
    ...getSavedRecipeEntries(),
  ];
  writeJson(SAVED_KEY, entries);
}

/**
 * @param {unknown} slugOrPath
 */
export function removeSavedRecipe(slugOrPath) {
  const slug = coerceSlug(slugOrPath);
  if (!slug) return;
  const entries = getSavedRecipeEntries().filter((entry) => entry.slug !== slug);
  writeJson(SAVED_KEY, entries);
}

/**
 * @param {unknown} slugOrPath
 * @returns {boolean} true if saved after toggle
 */
export function toggleSavedRecipe(slugOrPath) {
  if (isRecipeSaved(slugOrPath)) {
    removeSavedRecipe(slugOrPath);
    return false;
  }
  addSavedRecipe(slugOrPath);
  return true;
}
