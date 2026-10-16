import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const catalogUrl = 'http://commerce-admin.test/tools/commerce-admin/catalog.html?stage=false';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function setup(page, rows, { sheetStatus = 200, writeStatus = 201 } = {}) {
  const writes = [];
  await page.route('http://commerce-admin.test/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('product-detail.html')) {
      await route.fulfill({ contentType: 'text/html', body: '<h1>Created product detail</h1>' });
      return;
    }
    let body = await readFile(`.${pathname}`, 'utf8');
    if (pathname.endsWith('.html')) {
      body = body.replace('<html lang="en">', '<html lang="en" class="commerce-admin-auth-ok">')
        .replace(/<script type="module" src="(?:auth-page-boot|commerce-admin-header)\.js"><\/script>/g, '');
    }
    const contentType = pathname.endsWith('.css') ? 'text/css' : 'text/javascript';
    await route.fulfill({ body, contentType: pathname.endsWith('.html') ? 'text/html' : contentType });
  });
  await page.route('https://main--vitamix--aemsites.aem.live/**', (route) => route.fulfill({
    contentType: 'image/png', body: pixel,
  }));
  await page.route('https://fcors.org/**', async (route) => {
    const target = new URL(route.request().url()).searchParams.get('url');
    if (route.request().method() === 'PUT') {
      writes.push({
        target,
        body: route.request().postDataJSON(),
        headers: route.request().headers(),
      });
      await route.fulfill({ status: writeStatus, json: { product: { status: writeStatus } } });
    } else if (target.includes('images.json')) {
      await route.fulfill({ status: sheetStatus, json: { data: rows } });
    } else {
      await route.fulfill({ json: { data: [] } });
    }
  });
  await page.goto(catalogUrl);
  await page.getByRole('button', { name: 'Add new product' }).click();
  return writes;
}

async function inspect(page, { locale, commercial = false } = {}) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('URL key', { exact: true }).fill('test-product');
  if (locale) await dialog.getByRole('listbox', { name: 'Catalogs', exact: true }).selectOption(locale);
  if (commercial) await dialog.getByLabel('Placement').selectOption('commercial/');
  await dialog.getByRole('button', { name: 'Check assets', exact: true }).click();
  return dialog;
}

async function fillProduct(dialog) {
  await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await dialog.getByLabel('Product name', { exact: true }).fill('Test blender');
  await dialog.getByLabel('Product / parent SKU').fill('PARENT');
}

test('asset-derived variants, galleries and prices are reviewed before a create-only write', async ({ page }) => {
  const writes = await setup(page, [
    {
      Path: 'shared.jpg', Label: 'Shared image', Market: 'US, CA', 'og-image': 'true',
    },
    { Path: 'shadow-black/front.jpg', Label: 'Black front', Video: 'https://example.com/demo.mp4' },
    { Path: 'polar-white/front.jpg', Label: 'White front' },
    { Path: 'red/front.jpg', Market: 'CA' },
  ]);
  const dialog = await inspect(page);
  await expect(dialog.locator('[data-assets-status]')).toContainText('2 color variant(s), 3 image(s)');
  await expect(dialog.locator('[data-assets-preview] img')).toHaveCount(3);
  await expect(dialog.getByText('Social image', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await fillProduct(dialog);
  const groups = dialog.locator('fieldset');
  await expect(groups).toHaveCount(2);
  await expect(groups.first().getByLabel('Variant name')).toHaveValue('Test blender Shadow Black');
  await expect(groups.first().getByLabel('Variant URL')).toHaveValue('https://www.vitamix.com/us/en_us/products/test-product?color=shadow-black');
  await groups.first().getByLabel('Variant SKU').fill('BLACK');
  await groups.first().getByLabel('Final price', { exact: true }).fill('499.95');
  await groups.first().getByLabel('Regular price (optional)').fill('599.95');
  await groups.last().getByLabel('Variant SKU').fill('WHITE');
  await groups.last().getByLabel('Final price', { exact: true }).fill('509.95');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.locator('[data-review] pre')).toContainText('"robots": "noindex"');
  await expect(dialog.locator('[data-review] img')).toHaveCount(3);
  await expect(dialog.locator('.product-create-summary')).toContainText('USD 499.95');
  expect(writes).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(groups.first().getByLabel('Variant SKU')).toHaveValue('BLACK');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  const bounds = await dialog.boundingBox();
  expect(bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
  await expect(dialog.getByRole('button', { name: 'Create product', exact: true })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(page).toHaveURL(/product-detail.html\?.*stage=false/);
  expect(writes).toHaveLength(1);
  expect(writes[0].headers['if-none-match']).toBe('*');
  expect(writes[0].target).toContain('/catalog/us/en_us/products/test-product.json');
  const { body } = writes[0];
  expect(body).toMatchObject({
    sku: 'PARENT',
    type: 'configurable',
    metadata: { robots: 'noindex' },
    availability: 'OutOfStock',
    options: [{
      id: 'color',
      label: 'Color',
      values: [
        { id: 'shadow-black', value: 'Shadow Black' }, { id: 'polar-white', value: 'Polar White' },
      ],
    }],
  });
  expect(body.images).toHaveLength(1);
  expect(body.metaImage).toContain('shared.jpg');
  expect(body.variants).toHaveLength(2);
  expect(body.variants[0]).toMatchObject({
    sku: 'BLACK',
    availability: 'OutOfStock',
    price: { currency: 'USD', final: '499.95', regular: '599.95' },
    options: [{ id: 'color', value: 'Shadow Black' }],
  });
  expect(body.variants[0].images[0].video).toBe('https://example.com/demo.mp4');
  expect(body.variants[0].images[0].url).toContain('/shadow-black/front.jpg');
  expect(body.variants[1].images[0].url).toContain('/polar-white/front.jpg');
});

test('simple commercial products use locale currency and collision errors preserve the form', async ({ page }) => {
  const writes = await setup(page, [{ Path: 'front.jpg' }], { writeStatus: 412 });
  const dialog = await inspect(page, { locale: 'ca/fr_ca', commercial: true });
  await expect(dialog.locator('[data-assets-status]')).toContainText('Simple product');
  await fillProduct(dialog);
  await expect(dialog.getByLabel('Currency')).toHaveValue('CAD');
  await expect(dialog.getByLabel('Canonical URL')).toHaveValue('https://www.vitamix.com/ca/fr_ca/products/commercial/test-product');
  await dialog.getByLabel('Final price', { exact: true }).fill('45.00');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await dialog.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Nothing was overwritten');
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({
    type: 'simple',
    path: '/ca/fr_ca/products/commercial/test-product',
    price: { currency: 'CAD', final: '45.00' },
    availability: 'OutOfStock',
    metadata: { robots: 'noindex' },
  });
  expect(writes[0].body.variants).toBeUndefined();
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(dialog.getByLabel('Product name', { exact: true })).toHaveValue('Test blender');
  await expect(dialog.getByLabel('Final price', { exact: true })).toHaveValue('45.00');
});

[
  {
    name: 'missing', rows: [], status: 404, message: 'No images.json',
  },
  { name: 'empty', rows: [], message: 'No images are available' },
  { name: 'other market only', rows: [{ Path: 'black/front.jpg', Market: 'CA' }], message: 'No images are available' },
  { name: 'malformed paths', rows: [{ Label: 'No path' }], message: 'invalid Path' },
  { name: 'ambiguous folders', rows: [{ Path: 'Black & White/front.jpg' }], message: 'ambiguous color folder' },
].forEach(({
  name, rows, status, message,
}) => {
  test(`${name} assets block progression and can be checked again`, async ({ page }) => {
    const writes = await setup(page, rows, { sheetStatus: status });
    const dialog = await inspect(page);
    await expect(dialog.getByRole('alert')).toContainText(message);
    await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('link', { name: 'Set up product assets' })).toHaveAttribute('href', 'https://da.live/app/aemsites/vitamix/tools/product-assets/app?ref=product-assets');
    await page.route('https://fcors.org/**', (route) => route.fulfill({
      json: { data: [{ Path: 'black/front.jpg' }] },
    }));
    await dialog.getByRole('button', { name: 'Check again', exact: true }).click();
    await expect(dialog.locator('[data-assets-status]')).toContainText('Configurable product: 1 color variant(s)');
    await expect(dialog.getByLabel('URL key', { exact: true })).toHaveValue('test-product');
    await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
    expect(writes).toHaveLength(0);
  });
});

test('changing asset identity invalidates the preview; dismissal requires confirmation', async ({ page }) => {
  const writes = await setup(page, [{ Path: 'front.jpg' }]);
  const dialog = await inspect(page);
  await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  await dialog.getByLabel('URL key', { exact: true }).fill('different');
  await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await expect(dialog.locator('[data-assets-preview] img')).toHaveCount(0);
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('URL key', { exact: true })).toHaveValue('different');
  page.once('dialog', (confirmation) => confirmation.accept());
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test('broken image files block creation, not just a missing manifest', async ({ page }) => {
  const writes = await setup(page, [{ Path: 'broken.jpg' }]);
  await page.route('https://main--vitamix--aemsites.aem.live/**', (route) => route.fulfill({ status: 404 }));
  const dialog = await inspect(page);
  await expect(dialog.getByRole('alert')).toContainText('image preview could not load');
  await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

test('creation remains disabled in staging', async ({ page }) => {
  await setup(page, [{ Path: 'front.jpg' }]);
  await page.keyboard.press('Escape');
  await page.goto(catalogUrl.replace('stage=false', 'stage=true'));
  await expect(page.getByRole('button', { name: 'Add new product' })).toBeDisabled();
});

[
  { name: 'invalid shape', json: {}, message: 'image data array' },
  { name: 'incomplete', json: { data: [{ Path: 'front.jpg' }], total: 2 }, message: 'incomplete' },
  { name: 'sign-in HTML', body: '<html>Sign in</html>', message: 'not available' },
  { name: 'invalid JSON', body: 'invalid-json', message: 'not valid JSON' },
].forEach((document) => {
  test(`${document.name} manifests block creation; multi-sheet assets can be retried`, async ({ page }) => {
    const writes = await setup(page, []);
    const dialog = await inspect(page);
    await expect(dialog.getByRole('alert')).toContainText('No images are available');
    await page.route('https://fcors.org/**', (route) => route.fulfill(
      document.json ? { json: document.json } : { body: document.body },
    ));
    await dialog.getByRole('button', { name: 'Check again', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(document.message);
    await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await page.route('https://fcors.org/**', (route) => route.fulfill({
      json: { images: { data: [{ Path: 'front.jpg' }] }, ':names': ['images'] },
    }));
    await dialog.getByRole('button', { name: 'Check again', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
    expect(writes).toHaveLength(0);
  });
});

test('required prices, distinct SKUs and regular prices are validated before review', async ({ page }) => {
  const writes = await setup(page, [{ Path: 'black/front.jpg' }]);
  const dialog = await inspect(page);
  await fillProduct(dialog);
  const variant = dialog.locator('fieldset');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.locator('[data-progress]')).toContainText('Step 2');
  await variant.getByLabel('Variant SKU').fill('PARENT');
  await variant.getByLabel('Final price', { exact: true }).fill('20.00');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('SKUs must be distinct');
  await variant.getByLabel('Variant SKU').fill('BLACK');
  await variant.getByLabel('Regular price (optional)').fill('10.00');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Regular price must be greater');
  await variant.getByLabel('Regular price (optional)').fill('25.00');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.locator('[data-progress]')).toContainText('Step 3');
  expect(writes).toHaveLength(0);
});

test('server save failures preserve review and allow a create-only retry', async ({ page }) => {
  const writes = await setup(page, [{ Path: 'front.jpg' }], { writeStatus: 500 });
  const dialog = await inspect(page);
  await fillProduct(dialog);
  await dialog.getByLabel('Final price', { exact: true }).fill('45.00');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await dialog.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('HTTP 500');
  await expect(dialog.locator('.product-create-summary')).toContainText('USD 45.00');
  await dialog.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[0].body).toEqual(writes[1].body);
  expect(writes[1].headers['if-none-match']).toBe('*');
});

test('refreshing structure retains entered variant information by color', async ({ page }) => {
  await setup(page, [{ Path: 'black/front.jpg' }]);
  const dialog = await inspect(page);
  await fillProduct(dialog);
  await dialog.getByLabel('Variant SKU').fill('BLACK');
  await dialog.getByLabel('Variant name').fill('Custom black name');
  await dialog.locator('fieldset').getByLabel('Final price', { exact: true }).fill('99.00');
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await page.route('https://fcors.org/**', (route) => route.fulfill({
    json: { data: [{ Path: 'white/front.jpg' }, { Path: 'black/front.jpg' }] },
  }));
  await dialog.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(dialog.locator('[data-assets-status]')).toContainText('2 color variant(s)');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  const black = dialog.locator('[data-color="black"]');
  await expect(black.getByLabel('Variant SKU')).toHaveValue('BLACK');
  await expect(black.getByLabel('Variant name')).toHaveValue('Custom black name');
  await expect(black.getByLabel('Final price', { exact: true })).toHaveValue('99.00');
});

test('multiple catalogs use separate names, URLs and prices with shared color SKUs', async ({ page }) => {
  const writes = await setup(page, [
    { Path: 'black/front.jpg', Market: 'US, CA' },
    { Path: 'white/front.jpg', Market: 'CA' },
  ]);
  const dialog = await inspect(page, { locale: ['us/en_us', 'ca/fr_ca'] });
  await expect(dialog.getByLabel('Placement')).toHaveValue('');
  await expect(dialog.getByLabel('Placement').locator('option:checked')).toHaveText('Household');
  await expect(dialog.locator('[data-path]')).toContainText('/us/en_us/products/test-product');
  await expect(dialog.locator('[data-path]')).toContainText('/ca/fr_ca/products/test-product');
  await expect(dialog.locator('[data-assets-status]')).toContainText('ca/fr_ca: Configurable product: 2 color variant(s)');
  await fillProduct(dialog);
  await dialog.locator('[data-color="black"]').getByLabel('Variant SKU').fill('BLACK');
  await dialog.locator('[data-color="black"]').getByLabel('Final price', { exact: true }).fill('100.00');
  await dialog.getByLabel('Edit catalog').selectOption('ca/fr_ca');
  await expect(dialog.getByLabel('Product / parent SKU')).toHaveValue('PARENT');
  await expect(dialog.getByLabel('Currency')).toHaveValue('CAD');
  await expect(dialog.getByLabel('Canonical URL')).toHaveValue('https://www.vitamix.com/ca/fr_ca/products/test-product');
  await expect(dialog.locator('[data-color="black"]').getByLabel('Variant SKU')).toHaveValue('BLACK');
  await dialog.getByLabel('Product name', { exact: true }).fill('Melangeur');
  await dialog.locator('[data-color="black"]').getByLabel('Final price', { exact: true }).fill('140.00');
  await dialog.locator('[data-color="white"]').getByLabel('Variant SKU').fill('WHITE');
  await dialog.locator('[data-color="white"]').getByLabel('Final price', { exact: true }).fill('150.00');
  await dialog.getByLabel('Edit catalog').selectOption('us/en_us');
  await expect(dialog.getByLabel('Product name', { exact: true })).toHaveValue('Test blender');
  await expect(dialog.getByLabel('Currency')).toHaveValue('USD');
  await expect(dialog.locator('[data-color="black"]').getByLabel('Final price', { exact: true })).toHaveValue('100.00');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.locator('[data-review] pre')).toHaveCount(2);
  expect(writes).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(page).toHaveURL(/product-detail.html/);
  expect(writes).toHaveLength(2);
  const us = writes.find((write) => write.body.path.startsWith('/us/')).body;
  const ca = writes.find((write) => write.body.path.startsWith('/ca/')).body;
  expect(us.name).toBe('Test blender');
  expect(ca.name).toBe('Melangeur');
  expect(us.sku).toBe(ca.sku);
  expect(us.variants).toHaveLength(1);
  expect(ca.variants).toHaveLength(2);
  expect(us.variants[0].price).toMatchObject({ currency: 'USD', final: '100.00' });
  expect(ca.variants[0].price).toMatchObject({ currency: 'CAD', final: '140.00' });
  expect(ca.variants[0].sku).toBe(us.variants[0].sku);
  writes.forEach(({ headers, body }) => {
    expect(headers['if-none-match']).toBe('*');
    expect(body.metadata.robots).toBe('noindex');
    expect(body.availability).toBe('OutOfStock');
  });
});

test('all selected catalogs require valid assets and at least one catalog is required', async ({ page }) => {
  const writes = await setup(page, [{ Path: 'front.jpg', Market: 'US' }]);
  const dialog = await inspect(page, { locale: ['us/en_us', 'ca/fr_ca'] });
  await expect(dialog.getByRole('alert')).toContainText('ca/fr_ca: No images');
  await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await dialog.getByRole('listbox', { name: 'Catalogs', exact: true }).selectOption([]);
  await dialog.getByRole('button', { name: 'Check assets', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

test('review requires details for every catalog and retries skip confirmed creations', async ({ page }) => {
  await setup(page, [{ Path: 'front.jpg' }]);
  const dialog = await inspect(page, { locale: ['us/en_us', 'ca/en_us'] });
  await fillProduct(dialog);
  await dialog.getByLabel('Final price', { exact: true }).fill('100.00');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Complete the product details for ca/en_us');
  await dialog.getByLabel('Product name', { exact: true }).fill('Canada blender');
  await dialog.getByLabel('Final price', { exact: true }).fill('140.00');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  const attempts = [];
  let failCanada = true;
  await page.route('https://fcors.org/**', async (route) => {
    const body = route.request().postDataJSON();
    attempts.push(body.path);
    const status = body.path.startsWith('/ca/') && failCanada ? 500 : 201;
    await route.fulfill({ status, json: { product: { status } } });
  });
  await dialog.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('1 of 2 catalogs created');
  await expect(dialog.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  failCanada = false;
  await dialog.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(page).toHaveURL(/product-detail.html/);
  expect(attempts).toEqual([
    '/us/en_us/products/test-product',
    '/ca/en_us/products/test-product',
    '/ca/en_us/products/test-product',
  ]);
});
