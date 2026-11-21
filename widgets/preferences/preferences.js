import { createOptimizedPicture } from '../../scripts/aem.js';
import { loadWidgetCopy } from '../../scripts/scripts.js';
import { logError } from '../../scripts/operations-log.js';
import { getStorage, isStorageAvailable } from '../../scripts/safe-storage.js';
import {
  addEdgeRecipeFavorite,
  removeEdgeRecipeFavorite,
  syncSavedRecipesWithCustomer,
} from '../../scripts/recipe-favorites.js';
import { getSavedRecipeSlugs, recipeSlugFromPathname } from '../../scripts/recipe-storage.js';
import {
  findRecipeBySlug, recipeHref, recipeImageSrc, titleFromSlug,
} from '../account/recipe-book.js';
import { getWidgetLocaleAndLanguage } from '../product-list/products.js';

const INTERESTS_KEY = 'vitamix-dietary-interests';
const DEFAULT_COPY = {
  selectedCount: '{{value}} selected',
  unavailable: 'Recipe unavailable',
  remove: 'Remove',
  removeAria: 'Remove {{value}} from your recipe book',
  interestSaved: 'Saved: {{value}} added to your dietary interests.',
  interestRemoved: 'Saved: {{value}} removed from your dietary interests.',
  recipeRemoved: '{{value}} removed from your recipe book.',
  addRecipes: 'Add recipes to your recipe book',
  searchRecipes: 'Search recipes',
  searchPlaceholder: 'Type to search recipes',
  addAria: 'Add {{value}} to your recipe book',
  alreadyAdded: '{{value}} is already in your recipe book',
  recipeAdded: '{{value}} added to your recipe book.',
  addError: 'Could not add this recipe. Please try again.',
  loadError: 'Could not load recipes and preferences. Please try again.',
  saveError: 'Could not save your dietary interests. Please try again.',
  removeError: 'Could not remove this recipe. Please try again.',
  storageError: 'Your browser is blocking storage. Allow site data to save preferences and manage your recipe book.',
};

function highlightMatches(element, text, term) {
  element.replaceChildren();
  const lower = text.toLowerCase();
  let start = 0;
  let index = lower.indexOf(term);
  while (index !== -1) {
    element.append(document.createTextNode(text.slice(start, index)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(index, index + term.length);
    element.append(mark);
    start = index + term.length;
    index = lower.indexOf(term, start);
  }
  element.append(document.createTextNode(text.slice(start)));
}

async function fetchRecipes(locale, language) {
  const rows = [];
  let total;
  do {
    // Each page's offset depends on the rows returned by the previous page.
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(`/${locale}/${language}/recipes/query-index.json?offset=${rows.length}`);
    if (!response.ok) throw new Error(`Recipe index failed (${response.status})`);
    // eslint-disable-next-line no-await-in-loop
    const payload = await response.json();
    if (!Array.isArray(payload.data)) throw new Error('Invalid recipe index');
    if (!payload.data.length && rows.length < total) {
      throw new Error('Incomplete recipe index');
    }
    rows.push(...payload.data);
    total = Number(payload.total) || rows.length;
  } while (rows.length < total);
  return rows.filter((recipe) => String(recipe.status || '').toLowerCase() !== 'deleted');
}

function readInterests() {
  const raw = getStorage().getItem(INTERESTS_KEY);
  if (!raw) return [];
  const values = JSON.parse(raw);
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new Error('Invalid dietary preferences');
  }
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function getInterests(recipes, selected) {
  const values = new Map();
  [...selected, ...recipes.flatMap((recipe) => {
    const raw = recipe['dietary-interests'];
    return Array.isArray(raw) ? raw : String(raw || '').split(',');
  })].forEach((value) => {
    const label = String(value).trim();
    if (label) values.set(label.toLowerCase(), label);
  });
  return [...values.values()].sort((a, b) => a.localeCompare(b));
}

export default async function decorate(widget) {
  const { locale, language } = getWidgetLocaleAndLanguage();
  const copy = {
    ...DEFAULT_COPY,
    ...await loadWidgetCopy(import.meta.url, language.split('_')[0]),
  };
  widget.querySelectorAll('[data-copy]').forEach((element) => {
    if (copy[element.dataset.copy]) element.textContent = copy[element.dataset.copy];
  });

  const error = widget.querySelector('.preferences-error');
  const status = widget.querySelector('.preferences-status');
  const interestStatus = widget.querySelector('.preferences-interest-status');
  const panels = widget.querySelector('.preferences-panels');
  const loading = widget.querySelector('.preferences-loading');
  const retry = widget.querySelector('.preferences-retry');
  const interestList = widget.querySelector('.preferences-interest-list');
  const recipeList = widget.querySelector('.preferences-recipe-list');
  const addToggle = widget.querySelector('.preferences-add-toggle');
  const ghostRecipe = widget.querySelector('.preferences-ghost-recipe');
  const searchPanel = widget.querySelector('.preferences-recipe-search');
  const searchForm = widget.querySelector('.preferences-search-form');
  const searchInput = widget.querySelector('.preferences-search-input');
  const searchResults = widget.querySelector('.preferences-search-results');
  const searchEmpty = widget.querySelector('.preferences-search-empty');
  addToggle.setAttribute('aria-label', copy.addRecipes);
  searchForm.setAttribute('aria-label', copy.searchRecipes);
  searchInput.setAttribute('aria-label', copy.searchRecipes);
  searchInput.placeholder = copy.searchPlaceholder;
  let recipes = [];
  let selected = [];
  let busy = false;

  const message = (key, value) => copy[key].replace('{{value}}', value);
  const showError = (cause, text) => {
    logError('preferences-widget', cause);
    error.textContent = text;
    error.hidden = false;
    status.textContent = '';
    interestStatus.textContent = '';
  };
  const clearError = () => {
    error.hidden = true;
    error.textContent = '';
  };
  const canSave = () => {
    if (isStorageAvailable()) return true;
    showError(new Error('Local storage is unavailable'), copy.storageError);
    return false;
  };

  const renderInterests = () => {
    interestList.replaceChildren();
    const interests = getInterests(recipes, selected);
    widget.querySelector('.preferences-interests-empty').hidden = interests.length > 0;
    widget.querySelector('.preferences-interest-count').textContent = message('selectedCount', selected.length);
    interests.forEach((interest) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preferences-interest';
      button.dataset.interest = interest;
      const pressed = selected.some((value) => value.toLowerCase() === interest.toLowerCase());
      button.setAttribute('aria-pressed', String(pressed));
      button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>';
      button.append(document.createTextNode(interest));
      item.append(button);
      interestList.append(item);
    });
  };

  const createRecipeItem = (recipe, title, forSearch = false) => {
    const item = document.createElement('li');
    item.className = 'preferences-recipe';
    const image = recipeImageSrc(recipe?.image);
    if (image) item.append(createOptimizedPicture(image, '', false, [{ width: '300' }]));
    const body = document.createElement(forSearch ? 'span' : 'div');
    body.className = 'preferences-recipe-body';
    const heading = document.createElement(forSearch ? 'span' : 'h4');
    heading.className = 'preferences-recipe-title';
    heading.textContent = title;
    body.append(heading);
    item.append(body);
    return { item, body, heading };
  };

  const renderSearch = () => {
    searchResults.replaceChildren();
    const term = searchInput.value.trim().toLowerCase();
    widget.querySelector('.preferences-search-hint').hidden = !!term;
    if (!term) {
      searchEmpty.hidden = true;
      return;
    }
    const fields = ['title', 'compatible-containers', 'dietary-interests', 'course', 'recipe-type'];
    const seen = new Set();
    const saved = new Set(getSavedRecipeSlugs());
    const matches = recipes.filter((recipe) => {
      const slug = recipeSlugFromPathname(recipe.path);
      if (!slug || !recipe.title || seen.has(slug)) return false;
      if (!fields.some((field) => String(recipe[field] || '').toLowerCase().includes(term))) {
        return false;
      }
      seen.add(slug);
      return true;
    });
    searchEmpty.hidden = matches.length > 0;
    matches.forEach((recipe) => {
      const slug = recipeSlugFromPathname(recipe.path);
      const { item, heading } = createRecipeItem(recipe, recipe.title, true);
      highlightMatches(heading, recipe.title, term);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preferences-search-result';
      button.dataset.slug = slug;
      button.dataset.title = recipe.title;
      button.disabled = busy || saved.has(slug);
      button.setAttribute('aria-label', message(saved.has(slug) ? 'alreadyAdded' : 'addAria', recipe.title));
      button.append(...item.childNodes);
      item.append(button);
      searchResults.append(item);
    });
  };

  const renderRecipes = () => {
    recipeList.replaceChildren();
    const slugs = getSavedRecipeSlugs();
    widget.querySelector('.preferences-recipes-empty').hidden = slugs.length > 0;
    widget.querySelector('.preferences-recipe-count').textContent = String(slugs.length);
    slugs.forEach((slug) => {
      const recipe = findRecipeBySlug(recipes, slug);
      const title = recipe?.title || titleFromSlug(slug);
      const { item, body, heading } = createRecipeItem(recipe, title);
      const href = recipeHref(recipe?.path);
      if (href) {
        heading.replaceChildren();
        const link = document.createElement('a');
        link.href = href;
        link.textContent = title;
        heading.append(link);
      } else {
        heading.textContent = title;
      }
      if (!recipe) {
        const note = document.createElement('p');
        note.textContent = copy.unavailable;
        body.append(note);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'preferences-remove';
      remove.dataset.slug = slug;
      remove.dataset.title = title;
      remove.textContent = copy.remove;
      remove.setAttribute('aria-label', message('removeAria', title));
      body.append(remove);
      recipeList.append(item);
    });
  };

  const setSearchOpen = (open) => {
    searchPanel.hidden = !open;
    ghostRecipe.hidden = open;
    addToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      renderSearch();
      searchInput.focus();
    } else {
      searchInput.value = '';
      renderSearch();
      addToggle.focus();
    }
  };
  addToggle.addEventListener('click', () => setSearchOpen(true));
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderSearch();
  });
  searchInput.addEventListener('input', renderSearch);
  searchPanel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || busy) return;
    setSearchOpen(false);
  });
  searchResults.addEventListener('click', async (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('button[data-slug]');
    if (!button || button.disabled || busy || !canSave()) return;
    clearError();
    busy = true;
    panels.setAttribute('aria-busy', 'true');
    panels.querySelectorAll('button').forEach((control) => { control.disabled = true; });
    searchInput.disabled = true;
    try {
      await addEdgeRecipeFavorite(button.dataset.slug);
      if (!canSave()) return;
      if (!getSavedRecipeSlugs().includes(button.dataset.slug)) {
        throw new Error('Recipe addition was not persisted');
      }
      renderRecipes();
      status.textContent = message('recipeAdded', button.dataset.title);
      setSearchOpen(false);
    } catch (cause) {
      showError(cause, copy.addError);
    } finally {
      busy = false;
      panels.setAttribute('aria-busy', 'false');
      panels.querySelectorAll('button').forEach((control) => { control.disabled = false; });
      searchInput.disabled = false;
      renderSearch();
      if (searchPanel.hidden) addToggle.focus();
      else searchInput.focus();
    }
  });

  interestList.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('button[data-interest]');
    if (!button || busy || !canSave()) return;
    clearError();
    try {
      const current = readInterests();
      const interest = button.dataset.interest.toLowerCase();
      const wasSelected = current.some((value) => value.toLowerCase() === interest);
      const next = wasSelected
        ? current.filter((value) => value.toLowerCase() !== interest)
        : [...current, button.dataset.interest];
      getStorage().setItem(INTERESTS_KEY, JSON.stringify(next));
      if (!canSave()) return;
      selected = readInterests();
      renderInterests();
      interestList.querySelectorAll('button').forEach((candidate) => {
        if (candidate.dataset.interest.toLowerCase() === interest) candidate.focus();
      });
      interestStatus.textContent = message(wasSelected ? 'interestRemoved' : 'interestSaved', button.dataset.interest);
    } catch (cause) {
      showError(cause, copy.saveError);
    }
  });

  recipeList.addEventListener('click', async (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('button[data-slug]');
    if (!button || busy || !canSave()) return;
    clearError();
    busy = true;
    panels.setAttribute('aria-busy', 'true');
    panels.querySelectorAll('button').forEach((control) => { control.disabled = true; });
    const buttons = [...recipeList.querySelectorAll('button')];
    const position = buttons.indexOf(button);
    try {
      await removeEdgeRecipeFavorite(button.dataset.slug);
      if (!canSave()) return;
      if (getSavedRecipeSlugs().includes(button.dataset.slug)) {
        throw new Error('Recipe removal was not persisted');
      }
      renderRecipes();
      const remaining = [...recipeList.querySelectorAll('button')];
      const focusTarget = remaining[Math.min(position, remaining.length - 1)]
        || widget.querySelector('.preferences-recipes-empty');
      if (!remaining.length) focusTarget.setAttribute('tabindex', '-1');
      focusTarget.focus();
      status.textContent = message('recipeRemoved', button.dataset.title);
    } catch (cause) {
      showError(cause, copy.removeError);
    } finally {
      busy = false;
      panels.setAttribute('aria-busy', 'false');
      panels.querySelectorAll('button').forEach((control) => { control.disabled = false; });
      renderSearch();
    }
  });

  const load = async () => {
    if (busy) return;
    busy = true;
    clearError();
    retry.hidden = true;
    loading.hidden = false;
    panels.setAttribute('aria-busy', 'true');
    panels.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      selected = readInterests();
      const results = await Promise.allSettled([
        fetchRecipes(locale, language).then((rows) => { recipes = rows; }),
        isStorageAvailable() ? syncSavedRecipesWithCustomer() : Promise.resolve(),
      ]);
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
      canSave();
    } catch (cause) {
      showError(cause, copy.loadError);
      retry.hidden = false;
    } finally {
      renderInterests();
      renderRecipes();
      loading.hidden = true;
      panels.setAttribute('aria-busy', 'false');
      busy = false;
      addToggle.disabled = false;
      renderSearch();
    }
  };
  retry.addEventListener('click', load);
  await load();
}
