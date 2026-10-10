import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test('Update images previews the new galleries and writes only after confirmation', async ({ page }) => {
  const product = {
    path: '/us/en_us/products/test',
    sku: '001',
    name: 'Test product',
    images: [],
    variants: [],
  };
  const writes = [];
  await page.addInitScript(() => sessionStorage.setItem('productbus-stage', 'false'));
  await page.route('http://commerce-admin.test/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    let body = await readFile(`.${pathname}`, 'utf8');
    if (pathname.endsWith('.html')) {
      body = body.replace('<html lang="en">', '<html lang="en" class="commerce-admin-auth-ok">')
        .replace(/<script type="module" src="(?:auth-page-boot|commerce-admin-header)\.js"><\/script>/g, '');
    }
    const contentType = pathname.endsWith('.html') ? 'text/html' : 'text/javascript';
    await route.fulfill({
      body,
      contentType: pathname.endsWith('.css') ? 'text/css' : contentType,
    });
  });
  await page.route('https://fcors.org/**', async (route) => {
    const target = new URL(route.request().url()).searchParams.get('url');
    if (route.request().method() === 'PUT') writes.push(route.request().postDataJSON());
    let json = product;
    if (target.includes('index.json')) json = { data: [] };
    if (target.includes('images.json')) {
      json = {
        data: [
          { Path: 'new-image.jpg', Label: 'New gallery image', Market: 'US, CA' },
          { Path: 'ca-only.jpg', Label: 'Canada image', Market: 'CA' },
        ],
      };
    }
    await route.fulfill({ json });
  });
  await page.goto('http://commerce-admin.test/tools/commerce-admin/product-detail.html?product=test');
  await expect(page.locator('#toolbar')).toBeVisible();
  await expect(page.locator('#productUpdateImagesBtn')).toHaveCount(0);
  await page.locator('label[for="editModeCheckbox"]').click();
  await expect(page.locator('.pim-detail-section-head #productUpdateImagesBtn')).toBeVisible();
  await expect(page.locator('#toolbar #productUpdateImagesBtn')).toHaveCount(0);
  await page.locator('#productUpdateImagesBtn').click();
  const modal = page.locator('.pim-sync-dialog');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.pim-sync-card-img')).toHaveAttribute('src', /new-image\.jpg/);
  await expect(modal.locator('.pim-sync-card-label')).toHaveText('New gallery image');
  const mediaBox = await modal.locator('.pim-sync-card-media').boundingBox();
  expect(Math.round(mediaBox.width)).toBe(Math.round(mediaBox.height));
  await modal.getByRole('button', { name: 'View larger image: New gallery image' }).click();
  const lightbox = page.locator('.pim-sync-lightbox');
  await expect(lightbox).toBeVisible();
  await expect(lightbox.locator('img')).toHaveAttribute('src', /new-image\.jpg/);
  await page.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);
  await expect(modal).toBeVisible();
  expect(writes).toHaveLength(0);
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await expect(modal).toHaveCount(0);
  expect(writes).toHaveLength(0);
  await page.locator('#productUpdateImagesBtn').click();
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Update images', exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(writes[0].images).toHaveLength(1);
  expect(writes[0].images[0].url).toContain('/assets/products/test/new-image.jpg');

  await page.route('https://fcors.org/**', async (route) => {
    const target = new URL(route.request().url()).searchParams.get('url');
    if (target.includes('images.json')) {
      await route.fulfill({ status: 404, body: 'Not found' });
    } else {
      await route.fulfill({ json: product });
    }
  });
  await page.locator('#productUpdateImagesBtn').click();
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('alert')).toContainText('No images.json at /assets/products/test/');
  await modal.getByRole('button', { name: 'Close' }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator('#productUpdateImagesBtn')).toBeEnabled();
  expect(writes).toHaveLength(1);
});
