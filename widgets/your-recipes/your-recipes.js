import { decorateBlock, loadBlock, loadCSS } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';
import {
  createRelatedRecipeTarget,
  findMatchingRecipe,
  findRelatedRecipes,
  stripRecipeId,
} from '../../blocks/related-recipes/related-recipes.js';
import {
  getSavedRecipes,
  getRecentlyViewedRecipes,
  normalizeRecipePath,
} from '../../scripts/recipe-storage.js';

/** Same cap as `related-recipes` highlight layout in the block decorator. */
const HIGHLIGHT_RELATED_MAX = 5;

/**
 * @param {string} lang - Widget JSON key (e.g. en, fr)
 * @returns {Promise<Object>}
 */
async function loadWidgetCopy(lang) {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const url = `${window.hlx?.codeBasePath || ''}${jsonPath}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const key = data[lang] ? lang : 'en';
  return data[key] || {};
}

/**
 * @param {{ pathname: string, addedAt?: string }[]} entries
 * @returns {{ pathname: string, addedAt?: string }[]}
 */
function sortSavedByDateDesc(entries) {
  return [...entries].sort(
    (a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime(),
  );
}

/**
 * @param {{ pathname: string, viewedAt?: string }[]} entries
 * @returns {{ pathname: string, viewedAt?: string }[]}
 */
function sortViewedByDateDesc(entries) {
  return [...entries].sort(
    (a, b) => new Date(b.viewedAt || 0).getTime() - new Date(a.viewedAt || 0).getTime(),
  );
}

/**
 * @param {HTMLElement} container
 * @param {string[]} pathnames
 * @param {string} headingText
 */
async function mountRelatedRecipesHighlight(container, pathnames, headingText) {
  if (!pathnames.length) return;

  const group = document.createElement('section');
  group.className = 'your-recipes-group';

  const h2 = document.createElement('h2');
  h2.className = 'your-recipes-group-title';
  h2.textContent = headingText;
  group.append(h2);

  const related = document.createElement('div');
  related.classList.add('related-recipes', 'highlight');

  pathnames.forEach((pathname) => {
    const a = document.createElement('a');
    a.href = pathname;
    related.append(a);
  });

  group.append(related);
  container.append(group);

  decorateBlock(related);
  await loadBlock(related);

  if (!related.isConnected) {
    group.remove();
  }
}

async function init() {
  const root = document.querySelector('.your-recipes .your-recipes-inner');
  if (!root) return;

  const codeBase = window.hlx?.codeBasePath || '';
  await loadCSS(`${codeBase}/widgets/your-recipes/your-recipes.css`);

  const { locale, language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadWidgetCopy(lang);

  const savedSorted = sortSavedByDateDesc(getSavedRecipes());
  const savedPaths = savedSorted.map((e) => normalizeRecipePath(e.pathname)).filter(Boolean);

  const savedPathSet = new Set(savedPaths);
  const viewedSorted = sortViewedByDateDesc(getRecentlyViewedRecipes());
  const viewedPaths = viewedSorted
    .map((e) => normalizeRecipePath(e.pathname))
    .filter((p) => p && !savedPathSet.has(p));

  root.replaceChildren();

  if (!savedPaths.length && !viewedPaths.length) {
    const empty = document.createElement('p');
    empty.className = 'your-recipes-empty';
    empty.textContent = copy.empty || 'Save recipes or browse the recipe collection to see them here.';
    root.append(empty);
    return;
  }

  const combinedPaths = [...savedPaths, ...viewedPaths];
  await mountRelatedRecipesHighlight(
    root,
    combinedPaths,
    copy.yourRecipes || 'Your Recipes',
  );

  const indexPath = `/${locale}/${language}/recipes/query-index.json`;
  const indexResp = await fetch(indexPath);
  const recipeData = indexResp.ok ? (await indexResp.json()).data || [] : [];

  const anchorPath = savedPaths.length ? savedPaths[0] : viewedPaths[0];
  if (anchorPath && recipeData.length) {
    const anchorRecipe = findMatchingRecipe(anchorPath, recipeData);
    if (anchorRecipe) {
      const target = createRelatedRecipeTarget(anchorRecipe);
      const excludeSet = new Set(combinedPaths.map((p) => normalizeRecipePath(p)));
      const recommended = findRelatedRecipes(target, recipeData, HIGHLIGHT_RELATED_MAX).filter(
        (r) => !excludeSet.has(normalizeRecipePath(stripRecipeId(r.path))),
      );
      const recommendedPaths = recommended.map((r) => stripRecipeId(r.path));
      if (recommendedPaths.length) {
        await mountRelatedRecipesHighlight(
          root,
          recommendedPaths,
          copy.recommendedForYou || 'Recommended for you',
        );
      }
    }
  }

  if (!root.children.length) {
    const empty = document.createElement('p');
    empty.className = 'your-recipes-empty';
    empty.textContent = copy.empty || 'Save recipes or browse the recipe collection to see them here.';
    root.append(empty);
  }
}

init();
