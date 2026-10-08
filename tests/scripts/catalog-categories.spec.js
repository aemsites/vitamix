import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const catalogUrl = 'http://commerce-admin.test/tools/commerce-admin/catalog.html';
const products = [
  {
    sku: '001',
    title: 'Alpha',
    categories: 'Home, Blenders',
    categoriesUrlKey: 'home, blenders',
    price: 100,
  },
  {
    sku: '002',
    title: 'Beta',
    custom: { categories: [{ name: 'Blenders', url_key: 'blenders' }] },
    price: 200,
  },
  {
    sku: '003',
    title: 'Gamma',
    categoriesUrlKey: ['accessories'],
    price: 300,
  },
  { sku: '004', title: 'Delta', price: 400 },
];

test.beforeEach(async ({ page }) => {
  await page.route('http://commerce-admin.test/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const source = await readFile(`.${pathname}`, 'utf8');
    await route.fulfill({
      contentType: pathname.endsWith('.html') ? 'text/html' : 'text/javascript',
      body: pathname.endsWith('.html')
        ? source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
          .replace('data-commerce-header-page="Catalog"', '')
        : source,
    });
  });
  await page.route('https://fcors.org/**', (route) => route.fulfill({
    json: { data: products },
  }));
});

async function openCatalog(page, query = '') {
  await page.goto(`${catalogUrl}${query}`);
  await page.evaluate(async () => {
    const moduleUrl = new URL('./pim.js', window.location.href).href;
    const { init } = await import(moduleUrl);
    await init();
  });
}

test('renders category cells and keeps price under the price header', async ({ page }) => {
  await openCatalog(page);
  const rows = page.locator('#productGrid tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.first().locator('td')).toHaveCount(7);
  await expect(rows.first().locator('.pim-cat-tag')).toHaveText(['Blenders', 'Home']);
  await expect(rows.first().locator('td').nth(6)).toHaveText('100');
  await expect(rows.nth(1).locator('.pim-cat-tag')).toHaveText('Blenders');
  await expect(rows.nth(3).locator('.pim-col-categories')).toHaveText('accessories');
  await expect(rows.nth(2).locator('.pim-col-categories')).toHaveText('—');
});

test('searches categories and supports clicking, clearing, and restoring filters', async ({ page }) => {
  await openCatalog(page);
  await page.locator('#searchInput').fill('blenders');
  await expect(page.locator('#productGrid tr')).toHaveCount(2);
  await expect(page.locator('.pim-cat-tag mark')).toHaveCount(2);
  await page.locator('#searchInput').fill('');

  await page.locator('.pim-cat-tag[data-category="blenders"]').first().click();
  await expect(page).toHaveURL(/category=blenders/);
  await expect(page.locator('#productGrid tr')).toHaveCount(2);
  await expect(page.locator('#categoryFilterChip')).toBeVisible();
  await expect(page.locator('.pim-cat-tag-active')).toHaveCount(2);

  await page.locator('.pim-cat-tag-active').first().press('Enter');
  await expect(page.locator('#productGrid tr')).toHaveCount(4);
  await expect(page.locator('#categoryFilterChip')).toBeHidden();
  await expect(page).toHaveURL(`${catalogUrl}?catalog=us%2Fen_us`);

  await openCatalog(page, '?catalog=us%2Fen_us&category=home');
  await expect(page.locator('#productGrid tr')).toHaveCount(1);
  await expect(page.locator('.pim-cat-filter-name')).toHaveText('Home');
  await page.locator('#categoryFilterClear').click();
  await expect(page.locator('#productGrid tr')).toHaveCount(4);
  await expect(page.locator('#categoryFilterChip')).toBeHidden();
});

test('enables catalog export / import only in production', async ({ page }) => {
  await openCatalog(page);
  await expect(page.locator('#catalogExportImportBtn')).toBeDisabled();

  await page.addInitScript(() => sessionStorage.setItem('productbus-stage', 'false'));
  await openCatalog(page);
  await expect(page.locator('#catalogExportImportBtn')).toBeEnabled();

  await page.evaluate(() => {
    sessionStorage.removeItem('productbus-stage');
    document.getElementById('catalogExportImportBtn').click();
  });
  await expect(page.locator('#catalogExportImportBtn')).toBeDisabled();
  await expect(page.getByText('Export / import is only available in production.')).toBeVisible();

  await page.addInitScript(() => localStorage.setItem('productbus-api-url', 'http://custom-api.test'));
  await openCatalog(page);
  await expect(page.locator('#catalogExportImportBtn')).toBeDisabled();
});

async function openCategoryImport(page) {
  await page.goto(catalogUrl);
  await page.evaluate(async () => {
    const moduleUrl = new URL('./commerce-catalog-io.js', window.location.href).href;
    const { openCatalogExportImportDialog } = await import(moduleUrl);
    const path = '/us/en_us/products/alpha';
    openCatalogExportImportDialog({
      title: 'Export / import catalog',
      hint: '',
      filename: 'catalog.json',
      locale: 'us/en_us',
      existingByPath: new Map([[path, {
        path,
        urlKey: 'alpha',
        custom: { categories: [{ name: 'All Blenders', url_key: 'blenders' }] },
      }]]),
    });
  });
  await page.locator('[data-pim-io-format="categories"]').click();
}

test('category TSV preview regenerates existing slugs and detects slug-only changes', async ({ page }) => {
  await openCategoryImport(page);
  await page.locator('#pim-io-json').fill('Slug\tCategories\nalpha\tAll Blenders, Café & Kitchen!');
  await page.locator('[data-pim-io-preview]').click();
  await expect(page.locator('[data-pim-io-preview-lead]')).toContainText('1 category changes.');
  await expect(page.locator('.pim-io-category-table thead th')).toHaveCount(4);
  await expect(page.locator('del.pim-io-category-diff-del')).toHaveText('blenders');
  await expect(page.locator('.pim-io-category-diff-add'))
    .toHaveText(['all-blenders', '+ Café & Kitchen! [cafe-kitchen]']);
  await expect(page.locator('.pim-io-category-diff-same')).toHaveCount(1);
  await expect(page.locator('.pim-io-category-diff-same'))
    .toHaveText('All Blenders [blenders all-blenders]');
  await page.locator('[data-pim-io-select]').check();
  await expect(page.locator('[data-pim-io-import]')).toBeEnabled();

  await page.locator('[data-pim-io-back]').click();
  await page.locator('#pim-io-json').fill('Slug\tCategories\nalpha\tAll Blenders');
  await page.locator('[data-pim-io-preview]').click();
  await expect(page.locator('[data-pim-io-preview-lead]')).toContainText('1 category changes.');
  await expect(page.locator('[data-pim-io-select]')).toHaveCount(1);
  await expect(page.locator('del.pim-io-category-diff-del')).toHaveText('blenders');
  await expect(page.locator('.pim-io-category-diff-add')).toHaveText('all-blenders');
  await expect(page.locator('.pim-io-category-diff-same')).toHaveCount(1);
  let saved;
  await page.route('https://fcors.org/**', async (route) => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    await route.fulfill({
      json: {
        path: '/us/en_us/products/alpha',
        urlKey: 'alpha',
        custom: {
          categories: [{
            name: 'All Blenders', url_key: 'blenders', urlKey: 'blenders', id: 'category-1',
          }],
        },
      },
    });
  });
  await page.locator('[data-pim-io-select]').check();
  await page.locator('[data-pim-io-import]').click();
  await expect(page.locator('.pim-io-dialog')).toHaveCount(0);
  expect(saved.custom.categories).toEqual([{
    name: 'All Blenders', url_key: 'all-blenders', urlKey: 'all-blenders', id: 'category-1',
  }]);
});

test('flags nonstandard category slugs without changing filtering', async ({ page }) => {
  await page.route('https://fcors.org/**', (route) => route.fulfill({
    json: {
      data: [{
        sku: '001',
        title: 'Alpha',
        categories: 'All Blenders,Blenders,Café & Kitchen!',
        categoriesUrlKey: 'blenders,allblenders,cafe-kitchen',
      }],
    },
  }));
  await openCatalog(page);
  const tags = page.locator('.pim-cat-tag');
  await expect(tags.nth(0)).toHaveText('! All Blenders [blenders]');
  await expect(tags.nth(1)).toHaveText('! Blenders [allblenders]');
  await expect(tags.nth(2)).toHaveText('Café & Kitchen!');
  await expect(page.locator('.pim-cat-slug-warning')).toHaveCount(2);
  await expect(page.locator('.pim-cat-tag-warning')).toHaveCount(2);
  await expect(tags.nth(2)).not.toHaveClass(/pim-cat-tag-warning/);
  await expect(tags.nth(0)).toHaveAttribute('title', /generated slug: all-blenders/);
  await expect(tags.nth(0)).toHaveAccessibleName(/Stored slug: blenders/);
  await tags.nth(0).locator('.pim-cat-slug-warning').click();
  await expect(page).toHaveURL(/category=blenders/);
  await expect(page.locator('.pim-cat-tag-active')).toHaveText('! All Blenders [blenders]');
});

test('duplicate product and category slugs warn but selected rows can be imported', async ({ page }) => {
  const path = '/us/en_us/products/alpha';
  let product = {
    path,
    urlKey: 'alpha',
    custom: { categories: [{ name: 'All Blenders', url_key: 'blenders' }] },
  };
  const writes = [];
  await page.route('https://fcors.org/**', async (route) => {
    if (route.request().method() === 'PUT') {
      product = route.request().postDataJSON();
      writes.push(product);
      await route.fulfill({ json: product });
    } else {
      await route.fulfill({ json: product });
    }
  });
  await openCategoryImport(page);
  await page.locator('#pim-io-json').fill(
    'Slug\tCategories\nalpha\tCafé & Kitchen!, Cafe Kitchen\nalpha\tOther Category',
  );
  await page.locator('[data-pim-io-preview]').click();
  await expect(page.locator('[data-pim-io-preview-lead]')).toContainText('2 category changes.');
  const rows = page.locator('.pim-io-category-table tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('.pim-io-category-row-warning')).toHaveCount(2);
  await expect(rows.first()).toContainText('Category slug "cafe-kitchen" is shared by different names');
  await expect(rows.nth(1)).toContainText('Duplicate product slug.');
  await expect(page.locator('[data-pim-io-select]:checked')).toHaveCount(0);
  await page.locator('[data-pim-io-select-all]').check();
  await expect(page.locator('[data-pim-io-import]')).toBeEnabled();
  await page.locator('[data-pim-io-import]').click();
  await expect(page.locator('.pim-io-dialog')).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[0].custom.categories).toEqual([
    { name: 'Café & Kitchen!', url_key: 'cafe-kitchen' },
    { name: 'Cafe Kitchen', url_key: 'cafe-kitchen' },
  ]);
  expect(product.custom.categories).toEqual([{ name: 'Other Category', url_key: 'other-category' }]);
});

test('category export dedupes full paths and round-trips distinct paths sharing a slug', async ({ page }) => {
  let alertMessage;
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('alert');
    alertMessage = dialog.message();
    await dialog.accept();
  });
  await page.goto(catalogUrl);
  const exported = await page.evaluate(async () => {
    const moduleUrl = new URL('./commerce-catalog-io.js', window.location.href).href;
    const {
      catalogCategoriesTsv, categoryPreviewRows, parseCategoriesTsv, openCatalogExportImportDialog,
    } = await import(moduleUrl);
    const regular = {
      path: '/us/en_us/products/accelerate-container',
      urlKey: 'accelerate-container',
      custom: { categories: [{ name: 'Home', url_key: 'home' }] },
    };
    const commercial = {
      ...regular,
      path: '/us/en_us/products/commercial/accelerate-container',
      custom: { categories: [{ name: 'Commercial', url_key: 'commercial' }] },
    };
    const canadian = { ...regular, path: '/ca/fr_ca/products/accelerate-container' };
    const productsWithDuplicates = [regular, { ...regular }, commercial, canadian];
    const tsv = catalogCategoriesTsv(productsWithDuplicates);
    const existing = new Map(productsWithDuplicates.map((product) => [product.path, product]));
    const rows = categoryPreviewRows(parseCategoriesTsv(tsv), existing);
    openCatalogExportImportDialog({
      title: 'Export / import catalog',
      hint: '',
      filename: 'catalog.json',
      locale: 'us/en_us',
      existingByPath: new Map([[regular.path, regular], [commercial.path, commercial]]),
      loadJson: async () => JSON.stringify([regular, commercial]),
    });
    return {
      tsv,
      rows: rows.map(({ path, kind }) => ({ path, kind })),
      uniqueTsv: catalogCategoriesTsv([regular, regular]),
    };
  });
  expect(exported.tsv.trim().split('\n')).toHaveLength(4);
  expect(exported.rows).toEqual([
    { path: '/us/en_us/products/accelerate-container', kind: 'same' },
    { path: '/us/en_us/products/commercial/accelerate-container', kind: 'same' },
    { path: '/ca/fr_ca/products/accelerate-container', kind: 'same' },
  ]);
  expect(exported.uniqueTsv).toBe('Slug\tCategories\naccelerate-container\tHome\n');
  await expect.poll(() => alertMessage).toContain('/us/en_us/products/accelerate-container');
  expect(alertMessage).toContain('/us/en_us/products/commercial/accelerate-container');
  await expect(page.locator('[data-pim-io-export-warning]')).toHaveCount(0);
  await page.locator('[data-pim-io-format="categories"]').click();
  await expect(page.locator('#pim-io-json')).toHaveValue(
    'Slug\tCategories\n/us/en_us/products/accelerate-container\tHome\n'
    + '/us/en_us/products/commercial/accelerate-container\tCommercial\n',
  );
  await page.locator('[data-pim-io-preview]').click();
  await expect(page.locator('[data-pim-io-preview-lead]')).toContainText('2 unchanged. 0 unresolved.');
  await expect(page.locator('.pim-io-category-row-warning')).toHaveCount(0);
  await expect(page.locator('.pim-io-category-diff-same'))
    .toHaveText(['Home [home]', 'Commercial [commercial]']);
  await expect(page.locator('.pim-io-category-diff-del')).toHaveCount(0);
  await expect(page.locator('.pim-io-category-diff-add')).toHaveCount(0);

  const writes = [];
  await page.route('https://fcors.org/**', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      writes.push(body);
      await route.fulfill({ json: body });
      return;
    }
    const apiUrl = new URL(route.request().url()).searchParams.get('url');
    const path = apiUrl.includes('/products/commercial/')
      ? '/us/en_us/products/commercial/accelerate-container'
      : '/us/en_us/products/accelerate-container';
    await route.fulfill({
      json: {
        path,
        urlKey: 'accelerate-container',
        custom: { categories: [{ name: 'Home', url_key: 'home' }] },
      },
    });
  });
  await page.locator('[data-pim-io-back]').click();
  await page.locator('#pim-io-json').fill(
    'Slug\tCategories\n/us/en_us/products/accelerate-container\tKitchen\n'
    + '/us/en_us/products/commercial/accelerate-container\tProfessional',
  );
  await page.locator('[data-pim-io-preview]').click();
  await page.locator('[data-pim-io-select-all]').check();
  await page.locator('[data-pim-io-import]').click();
  await expect(page.locator('.pim-io-dialog')).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes.find((body) => body.path === '/us/en_us/products/accelerate-container')
    .custom.categories).toEqual([{ name: 'Kitchen', url_key: 'kitchen' }]);
  expect(writes.find((body) => body.path === '/us/en_us/products/commercial/accelerate-container')
    .custom.categories).toEqual([{ name: 'Professional', url_key: 'professional' }]);
});

test('previews and imports Canadian commercial paths with commercial before products', async ({ page }) => {
  const paths = [
    'accelerate-container',
    'advance-container',
    'aer-blend-container',
    'aerating-container',
    'drink-machine-advance',
    'drink-machine-two-speed',
  ].map((slug) => `/ca/fr_ca/commercial/products/${slug}`);
  const writes = [];
  await page.route('https://fcors.org/**', async (route) => {
    const apiUrl = new URL(new URL(route.request().url()).searchParams.get('url'));
    const path = apiUrl.pathname.slice(apiUrl.pathname.indexOf('/catalog/') + '/catalog'.length)
      .replace(/\.json$/, '');
    expect(paths).toContain(path);
    if (route.request().method() === 'PUT') {
      writes.push(route.request().postDataJSON());
    }
    await route.fulfill({
      json: {
        path,
        urlKey: path.split('/').pop(),
        custom: { categories: [{ name: 'Commercial', url_key: 'commercial' }] },
      },
    });
  });
  await page.goto(catalogUrl);
  await page.evaluate(async () => {
    const moduleUrl = new URL('./commerce-catalog-io.js', window.location.href).href;
    const { openCatalogExportImportDialog } = await import(moduleUrl);
    openCatalogExportImportDialog({
      title: 'Export / import catalog',
      hint: '',
      filename: 'catalog.json',
      locale: 'ca/fr_ca',
    });
  });
  await page.locator('[data-pim-io-format="categories"]').click();
  await page.locator('#pim-io-json').fill(
    `Slug\tCategories\n${paths.map((path) => `${path}\tCommercial, Products, Accessories`).join('\n')}`,
  );
  await page.locator('[data-pim-io-preview]').click();
  await expect(page.locator('[data-pim-io-preview-lead]')).toContainText(
    '6 category changes. 0 unchanged. 0 unresolved.',
  );
  await expect(page.locator('.pim-io-category-table tbody tr')).toHaveCount(6);
  await page.locator('[data-pim-io-select-all]').check();
  await page.locator('[data-pim-io-import]').press('Enter');
  await expect(page.locator('.pim-io-dialog')).toHaveCount(0);
  expect(writes.map((body) => body.path).sort()).toEqual([...paths].sort());
});
