import { test, expect } from '@playwright/test';
import { getCurrentBranch, buildProductUrl } from '../utils/test-helpers.js';

/**
 * Free gift (GWP) banner on the PDP. A gift row with a minimum price is only
 * shown on products priced at or above it; a blank minimum applies to all products.
 */

const CHEAP_PRODUCT = '/us/en_us/products/food-processor-attachment-julienne-disc'; // $39.95
const PRICEY_PRODUCT = '/us/en_us/products/ascent-x2'; // $549.95

/**
 * Builds a free-gifts config sheet with open-ended dates so the rows are always active.
 * @param {Array<{ minPrice: string, label: string, slugs?: string }>} rows
 * @returns {string} The sheet HTML
 */
function buildSheet(rows) {
  const cells = rows.map(({ minPrice, label, slugs = '' }) => `
    <div>
      <div></div>
      <div></div>
      <div>${minPrice}</div>
      <div><strong>${label}</strong></div>
      <div><p>${label}</p></div>
      <div>${slugs}</div>
    </div>`).join('');
  return `<div><div class="free-gifts">${cells}</div></div>`;
}

test.describe('PDP free gift minimum price', () => {
  let currentBranch;

  test.beforeAll(async () => {
    currentBranch = await getCurrentBranch();
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.IS_TEST_MODE = true;
      localStorage.setItem('vitamix.priceRules.stub', JSON.stringify({ promotions: [] }));
    });
    await page.route('**/us/en_us/products/operations-log', (route) => route.fulfill({ status: 204, body: '' }));
  });

  async function mockGifts(page, rows) {
    await page.route('**/us/en_us/products/config/free-gifts.plain.html', (route) => route.fulfill({
      contentType: 'text/html',
      body: buildSheet(rows),
    }));
  }

  test('hides the gift on a product below the minimum price', async ({ page }) => {
    await mockGifts(page, [{ minPrice: '$299.95', label: 'Free scraper over 299' }]);
    await page.goto(buildProductUrl(CHEAP_PRODUCT, currentBranch));
    await expect(page.locator('.pdp-buy-box')).toBeVisible();
    await expect(page.locator('.pdp-free-gift-container')).toHaveCount(0);
  });

  test('shows the gift on a product at or above the minimum price', async ({ page }) => {
    await mockGifts(page, [{ minPrice: '$299.95', label: 'Free scraper over 299' }]);
    await page.goto(buildProductUrl(PRICEY_PRODUCT, currentBranch));
    await expect(page.locator('.pdp-free-gift-container')).toBeVisible();
    await expect(page.locator('.pdp-free-gift-heading')).toHaveText('Free scraper over 299');
  });

  test('applies the gift to every product when the minimum price is blank', async ({ page }) => {
    await mockGifts(page, [{ minPrice: '', label: 'Free gift for everyone' }]);
    await page.goto(buildProductUrl(PRICEY_PRODUCT, currentBranch));
    await expect(page.locator('.pdp-free-gift-heading')).toHaveText('Free gift for everyone');
  });

  test('falls through to the next gift when the first minimum is not met', async ({ page }) => {
    await mockGifts(page, [
      { minPrice: '$999.95', label: 'Free gift over 999' },
      { minPrice: '$299.95', label: 'Free gift over 299' },
    ]);
    await page.goto(buildProductUrl(PRICEY_PRODUCT, currentBranch));
    await expect(page.locator('.pdp-free-gift-heading')).toHaveText('Free gift over 299');
  });

  test('skips a gift row with an invalid minimum price', async ({ page }) => {
    await mockGifts(page, [{ minPrice: 'tbd', label: 'Broken row' }]);
    await page.goto(buildProductUrl(PRICEY_PRODUCT, currentBranch));
    await expect(page.locator('.pdp-buy-box')).toBeVisible();
    await expect(page.locator('.pdp-free-gift-container')).toHaveCount(0);
  });
});
