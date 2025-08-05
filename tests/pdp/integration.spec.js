/* eslint-disable no-console */
import { test, expect } from '@playwright/test';
import {
  getCurrentBranch,
  buildProductUrl,
  assertPDPElements,
  waitForElement,
  assertSaleableElements,
  assertOptionElements,
  assertElementText,
} from '../utils/test-helpers.js';

/**
 * Integration tests for Product Detail Pages (PDP)
 * These tests verify that key elements exist and function correctly
 */

test.describe('PDP Integration Tests', () => {
  let currentBranch;

  test.beforeAll(async () => {
    currentBranch = await getCurrentBranch();
    console.log(`Running tests against branch: ${currentBranch}`);
  });

  test.describe('Configurable Product Page', () => {
    const productPath = '/us/en_us/products/ascent-x3';

    test('should load Ascent X3 product page with all required elements', async ({ page }) => {
      const productUrl = buildProductUrl(productPath, currentBranch);
      console.log(`Testing URL: ${productUrl}`);

      await page.goto(productUrl);

      // Wait for page to load
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveTitle(/Ascent X3/i);
      await assertPDPElements(page);
      await assertSaleableElements(page);
      await assertOptionElements(page);
    });

    test('should deeplink to Ascent X3 variant', async ({ page }) => {
      const productUrl = buildProductUrl(productPath, currentBranch, {
        color: 'polar-white',
      });
      console.log(`Testing URL: ${productUrl}`);

      // Navigate to the product page
      await page.goto(productUrl);

      // Wait for page to load
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveTitle(/Ascent X3/i);
      await assertPDPElements(page);
      await assertPDPElements(page);
      await assertSaleableElements(page);
      await assertOptionElements(page);

      assertElementText(page, '.selected-option-label', 'Color: Polar White', 'Selected Variant Label');
    });

    test('add to cart button should work', async ({ page }) => {
      await page.route('**/graphql', async (route) => {
        const requestBody = route.request().postDataJSON();
        expect(requestBody.variables).toEqual({
          cartItems: [
            {
              sku: 'Ascent X3',
              quantity: '1',
              selected_options: [
                'Y29uZmlndXJhYmxlLzkzLzUzNA==',
                'Y3VzdG9tLW9wdGlvbi8zMDAyLzM5NDE=',
              ],
            },
          ],
        });

        // Log the arguments that were passed to addToCart
        console.log('✓ Add to Cart function called with correct variables');
        await route.fulfill({
          status: 200,
        });
      });

      const productUrl = buildProductUrl(productPath, currentBranch);
      await page.goto(productUrl);

      // Wait for add to cart button
      await waitForElement(page, '.quantity-container button');

      const addToCartButton = page.locator('.quantity-container button');
      await expect(addToCartButton).toContainText(/add to cart/i);

      // Click the add to cart button
      await addToCartButton.click();

      await page.waitForTimeout(3000);

      // should redirect to the cart page
      const currentUrl = new URL(page.url());
      expect(currentUrl.pathname).toBe('/us/en_us/checkout/cart/');
      console.log('✓ Add to Cart button is functional');
    });

    test('should handle product variant selection', async ({ page }) => {
      const productUrl = buildProductUrl(productPath, currentBranch);
      await page.goto(productUrl);
      await page.waitForLoadState('networkidle');

      // Look for variant options
      const variantOptions = page.locator('.pdp-color-options .pdp-color-swatch');

      if (await variantOptions.count() > 0) {
        await variantOptions.nth(1).click();

        // Wait for any updates to complete
        await page.waitForTimeout(1000);
        assertElementText(page, '.selected-option-label', 'Color: Polar White', 'Selected Variant Label');

        console.log('✓ Product variant selection works');
      } else {
        console.log('ℹ No variant options found for this product');
      }
    });
  });

  test.describe('Bundle Product Page', () => {
    const productPath = '/us/en_us/products/5200-legacy-bundle';

    test('should load bundle product page with all required elements', async ({ page }) => {
      const productUrl = buildProductUrl(productPath, currentBranch);
      console.log(`Testing URL: ${productUrl}`);

      await page.goto(productUrl);

      // Wait for page to load
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveTitle(/5200 Legacy Bundle/i);
      await assertPDPElements(page);
      await assertSaleableElements(page);
      await assertOptionElements(page);
    });

    test('should deeplink to bundle variant', async ({ page }) => {
      const productUrl = buildProductUrl(productPath, currentBranch, {
        color: 'red',
      });
      console.log(`Testing URL: ${productUrl}`);

      // Navigate to the product page
      await page.goto(productUrl);

      // Wait for page to load
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveTitle(/5200 Legacy Bundle/i);
      await assertPDPElements(page);
      await assertPDPElements(page);
      await assertSaleableElements(page);
      await assertOptionElements(page);

      assertElementText(page, '.selected-option-label', 'Color: Red', 'Selected Variant Label');
    });

    test('add to cart button should work', async ({ page }) => {
      await page.route('**/graphql', async (route) => {
        const requestBody = route.request().postDataJSON();
        expect(requestBody.variables).toEqual({
          cartItems: [
            {
              sku: 'VBND5200LB',
              quantity: '1',
              selected_options: [
                'YnVuZGxlLzQzLzIyMy8x',
                'Y3VzdG9tLW9wdGlvbi8zMDIzLzM5NjI=',
                'YnVuZGxlLzQxLzIxMi8x',
                'YnVuZGxlLzQxLzIxNS8x',
                'YnVuZGxlLzQxLzIyMS8x',
              ],
            },
          ],
        });

        // Log the arguments that were passed to addToCart
        console.log('✓ Add to Cart function called with correct variables');
        await route.fulfill({
          status: 200,
        });
      });

      const productUrl = buildProductUrl(productPath, currentBranch);
      await page.goto(productUrl);

      // Wait for add to cart button
      await waitForElement(page, '.quantity-container button');

      const addToCartButton = page.locator('.quantity-container button');
      await expect(addToCartButton).toContainText(/add to cart/i);

      // Click the add to cart button
      await addToCartButton.click();

      await page.waitForTimeout(3000);

      // should redirect to the cart page
      const currentUrl = new URL(page.url());
      expect(currentUrl.pathname).toBe('/us/en_us/checkout/cart/');
      console.log('✓ Add to Cart button is functional');
    });

    test('add to cart button should work with extended warranty', async ({ page }) => {
      await page.route('**/graphql', async (route) => {
        const requestBody = route.request().postDataJSON();
        expect(requestBody.variables).toEqual({
          cartItems: [
            {
              sku: 'VBND5200LB',
              quantity: '1',
              selected_options: [
                'YnVuZGxlLzQzLzIyMy8x',
                'Y3VzdG9tLW9wdGlvbi8zMDIzLzM5NjU=',
                'YnVuZGxlLzQxLzIxMi8x',
                'YnVuZGxlLzQxLzIxNS8x',
                'YnVuZGxlLzQxLzIyMS8x',
              ],
            },
          ],
        });

        // Log the arguments that were passed to addToCart
        console.log('✓ Add to Cart function called with correct variables');
        await route.fulfill({
          status: 200,
        });
      });

      const productUrl = buildProductUrl(productPath, currentBranch);
      await page.goto(productUrl);

      // Wait for add to cart button
      await waitForElement(page, '.quantity-container button');

      const extendedWarranty = page.locator('.warranty > div:first-of-type');
      await expect(extendedWarranty).toContainText(/warranty/i);

      const warrantyOptions = page.locator('.pdp-warrenty-option');
      const add3YearWarrantyContainer = warrantyOptions.nth(1);
      const add3YearWarrantyInput = add3YearWarrantyContainer.locator('input');
      await add3YearWarrantyInput.click();

      await page.waitForTimeout(1000);

      // Click the add to cart button
      const addToCartButton = page.locator('.quantity-container button');
      await expect(addToCartButton).toContainText(/add to cart/i);
      await addToCartButton.click();

      await page.waitForTimeout(3000);

      // should redirect to the cart page
      const currentUrl = new URL(page.url());
      expect(currentUrl.pathname).toBe('/us/en_us/checkout/cart/');
      console.log('✓ Add to Cart button is functional');
    });

    test('should handle product variant selection', async ({ page }) => {
      const productUrl = buildProductUrl(productPath, currentBranch);
      await page.goto(productUrl);
      await page.waitForLoadState('networkidle');

      // Look for variant options
      const variantOptions = page.locator('.pdp-color-options .pdp-color-swatch');

      if (await variantOptions.count() > 0) {
        await variantOptions.nth(1).click();

        // Wait for any updates to complete
        await page.waitForTimeout(1000);
        assertElementText(page, '.selected-option-label', 'Color: White', 'Selected Variant Label');

        console.log('✓ Product variant selection works');
      } else {
        console.log('No variant options found for this product');
      }
    });
  });

  test.describe('Simple Product Page', () => {
    const productPath = '/us/en_us/products/20-ounce-travel-cup';

    test('should load simple product page with all required elements', async ({ page }) => {
      const productUrl = buildProductUrl(productPath, currentBranch);
      console.log(`Testing URL: ${productUrl}`);

      await page.goto(productUrl);

      // Wait for page to load
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveTitle(/20-ounce Container Cup - Smoothie Cups/i);
      await assertPDPElements(page);
      await assertSaleableElements(page);
    });

    test('add to cart button should work', async ({ page }) => {
      await page.route('**/graphql', async (route) => {
        const requestBody = route.request().postDataJSON();
        expect(requestBody.variables).toEqual({
          cartItems: [
            {
              sku: '056264',
              quantity: '1',
              selected_options: [
              ],
            },
          ],
        });

        // Log the arguments that were passed to addToCart
        console.log('✓ Add to Cart function called with correct variables');
        await route.fulfill({
          status: 200,
        });
      });

      const productUrl = buildProductUrl(productPath, currentBranch);
      await page.goto(productUrl);

      // Wait for add to cart button
      await waitForElement(page, '.quantity-container button');

      const addToCartButton = page.locator('.quantity-container button');
      await expect(addToCartButton).toContainText(/add to cart/i);

      // Click the add to cart button
      await addToCartButton.click();

      await page.waitForTimeout(3000);

      // should redirect to the cart page
      const currentUrl = new URL(page.url());
      expect(currentUrl.pathname).toBe('/us/en_us/checkout/cart/');
      console.log('✓ Add to Cart button is functional');
    });
  });
});
