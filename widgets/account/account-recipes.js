/* eslint-disable import/prefer-default-export -- module is recipe-book wiring only */
/* eslint-disable no-alert -- minimal user feedback for recipe-book errors */
import { createOptimizedPicture } from '../../scripts/aem.js';
import { formatServings, formatTime } from '../../scripts/scripts.js';
import {
  getLoggedInCustomer,
  unwrapCustomerResponse,
  updateCustomer,
} from './account-api.js';
import {
  findRecipeBySlug,
  getRecipeSlugsFromCustomer,
  recipeHref,
  recipeImageSrc,
  recipesCustomPatch,
  titleFromSlug,
} from './recipe-book.js';
import { syncSavedRecipesWithCustomer } from '../../scripts/recipe-favorites.js';
import {
  getSavedRecipeSlugs,
  mergeRecipeSlugLists,
  setSavedRecipeSlugs,
} from '../../scripts/recipe-storage.js';

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
function unwrapCustomer(raw) {
  let customer = unwrapCustomerResponse(raw);
  if (Array.isArray(customer) && customer.length === 1) [customer] = customer;
  return customer && typeof customer === 'object'
    ? /** @type {Record<string, unknown>} */ (customer)
    : null;
}

/**
 * @param {unknown} payload
 * @returns {Record<string, unknown>[]}
 */
function recipeIndexRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const { data } = /** @type {Record<string, unknown>} */ (payload);
    if (Array.isArray(data)) return data;
  }
  return [];
}

/**
 * @param {string} locale
 * @param {string} language
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function fetchRecipeIndex(locale, language) {
  const resp = await fetch(`/${locale}/${language}/recipes/query-index.json`);
  if (!resp.ok) throw new Error(`Recipe index failed (${resp.status})`);
  return recipeIndexRows(await resp.json());
}

/**
 * @param {HTMLElement} parent
 * @param {string} iconSrc
 * @param {string} alt
 * @param {string} text
 */
function appendMetaItem(parent, iconSrc, alt, text) {
  if (!text) return;
  const span = document.createElement('span');
  const img = document.createElement('img');
  img.src = iconSrc;
  img.alt = alt;
  span.append(img, document.createTextNode(` ${text}`));
  parent.append(span);
}

/**
 * Wires the Recipe Book panel: resolve `custom.recipes` slugs against the
 * locale recipe index, render cards, and PATCH remaining slugs on delete.
 *
 * @param {HTMLElement} widget
 * @param {string} email
 * @param {string} locale
 * @param {string} language
 * @param {Record<string, unknown>} copy
 * @param {unknown} [initialCustomer]
 * @returns {{ load: () => Promise<void> }}
 */
export function wireAccountRecipes(widget, email, locale, language, copy, initialCustomer) {
  const panel = widget.querySelector('.account-panel[data-section="recipes"]');
  const loadingEl = widget.querySelector('.account-recipes-loading');
  const emptyEl = widget.querySelector('.account-recipes-empty');
  const errorEl = widget.querySelector('.account-recipes-error');
  const listEl = widget.querySelector('.account-recipe-list');
  const rb = /** @type {Record<string, string>} */ (copy.recipeBook || {});

  /** @type {Record<string, unknown> | null} */
  let currentCustomer = unwrapCustomer(initialCustomer);
  /** @type {Record<string, unknown>[]} */
  let indexRows = [];
  let indexLoaded = false;
  let recipesLoaded = false;
  /** @type {Promise<void> | null} */
  let recipesPromise = null;

  const setLoading = (loading) => {
    if (loadingEl) loadingEl.hidden = !loading;
    if (loading) {
      if (listEl) listEl.hidden = true;
      if (emptyEl) emptyEl.hidden = true;
      if (errorEl) errorEl.hidden = true;
    }
  };

  const showError = (message) => {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
  };

  const hideError = () => {
    if (!errorEl) return;
    errorEl.hidden = true;
    errorEl.textContent = '';
  };

  const renderList = (slugs) => {
    if (!listEl) return;
    listEl.innerHTML = '';
    hideError();
    if (!slugs.length) {
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = rb.empty || 'No saved recipes yet.';
      }
      listEl.hidden = true;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.hidden = false;

    slugs.forEach((slug) => {
      const recipe = findRecipeBySlug(indexRows, slug);
      const title = recipe && typeof recipe.title === 'string' && recipe.title.trim()
        ? recipe.title
        : titleFromSlug(slug) || slug;
      const href = recipe ? recipeHref(recipe.path) : '';
      const imageSrc = recipe ? recipeImageSrc(recipe.image) : '';
      const timeText = recipe
        ? formatTime(String(recipe['total-time'] || ''), rb)
        : '';
      const yieldText = recipe ? formatServings(String(recipe.yield || '')) : '';
      const difficulty = recipe && typeof recipe.difficulty === 'string'
        ? recipe.difficulty.trim()
        : '';

      const li = document.createElement('li');
      li.className = 'account-recipe-item';
      li.dataset.recipeSlug = slug;

      const thumb = document.createElement('div');
      thumb.className = 'account-recipe-thumb';
      if (imageSrc) {
        try {
          thumb.append(createOptimizedPicture(imageSrc, title, false, [{ width: '180' }]));
        } catch {
          const img = document.createElement('img');
          img.src = imageSrc;
          img.alt = title;
          img.loading = 'lazy';
          thumb.append(img);
        }
      }

      const body = document.createElement('div');
      body.className = 'account-recipe-body';
      const heading = document.createElement('h3');
      heading.className = 'account-recipe-title';
      if (href) {
        const a = document.createElement('a');
        a.href = href;
        a.textContent = title;
        heading.append(a);
      } else {
        heading.textContent = title;
        li.classList.add('is-unavailable');
      }
      body.append(heading);

      if (timeText || yieldText || difficulty) {
        const meta = document.createElement('p');
        meta.className = 'account-recipe-meta';
        appendMetaItem(meta, '/blocks/recipe/time.svg', rb.time || 'Time', timeText);
        appendMetaItem(meta, '/blocks/recipe/yield.svg', rb.yield || 'Yield', yieldText);
        if (difficulty) {
          const span = document.createElement('span');
          span.textContent = difficulty;
          meta.append(span);
        }
        body.append(meta);
      } else if (!recipe) {
        const note = document.createElement('p');
        note.className = 'account-recipe-unavailable';
        note.textContent = rb.unavailable || 'Recipe unavailable';
        body.append(note);
      }

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'button link-style account-recipe-delete';
      delBtn.textContent = '×';
      delBtn.setAttribute('aria-label', rb.deleteAria
        ? rb.deleteAria.replace('{{title}}', title)
        : `${rb.delete || 'Remove'} ${title}`);
      delBtn.title = rb.delete || 'Remove';

      li.append(thumb, body, delBtn);
      listEl.append(li);
    });
  };

  const loadRecipeBook = async () => {
    if (!email || recipesLoaded) return;
    if (recipesPromise) {
      await recipesPromise;
      return;
    }
    setLoading(true);
    recipesPromise = (async () => {
      try {
        if (!currentCustomer) {
          currentCustomer = unwrapCustomer(await getLoggedInCustomer(email));
        }
        let slugs = getRecipeSlugsFromCustomer(currentCustomer);
        try {
          slugs = await syncSavedRecipesWithCustomer();
        } catch {
          slugs = mergeRecipeSlugLists(slugs, getSavedRecipeSlugs());
        }
        if (slugs.length && !indexLoaded) {
          indexRows = await fetchRecipeIndex(locale, language);
          indexLoaded = true;
        }
        renderList(slugs);
        recipesLoaded = true;
      } catch {
        if (emptyEl) {
          emptyEl.hidden = false;
          emptyEl.textContent = rb.loadError || 'Could not load recipes. Please try again.';
        }
        if (listEl) listEl.hidden = true;
      } finally {
        setLoading(false);
        recipesPromise = null;
      }
    })();
    await recipesPromise;
  };

  if (panel && listEl) {
    listEl.addEventListener('click', async (e) => {
      const { target } = e;
      if (!(target instanceof Element)) return;
      const delBtn = /** @type {HTMLButtonElement | null} */ (target.closest('.account-recipe-delete'));
      if (!delBtn) return;
      const item = delBtn.closest('.account-recipe-item');
      const slug = item?.dataset.recipeSlug;
      if (!slug || !email) return;
      const ok = window.confirm(rb.deleteConfirm || 'Remove this recipe from your recipe book?');
      if (!ok) return;
      hideError();
      delBtn.disabled = true;
      try {
        const latest = unwrapCustomer(await getLoggedInCustomer(email)) || currentCustomer;
        const slugs = mergeRecipeSlugLists(
          getRecipeSlugsFromCustomer(latest),
          getSavedRecipeSlugs(),
        );
        const remaining = slugs.filter((itemSlug) => itemSlug !== slug);
        const updated = unwrapCustomer(await updateCustomer(email, recipesCustomPatch(remaining)));
        if (updated) {
          currentCustomer = updated;
        } else {
          const prevCustom = latest && typeof latest.custom === 'object' && latest.custom
            ? /** @type {Record<string, unknown>} */ (latest.custom)
            : {};
          const custom = { ...prevCustom, recipes: remaining };
          currentCustomer = { ...(latest || {}), custom };
        }
        const remainingSlugs = getRecipeSlugsFromCustomer(currentCustomer);
        setSavedRecipeSlugs(remainingSlugs);
        renderList(remainingSlugs);
      } catch {
        showError(rb.deleteError || 'Could not remove recipe. Please try again.');
      } finally {
        delBtn.disabled = false;
      }
    });
  }

  return { load: loadRecipeBook };
}

export default wireAccountRecipes;
