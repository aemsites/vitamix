import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const origin = 'http://commerce-admin.test';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const PROD_HOST = 'api.adobecommerce.live';
const PAGE = `${origin}/tools/commerce-admin/coupons.html?stage=false`;

function fakeJwt() {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${enc({ alg: 'none' })}.${enc({ exp, iat: exp - 60, email: 'admin@example.com' })}.sig`;
}

const coupon = (id, name, extra = {}) => ({
  id,
  name,
  country: id.slice(0, 2),
  discountType: 'percentage',
  discountValue: 10,
  minimumOrderAmount: 0,
  stackable: true,
  allowManualEntry: true,
  ...extra,
});

const COUPONS = () => [
  coupon('us-2026-aff', 'Affiliate ten', { groups: ['affiliate', 'partner'], custom: { group: '2026' } }),
  coupon('us-2026-staff', 'Staff', { groups: ['employee'] }),
  coupon('us-2026-plain', 'Plain'),
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ coupons?: object[] }} [options]
 */
async function setup(page, options = {}) {
  const coupons = options.coupons || COUPONS();
  const writes = [];
  await page.addInitScript((token) => {
    const s = JSON.stringify({ token, email: 'admin@example.com', roles: ['admin'] });
    localStorage.setItem('pbus-auth-aemsites-vitamix-prod', s);
    localStorage.setItem('pbus-auth-aemsites-vitamix-stage', s);
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
    const method = req.method();
    if (target.pathname.endsWith('.json')) {
      await route.fulfill({ json: { data: [] } });
      return;
    }
    const path = decodeURIComponent(target.pathname.replace('/aemsites/sites/vitamix/', ''));
    const env = target.host === PROD_HOST ? 'prod' : 'stage';
    if (method === 'POST' || method === 'PUT') {
      const body = JSON.parse(req.postData() || '{}');
      writes.push({
        env, method, path, body,
      });
      if (env === 'prod' && path.startsWith('coupons/types')) {
        const i = coupons.findIndex((c) => c.id === body.id);
        if (i === -1) coupons.push(body);
        else coupons[i] = { ...coupons[i], ...body };
      }
      await route.fulfill({ json: body });
      return;
    }
    if (env === 'stage') {
      await route.fulfill({ status: 404, json: {} });
      return;
    }
    if (path === 'coupons/types') {
      await route.fulfill({ json: { types: coupons } });
      return;
    }
    if (path.startsWith('coupons/types/')) {
      const row = coupons.find((c) => c.id === path.slice('coupons/types/'.length));
      await (row ? route.fulfill({ json: row }) : route.fulfill({ status: 404, json: {} }));
      return;
    }
    if (path === 'coupons') {
      await route.fulfill({ json: { codes: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });
  return writes;
}

/** @param {import('@playwright/test').Page} page @param {string} id */
async function openEdit(page, id) {
  await page.locator(`tr[data-cp-coupon-id="${id}"]`).click();
  await page.locator('dialog.coupons-detail-dialog [data-cp-modal-edit]').click();
  return page.locator('dialog.coupons-dialog').filter({ has: page.locator('[data-cp-groups-mount]') });
}

test('overview shows group badges and the group filter narrows the list and survives reload', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  const affRow = page.locator('tr[data-cp-coupon-id="us-2026-aff"]');
  await expect(affRow.locator('.coupons-grid-col-groups')).toContainText('affiliate');
  await expect(affRow.locator('.coupons-grid-col-groups')).toContainText('partner');
  await expect(page.locator('tr[data-cp-coupon-id="us-2026-plain"] .coupons-grid-col-groups')).toHaveText('—');

  const filter = page.locator('#coupons-group-filter');
  await expect(filter.locator('option')).toHaveText(['All groups', 'affiliate', 'employee', 'partner']);
  await filter.selectOption('employee');
  await expect(page.locator('tr.coupons-grid-row')).toHaveCount(1);
  await expect(page.locator('tr[data-cp-coupon-id="us-2026-staff"]')).toHaveCount(1);
  await expect(page.locator('#coupons-count')).toHaveText('1 of 3 coupons');
  expect(new URL(page.url()).searchParams.get('group')).toBe('employee');

  await page.reload();
  await expect(page.locator('#coupons-group-filter')).toHaveValue('employee');
  await expect(page.locator('tr.coupons-grid-row')).toHaveCount(1);

  await page.locator('#coupons-group-filter').selectOption('');
  await expect(page.locator('tr.coupons-grid-row')).toHaveCount(3);
  expect(new URL(page.url()).searchParams.has('group')).toBe(false);
});

test('detail modal lists the groups', async ({ page }) => {
  await setup(page);
  await page.goto(`${PAGE}&id=us-2026-aff`);
  const groups = page.locator('dialog.coupons-detail-dialog .coupons-modal-pill-group', { hasText: 'Groups' });
  await expect(groups.locator('.commerce-admin-group-badge')).toHaveText(['affiliate', 'partner']);
});

test('edit adds an existing group, adds a new one, removes one and sends groups without custom', async ({ page }) => {
  const writes = await setup(page);
  await page.goto(PAGE);
  const dialog = await openEdit(page, 'us-2026-aff');
  const field = dialog.locator('.cgf-root');
  await expect(field.locator('.cgf-chip-label')).toHaveText(['affiliate', 'partner']);
  await expect(field.locator('[data-cgf-add]')).toHaveText(['employee']);

  await field.getByRole('button', { name: 'Remove group partner' }).click();
  await field.getByRole('button', { name: 'Add group employee' }).click();
  await field.locator('.cgf-input').fill('  Spring promo ');
  await expect(field.locator('[data-cgf-add-new]')).toHaveText('Add “Spring promo”');
  await field.locator('[data-cgf-add-new]').click();
  await field.locator('.cgf-input').fill('affiliate');
  await expect(field.locator('[data-cgf-add-new]')).toHaveCount(0);
  await expect(field.locator('.cgf-chip-label')).toHaveText(['affiliate', 'employee', 'Spring promo']);

  await dialog.locator('[data-cp-submit]').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].method).toBe('PUT');
  expect(writes[0].path).toBe('coupons/types/us-2026-aff');
  expect(writes[0].body.groups).toEqual(['affiliate', 'employee', 'Spring promo']);
  expect(writes[0].body).not.toHaveProperty('custom');
});

test('edit clearing every group sends an empty list', async ({ page }) => {
  const writes = await setup(page);
  await page.goto(PAGE);
  const dialog = await openEdit(page, 'us-2026-staff');
  await dialog.getByRole('button', { name: 'Remove group employee' }).click();
  await expect(dialog.locator('.cgf-empty')).toHaveText('No groups');
  await dialog.locator('[data-cp-submit]').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.groups).toEqual([]);
});

test('new coupon sends groups and no year label', async ({ page }) => {
  const writes = await setup(page);
  await page.goto(PAGE);
  await page.locator('[data-cp-new]').click();
  const dialog = page.locator('dialog.coupons-dialog');
  await dialog.locator('#cp-new-label').fill('vip');
  await dialog.locator('#cp-form-name').fill('VIP');
  await dialog.locator('#cp-form-discount-value').fill('15');
  await dialog.getByRole('button', { name: 'Add group partner' }).click();
  await dialog.locator('[data-cp-submit]').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].method).toBe('POST');
  expect(writes[0].body.id).toMatch(/^us-\d{4}-vip$/);
  expect(writes[0].body.groups).toEqual(['partner']);
  expect(writes[0].body).not.toHaveProperty('custom');

  await page.locator('dialog.coupons-detail-dialog [data-cp-modal-close-secondary]').click();
  await page.locator('[data-cp-new]').click();
  const second = page.locator('dialog.coupons-dialog').filter({ has: page.locator('#cp-new-label') });
  await second.locator('#cp-new-label').fill('none');
  await second.locator('#cp-form-name').fill('None');
  await second.locator('#cp-form-discount-value').fill('5');
  await second.locator('[data-cp-submit]').click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].body.groups).toEqual([]);
});

/** @param {import('@playwright/test').Page} page @param {unknown} json */
async function previewImport(page, json) {
  await page.locator('[data-cp-export-import]').first().click();
  const dialog = page.locator('dialog.coupons-dialog');
  await dialog.locator('[data-cp-export-mode="json"]').click();
  await dialog.locator('#cp-export-json').fill(JSON.stringify(json));
  await dialog.locator('[data-cp-export-preview]').click();
  return dialog;
}

test('import rejects groups that are not a list of names', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  let dialog = await previewImport(page, [{ ...COUPONS()[1], groups: 'employee' }]);
  await expect(dialog.locator('[data-cp-export-status]')).toContainText('groups must be an array');
  await dialog.locator('[data-cp-cancel]').click();

  dialog = await previewImport(page, [{ ...COUPONS()[1], groups: ['employee', '  '] }]);
  await expect(dialog.locator('[data-cp-export-status]')).toContainText('group 2 must be a non-empty string');
});

test('import preview shows a groups change as an update and imports the list', async ({ page }) => {
  const writes = await setup(page);
  await page.goto(PAGE);
  const [aff, staff, plain] = COUPONS();
  const dialog = await previewImport(page, [aff, { ...staff, groups: ['employee', ' vip '] }, plain]);
  const updateRow = dialog.locator('tr.coupons-import-row-update');
  await expect(updateRow).toHaveCount(1);
  await expect(updateRow.locator('.coupons-grid-col-groups')).toHaveClass(/coupons-import-cell-changed/);
  await expect(updateRow.locator('.coupons-grid-col-groups')).toContainText('vip');
  await expect(dialog.locator('tr.coupons-import-row-same')).toHaveCount(2);
  await dialog.locator('.coupons-import-diff summary').click();
  await expect(dialog.locator('.coupons-import-diff')).toContainText('vip');

  await dialog.locator('[data-cp-export-import]').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].method).toBe('PUT');
  expect(writes[0].body.groups).toEqual(['employee', 'vip']);
});

test('copy to the other environment keeps the groups', async ({ page }) => {
  const writes = await setup(page);
  await page.goto(`${PAGE}&id=us-2026-staff`);
  await page.locator('dialog.coupons-detail-dialog .commerce-promote-production-btn').click();
  const copy = page.locator('dialog.commerce-promote-dialog');
  await copy.locator('[data-promote-confirm]').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ env: 'stage', method: 'POST', path: 'coupons/types' });
  expect(writes[0].body.groups).toEqual(['employee']);
});
