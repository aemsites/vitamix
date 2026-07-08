/**
 * Recipe slug helpers (mirrors widgets/404/recipes.js pathname matching).
 */

/**
 * Last URL segment, lowercased and kebab-style (spaces/underscores → hyphens).
 * @param {string} segment — raw URL path segment
 * @returns {string}
 */
export function normalizeKebabLower(segment) {
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
export function lastPathSegment(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

/**
 * Recipe slugs often end with `-r` + digits; strip for base-key match.
 * @param {string} slug - Already kebab-lowercased segment
 * @returns {string}
 */
export function stripTrailingRecipeId(slug) {
  return (slug || '').replace(/-r\d+$/i, '');
}

/**
 * Removes equipment-variant suffixes from a recipe slug for fallback matching.
 * @param {string} slug - Already kebab-lowercased segment
 * @returns {string}
 */
export function stripEquipmentSuffixFromSlug(slug) {
  return (slug || '').replace(/-immersion-blender|-food-processor-attachment|-mini-chopper-attachment/g, '');
}

/**
 * Kebab-case slug from a recipe title: strip diacritics, `&` → `and`, drop punctuation.
 * @param {string} title
 * @returns {string}
 */
export function slugFromRecipeTitle(title) {
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
 * Slug derived from the current recipe page pathname (inverse of 404 index matching).
 * @param {string} pathname — window.location.pathname
 * @returns {string}
 */
export function slugFromRecipePathname(pathname) {
  return normalizeKebabLower(lastPathSegment(pathname));
}

/**
 * Best recipe-ids row for a target slug, or null when none match.
 * @param {Object[]} rows - recipe-ids.json data rows
 * @param {string} targetSlug - Normalized last path segment to match
 * @returns {{ id: string, slug: string, score: number } | null}
 */
function findBestSlugMatch(rows, targetSlug) {
  const matches = rows.flatMap((r) => {
    const slug = (r.slug || '').trim();
    const id = (r.id || '').trim();
    if (!slug || !id) return [];
    if (slug === targetSlug) return [{ id, slug, score: 3 }];
    const slugBase = stripTrailingRecipeId(slug);
    if (slugBase === targetSlug) return [{ id, slug, score: 2 }];
    if (targetSlug.length >= 3 && slug.startsWith(targetSlug)) return [{ id, slug, score: 1 }];
    return [];
  });

  if (matches.length === 0) return null;

  matches.sort((a, b) => b.score - a.score || a.slug.length - b.slug.length);
  return matches[0];
}

/**
 * Resolve a recipe page pathname to a commerce recipe id using recipe-ids.json rows.
 * @param {string} pathname — window.location.pathname
 * @param {Object[]} rows — recipe-ids.json data rows
 * @returns {string | null}
 */
export function resolveRecipeId(pathname, rows) {
  const targetSlug = slugFromRecipePathname(pathname);
  if (!targetSlug || targetSlug === 'recipes') return null;

  const slugIndex = new Map(
    rows
      .map((r) => [(r.slug || '').trim(), (r.id || '').trim()])
      .filter(([slug, id]) => slug && id),
  );

  if (slugIndex.has(targetSlug)) return slugIndex.get(targetSlug);

  const strippedTarget = stripTrailingRecipeId(targetSlug);
  if (strippedTarget !== targetSlug && slugIndex.has(strippedTarget)) {
    return slugIndex.get(strippedTarget);
  }

  let best = findBestSlugMatch(rows, targetSlug);
  if (!best) {
    const simplifiedSlug = stripEquipmentSuffixFromSlug(targetSlug);
    if (simplifiedSlug && simplifiedSlug !== targetSlug) {
      if (slugIndex.has(simplifiedSlug)) return slugIndex.get(simplifiedSlug);
      best = findBestSlugMatch(rows, simplifiedSlug);
    }
  }
  if (!best) {
    const titleTargetSlug = slugFromRecipeTitle(lastPathSegment(pathname));
    if (titleTargetSlug) {
      if (slugIndex.has(titleTargetSlug)) return slugIndex.get(titleTargetSlug);
      best = findBestSlugMatch(rows, titleTargetSlug);
      if (!best) {
        const simplifiedTitleSlug = stripEquipmentSuffixFromSlug(titleTargetSlug);
        if (simplifiedTitleSlug && simplifiedTitleSlug !== titleTargetSlug) {
          if (slugIndex.has(simplifiedTitleSlug)) return slugIndex.get(simplifiedTitleSlug);
          best = findBestSlugMatch(rows, simplifiedTitleSlug);
        }
      }
    }
  }

  return best?.id || null;
}
