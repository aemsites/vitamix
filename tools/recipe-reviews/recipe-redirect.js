/**
 * Recipe slug matching and redirect resolution (mirrors widgets/404/recipes.js logic).
 */

/**
 * Last URL segment, lowercased and kebab-style (spaces/underscores → hyphens).
 * @param {string} segment — raw URL path segment
 * @returns {string}
 */
function normalizeKebabLower(segment) {
  try {
    return decodeURIComponent(segment || '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-');
  } catch {
    return (segment || '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
  }
}

/**
 * Final segment of a path.
 * @param {string} pathname — URL pathname (e.g. window.location.pathname)
 * @returns {string}
 */
function lastPathSegment(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

/**
 * Recipe index path segments often end with `-r` + digits; strip for base-key match.
 * @param {string} slug - Already kebab-lowercased segment
 * @returns {string}
 */
function stripTrailingRecipeId(slug) {
  return (slug || '').replace(/-r\d+$/i, '');
}

/**
 * Removes equipment-variant suffixes from a recipe slug for fallback matching.
 * @param {string} slug - Already kebab-lowercased segment
 * @returns {string}
 */
function stripEquipmentSuffixFromSlug(slug) {
  return (slug || '').replace(/-immersion-blender|-food-processor-attachment|-mini-chopper-attachment/g, '');
}

/**
 * Slug from a recipe index `path` (basename, normalized).
 * @param {string} path — recipe's path field from the query-index
 * @returns {string}
 */
function slugFromRecipePath(path) {
  return normalizeKebabLower(lastPathSegment(path));
}

/**
 * Kebab-case slug from a recipe title: strip diacritics, `&` → `and`, drop punctuation.
 * @param {string} title
 * @returns {string}
 */
function slugFromRecipeTitle(title) {
  let text = String(title || '').trim();
  if (!text) return '';
  try {
    text = decodeURIComponent(text);
  } catch {
    // keep original
  }
  return text
    .replace(/&/g, ' and ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\u0131/g, 'i')
    .replace(/\u0130/g, 'i')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Best recipe index row for a target slug, or null when none match.
 * @param {Object[]} recipes - Filtered query-index rows
 * @param {string} targetSlug - Normalized last path segment to match
 * @returns {{ path: string, slug: string, score: number } | null}
 */
function findBestRecipeMatch(recipes, targetSlug) {
  const matches = recipes.flatMap((r) => {
    const path = (r.path || '').trim();
    const slug = slugFromRecipePath(path);
    if (!slug) return [];
    if (slug === targetSlug) return [{ path, slug, score: 3 }];
    const slugBase = stripTrailingRecipeId(slug);
    if (slugBase === targetSlug) return [{ path, slug, score: 2 }];
    if (targetSlug.length >= 3 && slug.startsWith(targetSlug)) return [{ path, slug, score: 1 }];
    return [];
  });

  if (matches.length === 0) return null;

  matches.sort((a, b) => b.score - a.score || a.slug.length - b.slug.length);
  return matches[0];
}

/**
 * Best recipe index row for a target slug matched against title-derived slugs.
 * @param {Object[]} recipes - Filtered query-index rows
 * @param {string} targetSlug - Normalized slug to match
 * @returns {{ path: string, slug: string, score: number } | null}
 */
function findBestRecipeMatchByTitle(recipes, targetSlug) {
  const matches = recipes.flatMap((r) => {
    const path = (r.path || '').trim();
    const slug = slugFromRecipeTitle(r.title);
    if (!slug) return [];
    if (slug === targetSlug) return [{ path, slug, score: 3 }];
    if (targetSlug.length >= 3 && slug.startsWith(targetSlug)) return [{ path, slug, score: 1 }];
    return [];
  });

  if (matches.length === 0) return null;

  matches.sort((a, b) => b.score - a.score || a.slug.length - b.slug.length);
  return matches[0];
}

/**
 * Active recipe rows from a query-index payload.
 * @param {Object} payload
 * @returns {Object[]}
 */
export function filterRecipeIndexRows(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.filter((r) => {
    const status = (r.status || '').toLowerCase();
    return (status === 'updated' || status === 'new') && (r.path || '').trim();
  });
}

/**
 * Resolve a recipe 404 pathname to a redirect destination using index rows.
 * @param {string} pathname — source path without query string
 * @param {Object[]} recipes — filtered query-index rows
 * @returns {{ destination: string, score: number, slug: string } | null}
 */
export function resolveRecipeRedirect(pathname, recipes) {
  const targetSlug = normalizeKebabLower(lastPathSegment(pathname));
  if (!targetSlug || targetSlug === 'recipes') return null;

  let best = findBestRecipeMatch(recipes, targetSlug);
  if (!best) {
    const simplifiedSlug = stripEquipmentSuffixFromSlug(targetSlug);
    if (simplifiedSlug && simplifiedSlug !== targetSlug) {
      best = findBestRecipeMatch(recipes, simplifiedSlug);
    }
  }
  if (!best) {
    const titleTargetSlug = slugFromRecipeTitle(lastPathSegment(pathname));
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
  if (!best) return null;

  const target = best.path.startsWith('/') ? best.path : `/${best.path}`;
  const here = pathname.replace(/\/$/, '') || '/';
  const there = target.replace(/\/$/, '') || '/';
  if (here === there) return null;

  return { destination: there, score: best.score, slug: best.slug };
}
