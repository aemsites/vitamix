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

      // wait for page to navigate to the cart page
      await page.waitForURL('**/checkout/cart/**');

      // should redirect to the cart page
      const currentUrl = new URL(page.url());
      expect(currentUrl.pathname).toBe('/us/en_us/checkout/cart/');
      console.log('✓ Add to Cart button is functional');
    });

    test('add to cart button should work, with coupon, should use legacy atc', async ({ page }) => {
      await page.route('**/us/en_us/checkout/cart/add/**', async (route) => {
        // check that the correct uenc path segment exists
        const url = new URL(route.request().url());
        expect(url.pathname).toContain('/us/en_us/checkout/cart/add/uenc/aHR0cHM6Ly9jb3Vwb24tLXZpdGFtaXgtLWFlbXNpdGVzLmFlbS5uZXR3b3JrL3VzL2VuX3VzL3Byb2R1Y3RzL2FzY2VudC14Mw==_Q09VUE9OPXRlc3QmbWFydGVjaD1vZmY=/product/3641/');

        const requestBody = route.request().postData();
        // requestBody is a multipart form data string
        // extract form data from the string
        const boundary = requestBody.split('\n')[0];
        const parts = requestBody.split(boundary).filter(Boolean);
        const data = {};
        parts.forEach((part) => {
          const name = part.split('\n')[1].split('name="')[1].split('"')[0];
          const value = part.split('\n')[3].trim();
          data[name] = value;
        });
        expect(data).toEqual({
          index_id: '534',
          product: '3641',
          item: '3641',
          form_key: 'null',
          qty: '1',
          'super_attribute[93]': '534',
          vitamixProductId: '3641',
          'options[3002]': '3941',
          warranty_sku: 'sku-10-year-standard-warranty',
          'warranty_skus[3941]': 'sku-10-year-standard-warranty',
        });

        // Log the arguments that were passed to addToCart
        console.log('✓ Add to Cart function called with correct variables');
        await route.fulfill({
          status: 200,
        });
      });

      const productUrl = buildProductUrl(productPath, currentBranch, { COUPON: 'test' });
      console.log('productUrl: ', productUrl);
      await page.goto(productUrl);

      // Wait for add to cart button
      await waitForElement(page, '.quantity-container button');

      const addToCartButton = page.locator('.quantity-container button');
      await expect(addToCartButton).toContainText(/add to cart/i);

      // Click the add to cart button
      await addToCartButton.click();

      // wait for page to navigate to the cart page
      await page.waitForURL('**/checkout/cart/**');

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

      // wait for page to navigate to the cart page
      await page.waitForURL('**/checkout/cart/**');

      // should redirect to the cart page
      const currentUrl = new URL(page.url());
      expect(currentUrl.pathname).toBe('/us/en_us/checkout/cart/');
      console.log('✓ Add to Cart button is functional');
    });

    test('add to cart button should work with extended warranty', async ({ page }) => {
      await page.route('**/us/en_us/checkout/cart/add/**', async (route) => {
        // check that the correct uenc path segment exists
        const url = new URL(route.request().url());
        expect(url.pathname).toEqual('/us/en_us/checkout/cart/add/uenc/aHR0cHM6Ly9jb3Vwb24tLXZpdGFtaXgtLWFlbXNpdGVzLmFlbS5uZXR3b3JrL3VzL2VuX3VzL3Byb2R1Y3RzLzUyMDAtbGVnYWN5LWJ1bmRsZQ==_bWFydGVjaD1vZmY=/product/3701/');

        const requestBody = route.request().postData();
        // requestBody is a multipart form data string
        // extract form data from the string
        const boundary = requestBody.split('\n')[0];
        const parts = requestBody.split(boundary).filter(Boolean);
        const data = {};
        parts.forEach((part) => {
          const name = part.split('\n')[1].split('name="')[1].split('"')[0];
          const value = part.split('\n')[3].trim();
          data[name] = value;
        });
        expect(data).toEqual({
          product: '3701',
          item: '3701',
          form_key: 'null',
          qty: '1',
          vitamixProductId: '3701',
          'options[3023]': '3965',
          'warranty_skus[3965]': '001314',
          warranty_sku: '001314',
          'warranty_skus[3962]': 'sku-warranty-7yr-std',
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

      const warrantyOptions = page.locator('.pdp-warranty-option');
      const add3YearWarrantyContainer = warrantyOptions.nth(1);
      const add3YearWarrantyInput = add3YearWarrantyContainer.locator('input');
      await add3YearWarrantyInput.click();

      await page.waitForTimeout(1000);

      // Click the add to cart button
      const addToCartButton = page.locator('.quantity-container button');
      await expect(addToCartButton).toContainText(/add to cart/i);
      await addToCartButton.click();

      // wait for page to navigate to the cart page
      await page.waitForURL('**/checkout/cart/**');

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

      // wait for page to navigate to the cart page
      await page.waitForURL('**/checkout/cart/**');

      // should redirect to the cart page
      const currentUrl = new URL(page.url());
      expect(currentUrl.pathname).toBe('/us/en_us/checkout/cart/');
      console.log('✓ Add to Cart button is functional');
    });
  });

  test.describe('Newsletter Subscription', () => {
    const newsletterConfigs = [
      {
        modal: false,
        smsOptin: false,
        leadSource: 'sub-em-footer-us',
        pageUrl: '/us/en_us/products/20-ounce-travel-cup',
      },
      {
        modal: false,
        smsOptin: true,
        leadSource: 'sub-emsms-footer-us',
        pageUrl: '/us/en_us/products/20-ounce-travel-cup',
      },
      {
        modal: true,
        smsOptin: false,
        leadSource: 'sub-em-modal-us',
        pageUrl: '/us/en_us/products/20-ounce-travel-cup',
      },
      {
        modal: true,
        smsOptin: true,
        leadSource: 'sub-emsms-modal-us',
        pageUrl: '/us/en_us/products/20-ounce-travel-cup',
      },
    ];

    const newsLetterSubscription = async (page, config) => {
      const {
        modal,
        smsOptin,
        leadSource,
        pageUrl,
      } = config;

      await page.route('**/bin/vitamix/newslettersubscription**', async (route) => {
        const url = route.request().url();
        const urlObj = new URL(url);

        // Check the query parameters
        expect(urlObj.searchParams.get('email')).toBe('test@test.com');
        expect(urlObj.searchParams.get('mobile')).toBe('1234567890');
        expect(urlObj.searchParams.get('sms_optin')).toBe(smsOptin ? '1' : '0');
        expect(urlObj.searchParams.get('lead_source')).toBe(leadSource);
        expect(urlObj.searchParams.get('pageUrl')).toContain(pageUrl);
        expect(urlObj.searchParams.get('actionUrl')).toBe('/us/en_us/rest/V1/vitamix-api/newslettersubscribe');

        console.log('✓ Newsletter subscription request intercepted with correct parameters');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { message: 'Success' } }),
        });
      });

      const productUrl = buildProductUrl(pageUrl, currentBranch);
      await page.goto(productUrl);

      let form = page.locator('form.footer-sign-up');

      if (modal) {
        if (page.viewportSize().width < 600) {
          const hamburgerMenu = page.locator('header .nav-hamburger button');
          await hamburgerMenu.click();
        }

        const signupButton = page.locator('header a[href$="/modals/sign-up"]');
        await signupButton.click();

        const modalForm = page.locator('dialog form.footer-sign-up');
        await modalForm.waitFor({ state: 'visible', timeout: 10000 });

        form = modalForm;
      }

      const emailInput = form.locator('.form-field #email');
      await emailInput.fill('test@test.com');
      await expect(emailInput).toHaveValue('test@test.com');

      const phoneInput = form.locator('.form-field #mobile');
      await phoneInput.fill('1234567890');
      await expect(phoneInput).toHaveValue('1234567890');

      if (smsOptin) {
        const consentCheckbox = form.locator('label input[type="checkbox"]');
        await consentCheckbox.click({ force: true });
        // wait for consent checkbox to be checked
        await expect(consentCheckbox).toBeChecked();
      }

      const submitButton = form.locator('button[type="submit"]');
      await submitButton.click();

      await page.waitForTimeout(1000);

      console.log('✓ Newsletter subscription form is functional');
    };

    test('newsletter subscription should work in footer', async ({ page }) => {
      await newsLetterSubscription(page, newsletterConfigs[0]);
    });

    test('newsletter subscription should work in footer with SMS', async ({ page }) => {
      await newsLetterSubscription(page, newsletterConfigs[1]);
    });

    test('newsletter subscription should work in modal', async ({ page }) => {
      await newsLetterSubscription(page, newsletterConfigs[2]);
    });

    test('newsletter subscription should work in modal with SMS', async ({ page }) => {
      await newsLetterSubscription(page, newsletterConfigs[3]);
    });
  });
});
