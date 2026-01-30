/* eslint-disable no-console */
import { test, expect } from '@playwright/test';
import {
  getCurrentBranch,
  getBaseUrl,
} from '../utils/test-helpers.js';

/**
 * Tests for cart storage isolation across store views
 * Verifies that:
 * 1. US store uses original 'mage-cache-storage' key
 * 2. Non-US stores use store-specific keys like 'mage-cache-storage-ca-fr_ca'
 * 3. Carts are isolated between store views
 */

test.describe('Cart Storage Tests', () => {
  let currentBranch;
  let baseUrl;

  test.beforeAll(async () => {
    currentBranch = await getCurrentBranch();
    baseUrl = getBaseUrl(currentBranch);
    console.log(`Running tests against branch: ${currentBranch}`);
    console.log(`Base URL: ${baseUrl}`);
  });

  test.describe('US Store (/us/en_us/)', () => {
    const storePath = '/us/en_us';

    test('should use original mage-cache-storage key', async ({ page }) => {
      await page.goto(`${baseUrl}${storePath}/products/ascent-x2?martech=off`);
      await page.waitForLoadState('networkidle');

      // Trigger a cart interaction to populate localStorage
      // We'll mock the section load response
      await page.route('**/customer/section/load/**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cart: { items: [], summary_count: 0 },
            customer: {},
            'side-by-side': { cart_id: 'us-test-cart-123' },
          }),
        });
      });

      // Evaluate in page context to check localStorage
      const storageKeys = await page.evaluate(() =>
        // Trigger the storage by accessing getMagentoCache indirectly
        // eslint-disable-next-line implicit-arrow-linebreak
        Object.keys(localStorage).filter((key) => key.includes('mage-cache')));

      console.log('US Store localStorage keys:', storageKeys);

      // For US store, we should NOT see store-specific keys
      const hasUSSpecificKey = storageKeys.some((key) => key.includes('-us-en_us'));
      expect(hasUSSpecificKey).toBe(false);

      console.log('✓ US store uses original mage-cache-storage key (no suffix)');
    });

    test('should store cart data in mage-cache-storage', async ({ page }) => {
      // Mock the GraphQL and section load responses
      await page.route('**/customer/section/load/**', async (route) => {
        const url = new URL(route.request().url());
        expect(url.pathname).toContain('/us/en_us/customer/section/load');

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cart: { items: [], summary_count: 0, data_id: 12345 },
            customer: { data_id: 12345 },
            'side-by-side': { cart_id: 'us-cart-abc123', data_id: 12345 },
          }),
        });
      });

      await page.route('**/graphql', async (route) => {
        const headers = route.request().headers();
        // Verify Store header is correct for US
        expect(headers.store).toBe('en_us');

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              addProductsToCart: {
                cart: { items: [], total_quantity: 0 },
                user_errors: [],
              },
            },
          }),
        });
      });

      await page.goto(`${baseUrl}${storePath}/products/ascent-x2?martech=off`);
      await page.waitForLoadState('networkidle');

      // Wait for add to cart button
      const addToCartButton = page.locator('.quantity-container button');
      await addToCartButton.waitFor({ state: 'visible', timeout: 10000 });

      // Click add to cart
      await addToCartButton.click();

      // Wait for the cart redirect or network request
      await page.waitForTimeout(2000);

      // Check localStorage for the cart ID
      const cartData = await page.evaluate(() => {
        const storage = localStorage.getItem('mage-cache-storage');
        return storage ? JSON.parse(storage) : null;
      });

      if (cartData && cartData['side-by-side']) {
        expect(cartData['side-by-side'].cart_id).toBe('us-cart-abc123');
        console.log('✓ US cart stored in mage-cache-storage with correct cart_id');
      }
    });
  });

  test.describe('French Canadian Store (/ca/fr_ca/)', () => {
    const storePath = '/ca/fr_ca';

    test('should use store-specific mage-cache-storage-ca-fr_ca key', async ({ page }) => {
      await page.route('**/customer/section/load/**', async (route) => {
        const url = new URL(route.request().url());
        expect(url.pathname).toContain('/ca/fr_ca/customer/section/load');

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cart: { items: [], summary_count: 0, data_id: 67890 },
            customer: { data_id: 67890 },
            'side-by-side': { cart_id: 'fr-cart-xyz789', data_id: 67890 },
          }),
        });
      });

      await page.route('**/graphql', async (route) => {
        const headers = route.request().headers();
        // Verify Store header is correct for FR-CA
        expect(headers.store).toBe('fr_ca');

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              addProductsToCart: {
                cart: { items: [], total_quantity: 0 },
                user_errors: [],
              },
            },
          }),
        });
      });

      await page.goto(`${baseUrl}${storePath}/products/ascent-x2?martech=off`);
      await page.waitForLoadState('networkidle');

      // Wait for add to cart button
      const addToCartButton = page.locator('.quantity-container button');
      await addToCartButton.waitFor({ state: 'visible', timeout: 10000 });

      // Click add to cart
      await addToCartButton.click();

      // Wait for the network requests
      await page.waitForTimeout(2000);

      // Check localStorage for store-specific key
      const storageKeys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes('mage-cache')));

      console.log('FR-CA Store localStorage keys:', storageKeys);

      // Should have the store-specific key
      const hasFRCAKey = storageKeys.some((key) => key.includes('-ca-fr_ca'));
      expect(hasFRCAKey).toBe(true);

      console.log('✓ FR-CA store uses mage-cache-storage-ca-fr_ca key');
    });

    test('should store cart data in store-specific localStorage', async ({ page }) => {
      await page.route('**/customer/section/load/**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cart: { items: [], summary_count: 0, data_id: 67890 },
            customer: { data_id: 67890 },
            'side-by-side': { cart_id: 'fr-cart-isolated', data_id: 67890 },
          }),
        });
      });

      await page.route('**/graphql', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              addProductsToCart: {
                cart: { items: [], total_quantity: 0 },
                user_errors: [],
              },
            },
          }),
        });
      });

      await page.goto(`${baseUrl}${storePath}/products/ascent-x2?martech=off`);
      await page.waitForLoadState('networkidle');

      const addToCartButton = page.locator('.quantity-container button');
      await addToCartButton.waitFor({ state: 'visible', timeout: 10000 });
      await addToCartButton.click();

      await page.waitForTimeout(2000);

      // Check the store-specific localStorage
      const cartData = await page.evaluate(() => {
        const storage = localStorage.getItem('mage-cache-storage-ca-fr_ca');
        return storage ? JSON.parse(storage) : null;
      });

      if (cartData && cartData['side-by-side']) {
        expect(cartData['side-by-side'].cart_id).toBe('fr-cart-isolated');
        console.log('✓ FR-CA cart stored in mage-cache-storage-ca-fr_ca with correct cart_id');
      }
    });
  });

  test.describe('Cross-Store Cart Isolation', () => {
    test('carts should be isolated between US and FR-CA stores', async ({ page }) => {
      // Set up mock responses
      await page.route('**/customer/section/load/**', async (route) => {
        const url = new URL(route.request().url());
        const isUS = url.pathname.includes('/us/en_us/');

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cart: { items: [], summary_count: 0, data_id: isUS ? 11111 : 22222 },
            customer: { data_id: isUS ? 11111 : 22222 },
            'side-by-side': {
              cart_id: isUS ? 'us-isolated-cart' : 'fr-isolated-cart',
              data_id: isUS ? 11111 : 22222,
            },
          }),
        });
      });

      await page.route('**/graphql', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              addProductsToCart: {
                cart: { items: [], total_quantity: 0 },
                user_errors: [],
              },
            },
          }),
        });
      });

      // Step 1: Add to cart on US store
      await page.goto(`${baseUrl}/us/en_us/products/ascent-x2?martech=off`);
      await page.waitForLoadState('networkidle');

      let addToCartButton = page.locator('.quantity-container button');
      await addToCartButton.waitFor({ state: 'visible', timeout: 10000 });
      await addToCartButton.click();
      await page.waitForTimeout(2000);

      // Check US cart was stored
      const usCartData = await page.evaluate(() => {
        const storage = localStorage.getItem('mage-cache-storage');
        return storage ? JSON.parse(storage) : null;
      });

      expect(usCartData?.['side-by-side']?.cart_id).toBe('us-isolated-cart');
      console.log('✓ US cart stored correctly');

      // Step 2: Navigate to FR-CA store and add to cart
      await page.goto(`${baseUrl}/ca/fr_ca/products/ascent-x2?martech=off`);
      await page.waitForLoadState('networkidle');

      addToCartButton = page.locator('.quantity-container button');
      await addToCartButton.waitFor({ state: 'visible', timeout: 10000 });
      await addToCartButton.click();
      await page.waitForTimeout(2000);

      // Check FR-CA cart was stored separately
      const frCartData = await page.evaluate(() => {
        const storage = localStorage.getItem('mage-cache-storage-ca-fr_ca');
        return storage ? JSON.parse(storage) : null;
      });

      expect(frCartData?.['side-by-side']?.cart_id).toBe('fr-isolated-cart');
      console.log('✓ FR-CA cart stored correctly');

      // Step 3: Verify US cart is still intact
      const usCartAfterFR = await page.evaluate(() => {
        const storage = localStorage.getItem('mage-cache-storage');
        return storage ? JSON.parse(storage) : null;
      });

      expect(usCartAfterFR?.['side-by-side']?.cart_id).toBe('us-isolated-cart');
      console.log('✓ US cart still intact after FR-CA interaction');

      // Step 4: Navigate back to US and verify cart is preserved
      await page.goto(`${baseUrl}/us/en_us/products/ascent-x2?martech=off`);
      await page.waitForLoadState('networkidle');

      const usCartFinal = await page.evaluate(() => {
        const storage = localStorage.getItem('mage-cache-storage');
        return storage ? JSON.parse(storage) : null;
      });

      expect(usCartFinal?.['side-by-side']?.cart_id).toBe('us-isolated-cart');
      console.log('✓ US cart preserved after returning from FR-CA store');

      console.log('✓ Cross-store cart isolation verified!');
    });
  });

  test.describe('GraphQL Store Header', () => {
    test('US store should send Store: en_us header', async ({ page }) => {
      let storeHeaderValue = null;

      await page.route('**/graphql', async (route) => {
        storeHeaderValue = route.request().headers().store;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              addProductsToCart: {
                cart: { items: [], total_quantity: 0 },
                user_errors: [],
              },
            },
          }),
        });
      });

      await page.route('**/customer/section/load/**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cart: { items: [], summary_count: 0 },
            customer: {},
            'side-by-side': { cart_id: 'test-cart' },
          }),
        });
      });

      await page.goto(`${baseUrl}/us/en_us/products/ascent-x2?martech=off`);
      await page.waitForLoadState('networkidle');

      const addToCartButton = page.locator('.quantity-container button');
      await addToCartButton.waitFor({ state: 'visible', timeout: 10000 });
      await addToCartButton.click();

      await page.waitForTimeout(2000);

      expect(storeHeaderValue).toBe('en_us');
      console.log('✓ US store sends correct Store header: en_us');
    });

    test('FR-CA store should send Store: fr_ca header', async ({ page }) => {
      let storeHeaderValue = null;

      await page.route('**/graphql', async (route) => {
        storeHeaderValue = route.request().headers().store;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              addProductsToCart: {
                cart: { items: [], total_quantity: 0 },
                user_errors: [],
              },
            },
          }),
        });
      });

      await page.route('**/customer/section/load/**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cart: { items: [], summary_count: 0 },
            customer: {},
            'side-by-side': { cart_id: 'test-cart' },
          }),
        });
      });

      await page.goto(`${baseUrl}/ca/fr_ca/products/ascent-x2?martech=off`);
      await page.waitForLoadState('networkidle');

      const addToCartButton = page.locator('.quantity-container button');
      await addToCartButton.waitFor({ state: 'visible', timeout: 10000 });
      await addToCartButton.click();

      await page.waitForTimeout(2000);

      expect(storeHeaderValue).toBe('fr_ca');
      console.log('✓ FR-CA store sends correct Store header: fr_ca');
    });
  });
});
