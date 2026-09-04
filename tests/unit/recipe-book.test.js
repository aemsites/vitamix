import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findRecipeBySlug,
  getRecipeSlugsFromCustomer,
  recipeHref,
  recipeImageSrc,
  serializeRecipeSlugs,
  slugFromIndexPath,
  titleFromSlug,
} from '../../widgets/account/recipe-book.js';

test('getRecipeSlugsFromCustomer reads custom.recipes array', () => {
  const customer = {
    custom: { recipes: ['jalapeno-tequila-cocktail', ' mango-lassi '] },
  };
  assert.deepEqual(
    getRecipeSlugsFromCustomer(customer),
    ['jalapeno-tequila-cocktail', 'mango-lassi'],
  );
});

test('getRecipeSlugsFromCustomer dedupes and ignores empty values', () => {
  const customer = { custom: { recipes: ['a', '', 'a', '  '] } };
  assert.deepEqual(getRecipeSlugsFromCustomer(customer), ['a']);
});

test('getRecipeSlugsFromCustomer parses JSON or comma-separated strings', () => {
  assert.deepEqual(
    getRecipeSlugsFromCustomer({ custom: { recipes: '["one","two"]' } }),
    ['one', 'two'],
  );
  assert.deepEqual(
    getRecipeSlugsFromCustomer({ custom: { recipes: 'one, two' } }),
    ['one', 'two'],
  );
});

test('getRecipeSlugsFromCustomer returns empty when recipes are missing', () => {
  assert.deepEqual(getRecipeSlugsFromCustomer(null), []);
  assert.deepEqual(getRecipeSlugsFromCustomer({}), []);
  assert.deepEqual(getRecipeSlugsFromCustomer({ custom: {} }), []);
});

test('serializeRecipeSlugs writes a JSON string for the customer PATCH', () => {
  assert.equal(serializeRecipeSlugs(['jalapeno-tequila-cocktail']), '["jalapeno-tequila-cocktail"]');
  assert.equal(serializeRecipeSlugs([]), '[]');
  assert.equal(serializeRecipeSlugs('["one","two"]'), '["one","two"]');
});

test('findRecipeBySlug matches the index path basename', () => {
  const rows = [
    { path: '/ca/en_us/recipes/jalapeno-tequila-cocktail', title: 'Jalapeño Tequila Cocktail' },
    { path: '/ca/en_us/recipes/mango-lassi', title: 'Mango Lassi' },
  ];
  const match = findRecipeBySlug(rows, 'jalapeno-tequila-cocktail');
  assert.equal(match?.title, 'Jalapeño Tequila Cocktail');
});

test('findRecipeBySlug matches after stripping -r ids from the index path', () => {
  const rows = [
    { path: '/us/en_us/recipes/jalapeno-tequila-cocktail-r1234', title: 'Cocktail' },
  ];
  assert.equal(findRecipeBySlug(rows, 'jalapeno-tequila-cocktail')?.title, 'Cocktail');
});

test('findRecipeBySlug skips deleted rows and returns null when unmatched', () => {
  const rows = [
    { path: '/us/en_us/recipes/gone', status: 'Deleted', title: 'Gone' },
  ];
  assert.equal(findRecipeBySlug(rows, 'gone'), null);
  assert.equal(findRecipeBySlug(rows, 'missing'), null);
});

test('findRecipeBySlug matches Magento jalapeno slug via Jalapeño title when index path dropped ñ', () => {
  // Published path lost the n (`jalapeo`); Magento cookbook slug kept ASCII `n`.
  const rows = [
    {
      path: '/ca/en_us/recipes/jalapeo-tequila-cocktail',
      title: 'Jalapeño Tequila Cocktail',
    },
  ];
  const match = findRecipeBySlug(rows, 'jalapeno-tequila-cocktail');
  assert.equal(match?.path, '/ca/en_us/recipes/jalapeo-tequila-cocktail');
});

test('findRecipeBySlug folds title punctuation and ampersands like the 404 matcher', () => {
  const rows = [
    { path: '/us/en_us/recipes/pbj', title: 'Peanut Butter & Jelly Smoothie' },
  ];
  assert.equal(
    findRecipeBySlug(rows, 'peanut-butter-and-jelly-smoothie')?.path,
    '/us/en_us/recipes/pbj',
  );
});

test('slug helpers format href, image, and fallback title', () => {
  assert.equal(slugFromIndexPath('/ca/en_us/recipes/Jalapeno_Tequila_Cocktail'), 'jalapeno-tequila-cocktail');
  assert.equal(recipeHref('/us/en_us/recipes/mango-lassi-r99'), '/us/en_us/recipes/mango-lassi');
  assert.equal(recipeImageSrc('https://www.vitamix.com/content/dam/recipe.jpg'), '/content/dam/recipe.jpg');
  assert.equal(recipeImageSrc('https://www.vitamix.com/default-meta-image.png'), '');
  assert.equal(titleFromSlug('jalapeno-tequila-cocktail'), 'Jalapeno Tequila Cocktail');
});
