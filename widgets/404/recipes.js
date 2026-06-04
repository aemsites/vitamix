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
 * If the query index has a recipe whose path matches this 404 URL's last segment
 * (normalized), prefer full slug exact, then base exact after stripping `-r` digits
 * from the index slug, then prefix match on the full slug.
 * @param {string} locale — two-letter country code (e.g. 'us')
 * @param {string} language — locale+language code (e.g. 'en_us')
 * @returns {Promise<boolean>} True when a redirect to a recipe page was started
 */
async function tryRedirectFromRecipeIndex(locale, language) {
  const targetSlug = normalizeKebabLower(lastPathSegment(window.location.pathname));
  if (!targetSlug || targetSlug === 'recipes') return false;

  const indexUrl = `/${locale}/${language}/recipes/query-index.json`;
  let resp;
  try {
    resp = await fetch(indexUrl);
  } catch {
    return false;
  }
  if (!resp.ok) return false;

  let payload;
  try {
    payload = await resp.json();
  } catch {
    return false;
  }
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const recipes = rows.filter((r) => {
    const status = (r.status || '').toLowerCase();
    return (status === 'updated' || status === 'new') && (r.path || '').trim();
  });

  let best = findBestRecipeMatch(recipes, targetSlug);
  if (!best) {
    const simplifiedSlug = stripEquipmentSuffixFromSlug(targetSlug);
    if (simplifiedSlug && simplifiedSlug !== targetSlug) {
      best = findBestRecipeMatch(recipes, simplifiedSlug);
    }
  }
  if (!best) return false;
  const target = best.path.startsWith('/') ? best.path : `/${best.path}`;
  const here = window.location.pathname.replace(/\/$/, '') || '/';
  const there = target.replace(/\/$/, '') || '/';
  if (here === there) return false;

  window.location.assign(`${target}${window.location.search}`);
  return true;
}

/**
 * Recipe-specific 404 helper shown when the missing URL is under /recipes/.
 * @param {HTMLElement} widget - Widget root (`.widget` / `.404-recipes`)
 */
export default async function decorate(widget) {
  const content = widget.querySelector('.recipes-404');
  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  const locale = pathSegments[0] || 'us';
  const language = pathSegments[1] || 'en_us';

  const willRedirect = await tryRedirectFromRecipeIndex(locale, language);
  if (willRedirect) return;

  const rawLang = (language || 'en_us').toLowerCase();
  let langKey = 'en';
  if (rawLang.startsWith('fr')) langKey = 'fr';
  else if (rawLang.startsWith('es')) langKey = 'es';

  const scriptPath = new URL(import.meta.url).pathname;
  const jsonUrl = `${window.hlx?.codeBasePath || ''}${scriptPath.replace(/\.js$/, '.json')}`;
  let resp;
  try {
    resp = await fetch(jsonUrl);
  } catch {
    return;
  }
  if (!resp.ok) return;
  let data;
  try {
    data = await resp.json();
  } catch {
    return;
  }
  const copy = data[langKey] || data.en;
  if (!copy) return;

  const title = widget.querySelector('.title');
  const eyebrow = widget.querySelector('.eyebrow');
  const lead = widget.querySelector('.lead');
  const browse = widget.querySelector('.button-wrapper .button');
  const img = widget.querySelector('img');
  const recipesHome = `/${locale}/${language}/recipes`;

  if (title) title.textContent = copy.title;
  if (eyebrow) eyebrow.textContent = copy.eyebrow;
  if (lead) lead.textContent = copy.lead;
  if (browse) {
    browse.textContent = copy.recipesCta;
    browse.href = recipesHome;
    browse.title = copy.recipesCta;
  }
  if (img && copy.imageAlt) img.alt = copy.imageAlt;

  if (content) content.classList.add('ready');
}
