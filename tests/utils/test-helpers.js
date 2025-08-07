/* eslint-disable no-console */
/* eslint-disable global-require */
import { expect } from '@playwright/test';

/**
 * Utility functions for Vitamix integration tests
 */

/**
 * Get the base URL for the current branch
 * @param {string} branch - The branch name (defaults to 'main')
 * @returns {string} The base URL for the branch
 */
export function getBaseUrl(branch = 'main') {
  // Check if we're running locally
  if (process.env.NODE_ENV === 'development' || process.env.LOCAL_TESTING) {
    return 'http://localhost:3000';
  }

  const baseUrl = process.env.BASE_URL || `https://${branch}--vitamix--aemsites.aem.network`;
  return baseUrl;
}
/**
 * Get the current branch name from environment or git
 * @returns {Promise<string>} The current branch name
 */
export async function getCurrentBranch() {
  // Check if branch is provided via environment variable
  if (process.env.BRANCH) {
    return process.env.BRANCH;
  }

  // Try to get branch from git (if available)
  try {
    const { execSync } = require('child_process');
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    return branch;
  } catch (error) {
    console.warn('Could not determine git branch, using "main"');
    return 'main';
  }
}

/**
 * Build a product URL for testing, set martech to off by default
 * @param {string} productPath - The product path (e.g., '/us/en_us/products/ascent-x3')
 * @param {string} branch - The branch name
 * @returns {string} The full product URL
 */
export function buildProductUrl(productPath, branch = 'main', queryParams = {}) {
  const baseUrl = getBaseUrl(branch);

  queryParams.martech = 'off';
  const queryString = new URLSearchParams(queryParams).toString();
  return `${baseUrl}${productPath}${queryString ? `?${queryString}` : ''}`;
}

/**
 * Assert that a specific element exists and is visible
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} selector - CSS selector for the element
 * @param {string} description - Description of the element for error messages
 */
export async function assertElementExists(page, selector, description) {
  const element = page.locator(selector);
  await expect(element).toBeVisible();
  console.log(`✓ ${description} is visible`);
}

/**
 * Common assertions for PDP elements
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function assertPDPElements(page) {
  // Wait for the page to load
  await page.waitForLoadState('networkidle');

  // Assert that key PDP elements exist
  await assertElementExists(page, '.title h1', 'Product Title');
  await assertElementExists(page, '.pdp-buy-box', 'Product Gallery');
  await assertElementExists(page, '.gallery', 'Product Gallery');

  // Assert that product images are displayed
  const images = page.locator('.gallery img');
  await expect(images.first()).toBeVisible();

  // Assert that multiple images are available (if applicable)
  const imageCount = await images.count();
  expect(imageCount).toBeGreaterThan(0);

  // Assert that specifications section exists
  await assertElementExists(page, '.specifications', 'Product Specifications');

  // Assert that FAQ section exists
  await assertElementExists(page, '.faq-container', 'FAQ Section');

  // Assert that share buttons exist
  await assertElementExists(page, '.pdp-share-container', 'Share Buttons');

  // Assert that compare functionality exists
  await assertElementExists(page, '.pdp-compare-container', 'Compare Functionality');
}

/**
 * Common assertions for PDP elements
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function assertSaleableElements(page) {
  // Wait for the page to load
  await page.waitForLoadState('networkidle');

  await assertElementExists(page, '.pricing', 'Product Pricing');
  await assertElementExists(page, '.pricing-final', 'Product Pricing');
  await assertElementExists(page, '.quantity-container button', 'Add to Cart Button');
}

/**
 * Common assertions for PDP elements
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function assertOptionElements(page) {
  // Wait for the page to load
  await page.waitForLoadState('networkidle');

  // Assert that product options are available (if this product has variants)
  const optionsContainer = page.locator('.pdp-color-options');
  const options = page.locator('.pdp-color-options .pdp-color-swatch');

  await expect(optionsContainer).toBeVisible();
  await expect(await options.count()).toBeGreaterThan(0);
  console.log('✓ Product options are available');
}

/**
 * Assert that a specific element contains expected text
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} selector - CSS selector for the element
 * @param {string} expectedText - Expected text content
 * @param {string} description - Description of the element for error messages
 */
export async function assertElementText(page, selector, expectedText, description) {
  const element = page.locator(selector);
  await expect(element).toContainText(expectedText);
  console.log(`✓ ${description} contains expected text: "${expectedText}"`);
}

/**
 * Wait for and assert that a specific element is present
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} selector - CSS selector for the element
 * @param {number} timeout - Timeout in milliseconds (default: 10000)
 */
export async function waitForElement(page, selector, timeout = 10000) {
  await page.waitForSelector(selector, { timeout });
  console.log(`✓ Element found: ${selector}`);
}
