import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const product = {
  path: '/us/en_us/products/alpha',
  sku: '001',
  name: 'Alpha',
  price: 100,
  enabled: true,
  custom: { description: 'First line\nSecond line', empty: null },
  tags: ['home', 'blender'],
};

test.beforeEach(async ({ page }) => {
  await page.route('http://commerce-admin.test/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('.html')) {
      await route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' });
    } else {
      await route.fulfill({
        contentType: pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
        body: await readFile(`.${pathname}`, 'utf8'),
      });
    }
  });
  await page.goto('http://commerce-admin.test/tools/commerce-admin/product-detail.html');
  await page.addStyleTag({ url: './pim.css' });
  await page.evaluate(async (initial) => {
    const moduleUrl = new URL('./commerce-catalog-io.js', window.location.href).href;
    const { openCatalogExportImportDialog } = await import(moduleUrl);
    openCatalogExportImportDialog({
      title: 'Export / import product',
      hint: 'Edit product JSON',
      filename: 'product.json',
      initialJson: JSON.stringify(initial, null, 2),
      existingByPath: new Map([[initial.path, initial]]),
      onApplied: (products) => { window.importedProducts = products; },
    });
  }, product);
});

async function nodeFor(page, name) {
  return page.locator(`[data-property="${name}"]`).last();
}

async function editField(node, label, text) {
  const row = node.locator(':scope > .pim-json-row');
  await row.getByRole('button', { name: new RegExp(`^Edit ${label.toLowerCase()}:`) }).click();
  await row.getByLabel(label, { exact: true }).fill(text);
  await row.getByLabel(label, { exact: true }).press('Tab');
}

async function rawJson(page) {
  return JSON.parse(await page.locator('#pim-io-json').inputValue());
}

test('round-trips all JSON types and edits names and values without losing multiline strings', async ({ page }) => {
  await page.getByLabel('Editor view').check();
  await expect(page.locator('#pim-io-json')).toBeHidden();
  await expect(page.locator('.pim-json-tree')).toBeVisible();
  await expect(page.locator('.pim-json-tree select')).toHaveCount(0);
  await expect(page.locator('.pim-json-field input:visible, .pim-json-field textarea:visible'))
    .toHaveCount(0);
  const name = await nodeFor(page, 'name');
  await editField(name, 'Value', 'New product');
  await expect(name.locator(':scope > .pim-json-row > .pim-json-dirty')).toHaveText('Modified');
  await expect(name.locator('.pim-json-field-dirty')).toHaveCount(1);
  const price = await nodeFor(page, 'price');
  await editField(price, 'Value', '123.45');
  const enabled = await nodeFor(page, 'enabled');
  await editField(enabled, 'Value', 'false');
  await editField(enabled, 'Property name', 'available');
  await page.getByLabel('Editor view').uncheck();
  await expect(page.locator('#pim-io-json')).toBeVisible();
  expect(await rawJson(page)).toEqual({
    ...product, name: 'New product', price: 123.45, enabled: undefined, available: false,
  });
  await page.getByLabel('Editor view').check();
  await expect(name.locator(':scope > .pim-json-row > .pim-json-dirty')).toBeVisible();
  await page.getByLabel('Editor view').uncheck();
  await page.locator('#pim-io-json').fill(JSON.stringify({ ...product, name: 'Raw edit' }));
  await page.getByLabel('Editor view').check();
  await expect((await nodeFor(page, 'name')).getByRole('button', { name: 'Edit value: Raw edit' }))
    .toBeVisible();
});

test('adds strings and removes nested properties and array items with subtle icon controls', async ({ page }) => {
  await page.getByLabel('Editor view').check();
  const custom = await nodeFor(page, 'custom');
  await custom.locator(':scope > .pim-json-row > .pim-json-toggle').click();
  await expect(custom.getByRole('button', { name: 'Add property', exact: true }))
    .toHaveText('Add property');
  await expect(custom.getByRole('button', { name: 'Add property', exact: true }).locator('svg'))
    .toBeVisible();
  await custom.getByRole('button', { name: 'Add property', exact: true }).click();
  const added = await nodeFor(page, 'property');
  await expect(added.getByLabel('Property name', { exact: true })).toBeFocused();
  await added.getByLabel('Property name', { exact: true }).fill('__proto__');
  await added.getByLabel('Property name', { exact: true }).press('Tab');
  await editField(added, 'Value', 'safe');
  await expect(added.getByText('Added', { exact: true })).toBeVisible();
  await (await nodeFor(page, 'empty')).getByRole('button', { name: 'Remove', exact: true }).click();
  const tags = await nodeFor(page, 'tags');
  await tags.locator(':scope > .pim-json-row > .pim-json-toggle').click();
  await expect(tags.getByRole('button', { name: 'Add item', exact: true })).toHaveText('Add item');
  await tags.getByRole('button', { name: 'Add item', exact: true }).click();
  await tags.getByLabel('Value', { exact: true }).last().fill('new');
  await tags.getByLabel('Value', { exact: true }).last().press('Tab');
  await tags.getByRole('button', { name: 'Remove', exact: true }).nth(1).click();
  await page.getByLabel('Editor view').uncheck();
  const result = await rawJson(page);
  expect(result.tags).toEqual(['blender', 'new']);
  expect(result.custom).toEqual(JSON.parse('{"description":"First line\\nSecond line","__proto__":"safe"}'));
});

test('rejects invalid raw JSON, duplicate keys, and invalid numbers without losing edits', async ({ page }) => {
  await page.locator('#pim-io-json').fill('{ broken');
  await page.getByLabel('Editor view').click();
  await expect(page.getByLabel('Editor view')).not.toBeChecked();
  await expect(page.locator('[data-pim-io-status]')).toContainText('Cannot switch view');
  await expect(page.locator('#pim-io-json')).toHaveValue('{ broken');
  await page.locator('#pim-io-json').fill(JSON.stringify(product));
  await page.getByLabel('Editor view').check();
  const name = await nodeFor(page, 'name');
  await editField(name, 'Property name', 'sku');
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(page.locator('[data-pim-io-status]')).toContainText('must be unique');
  await page.getByLabel('Editor view').click();
  await expect(page.getByLabel('Editor view')).toBeChecked();
  await editField(name, 'Property name', 'name');
  const price = await nodeFor(page, 'price');
  await editField(price, 'Value', '');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.locator('[data-pim-io-status]')).toContainText('valid, finite number');
  await editField(price, 'Value', '42');
  await page.getByLabel('Editor view').uncheck();
  expect((await rawJson(page)).price).toBe(42);
});

test('downloads, previews and imports tree edits, preserving them when going back', async ({ page }) => {
  await page.getByLabel('Editor view').check();
  await editField(await nodeFor(page, 'name'), 'Value', 'Edited');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadEvent;
  expect(JSON.parse(await readFile(await download.path(), 'utf8'))).toEqual({
    ...product, name: 'Edited',
  });
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(page.getByLabel('Editor view')).toBeHidden();
  await expect(page.locator('[data-pim-io-preview-list]')).toContainText('Edited');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Editor view')).toBeChecked();
  await expect((await nodeFor(page, 'name')).getByRole('button', { name: 'Edit value: Edited' }))
    .toBeVisible();
  let saved;
  await page.route('https://fcors.org/**', async (route) => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    await route.fulfill({ json: product });
  });
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await page.locator('[data-pim-io-import]').click();
  await expect(page.locator('.pim-io-dialog')).toHaveCount(0);
  expect(saved).toEqual({ ...product, name: 'Edited' });
  expect(await page.evaluate(() => window.importedProducts)).toEqual([{ ...product, name: 'Edited' }]);
});

test('fits the tree editor within the modal on narrow screens', async ({ page }) => {
  await page.getByLabel('Editor view').check();
  const dimensions = await page.locator('.pim-io-dialog-scroll').evaluate((element) => ({
    width: element.clientWidth, scroll: element.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
});

test('opens all array descendants without index labels and preserves array editing', async ({ page }) => {
  const initial = {
    ...product,
    tags: [{ name: 'Home', nested: { values: [{ label: 'Deep' }] } }],
    custom: { options: [{ name: 'Option', nested: { label: 'Nested' } }] },
  };
  await page.locator('#pim-io-json').fill(JSON.stringify(initial));
  await page.getByLabel('Editor view').check();
  const tags = await nodeFor(page, 'tags');
  await expect(tags.locator(':scope > details')).not.toHaveAttribute('open', '');
  await tags.locator(':scope > .pim-json-row > .pim-json-toggle').click();
  await expect(tags.locator('details:not([open])')).toHaveCount(0);
  const options = await nodeFor(page, 'options');
  await (await nodeFor(page, 'custom')).locator(':scope > .pim-json-row > .pim-json-toggle').click();
  const toggle = options.locator(':scope > .pim-json-row > .pim-json-toggle');
  const add = options.locator(':scope > .pim-json-row > .pim-json-add');
  await expect(options.locator(':scope > details')).not.toHaveAttribute('open', '');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(add).toBeHidden();
  await expect(options.locator(':scope > .pim-json-row > .pim-json-field + .pim-json-toggle'))
    .toHaveCount(1);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(add).toBeVisible();
  await expect(options.locator('details:not([open])')).toHaveCount(0);
  await options.locator('[data-property="nested"] > .pim-json-row > .pim-json-toggle').click();
  await expect(options.locator('details:not([open])')).toHaveCount(1);
  await toggle.click();
  await expect(add).toBeHidden();
  await toggle.click();
  await expect(options.locator('details:not([open])')).toHaveCount(0);
  await expect(page.locator('.pim-json-tree')).not.toContainText(/\[\d+\]/);
  await editField(options.locator('[data-property="name"]'), 'Value', 'Edited option');
  await page.getByLabel('Editor view').uncheck();
  expect(await rawJson(page)).toEqual({
    ...initial,
    custom: { options: [{ name: 'Edited option', nested: { label: 'Nested' } }] },
  });
});

test('adds blank copies of array items without property counts or item-level add-property buttons', async ({ page }) => {
  const original = {
    name: 'Home',
    price: 100,
    enabled: true,
    optional: null,
    nested: { values: [{ label: 'Deep' }], empty: [] },
  };
  const blank = {
    name: '',
    price: '',
    enabled: '',
    optional: '',
    nested: { values: [{ label: '' }], empty: [] },
  };
  await page.locator('#pim-io-json').fill(JSON.stringify({ ...product, tags: [original] }));
  await page.getByLabel('Editor view').check();
  const tags = await nodeFor(page, 'tags');
  await tags.locator(':scope > .pim-json-row > .pim-json-toggle').click();
  const children = tags.locator(':scope > details > .pim-json-children');
  const add = tags.locator(':scope > .pim-json-row')
    .getByRole('button', { name: 'Add item', exact: true });
  await expect(children.locator(':scope > .pim-json-node > .pim-json-row')
    .getByRole('button', { name: 'Add property', exact: true })).toHaveCount(0);
  await expect(page.locator('.pim-json-tree summary:visible')).toHaveCount(0);
  await expect(children.locator(':scope > .pim-json-node > .pim-json-row > .pim-json-toggle'))
    .toHaveCount(0);
  await add.click();
  await expect(children.locator(':scope > .pim-json-node')).toHaveCount(2);
  await expect(children.locator('details:not([open])')).toHaveCount(0);
  expect((await rawJson(page)).tags).toEqual([original, blank]);
  const remove = children.locator(':scope > .pim-json-node > .pim-json-row')
    .getByRole('button', { name: 'Remove', exact: true });
  await remove.first().click();
  await remove.first().click();
  await add.click();
  expect((await rawJson(page)).tags).toEqual([blank]);
  const nestedEmpty = children.locator('[data-property="empty"] > .pim-json-row');
  await nestedEmpty.getByRole('button', { name: 'Add item', exact: true }).click();
  expect((await rawJson(page)).tags[0].nested.empty).toEqual(['']);
});

test('cancels a field edit with Escape and clears dirty marks when the original value is restored', async ({ page }) => {
  await page.getByLabel('Editor view').check();
  const name = await nodeFor(page, 'name');
  await editField(name, 'Value', 'Changed');
  await name.getByRole('button', { name: 'Edit value: Changed' }).click();
  await name.getByLabel('Value', { exact: true }).fill('Cancelled');
  await name.getByLabel('Value', { exact: true }).press('Escape');
  await expect(page.locator('.pim-io-dialog')).toBeVisible();
  await expect(name.getByRole('button', { name: 'Edit value: Changed' })).toBeVisible();
  await editField(name, 'Value', 'Alpha');
  await expect(name.locator('.pim-json-field-dirty')).toHaveCount(0);
  await expect(name.locator(':scope > .pim-json-row > .pim-json-dirty')).toBeHidden();
  expect(await rawJson(page)).toEqual(product);
});

test('search highlights matching parent names and keeps their children editable without losing hidden data', async ({ page }) => {
  const initial = {
    ...product,
    price: { regular: 100, final: 80 },
    custom: { pricing: { specialPrice: 70 }, description: 'price is only a value here' },
  };
  await page.locator('#pim-io-json').fill(JSON.stringify(initial));
  await page.getByLabel('Editor view').check();
  const search = page.getByRole('searchbox', { name: 'Search property names' });
  await search.fill('PRICE');
  const price = await nodeFor(page, 'price');
  await expect(price.locator(':scope > .pim-json-row mark')).toHaveText('price');
  await expect((await nodeFor(page, 'name'))).toBeHidden();
  await expect((await nodeFor(page, 'description'))).toBeHidden();
  await expect((await nodeFor(page, 'custom'))).toBeVisible();
  await expect((await nodeFor(page, 'specialPrice'))).toBeVisible();
  await expect((await nodeFor(page, 'specialPrice')).locator('mark')).toHaveText('Price');
  await editField(await nodeFor(page, 'final'), 'Value', '75');
  await price.locator(':scope > .pim-json-row')
    .getByRole('button', { name: 'Add property', exact: true }).click();
  const added = await nodeFor(page, 'property');
  await added.getByLabel('Property name', { exact: true }).fill('discount');
  await added.getByLabel('Property name', { exact: true }).press('Tab');
  await editField(added, 'Value', '5');
  await search.fill('no-match');
  await expect(page.getByRole('status')).toHaveText('No matching properties.');
  await search.fill('');
  await expect((await nodeFor(page, 'name'))).toBeVisible();
  await expect(page.locator('.pim-json-tree mark')).toHaveCount(0);
  await page.getByLabel('Editor view').uncheck();
  expect(await rawJson(page)).toEqual({
    ...initial, price: { regular: 100, final: 75, discount: '5' },
  });
});

test('search opens nested array matches, restores collapsed branches, and accepts literal special characters', async ({ page }) => {
  const initial = {
    ...product,
    custom: { variants: [{ 'price[usd]': 10, name: 'Variant' }] },
  };
  await page.locator('#pim-io-json').fill(JSON.stringify(initial));
  await page.getByLabel('Editor view').check();
  const variants = await nodeFor(page, 'variants');
  await expect(variants.locator(':scope > details')).not.toHaveAttribute('open', '');
  const search = page.getByRole('searchbox', { name: 'Search property names' });
  await search.fill('price[usd]');
  await expect(variants.locator('mark')).toHaveText('price[usd]');
  await expect(variants.getByRole('button', { name: 'Edit value: 10', exact: true })).toBeVisible();
  await search.fill('');
  await expect(variants.locator(':scope > details')).not.toHaveAttribute('open', '');
  expect(await rawJson(page)).toEqual(initial);
});

test('starts parent objects and arrays collapsed and expands matching parents during search', async ({ page }) => {
  await page.locator('#pim-io-json').fill(JSON.stringify({
    ...product, price: { regular: 100, final: 80 },
  }));
  await page.getByLabel('Editor view').check();
  const price = await nodeFor(page, 'price');
  const custom = await nodeFor(page, 'custom');
  const tags = await nodeFor(page, 'tags');
  await expect(price.locator(':scope > details')).not.toHaveAttribute('open', '');
  await expect(custom.locator(':scope > details')).not.toHaveAttribute('open', '');
  await expect(tags.locator(':scope > details')).not.toHaveAttribute('open', '');
  const search = page.getByRole('searchbox', { name: 'Search property names' });
  await search.fill('price');
  await expect(price.locator(':scope > details')).toHaveAttribute('open', '');
  await expect(price.getByRole('button', { name: 'Edit value: 100', exact: true })).toBeVisible();
  await search.fill('');
  await expect(price.locator(':scope > details')).not.toHaveAttribute('open', '');
});
