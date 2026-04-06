import { getMetadata, toClassName, fetchPlaceholders } from '../../scripts/aem.js';
import {
  buildCarousel, formatServings, formatTime, getLocaleAndLanguage,
} from '../../scripts/scripts.js';

const WEIGHTS = {
  titleWords: 4,
  recipeType: 3,
  course: 2,
  dietaryInterests: 1,
};

/**
 * Strip trailing `-immersion-blender` from pathname for index matching.
 * @param {string} path - Pathname (no query)
 * @returns {string} Pathname without immersion-blender suffix when present
 */
function stripImmersionBlenderSuffix(path) {
  if (!path) return path;
  const suffix = '-immersion-blender';
  if (!path.endsWith(suffix)) return path;
  return path.slice(0, path.length - suffix.length);
}

/**
 * `-immersion-blender` segment to put back on display href when the author pathname had it.
 * @param {string} path - Original author pathname
 * @returns {string} `'-immersion-blender'` or empty
 */
function immersionBlenderSuffixFromAuthorPath(path) {
  if (!path) return '';
  const withoutImmersionBlender = stripImmersionBlenderSuffix(path);
  if (withoutImmersionBlender === path) return '';
  return path.slice(withoutImmersionBlender.length);
}

/**
 * Find matching recipe in data by href path.
 * @param {string} href - Path to match
 * @param {Object[]} data - Array of all recipe objects
 * @returns {Object|undefined} Matching recipe or undefined
 */
function findMatchingRecipe(href, data) {
  const pathForMatch = stripImmersionBlenderSuffix(href);

  if (pathForMatch.match(/-r\d+$/)) {
    return data.find((recipe) => recipe.path === pathForMatch);
  }

  // Match base path (without r-ID suffix)
  return data.find((recipe) => {
    const lastIndex = recipe.path.lastIndexOf('-r');
    const recipePath = recipe.path.substring(0, lastIndex);
    return recipePath === pathForMatch;
  });
}

/**
 * Strip recipe id suffix (-r###, redirect resolves the canonical URL).
 * @param {string} path - Recipe path from query index
 * @returns {string} Path without suffix
 */
function stripRecipeId(path) {
  if (!path) return path;
  return path.replace(/-r\d+$/, '');
}

/**
 * Write public anchor href: strip index `-r###`, then append optional pathname suffix.
 * @param {Object} recipe - Recipe from query index
 * @param {string} suffix - Trailing pathname segment to append, or empty string
 * @returns {string} href pathname for `<a href>`
 */
function recipeHrefForDisplay(recipe, suffix) {
  const baseWithoutRid = stripRecipeId(recipe.path);
  if (!suffix) return baseWithoutRid;
  return baseWithoutRid + suffix;
}

/**
 * Parse comma-separated string into trimmed array.
 * @param {string} str - String
 * @returns {string[]} Array of trimmed, non-empty values
 */
function parseList(str) {
  if (!str) return [];
  return str.split(',').map((s) => s.trim()).filter((s) => s);
}

/**
 * Extract words from a title.
 * @param {string} title - Recipe title
 * @returns {string[]} Array of lowercase words
 */
function getTitleWords(title) {
  if (!title) return [];
  return title
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

/**
 * Count how many items from array A appear in array B.
 * @param {string[]} a - Source array
 * @param {string[]} b - Array to check against
 * @returns {number} Number of items from A that exist in B
 */
function intersectionCount(a, b) {
  return a.filter((item) => b.includes(item)).length;
}

/**
 * Check if all items in A are present in B.
 * @param {string[]} a - Source array
 * @param {string[]} b - Array to check against
 * @returns {boolean} `true` if A is non-empty and all items in A exist in B
 */
function isExactMatch(a, b) {
  return a.length > 0 && a.every((item) => b.includes(item));
}

/**
 * Calculate relatedness score between target recipe and a candidate.
 * @param {Object} target - Target recipe with parsed attributes
 * @param {Object} candidate - Candidate recipe
 * @returns {number} Weighted relatedness score
 */
function getRelatedScore(target, candidate) {
  let score = 0;
  const exactMatchBonus = 2;

  // Title word overlap (strongest signal - "Agua Fresca" matches "Agua Fresca")
  const titleOverlap = intersectionCount(target.titleWords, candidate.titleWords);
  score += titleOverlap * WEIGHTS.titleWords;

  // Recipe type overlap
  const typeOverlap = intersectionCount(target.recipeType, candidate.recipeType);
  score += typeOverlap * WEIGHTS.recipeType;
  if (isExactMatch(target.recipeType, candidate.recipeType)) {
    score += exactMatchBonus;
  }

  // Course overlap
  const courseOverlap = intersectionCount(target.course, candidate.course);
  score += courseOverlap * WEIGHTS.course;
  if (isExactMatch(target.course, candidate.course)) {
    score += exactMatchBonus;
  }

  // Dietary interests overlap
  const dietaryOverlap = intersectionCount(target.dietaryInterests, candidate.dietaryInterests);
  score += dietaryOverlap * WEIGHTS.dietaryInterests;

  return score;
}

/**
 * Check if a recipe has ANY overlap with the target (fast pre-filter).
 * @param {Object} target - Target recipe with parsed attribute arrays
 * @param {Object} recipe - Raw recipe object from data source
 * @returns {boolean} True if any attribute overlaps with target
 */
function hasAnyOverlap(target, recipe) {
  const titleWords = getTitleWords(recipe.title);
  if (titleWords.some((w) => target.titleWords.includes(w))) return true;

  const types = parseList(recipe['recipe-type']);
  if (types.some((t) => target.recipeType.includes(t))) return true;

  const courses = parseList(recipe.course);
  if (courses.some((c) => target.course.includes(c))) return true;

  const dietary = parseList(recipe['dietary-interests']);
  if (dietary.some((d) => target.dietaryInterests.includes(d))) return true;

  return false;
}

/**
 * Find related recipes based on weighted attribute overlap.
 * @param {Object} target - Target recipe with parsed attributes
 * @param {Object[]} allRecipes - Array of all recipe objects
 * @param {number} [max=3] - Maximum number of related recipes
 * @returns {Object[]} Array of related recipe objects
 */
function findRelatedRecipes(target, allRecipes, max = 3) {
  // Pre-filter: only recipes with at least one overlapping attribute
  const targetPath = stripRecipeId(stripImmersionBlenderSuffix(target.path));
  const candidates = allRecipes.filter((recipe) => (
    stripRecipeId(recipe.path) !== targetPath
    && recipe.title !== target.title
    && recipe.status !== 'Deleted'
    && recipe.image
    && !recipe.image.includes('default-meta-image')
    && hasAnyOverlap(target, recipe)
  ));

  const scored = candidates
    .map((recipe) => {
      const candidate = {
        ...recipe,
        titleWords: getTitleWords(recipe.title),
        recipeType: parseList(recipe['recipe-type']),
        course: parseList(recipe.course),
        dietaryInterests: parseList(recipe['dietary-interests']),
      };
      return {
        recipe,
        score: getRelatedScore(target, candidate),
      };
    })
    .sort((a, b) => b.score - a.score);

  // Deduplicate by title, keeping the highest-scored version
  const seenTitles = new Set();
  return scored.reduce((results, { recipe }) => {
    if (results.length < max && !seenTitles.has(recipe.title)) {
      seenTitles.add(recipe.title);
      results.push(recipe);
    }
    return results;
  }, []);
}

/**
 * Builds the highlight recipe list.
 * @param {Array<{ recipe: Object, suffix: string }>} rows - Display rows
 * @param {Object} placeholders - Placeholders for formatting
 */
function buildFeaturedList(rows, placeholders) {
  const ul = document.createElement('ul');
  rows.forEach(({ recipe, suffix }) => {
    let imagePath = recipe.image;
    try {
      const imageUrl = new URL(imagePath, window.location.origin);
      imagePath = imageUrl.pathname + imageUrl.search;
    } catch (e) {
      // use as-is
    }

    const { difficulty } = recipe;
    const timeText = formatTime(recipe['total-time'], placeholders);
    const servesText = formatServings(recipe.yield);

    const badge = difficulty
      ? `<span class="badge" data-difficulty="${toClassName(difficulty)}">${difficulty}</span>`
      : '';

    const timeItem = timeText
      ? `<span><img src="/blocks/recipe/time.svg" alt=""> ${timeText}</span>`
      : '';
    const servesItem = servesText
      ? `<span><img src="/blocks/recipe/yield.svg" alt=""> ${servesText}</span>`
      : '';
    const metaRow = (timeItem || servesItem)
      ? `<p class="meta">${timeItem}${servesItem}</p>`
      : '';

    const li = document.createElement('li');
    const href = recipeHrefForDisplay(recipe, suffix);
    li.innerHTML = `
      <a href="${href}">
        <div class="image-wrapper">
          <img src="${imagePath}" alt="" loading="lazy" />
          ${badge}
        </div>
        <div class="body">
          <h2>${recipe.title}</h2>
          ${metaRow}
        </div>
      </a>
    `;
    ul.append(li);
  });
  return ul;
}

export default async function decorate(block) {
  const hasHighlight = block.classList.contains('highlight');
  const { locale, language } = getLocaleAndLanguage();
  const placeholders = hasHighlight ? await fetchPlaceholders(`/${locale}/${language}`) : {};
  const path = `/${locale}/${language}/recipes/query-index.json`;
  const resp = await fetch(path);
  if (!resp.ok) {
    block.remove();
    return;
  }

  const { data } = await resp.json();
  if (!data || data.length === 0) {
    block.remove();
    return;
  }

  // Manual links: match index, carry immersion-blender suffix
  const links = [...block.querySelectorAll('a[href]')];
  const manualRows = links
    .map((anchor) => {
      const { pathname } = new URL(anchor.href);
      const recipe = findMatchingRecipe(pathname, data);
      if (!recipe) return null;
      return {
        recipe,
        suffix: immersionBlenderSuffixFromAuthorPath(pathname),
      };
    })
    .filter((row) => row);

  // If no manual links found, use algorithmic matching
  let relatedRows;
  if (manualRows.length > 0) {
    relatedRows = manualRows;
  } else {
    // Get current recipe metadata
    const title = document.querySelector('h1').textContent.trim() || '';
    const titleWords = getTitleWords(title);
    const recipeType = parseList(getMetadata('recipe-type'));
    const course = parseList(getMetadata('course'));
    const dietaryInterests = parseList(getMetadata('dietary-interests'));

    const target = {
      path: window.location.pathname,
      title,
      titleWords,
      recipeType,
      course,
      dietaryInterests,
    };

    const algorithmic = findRelatedRecipes(target, data, hasHighlight ? 5 : 3);
    relatedRows = algorithmic.map((recipe) => ({
      recipe,
      suffix: '',
    }));
  }

  if (relatedRows.length < 1) {
    block.remove();
    return;
  }

  if (hasHighlight) {
    block.replaceChildren(buildFeaturedList(relatedRows, placeholders));
    return;
  }

  // Build the related recipes UI
  const ul = document.createElement('ul');

  relatedRows.forEach(({ recipe, suffix }) => {
    const li = document.createElement('li');
    // Convert image URL to relative path (pathname + query params only)
    let imagePath = recipe.image;
    try {
      const imageUrl = new URL(imagePath, window.location.origin);
      imagePath = imageUrl.pathname + imageUrl.search;
    } catch (e) {
      // If URL parsing fails, use the path as-is
    }
    const href = recipeHrefForDisplay(recipe, suffix);
    li.innerHTML = `
      <a href="${href}">
        <img src="${imagePath}" alt="" loading="lazy" />
        <span>${recipe.title}</span>
      </a>
    `;
    ul.append(li);
  });

  block.replaceChildren(ul);
  buildCarousel(block, false);
}
