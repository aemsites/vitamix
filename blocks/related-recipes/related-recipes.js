import { getMetadata } from '../../scripts/aem.js';
import { buildCarousel, getLocaleAndLanguage } from '../../scripts/scripts.js';

const WEIGHTS = {
  titleWords: 4,
  recipeType: 3,
  course: 2,
  dietaryInterests: 1,
};

/**
 * Find matching recipe in data by href path.
 * @param {string} href - href path to match
 * @param {Object[]} data - Array of all recipe objects
 * @returns {Object|undefined} Matching recipe or undefined
 */
function findMatchingRecipe(href, data) {
  // If href has -r ID, try exact match; otherwise match base path
  if (href.includes('-r')) {
    return data.find((recipe) => recipe.path === href);
  }

  // Match base path (without r-ID suffix)
  return data.find((recipe) => {
    const recipePath = recipe.path.split('-r')[0];
    return recipePath === href;
  });
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
  const candidates = allRecipes.filter((recipe) => (
    recipe.path !== target.path
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

export default async function decorate(block) {
  const { locale, language } = getLocaleAndLanguage();
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

  // Get links from block and find matching recipes in data
  const links = [...block.querySelectorAll('a[href]')];
  const hrefs = links.map((a) => new URL(a.href).pathname);
  const matchingRecipes = hrefs
    .map((href) => findMatchingRecipe(href, data))
    .filter((r) => r);

  // If no manual links found, use algorithmic matching
  let relatedRecipes;
  if (matchingRecipes.length > 0) {
    relatedRecipes = matchingRecipes;
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

    relatedRecipes = findRelatedRecipes(target, data);
  }

  if (relatedRecipes.length < 1) {
    block.remove();
    return;
  }

  // Build the related recipes UI
  const ul = document.createElement('ul');

  relatedRecipes.forEach((recipe) => {
    const li = document.createElement('li');
    // Convert image URL to relative path (pathname + query params only)
    let imagePath = recipe.image.replace('/recipes/media_', '/media_');
    try {
      const imageUrl = new URL(imagePath, window.location.origin);
      imagePath = imageUrl.pathname + imageUrl.search;
    } catch (e) {
      // If URL parsing fails, use the transformed path as-is
    }
    li.innerHTML = `
      <a href="${recipe.path}">
        <img src="${imagePath}" alt="" loading="lazy" />
        <span>${recipe.title}</span>
      </a>
    `;
    ul.append(li);
  });

  block.replaceChildren(ul);
  buildCarousel(block, false);
}
