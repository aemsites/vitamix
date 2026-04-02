/* eslint-disable no-console */
import { test, expect } from '@playwright/test';
import {
  getCurrentBranch,
  buildProductUrl,
  waitForElement,
} from '../utils/test-helpers.js';

/**
 * Tests for stale session cart_id handling.
 *
 * Reproduces the bug where an expired PHP session leaves an orphaned
 * cart_id in localStorage. Without the fix, add-to-cart sends items
 * to the orphaned quote and the checkout page is empty.
 */

test.describe('Stale Session Cart ID', () => {
  let currentBranch;
  const productPath = '/us/en_us/products/ascent-x2';

  test.beforeAll(async () => {
    currentBranch = await getCurrentBranch();
    console.log(`Running tests against branch: ${currentBranch}`);
  });

  test('should refresh side-by-side before add-to-cart and use the fresh cart_id', async ({ page }) => {
    const freshCartId = 'fresh-session-cart-id';
    const staleCartId = 'stale-orphaned-cart-id';
    let graphqlCartId = null;

    // Mock section load — return the fresh cart_id
    await page.route('**/customer/section/load/**', async (route) => {
      const url = new URL(route.request().url());
      const sections = url.searchParams.get('sections') || '';

      const response = {};
      if (sections.includes('side-by-side')) {
        response['side-by-side'] = { cart_id: freshCartId, data_id: Date.now() };
      }
      if (sections.includes('cart')) {
        response.cart = { items: [], summary_count: 0, data_id: Date.now() };
      }
      if (sections.includes('customer')) {
        response.customer = { data_id: Date.now() };
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    });

    // Mock GraphQL — capture the cartId used
    await page.route('**/graphql', async (route) => {
      const body = route.request().postDataJSON();
      graphqlCartId = body?.variables?.cartId;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            addProductsToCart: {
              cart: {
                id: freshCartId,
                items: [{ sku: 'Ascent X2', quantity: 1 }],
                prices: { subtotal_excluding_tax: { currency: 'USD', value: 549.95 } },
                total_quantity: 1,
              },
              user_errors: [],
            },
          },
        }),
      });
    });

    // Load the product page
    const productUrl = buildProductUrl(productPath, currentBranch);
    await page.goto(productUrl);
    await page.waitForLoadState('networkidle');

    // Seed stale side-by-side data in localStorage (simulating expired PHP session)
    await page.evaluate(({ staleId }) => {
      const cacheKey = 'mage-cache-storage';
      const staleTimestamp = Math.floor(Date.now() / 1000) - 86400; // 1 day ago
      const cache = {
        customer: { data_id: staleTimestamp },
        'side-by-side': { cart_id: staleId, data_id: staleTimestamp },
        cart: { items: [], summary_count: 0, data_id: staleTimestamp },
      };
      localStorage.setItem(cacheKey, JSON.stringify(cache));

      // Set the session cookie so getMagentoCache doesn't treat cache as expired
      document.cookie = 'mage-cache-sessid=true; path=/';

      // Set the timeout so isMagentoLocalStorageExpired returns false
      const timeout = new Date(Date.now() + 30 * 60000).toISOString();
      localStorage.setItem('mage-cache-timeout', JSON.stringify(timeout));
    }, { staleId: staleCartId });

    // Verify the stale cart_id is in localStorage
    const preClickCartId = await page.evaluate(() => {
      const cache = JSON.parse(localStorage.getItem('mage-cache-storage') || '{}');
      return cache['side-by-side']?.cart_id;
    });
    expect(preClickCartId).toBe(staleCartId);
    console.log(`✓ Stale cart_id seeded: ${staleCartId}`);

    // Click add to cart
    await waitForElement(page, '.quantity-container button');
    const addToCartButton = page.locator('.quantity-container button');
    await addToCartButton.click();

    // Wait for the GraphQL request
    await page.waitForTimeout(3000);

    // The GraphQL call should have used the FRESH cart_id, not the stale one
    expect(graphqlCartId).toBe(freshCartId);
    console.log(`✓ GraphQL used fresh cart_id: ${freshCartId} (not stale: ${staleCartId})`);
  });
});
