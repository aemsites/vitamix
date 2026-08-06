import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const specificationTabsPath = resolve('blocks/pdp/specification-tabs.js');

/**
 * Renders the production PDP tabs module in a browser and opens its Resources tab.
 *
 * @param {import('@playwright/test').Page} page Browser page used for the module rendering.
 * @returns {Promise<void>} Resolves after the Resources tab has become active.
 */
async function renderResourcesTab(page) {
  const source = await readFile(specificationTabsPath, 'utf8');

  await page.setContent('<main></main>');
  await page.evaluate(async (moduleSource) => {
    const moduleUrl = URL.createObjectURL(
      new Blob([moduleSource], { type: 'text/javascript' }),
    );

    try {
      const { default: renderSpecs } = await import(moduleUrl);
      const specifications = document.createElement('div');
      specifications.textContent = 'Product specifications';
      const tabs = renderSpecs(
        { specifications: 'Specifications', resources: 'Resources' },
        specifications,
        { options: [], resources: [] },
        'Test Blender',
      );
      document.querySelector('main').append(tabs);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
  }, source);

  await page.locator('.tab[data-target="resources"]').click();
  await expect(page.locator('#resources')).toHaveClass(/active/);
}

test(
  'Resources support callout uses the commercial customer-service phone number',
  async ({ page }) => {
    await renderResourcesTab(page);

    const callout = page.locator('.pdp-questions-container');
    const phone = callout.locator('a[href^="tel:"]');

    await expect(phone).toHaveText('1.800.886.5235');
    await expect(phone).toHaveAttribute('href', 'tel:18008865235');
    await expect(callout.locator('a[href="mailto:service@vitamix.com"]')).toHaveText(
      'service@vitamix.com',
    );
  },
);
