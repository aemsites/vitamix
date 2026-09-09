/**
 * Edge cookbook persistence. Magento locales keep the legacy recipebook URL;
 * Edge locales toggle localStorage immediately and PATCH `custom.recipes` when
 * the customer is signed in (same `window.useEdgeCheckout` split as newsletter).
 */

import { AUTH_EVENT, getUser, isLoggedIn } from './auth-api.js';
import {
  getLoggedInCustomer,
  unwrapCustomerResponse,
  updateCustomer,
} from '../widgets/account/account-api.js';
import { getRecipeSlugsFromCustomer, recipesCustomPatch } from '../widgets/account/recipe-book.js';
import {
  getSavedRecipeSlugs,
  mergeRecipeSlugLists,
  recipeSlugFromPathname,
  setSavedRecipeSlugs,
  toggleSavedRecipe,
} from './recipe-storage.js';

let authSyncWired = false;

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
 * Merge localStorage slugs into the signed-in customer record and PATCH when
 * the lists differ. Always rewrites localStorage to the merged list.
 * @returns {Promise<string[]>}
 */
export async function syncSavedRecipesWithCustomer() {
  const local = getSavedRecipeSlugs();
  if (!isLoggedIn()) return local;
  const email = getUser()?.email;
  if (!email) return local;
  const customer = unwrapCustomer(await getLoggedInCustomer(email));
  const remote = getRecipeSlugsFromCustomer(customer);
  const merged = mergeRecipeSlugLists(remote, local);
  setSavedRecipeSlugs(merged);
  if (JSON.stringify(merged) !== JSON.stringify(remote)) {
    await updateCustomer(email, recipesCustomPatch(merged));
  }
  return merged;
}

/**
 * Persist the current localStorage list onto the customer (after a local toggle).
 * Re-reads the customer first so Magento-migrated slugs are not dropped.
 * @param {string} slug
 * @param {boolean} shouldBeSaved
 */
async function persistToggleToCustomer(slug, shouldBeSaved) {
  const email = getUser()?.email;
  if (!email) return;
  const customer = unwrapCustomer(await getLoggedInCustomer(email));
  const remote = getRecipeSlugsFromCustomer(customer);
  let merged = mergeRecipeSlugLists(remote, getSavedRecipeSlugs());
  if (shouldBeSaved) {
    merged = mergeRecipeSlugLists([slug], merged);
  } else {
    merged = merged.filter((item) => item !== slug);
  }
  setSavedRecipeSlugs(merged);
  await updateCustomer(email, recipesCustomPatch(merged));
}

/**
 * Toggle a recipe in the Edge cookbook. Updates localStorage immediately;
 * PATCHes `custom.recipes` when signed in.
 * @param {string} pathname
 * @returns {Promise<boolean>} true if saved after toggle
 */
export async function toggleEdgeRecipeFavorite(pathname) {
  const slug = recipeSlugFromPathname(pathname);
  const saved = toggleSavedRecipe(slug || pathname);
  if (isLoggedIn() && slug) {
    try {
      await persistToggleToCustomer(slug, saved);
    } catch {
      // localStorage already reflects the toggle
    }
  }
  return saved;
}

/**
 * After OTP login, fold any locally saved slugs into `custom.recipes`.
 */
export function wireRecipeFavoritesAuthSync() {
  if (authSyncWired) return;
  authSyncWired = true;
  document.addEventListener(AUTH_EVENT, (event) => {
    const detail = event && typeof event === 'object'
      ? /** @type {{ detail?: { loggedIn?: boolean } }} */ (event).detail
      : null;
    if (!detail?.loggedIn) return;
    syncSavedRecipesWithCustomer().catch(() => {});
  });
}
