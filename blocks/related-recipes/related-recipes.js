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
 * Strips trailing `-immersion-blender` suffix off URL path.
 * @param {string} path - Pathname, no query string
 * @returns {string} Same path, or shorter if it ended with that segment
 */
function stripEquipmentSuffix(path) {
  if (!path) return path;
  const suffixes = ['-immersion-blender', '-food-processor-attachment'];
  const suffix = suffixes.find((s) => path.endsWith(s));
  if (!suffix) return path;
  return path.slice(0, path.length - suffix.length);
}

/**
 * Uses the link the author provided (f `href` is empty, falls back to resolved pathname).
 * @param {HTMLAnchorElement} anchor - Link picked up from the block
 * @returns {string} What to put on the card's `<a href>`
 */
function hrefFromAuthorLink(anchor) {
  const attr = anchor.getAttribute('href');
  if (attr !== null && attr.trim() !== '') {
    return attr.trim();
  }
  const { pathname } = new URL(anchor.href);
  return pathname;
}

/**
 * Find matching recipe in data by href path.
 * @param {string} href - Pathname from the link (or current URL) to match
 * @param {Object[]} data - Array of all recipe objects
 * @returns {Object|undefined} Matching recipe, or undefined
 */
export function findMatchingRecipe(href, data) {
  const pathForMatch = stripEquipmentSuffix(href);

  if (pathForMatch.match(/-r\d+$/)) {
    return data.find((recipe) => recipe.path === pathForMatch);
  }

  // Match base path (without r-ID suffix)
  return data.find((recipe) => {
    const lastIndex = recipe.path.lastIndexOf('-r');
    const recipePath = recipe.path.substring(0, lastIndex);
    if (recipePath === pathForMatch) return true;
    return stripEquipmentSuffix(recipePath) === pathForMatch;
  });
}

/**
 * Strip recipe id suffix (-r###, redirect resolves the canonical URL).
 * @param {string} path - Path from the index
 * @returns {string} Path without the `-r###` suffix
 */
export function stripRecipeId(path) {
  if (!path) return path;
  return path.replace(/-r\d+$/, '');
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
export function findRelatedRecipes(target, allRecipes, max = 3) {
  // Pre-filter: only recipes with at least one overlapping attribute
  const targetPath = stripEquipmentSuffix(stripRecipeId(target.path));
  const candidates = allRecipes.filter((recipe) => (
    stripEquipmentSuffix(stripRecipeId(recipe.path)) !== targetPath
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
 * Builds the scoring target object used by {@link findRelatedRecipes} from a recipe index row.
 * @param {Object} recipe - Recipe object from query-index.json
 * @returns {Object} Target shape for findRelatedRecipes (path, title, parsed facets)
 */
export function createRelatedRecipeTarget(recipe) {
  const title = recipe.title || '';
  return {
    path: recipe.path,
    title,
    titleWords: getTitleWords(title),
    recipeType: parseList(recipe['recipe-type']),
    course: parseList(recipe.course),
    dietaryInterests: parseList(recipe['dietary-interests']),
  };
}

/**
 * Builds the highlight recipe list.
 * @param {Array<{ recipe: Object, href: string }>} rows - Recipe plus URL (author or generated)
 * @param {Object} placeholders - Placeholders for formatting
 */
function buildFeaturedList(rows, placeholders) {
  const ul = document.createElement('ul');
  rows.forEach(({ recipe, href }) => {
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

  // Manual links: pathname + fuzzy strip for index match
  const links = [...block.querySelectorAll('a[href]')];
  const manualRows = links
    .map((anchor) => {
      const { pathname } = new URL(anchor.href);
      const recipe = findMatchingRecipe(pathname, data);
      if (!recipe) return null;
      return {
        recipe,
        href: hrefFromAuthorLink(anchor),
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
      href: stripRecipeId(recipe.path),
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

  relatedRows.forEach(({ recipe, href }) => {
    const li = document.createElement('li');
    // Convert image URL to relative path (pathname + query params only)
    let imagePath = recipe.image;
    try {
      const imageUrl = new URL(imagePath, window.location.origin);
      imagePath = imageUrl.pathname + imageUrl.search;
    } catch (e) {
      // If URL parsing fails, use the path as-is
    }
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
