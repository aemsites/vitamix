import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const specificationTabsPath = resolve('blocks/pdp/specification-tabs.js');

/**
 * Renders the production PDP tabs module in a browser and opens its Resources tab.
 *
 * @param {import('@playwright/test').Page} page Browser page used for the module rendering.
 * @param {boolean} isCommercial Whether the rendered PDP is commercial.
 * @returns {Promise<void>} Resolves after the Resources tab has become active.
 */
async function renderResourcesTab(page, isCommercial) {
  const source = await readFile(specificationTabsPath, 'utf8');

  await page.setContent('<main></main>');
  await page.evaluate(async ({ moduleSource, commercial }) => {
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
        { isCommercial: commercial, options: [], resources: [] },
        'Test Blender',
      );
      document.querySelector('main').append(tabs);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
  }, { moduleSource: source, commercial: isCommercial });

  await page.locator('.tab[data-target="resources"]').click();
  await expect(page.locator('#resources')).toHaveClass(/active/);
}

/**
 * Checks the rendered Resources support callout for its expected contact details.
 *
 * @param {import('@playwright/test').Page} page Browser page containing the callout.
 * @param {string} supportEmail Expected visible support email address.
 * @param {string} phoneLabel Expected visible phone number.
 * @param {string} phoneLink Expected telephone link target.
 * @returns {Promise<void>} Resolves after all support-link assertions pass.
 */
async function expectSupportContact(page, supportEmail, phoneLabel, phoneLink) {
  const callout = page.locator('.pdp-questions-container');
  const email = callout.locator('a[href^="mailto:"]');
  const phone = callout.locator('a[href^="tel:"]');

  await expect(email).toHaveText(supportEmail);
  await expect(email).toHaveAttribute('href', `mailto:${supportEmail}`);
  await expect(phone).toHaveText(phoneLabel);
  await expect(phone).toHaveAttribute('href', phoneLink);
}

test(
  'Resources support callout retains the household customer-service phone number',
  async ({ page }) => {
    await renderResourcesTab(page, false);
    await expectSupportContact(
      page,
      'service@vitamix.com',
      '1.800.848.2649',
      'tel:18008482649',
    );
  },
);

test(
  'Resources support callout uses the commercial customer-service phone number',
  async ({ page }) => {
    await renderResourcesTab(page, true);
    await expectSupportContact(
      page,
      'commercial@vitamix.com',
      '1.800.886.5235',
      'tel:18008865235',
    );
  },
);
