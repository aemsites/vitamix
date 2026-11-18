import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const origin = 'http://commerce-admin.test';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const PROD_HOST = 'api.adobecommerce.live';
const PAGE = `${origin}/tools/commerce-admin/promotions.html?stage=true`;

function fakeJwt() {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${enc({ alg: 'none' })}.${enc({ exp, iat: exp - 60, email: 'admin@example.com' })}.sig`;
}

const future = new Date(Date.now() + 30 * 86400000).toISOString();

const rule = (path) => ({
  path, price: '10', end: future, custom: { group: '2026' },
});

const sale = (extra = {}) => ({
  id: 'spring',
  name: 'Spring sale',
  rules: [rule('/us/en_us/products/a')],
  ...extra,
});

const COUPON_TYPES = () => [
  {
    id: 'us-2026-aff', name: 'Affiliate', country: 'us', groups: ['affiliate'],
  },
  {
    id: 'us-2026-staff', name: 'Staff', country: 'us', groups: ['employee'],
  },
  {
    id: 'ca-2026-ten', name: 'Canada ten', country: 'ca', groups: ['affiliate'],
  },
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   promotions?: object[],
 *   types?: object[],
 *   prodTypes?: object[],
 *   prodPromotions?: object[],
 *   putError?: object,
 * }} [options]
 */
async function setup(page, options = {}) {
  let doc = { promotions: options.promotions || [sale()] };
  let prodDoc = { promotions: options.prodPromotions || [] };
  const puts = [];
  await page.addInitScript((token) => {
    const s = JSON.stringify({ token, email: 'admin@example.com', roles: ['admin'] });
    localStorage.setItem('pbus-auth-aemsites-vitamix-stage', s);
    localStorage.setItem('pbus-auth-aemsites-vitamix-prod', s);
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
    if (target.pathname.endsWith('.json')) {
      const data = target.pathname === '/us/en_us/products/index.json'
        ? [{
          path: '/us/en_us/products/b', urlKey: 'b', sku: 'B1', title: 'b',
        }]
        : [];
      await route.fulfill({ json: { data } });
      return;
    }
    const env = target.host === PROD_HOST ? 'prod' : 'stage';
    const path = target.pathname.replace('/aemsites/sites/vitamix/', '');
    if (path === 'coupons/types') {
      const types = env === 'prod' ? (options.prodTypes || []) : (options.types || COUPON_TYPES());
      await route.fulfill({ json: { types } });
      return;
    }
    if (path !== 'price-rules/catalog') {
      await route.fulfill({ json: {} });
      return;
    }
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData());
      puts.push({ env, body });
      if (options.putError) {
        await route.fulfill({
          status: 400,
          headers: { 'x-error': 'Invalid price_rules' },
          json: options.putError,
        });
        return;
      }
      if (env === 'prod') prodDoc = body;
      else doc = body;
    }
    await route.fulfill({ json: env === 'prod' ? prodDoc : doc }).catch(() => {});
  });
  return puts;
}

/** @param {import('@playwright/test').Page} page @param {string} id */
async function openEdit(page, id) {
  await page.locator(`tr[data-pr-promo-open][data-pr-id="${id}"]`).click();
  await page.locator('[data-pr-promo-modal-edit]').click();
  const dialog = page.locator('dialog.pr-promo-form-dialog');
  await expect(dialog.locator('[data-pr-promo-coupon-scope]')).toHaveCount(1);
  return dialog;
}

/** @param {{ body: { promotions: object[] } }} put @param {string} id */
const savedPromo = (put, id) => put.body.promotions.find((p) => p.id === id);

test('block mode saves blocked types and groups only', async ({ page }) => {
  const puts = await setup(page);
  await page.goto(PAGE);
  const dialog = await openEdit(page, 'spring');
  const section = dialog.locator('[data-pr-promo-coupon-scope]');
  await expect(section.locator('input[value="all"]')).toBeChecked();
  await expect(section.locator('[data-pr-promo-coupon-side="block"]')).toBeHidden();

  await section.getByText('Block selected coupons').click();
  const block = section.locator('[data-pr-promo-coupon-side="block"]');
  await expect(block).toBeVisible();
  await expect(section.locator('[data-pr-promo-coupon-side="allow"]')).toBeHidden();
  const typeField = block.locator('.pcs-types-root');
  await expect(typeField.locator('[data-pcs-add]')).toHaveText(['us-2026-aff', 'us-2026-staff', 'ca-2026-ten']);
  await expect(typeField.locator('[data-pcs-add="ca-2026-ten"]')).toHaveClass(/pcs-other-market/);
  await typeField.getByRole('button', { name: 'Add coupon type us-2026-aff' }).click();
  await block.getByRole('button', { name: 'Add group affiliate' }).click();

  await dialog.locator('[data-pr-promo-form-submit]').click();
  await expect.poll(() => puts.length).toBe(1);
  const saved = savedPromo(puts[0], 'spring');
  expect(saved.excludedCouponTypes).toEqual(['us-2026-aff']);
  expect(saved.excludedCouponGroups).toEqual(['affiliate']);
  expect(saved).not.toHaveProperty('includedCouponTypes');
  expect(saved).not.toHaveProperty('includedCouponGroups');
  await expect(page.locator('tr[data-pr-id="spring"] .pr-promo-col-scope')).toHaveText('Coupons: blocks affiliate, us-2026-aff');
});

test('switching mode clears the other side; all coupons removes the keys', async ({ page }) => {
  const puts = await setup(page, { promotions: [sale({ excludedCouponGroups: ['affiliate'] })] });
  await page.goto(PAGE);
  let dialog = await openEdit(page, 'spring');
  const section = dialog.locator('[data-pr-promo-coupon-scope]');
  await expect(section.locator('input[value="block"]')).toBeChecked();
  await section.getByText('Only allow selected coupons').click();
  const allow = section.locator('[data-pr-promo-coupon-side="allow"]');
  await allow.getByRole('button', { name: 'Add coupon type us-2026-staff' }).click();
  await dialog.locator('[data-pr-promo-form-submit]').click();
  await expect.poll(() => puts.length).toBe(1);
  let saved = savedPromo(puts[0], 'spring');
  expect(saved.includedCouponTypes).toEqual(['us-2026-staff']);
  expect(saved).not.toHaveProperty('excludedCouponGroups');
  expect(saved).not.toHaveProperty('excludedCouponTypes');
  await expect(page.locator('tr[data-pr-id="spring"] .pr-promo-col-scope')).toHaveText('Coupons: only us-2026-staff');

  dialog = await openEdit(page, 'spring');
  await expect(dialog.locator('input[value="allow"]')).toBeChecked();
  await dialog.getByText('All coupons allowed').click();
  await dialog.locator('[data-pr-promo-form-submit]').click();
  await expect.poll(() => puts.length).toBe(2);
  saved = savedPromo(puts[1], 'spring');
  ['includedCouponTypes', 'excludedCouponTypes', 'includedCouponGroups', 'excludedCouponGroups']
    .forEach((k) => expect(saved).not.toHaveProperty(k));
});

test('stored unknown type ids show as unknown chips and can be removed', async ({ page }) => {
  const puts = await setup(page, {
    promotions: [sale({ excludedCouponTypes: ['us-2025-gone', 'us-2026-aff'] })],
  });
  await page.goto(PAGE);
  const dialog = await openEdit(page, 'spring');
  const chips = dialog.locator('[data-pr-promo-coupon-side="block"] .pcs-types-root .cgf-chip');
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toHaveClass(/pcs-chip-unknown/);
  await expect(chips.nth(0)).toContainText('unknown');
  await expect(chips.nth(1)).not.toHaveClass(/pcs-chip-unknown/);
  await dialog.getByRole('button', { name: 'Remove coupon type us-2025-gone' }).click();
  await dialog.locator('[data-pr-promo-form-submit]').click();
  await expect.poll(() => puts.length).toBe(1);
  expect(savedPromo(puts[0], 'spring').excludedCouponTypes).toEqual(['us-2026-aff']);
});

test('advanced mix shows all lists; editing one market keeps the scope, other markets and unknown keys', async ({ page }) => {
  const scope = {
    excludedCouponGroups: ['affiliate'],
    includedCouponTypes: ['us-2026-aff'],
    includedCouponGroups: ['employee'],
    excludedCouponTypes: ['us-2026-staff'],
  };
  const promo = sale({
    rules: [rule('/us/en_us/products/a'), rule('/ca/en_us/products/b')],
    futureKey: { kept: true },
    ...scope,
  });
  const puts = await setup(page, { promotions: [promo] });
  await page.goto(PAGE);
  const dialog = await openEdit(page, 'spring');
  const section = dialog.locator('[data-pr-promo-coupon-scope]');
  await expect(section.locator('.pr-promo-coupon-modes')).toBeHidden();
  await expect(section.locator('[data-pr-promo-coupon-precedence]')).toBeVisible();
  await expect(section.locator('[data-pr-promo-coupon-side="block"]')).toBeVisible();
  await expect(section.locator('[data-pr-promo-coupon-side="allow"]')).toBeVisible();

  await dialog.locator('#pr-promo-form-name').fill('Spring sale 2');
  await dialog.locator('[data-pr-promo-form-submit]').click();
  await expect.poll(() => puts.length).toBe(1);
  const saved = savedPromo(puts[0], 'spring');
  expect(saved).toMatchObject({ name: 'Spring sale 2', futureKey: { kept: true }, ...scope });
  expect(saved.rules.map((r) => r.path)).toEqual(['/ca/en_us/products/b', '/us/en_us/products/a']);
});

test('promotions with conditions hide the section; adding a condition to a scoped one blocks save', async ({ page }) => {
  const gift = {
    id: 'gift',
    name: 'Gift',
    conditions: { minimumSubtotal: 100 },
    rules: [rule('/us/en_us/products/g')],
  };
  const puts = await setup(page, {
    promotions: [gift, sale({ excludedCouponGroups: ['affiliate'] })],
  });
  await page.goto(PAGE);
  let dialog = await openEdit(page, 'gift');
  await expect(dialog.locator('[data-pr-promo-coupon-scope]')).toBeHidden();
  await dialog.locator('[data-pr-promo-form-cancel]').click();

  dialog = await openEdit(page, 'spring');
  const warning = dialog.locator('[data-pr-promo-coupon-conditions]');
  await expect(warning).toBeHidden();
  await dialog.locator('#pr-promo-min-cart-enabled').check();
  await dialog.locator('#pr-promo-min-cart-amount').fill('50');
  await expect(dialog.locator('[data-pr-promo-coupon-scope]')).toBeVisible();
  await expect(warning).toBeVisible();
  await dialog.locator('[data-pr-promo-form-submit]').click();
  await expect(dialog.locator('.pr-promo-form-error')).toContainText('can\'t limit coupons');
  expect(puts).toHaveLength(0);

  await dialog.getByText('All coupons allowed').click();
  await expect(dialog.locator('[data-pr-promo-coupon-scope]')).toBeHidden();
  await dialog.locator('[data-pr-promo-form-submit]').click();
  await expect.poll(() => puts.length).toBe(1);
  const saved = savedPromo(puts[0], 'spring');
  expect(saved.conditions.minimumSubtotal).toBe(50);
  expect(saved).not.toHaveProperty('excludedCouponGroups');
});

test('a 400 from the API shows the unknown coupon type ids', async ({ page }) => {
  await setup(page, {
    putError: {
      code: 'ADOBE_COMMERCE_VALIDATION_FAILED',
      message: 'Invalid price_rules',
      errors: [{ path: '$.promotions[0].excludedCouponTypes', message: 'unknown coupon types: us-2026-aff' }],
    },
  });
  await page.goto(PAGE);
  const dialog = await openEdit(page, 'spring');
  await dialog.getByText('Block selected coupons').click();
  await dialog.getByRole('button', { name: 'Add coupon type us-2026-aff' }).click();
  await dialog.locator('[data-pr-promo-form-submit]').click();
  await expect(dialog.locator('.pr-promo-form-error')).toContainText(
    '"Spring sale": blocked coupon types: unknown coupon types: us-2026-aff',
  );
});

test('new promotion saves an allow list', async ({ page }) => {
  const puts = await setup(page);
  await page.goto(PAGE);
  await page.locator('[data-pr-promo-add]').click();
  const dialog = page.locator('dialog.pr-promo-form-dialog');
  await dialog.locator('#pr-promo-form-name').fill('Staff only');
  await dialog.getByText('Only allow selected coupons').click();
  await dialog.locator('[data-pr-promo-coupon-side="allow"]').getByRole('button', { name: 'Add group employee' }).click();
  await dialog.locator('.pr-promo-tsv-import summary').click();
  await expect(dialog.locator('#pr-promo-tsv-paste')).toHaveValue(/^Start/);
  await dialog.locator('#pr-promo-tsv-paste').fill(`Start\tEnd\tProduct\tRegular Price\tSale Price\n\t${future}\t/us/en_us/products/b\t10\t5`);
  await dialog.locator('[data-pr-promo-tsv-replace]').click();
  await dialog.locator('[data-pr-promo-form-submit]').click();
  await expect.poll(() => puts.length).toBe(1);
  const added = puts[0].body.promotions.find((p) => p.name === 'Staff only');
  expect(added.includedCouponGroups).toEqual(['employee']);
  expect(added).not.toHaveProperty('excludedCouponGroups');
  expect(added).not.toHaveProperty('conditions');
});

test('detail modal shows the coupon policy', async ({ page }) => {
  await setup(page, {
    promotions: [sale({ excludedCouponGroups: ['affiliate'], excludedCouponTypes: ['us-2026-aff'] })],
  });
  await page.goto(PAGE);
  await page.locator('tr[data-pr-id="spring"]').click();
  const policy = page.locator('dialog.pr-promo-detail-dialog [data-pr-promo-coupon-policy]');
  await expect(policy).toContainText('Blocks affiliate, us-2026-aff');
  await expect(policy.locator('[data-pr-promo-coupon-list="Blocked coupon groups"]')).toContainText('affiliate');
  await expect(policy.locator('[data-pr-promo-coupon-list="Blocked coupon types"]')).toContainText('us-2026-aff');
});

test('promote lists coupon types missing in the target and blocks the copy', async ({ page }) => {
  const puts = await setup(page, {
    promotions: [sale({ excludedCouponTypes: ['us-2026-aff', 'us-2026-staff'] })],
    prodTypes: [COUPON_TYPES()[1]],
  });
  await page.goto(PAGE);
  await page.locator('tr[data-pr-id="spring"]').click();
  await page.locator('dialog.pr-promo-detail-dialog .commerce-promote-production-btn').click();
  const copy = page.locator('dialog.commerce-promote-dialog');
  await expect(copy.locator('[data-promote-status]')).toHaveText('Missing in production: us-2026-aff');
  await expect(copy.locator('.commerce-promote-missing li')).toHaveText(['us-2026-aff']);
  await expect(copy.locator('[data-promote-confirm]')).toBeHidden();
  expect(puts).toHaveLength(0);
});

test('promote copies the coupon scope when the target has the types', async ({ page }) => {
  const puts = await setup(page, {
    promotions: [sale({ excludedCouponTypes: ['us-2026-aff'], excludedCouponGroups: ['affiliate'] })],
    prodTypes: COUPON_TYPES(),
  });
  await page.goto(PAGE);
  await page.locator('tr[data-pr-id="spring"]').click();
  await page.locator('dialog.pr-promo-detail-dialog .commerce-promote-production-btn').click();
  const copy = page.locator('dialog.commerce-promote-dialog');
  await copy.locator('[data-promote-confirm]').click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0].env).toBe('prod');
  expect(savedPromo(puts[0], 'spring')).toMatchObject({
    excludedCouponTypes: ['us-2026-aff'],
    excludedCouponGroups: ['affiliate'],
  });
});
