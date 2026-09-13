import {
  lastPathSegment,
  normalizeKebabLower,
  slugFromRecipeTitle,
  stripEquipmentSuffixFromSlug,
  stripTrailingRecipeId,
} from '../../blocks/recipe/recipe-slug.js';

/**
 * Last path segment of a recipe index `path`, kebab-lowercased.
 * @param {unknown} path
 * @returns {string}
 */
export function slugFromIndexPath(path) {
  return normalizeKebabLower(lastPathSegment(String(path || '')));
}

/**
 * Recipe page href from an index path (`-r###` suffix stripped).
 * @param {unknown} path
 * @returns {string}
 */
export function recipeHref(path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  return raw.replace(/-r\d+$/i, '');
}

/**
 * Relative image path for a recipe index row, or empty when missing/placeholder.
 * @param {unknown} image
 * @returns {string}
 */
export function recipeImageSrc(image) {
  if (image == null || image === '') return '';
  try {
    const url = new URL(String(image), 'https://www.vitamix.com');
    if (url.pathname.includes('default-meta-image')) return '';
    return `${url.pathname}${url.search}`;
  } catch {
    const raw = String(image).trim();
    return raw.includes('default-meta-image') ? '' : raw;
  }
}

/**
 * Title-case a kebab slug for unmatched cookbook entries.
 * @param {unknown} slug
 * @returns {string}
 */
export function titleFromSlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function slugsFromUnknown(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      /* fall through to comma-split */
    }
  }
  return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * Recipe slugs stored on the customer (`custom.recipes`).
 * @param {unknown} customer
 * @returns {string[]}
 */
export function getRecipeSlugsFromCustomer(customer) {
  if (!customer || typeof customer !== 'object') return [];
  const { custom } = /** @type {Record<string, unknown>} */ (customer);
  if (!custom || typeof custom !== 'object') return [];
  const { recipes } = /** @type {Record<string, unknown>} */ (custom);
  return [...new Set(slugsFromUnknown(recipes))];
}

/**
 * Commerce custom attributes are strings. PATCH `custom.recipes` as JSON text,
 * not an array (`expected string, got object`).
 * @param {unknown} slugs
 * @returns {string}
 */
export function serializeRecipeSlugs(slugs) {
  return JSON.stringify(slugsFromUnknown(slugs));
}

/**
 * PATCH body that only updates `custom.recipes`.
 * @param {unknown} slugs
 * @returns {{ custom: { recipes: string } }}
 */
export function recipesCustomPatch(slugs) {
  return { custom: { recipes: serializeRecipeSlugs(slugs) } };
}

/**
 * Query-index rows eligible for cookbook matching.
 * @param {unknown} indexRows
 * @returns {Record<string, unknown>[]}
 */
function eligibleRecipes(indexRows) {
  const rows = Array.isArray(indexRows) ? indexRows : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const recipe = /** @type {Record<string, unknown>} */ (row);
    const status = String(recipe.status || '').toLowerCase();
    if (status === 'deleted') return [];
    if (!String(recipe.path || '').trim()) return [];
    return [recipe];
  });
}

/**
 * Best index row whose path slug matches `targetSlug` (404 `findBestRecipeMatch`).
 * Prefer full slug exact, then base exact after stripping `-r` digits, then prefix.
 * @param {Record<string, unknown>[]} recipes
 * @param {string} targetSlug
 * @returns {{ recipe: Record<string, unknown>, slug: string, score: number } | null}
 */
function findBestRecipeMatch(recipes, targetSlug) {
  const matches = recipes.flatMap((recipe) => {
    const path = String(recipe.path || '').trim();
    const slug = slugFromIndexPath(path);
    if (!slug) return [];
    if (slug === targetSlug) return [{ recipe, slug, score: 3 }];
    const slugBase = stripTrailingRecipeId(slug);
    if (slugBase === targetSlug) return [{ recipe, slug, score: 2 }];
    if (targetSlug.length >= 3 && slug.startsWith(targetSlug)) {
      return [{ recipe, slug, score: 1 }];
    }
    return [];
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.score - a.score || a.slug.length - b.slug.length);
  return matches[0];
}

/**
 * Best index row whose title-derived slug matches `targetSlug`
 * (404 `findBestRecipeMatchByTitle`: diacritics, `&` → `and`, punctuation).
 * @param {Record<string, unknown>[]} recipes
 * @param {string} targetSlug
 * @returns {{ recipe: Record<string, unknown>, slug: string, score: number } | null}
 */
function findBestRecipeMatchByTitle(recipes, targetSlug) {
  const matches = recipes.flatMap((recipe) => {
    const slug = slugFromRecipeTitle(recipe.title);
    if (!slug) return [];
    if (slug === targetSlug) return [{ recipe, slug, score: 3 }];
    if (targetSlug.length >= 3 && slug.startsWith(targetSlug)) {
      return [{ recipe, slug, score: 1 }];
    }
    return [];
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.score - a.score || a.slug.length - b.slug.length);
  return matches[0];
}

/**
 * Best recipe index row for a cookbook slug, or null when none match.
 * Same cascade as the recipes 404 / redirect matcher: path slug, equipment-stripped
 * path, then title slug (special-character folding) with the same equipment fallback.
 * @param {unknown} indexRows
 * @param {unknown} slug
 * @returns {Record<string, unknown> | null}
 */
export function findRecipeBySlug(indexRows, slug) {
  const raw = String(slug || '');
  const targetSlug = normalizeKebabLower(raw);
  if (!targetSlug) return null;
  const recipes = eligibleRecipes(indexRows);

  let best = findBestRecipeMatch(recipes, targetSlug);
  if (!best) {
    const simplifiedSlug = stripEquipmentSuffixFromSlug(targetSlug);
    if (simplifiedSlug && simplifiedSlug !== targetSlug) {
      best = findBestRecipeMatch(recipes, simplifiedSlug);
    }
  }
  if (!best) {
    const titleTargetSlug = slugFromRecipeTitle(raw);
    if (titleTargetSlug) {
      best = findBestRecipeMatchByTitle(recipes, titleTargetSlug);
      if (!best) {
        const simplifiedTitleSlug = stripEquipmentSuffixFromSlug(titleTargetSlug);
        if (simplifiedTitleSlug && simplifiedTitleSlug !== titleTargetSlug) {
          best = findBestRecipeMatchByTitle(recipes, simplifiedTitleSlug);
        }
      }
    }
  }
  return best?.recipe || null;
}
