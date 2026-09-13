import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addSavedRecipe,
  getSavedRecipeSlugs,
  isRecipeSaved,
  mergeRecipeSlugLists,
  recipeSlugFromPathname,
  removeSavedRecipe,
  setSavedRecipeSlugs,
  toggleSavedRecipe,
} from '../../scripts/recipe-storage.js';

test('recipeSlugFromPathname uses the last segment and strips -r ids', () => {
  globalThis.__resetTestState();
  assert.equal(
    recipeSlugFromPathname('/ca/en_us/recipes/jalapeo-tequila-cocktail'),
    'jalapeo-tequila-cocktail',
  );
  assert.equal(
    recipeSlugFromPathname('/us/en_us/recipes/mango-lassi-r99?foo=1#bar'),
    'mango-lassi',
  );
  assert.equal(recipeSlugFromPathname('/us/en_us/recipes'), '');
});

test('saved recipes persist slugs in localStorage and ignore duplicates', () => {
  globalThis.__resetTestState();
  addSavedRecipe('/ca/en_us/recipes/jalapeno-tequila-cocktail');
  addSavedRecipe('jalapeno-tequila-cocktail');
  assert.deepEqual(getSavedRecipeSlugs(), ['jalapeno-tequila-cocktail']);
  assert.equal(isRecipeSaved('jalapeno-tequila-cocktail'), true);
});

test('toggleSavedRecipe adds then removes', () => {
  globalThis.__resetTestState();
  assert.equal(toggleSavedRecipe('mango-lassi'), true);
  assert.equal(toggleSavedRecipe('mango-lassi'), false);
  assert.equal(isRecipeSaved('mango-lassi'), false);
});

test('setSavedRecipeSlugs replaces the list and mergeRecipeSlugLists is remote-first', () => {
  globalThis.__resetTestState();
  setSavedRecipeSlugs(['a', 'b']);
  removeSavedRecipe('a');
  assert.deepEqual(getSavedRecipeSlugs(), ['b']);
  assert.deepEqual(mergeRecipeSlugLists(['remote', 'b'], ['b', 'local']), ['remote', 'b', 'local']);
});

test('coerces legacy pathname entries from localStorage', () => {
  globalThis.__resetTestState();
  localStorage.setItem('vitamix-recipe-saved', JSON.stringify([
    { pathname: '/us/en_us/recipes/old-path-r12', addedAt: '2026-04-01T00:00:00.000Z' },
  ]));
  assert.deepEqual(getSavedRecipeSlugs(), ['old-path']);
});
