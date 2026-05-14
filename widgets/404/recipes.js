/**
 * Last URL segment, lowercased and kebab-style (spaces/underscores → hyphens).
 * @param {string} segment
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
 * @param {string} pathname
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
 * Slug from a recipe index `path` (basename, normalized).
 * @param {string} path
 * @returns {string}
 */
function slugFromRecipePath(path) {
  return normalizeKebabLower(lastPathSegment(path));
}

/**
 * If the query index has a recipe whose path matches this 404 URL's last segment
 * (normalized), prefer full slug exact, then base exact after stripping `-r` digits
 * from the index slug, then prefix match on the full slug.
 * @param {string} locale
 * @param {string} language
 * @returns {Promise<void>}
 */
async function tryRedirectFromRecipeIndex(locale, language) {
  const needle = normalizeKebabLower(lastPathSegment(window.location.pathname));
  if (!needle || needle === 'recipes') return;

  const indexUrl = `/${locale}/${language}/recipes/query-index.json`;
  let resp;
  try {
    resp = await fetch(indexUrl);
  } catch {
    return;
  }
  if (!resp.ok) return;

  let payload;
  try {
    payload = await resp.json();
  } catch {
    return;
  }
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const recipes = rows.filter((r) => {
    const status = (r.status || '').toLowerCase();
    return (status === 'updated' || status === 'new') && (r.path || '').trim();
  });

  const matches = recipes.flatMap((r) => {
    const path = (r.path || '').trim();
    const slug = slugFromRecipePath(path);
    if (!slug) return [];
    if (slug === needle) return [{ path, slug, score: 3 }];
    const slugBase = stripTrailingRecipeId(slug);
    if (slugBase === needle) return [{ path, slug, score: 2 }];
    if (needle.length >= 3 && slug.startsWith(needle)) return [{ path, slug, score: 1 }];
    return [];
  });

  if (matches.length === 0) return;

  // Higher score first; same score: shortest slug (prefix tier avoids …mini-chopper…).
  matches.sort((a, b) => b.score - a.score || a.slug.length - b.slug.length);
  const best = matches[0];
  const target = best.path.startsWith('/') ? best.path : `/${best.path}`;
  const here = window.location.pathname.replace(/\/$/, '') || '/';
  const there = target.replace(/\/$/, '') || '/';
  if (here === there) return;

  window.location.assign(target);
}

/**
 * Recipe-specific 404 helper shown when the missing URL is under /recipes/.
 * @param {HTMLElement} widget - Widget root (`.widget` / `.404-recipes`)
 */
export default async function decorate(widget) {
  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  const locale = pathSegments[0] || 'us';
  const language = pathSegments[1] || 'en_us';

  await tryRedirectFromRecipeIndex(locale, language);

  const rawLang = (language || 'en_us').toLowerCase();
  let langKey = 'en';
  if (rawLang.startsWith('fr')) langKey = 'fr';
  else if (rawLang.startsWith('es')) langKey = 'es';

  const scriptPath = new URL(import.meta.url).pathname;
  const jsonUrl = `${window.hlx?.codeBasePath || ''}${scriptPath.replace(/\.js$/, '.json')}`;
  const resp = await fetch(jsonUrl);
  const data = await resp.json();
  const copy = data[langKey] || data.en;

  const title = widget.querySelector('.recipes-404-title');
  const eyebrow = widget.querySelector('.recipes-404-eyebrow');
  const lead = widget.querySelector('.recipes-404-lead');
  const browse = widget.querySelector('.recipes-404-browse');
  const img = widget.querySelector('.recipes-404-image');
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
}
