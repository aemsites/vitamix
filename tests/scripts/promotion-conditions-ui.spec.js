import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const origin = 'http://commerce-admin.test';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function fakeJwt() {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${enc({ alg: 'none' })}.${enc({ exp, iat: exp - 60, email: 'admin@example.com' })}.sig`;
}

const future = new Date(Date.now() + 30 * 86400000).toISOString();
const promotion = () => ({
  id: 'gift',
  name: 'Gift',
  country: 'us',
  conditions: {
    minimumSubtotal: 300,
    includedCategories: ['blenders'],
    disqualifyingCategories: ['commercial'],
    futureKey: 'kept',
  },
  rules: [{
    path: '/us/en_us/products/gift', price: '0', end: future, custom: { group: '2026' },
  }],
});

const INDEX = {
  '/us/en_us/products/index.json': [
    {
      path: '/us/en_us/products/gift', urlKey: 'gift', sku: 'G1', title: 'Gift',
    },
  ],
  '/ca/en_us/products/index.json': [
    {
      path: '/ca/en_us/products/gift', urlKey: 'gift', sku: 'G1', title: 'Gift',
    },
    {
      path: '/ca/en_us/products/blender', urlKey: 'blender', sku: 'B1', title: 'Blender',
    },
    {
      path: '/ca/en_us/products/other', urlKey: 'other', sku: 'O1', title: 'Other',
    },
  ],
  '/ca/fr_ca/products/index.json': [
    {
      path: '/ca/fr_ca/products/cadeau', urlKey: 'cadeau', sku: 'G1', title: 'Cadeau',
    },
    {
      path: '/ca/fr_ca/products/melangeur', urlKey: 'melangeur', sku: 'B1', title: 'Melangeur',
    },
    {
      path: '/ca/fr_ca/products/autre', urlKey: 'autre', sku: 'O1', title: 'Autre',
    },
  ],
};

async function setup(page, promotions = [promotion()]) {
  let doc = { promotions };
  const puts = [];
  await page.addInitScript((token) => {
    localStorage.setItem('pbus-auth-aemsites-vitamix-stage', JSON.stringify({
      token, email: 'admin@example.com', roles: ['admin'],
    }));
  }, fakeJwt());
  await page.route('**/*', (route) => route.abort());
  await page.route(`${origin}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    const ext = pathname.slice(pathname.lastIndexOf('.'));
    try {
      await route.fulfill({ contentType: MIME[ext] || 'text/plain', body: await readFile(`.${pathname}`, 'utf8') });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  await page.route('https://fcors.org/**', async (route) => {
    const req = route.request();
    const target = new URL(new URL(req.url()).searchParams.get('url'));
    if (target.pathname.endsWith('/index.json')) {
      await route.fulfill({ json: { data: INDEX[target.pathname] || [] } });
      return;
    }
    const path = target.pathname.replace('/aemsites/sites/vitamix/', '');
    if (path !== 'price-rules/catalog') {
      await route.fulfill({ json: {} });
      return;
    }
    if (req.method() === 'PUT') {
      doc = JSON.parse(req.postData());
      puts.push(doc);
    }
    await route.fulfill({ json: doc });
  });
  return puts;
}

test('promotion dialog edits scope and disqualifiers and keeps other conditions', async ({ page }) => {
  const puts = await setup(page);
  await page.goto(`${origin}/tools/commerce-admin/promotions.html`);

  const row = page.locator('tr[data-pr-promo-open][data-pr-id="gift"]');
  await expect(row.locator('.pr-promo-col-scope')).toHaveText('only: blenders · never with: commercial');

  await row.click();
  await page.locator('[data-pr-promo-modal-edit]').click();
  const dialog = page.locator('dialog.pr-promo-form-dialog');
  await expect(dialog.locator('#pr-promo-included-categories')).toHaveValue('blenders');
  await expect(dialog.locator('#pr-promo-disqualifying-categories')).toHaveValue('commercial');
  await expect(dialog.locator('[data-pr-promo-psf-mount="disqualifying"] .psf-root')).toHaveCount(1);

  await dialog.locator('#pr-promo-min-cart-enabled').uncheck();
  await dialog.locator('#pr-promo-included-categories').evaluate((el) => { el.value = ''; });
  await dialog.locator('#pr-promo-excluded-products').evaluate((el) => { el.value = '/us/en_us/products/refurb'; });
  await dialog.locator('[data-pr-promo-form-submit]').click();

  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0].promotions[0].conditions).toEqual({
    excludedProducts: [{ path: '/us/en_us/products/refurb' }],
    disqualifyingCategories: ['commercial'],
    futureKey: 'kept',
  });
  await expect(row.locator('.pr-promo-col-scope')).toHaveText('not: refurb · never with: commercial');
});

test('add dialog saves a scope-only promotion and the detail modal shows it', async ({ page }) => {
  const puts = await setup(page);
  await page.goto(`${origin}/tools/commerce-admin/promotions.html`);
  await expect(page.locator('tr[data-pr-promo-open][data-pr-id="gift"]')).toHaveCount(1);

  await page.locator('[data-pr-promo-add]').click();
  const dialog = page.locator('dialog.pr-promo-form-dialog');
  await dialog.locator('#pr-promo-form-name').fill('Scoped gift');

  await dialog.locator('#pr-promo-disqualifying-categories').evaluate((el) => { el.value = 'commercial'; });
  await dialog.locator('#pr-promo-included-products').evaluate((el) => { el.value = '/us/en_us/products/a'; });
  await dialog.locator('#pr-promo-form-market').selectOption('ca');
  await expect(dialog.locator('#pr-promo-included-products')).toHaveValue('');
  await expect(dialog.locator('#pr-promo-disqualifying-categories')).toHaveValue('commercial');
  await expect(dialog.locator('[data-pr-promo-scope-note]')).toContainText('/us/en_us/products/a');

  await dialog.locator('.pr-promo-tsv-import summary').click();
  await expect(dialog.locator('#pr-promo-tsv-paste')).toHaveValue(/^Start/);
  await dialog.locator('#pr-promo-tsv-paste').fill(`Start\tEnd\tProduct\tRegular Price\tSale Price\n\t${future}\t/ca/en_us/products/gift\t10\t0`);
  await dialog.locator('[data-pr-promo-tsv-replace]').click();

  await dialog.locator('[data-pr-promo-form-submit]').click();
  await expect.poll(() => puts.length).toBe(1);
  const added = puts[0].promotions.find((p) => p.name === 'Scoped gift');
  expect(added.country).toBe('ca');
  expect(added.conditions).toEqual({ disqualifyingCategories: ['commercial'] });

  await page.locator('button', { hasText: 'Canada' }).first().click();
  await page.locator(`tr[data-pr-promo-open][data-pr-id="${added.id}"]`).click();
  const detail = page.locator('dialog.pr-promo-detail-dialog');
  await expect(detail.locator('[data-pr-promo-scope-pills="included"]')).toHaveText('Any paid product');
  await expect(detail.locator('[data-pr-promo-scope-pills="disqualifying"]')).toContainText('commercial');
});

test('product picks are saved for every language of the market', async ({ page }) => {
  const puts = await setup(page, [{
    id: 'ca-gift',
    name: 'CA gift',
    country: 'ca',
    conditions: {
      minimumSubtotal: 100,
      disqualifyingProducts: [{ path: '/ca/en_us/products/blender' }, { path: '/ca/fr_ca/products/melangeur' }],
    },
    rules: [{
      path: '/ca/en_us/products/gift', price: '0', end: future, custom: { group: '2026' },
    }],
  }]);
  await page.goto(`${origin}/tools/commerce-admin/promotions.html?market=ca`);
  const row = page.locator('tr[data-pr-promo-open][data-pr-id="ca-gift"]');
  await row.click();
  await page.locator('[data-pr-promo-modal-edit]').click();
  const dialog = page.locator('dialog.pr-promo-form-dialog');
  await expect(dialog.locator('#pr-promo-disqualifying-products')).toHaveValue('/ca/en_us/products/blender');

  await dialog.locator('#pr-promo-included-products').evaluate((el) => { el.value = '/ca/en_us/products/other|O1-RED'; });
  await dialog.locator('[data-pr-promo-form-submit]').click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0].promotions[0].conditions).toEqual({
    minimumSubtotal: 100,
    includedProducts: [
      { path: '/ca/en_us/products/other', sku: 'O1-RED' },
      { path: '/ca/fr_ca/products/autre', sku: 'O1-RED' },
    ],
    disqualifyingProducts: [{ path: '/ca/en_us/products/blender' }, { path: '/ca/fr_ca/products/melangeur' }],
  });
});

test('new promotions get the default disqualifier while they have conditions', async ({ page }) => {
  await setup(page);
  await page.goto(`${origin}/tools/commerce-admin/promotions.html`);
  await page.locator('[data-pr-promo-add]').click();
  const dialog = page.locator('dialog.pr-promo-form-dialog');
  const disqualifying = dialog.locator('#pr-promo-disqualifying-categories');
  const minCart = dialog.locator('#pr-promo-min-cart-enabled');

  await expect(disqualifying).toHaveValue('');
  await minCart.check();
  await expect(disqualifying).toHaveValue('commercial');
  await minCart.uncheck();
  await expect(disqualifying).toHaveValue('');

  await minCart.check();
  await disqualifying.evaluate((el) => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await minCart.uncheck();
  await minCart.check();
  await expect(disqualifying).toHaveValue('');
});
