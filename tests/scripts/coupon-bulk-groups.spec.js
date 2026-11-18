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
  coupon('us-2026-acme', 'Acme Inc', { groups: ['corporate'] }),
  coupon('us-2026-beta', 'Beta Inc', { groups: ['corporate'] }),
  coupon('us-2026-spring', 'Spring sale', { groups: ['seasonal', 'corporate'] }),
  coupon('ca-2026-summer', 'Summer sale'),
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ coupons?: object[]; failPutOnce?: string[] }} [options]
 */
async function setup(page, options = {}) {
  const coupons = options.coupons || COUPONS();
  const failOnce = new Set(options.failPutOnce || []);
  const calls = [];
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
    if (env === 'stage') {
      await route.fulfill({ status: 404, json: {} });
      return;
    }
    const typeId = path.startsWith('coupons/types/') ? path.slice('coupons/types/'.length) : '';
    const body = method === 'PUT' || method === 'POST' ? JSON.parse(req.postData() || '{}') : undefined;
    calls.push({ method, path, body });
    if (method === 'PUT' && typeId) {
      if (failOnce.delete(typeId)) {
        await route.fulfill({ status: 500, json: { message: 'upstream down' } });
        return;
      }
      const i = coupons.findIndex((c) => c.id === typeId);
      coupons[i] = { ...coupons[i], ...body };
      await route.fulfill({ json: coupons[i] });
      return;
    }
    if (method === 'DELETE' && typeId) {
      const i = coupons.findIndex((c) => c.id === typeId);
      if (i !== -1) coupons.splice(i, 1);
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (path === 'coupons/types') {
      await route.fulfill({ json: { types: coupons } });
      return;
    }
    if (typeId) {
      const row = coupons.find((c) => c.id === typeId);
      await (row ? route.fulfill({ json: row }) : route.fulfill({ status: 404, json: {} }));
      return;
    }
    if (path === 'coupons') {
      await route.fulfill({ json: { codes: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });
  return { calls, coupons };
}

const row = (page, id) => page.locator(`tr[data-cp-coupon-id="${id}"]`);
const rowBox = (page, id) => row(page, id).locator('input[data-cp-select]');
const selectAll = (page) => page.locator('[data-cp-select-all]');
const indicator = (page) => page.locator('[data-cp-selection-count]');
const editAll = (page) => page.locator('[data-cp-edit-all]');
const bulkDialog = (page) => page.locator('dialog.coupons-bulk-groups-dialog');

/** @param {import('@playwright/test').Page} page */
async function selectAllState(page) {
  return selectAll(page).evaluate((el) => {
    if (el.indeterminate) return 'indeterminate';
    return el.checked ? 'checked' : 'unchecked';
  });
}

test('row checkbox toggles selection without opening the detail modal', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  await expect(editAll(page)).toBeDisabled();
  await rowBox(page, 'us-2026-acme').click();
  await expect(rowBox(page, 'us-2026-acme')).toBeChecked();
  await expect(row(page, 'us-2026-acme')).toHaveClass(/coupons-row-selected/);
  await expect(indicator(page)).toHaveText('1 selected');
  await expect(editAll(page)).toBeEnabled();

  await rowBox(page, 'us-2026-beta').focus();
  await page.keyboard.press('Space');
  await expect(rowBox(page, 'us-2026-beta')).toBeChecked();
  await page.keyboard.press('Enter');
  await expect(indicator(page)).toHaveText('2 selected');
  await expect(page.locator('dialog.coupons-detail-dialog')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('id')).toBe(false);

  await row(page, 'us-2026-beta').locator('.coupons-grid-col-select').click({ position: { x: 2, y: 2 } });
  await expect(rowBox(page, 'us-2026-beta')).not.toBeChecked();
  await expect(page.locator('dialog.coupons-detail-dialog')).toHaveCount(0);

  await row(page, 'us-2026-acme').locator('.coupons-grid-name').click();
  await expect(page.locator('dialog.coupons-detail-dialog')).toHaveCount(1);
});

test('header checkbox reflects and acts on the visible rows only', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  expect(await selectAllState(page)).toBe('unchecked');
  await rowBox(page, 'us-2026-acme').check();
  expect(await selectAllState(page)).toBe('indeterminate');

  await page.locator('#coupons-search').fill('inc');
  await expect(page.locator('tr.coupons-grid-row')).toHaveCount(2);
  await rowBox(page, 'us-2026-beta').check();
  expect(await selectAllState(page)).toBe('checked');

  await page.locator('#coupons-search').fill('sale');
  await expect(page.locator('tr.coupons-grid-row')).toHaveCount(2);
  expect(await selectAllState(page)).toBe('unchecked');
  await selectAll(page).check();
  await expect(indicator(page)).toHaveText('4 selected (2 not shown)');

  await selectAll(page).uncheck();
  await expect(indicator(page)).toHaveText('2 selected (2 not shown)');
  await page.locator('#coupons-search').fill('');
  await expect(rowBox(page, 'us-2026-acme')).toBeChecked();
  await expect(rowBox(page, 'us-2026-spring')).not.toBeChecked();
});

test('selection accumulates across filters; Clear empties it', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  await page.locator('#coupons-search').fill('acme');
  await selectAll(page).check();
  await page.locator('#coupons-search').fill('sale');
  await selectAll(page).check();
  await expect(indicator(page)).toHaveText('3 selected (1 not shown)');
  await page.locator('#coupons-search').fill('');
  await expect(indicator(page)).toHaveText('3 selected');
  await page.locator('[data-cp-selection-clear]').click();
  await expect(indicator(page)).toHaveText('');
  await expect(page.locator('[data-cp-selection-clear]')).toBeHidden();
  await expect(editAll(page)).toBeDisabled();
  expect(await selectAllState(page)).toBe('unchecked');
});

test('selection survives market tab, group filter, sort and list refresh; deleted ids are dropped', async ({ page }) => {
  await setup(page);
  page.on('dialog', (d) => d.accept());
  await page.goto(PAGE);
  await rowBox(page, 'us-2026-acme').check();
  await rowBox(page, 'ca-2026-summer').check();

  await page.locator('[data-cp-market="us"]').click();
  await expect(row(page, 'ca-2026-summer')).toHaveCount(0);
  await expect(indicator(page)).toHaveText('2 selected (1 not shown)');
  await page.locator('#coupons-group-filter').selectOption('seasonal');
  await expect(indicator(page)).toHaveText('2 selected (2 not shown)');
  await page.locator('#coupons-group-filter').selectOption('');
  await page.locator('[data-cp-market="all"]').click();
  await page.locator('[data-cp-sort="id"]').click();
  await expect(rowBox(page, 'us-2026-acme')).toBeChecked();
  await expect(rowBox(page, 'ca-2026-summer')).toBeChecked();
  expect(new URL(page.url()).search).not.toContain('acme');

  await row(page, 'us-2026-acme').locator('.coupons-grid-name').click();
  await page.locator('dialog.coupons-detail-dialog [data-cp-modal-delete]').click();
  await expect(row(page, 'us-2026-acme')).toHaveCount(0);
  await expect(indicator(page)).toHaveText('1 selected');
});

test('Edit all opens with the count; Edit is disabled when the groups differ', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  await selectAll(page).check();
  await editAll(page).click();
  const dialog = bulkDialog(page);
  await expect(dialog.locator('.coupons-dialog-title')).toHaveText('Edit groups for 4 coupons');
  await expect(dialog.locator('[data-cp-bg-env]')).toContainText('Production');
  await expect(dialog.locator('[data-cp-bg-summary] li')).toHaveText([
    'corporate: 3 of 4', 'seasonal: 1 of 4', 'No groups: 1 of 4',
  ]);
  await dialog.locator('.cp-bg-selected summary').click();
  await expect(dialog.locator('.cp-bg-selected-list li')).toHaveCount(4);
  await expect(dialog.locator('[data-cp-bg-edit-disabled]')).toBeVisible();
  await expect(dialog.locator('.cgf-root')).toHaveCount(0);
  await expect(dialog.locator('[data-cp-bg-apply]')).toBeDisabled();
});

test('Edit is prefilled with the shared groups and replaces them', async ({ page }) => {
  const { calls } = await setup(page);
  await page.goto(PAGE);
  await page.locator('#coupons-search').fill('inc');
  await selectAll(page).check();
  await editAll(page).click();
  const dialog = bulkDialog(page);
  await expect(dialog.locator('.coupons-dialog-title')).toHaveText('Edit groups for 2 coupons');
  await expect(dialog.locator('.cgf-chip-label')).toHaveText(['corporate']);
  await dialog.getByRole('button', { name: 'Add group seasonal' }).click();
  await dialog.getByRole('button', { name: 'Remove group corporate' }).click();
  await expect(dialog.locator('[data-cp-bg-change]')).toHaveCount(2);
  await expect(dialog.locator('[data-cp-bg-apply]')).toHaveText('Update 2 coupons');
  await dialog.locator('[data-cp-bg-apply]').click();
  await expect(dialog.locator('[data-cp-bg-result]')).toHaveText('Updated 2 · unchanged 0 · failed 0');
  const puts = calls.filter((c) => c.method === 'PUT');
  expect(puts.map((c) => c.path).sort()).toEqual(['coupons/types/us-2026-acme', 'coupons/types/us-2026-beta']);
  puts.forEach((c) => expect(c.body).toEqual({ groups: ['seasonal'] }));
});

test('add and remove: one PUT per changed coupon after a GET, skips unchanged, retries failures', async ({ page }) => {
  const { calls } = await setup(page, { failPutOnce: ['us-2026-beta'] });
  await page.goto(PAGE);
  await selectAll(page).check();
  await editAll(page).click();
  const dialog = bulkDialog(page);

  await dialog.locator('#cp-bg-add').fill('sales-exclusions, seasonal');
  await dialog.locator('#cp-bg-remove').fill('seasonal');
  await expect(dialog.locator('[data-cp-bg-status]')).toContainText('Both added and removed: seasonal');
  await expect(dialog.locator('[data-cp-bg-apply]')).toBeDisabled();

  await dialog.locator('#cp-bg-add').fill('sales-exclusions');
  await dialog.locator('#cp-bg-remove').fill('seasonal');
  await expect(dialog.locator('[data-cp-bg-change]')).toHaveCount(4);
  await dialog.locator('#cp-bg-add').fill('');
  await dialog.locator('#cp-bg-remove').fill('seasonal');
  await expect(dialog.locator('[data-cp-bg-change]')).toHaveCount(1);
  await expect(dialog.locator('[data-cp-bg-preview-lead]')).toHaveText('1 coupon will change. 3 unchanged (skipped).');

  await dialog.locator('#cp-bg-add').fill('sales-exclusions');
  await dialog.locator('#cp-bg-remove').fill('');
  await expect(dialog.locator('[data-cp-bg-change="us-2026-spring"]')).toContainText('sales-exclusions');
  await expect(dialog.locator('[data-cp-bg-apply]')).toHaveText('Update 4 coupons');
  calls.length = 0;
  await dialog.locator('[data-cp-bg-apply]').click();

  await expect(dialog.locator('[data-cp-bg-result]')).toHaveText('Updated 3 · unchanged 0 · failed 1');
  await expect(dialog.locator('[data-cp-bg-failed] li')).toHaveCount(1);
  await expect(dialog.locator('[data-cp-bg-failed-id="us-2026-beta"]')).toContainText('upstream down');
  const puts = calls.filter((c) => c.method === 'PUT');
  expect(puts).toHaveLength(4);
  puts.forEach((c) => {
    expect(Object.keys(c.body)).toEqual(['groups']);
    const getIdx = calls.findIndex((g) => g.method === 'GET' && g.path === c.path);
    expect(getIdx).toBeGreaterThan(-1);
    expect(getIdx).toBeLessThan(calls.indexOf(c));
  });
  expect(puts.find((c) => c.path.endsWith('us-2026-spring')).body.groups)
    .toEqual(['seasonal', 'corporate', 'sales-exclusions']);
  expect(puts.find((c) => c.path.endsWith('ca-2026-summer')).body.groups).toEqual(['sales-exclusions']);

  await expect(indicator(page)).toHaveText('4 selected');
  await expect(row(page, 'us-2026-acme').locator('.coupons-grid-col-groups')).toContainText('sales-exclusions');

  calls.length = 0;
  await dialog.locator('[data-cp-bg-retry]').click();
  await expect(dialog.locator('[data-cp-bg-result]')).toHaveText('Updated 1 · unchanged 0 · failed 0');
  await expect(dialog.locator('[data-cp-bg-retry]')).toBeHidden();
  const retryPuts = calls.filter((c) => c.method === 'PUT');
  expect(retryPuts).toEqual([{ method: 'PUT', path: 'coupons/types/us-2026-beta', body: { groups: ['corporate', 'sales-exclusions'] } }]);
});

test('apply skips the PUT when the stored groups already match', async ({ page }) => {
  const { calls, coupons } = await setup(page);
  await page.goto(PAGE);
  await rowBox(page, 'ca-2026-summer').check();
  await editAll(page).click();
  const dialog = bulkDialog(page);
  await dialog.locator('#cp-bg-add').fill('vip');
  coupons.find((c) => c.id === 'ca-2026-summer').groups = ['vip'];
  await dialog.locator('[data-cp-bg-apply]').click();
  await expect(dialog.locator('[data-cp-bg-result]')).toHaveText('Updated 0 · unchanged 1 · failed 0');
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
});

test('import preview table has no selection column', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  await page.locator('[data-cp-export-import]').first().click();
  const dialog = page.locator('dialog.coupons-dialog-export');
  await dialog.locator('[data-cp-export-mode="json"]').click();
  await dialog.locator('[data-cp-export-preview]').click();
  await expect(dialog.locator('table.coupons-grid-table tbody tr').first()).toBeVisible();
  await expect(dialog.locator('[data-cp-select], [data-cp-select-all], .coupons-grid-col-select')).toHaveCount(0);
});

test('empty state spans every column', async ({ page }) => {
  await setup(page, { coupons: [] });
  await page.goto(PAGE);
  const ths = await page.locator('table.coupons-grid-table thead th').count();
  await expect(page.locator('td.coupons-empty-cell')).toHaveAttribute('colspan', String(ths));
});

test('pasting one group per line into Add keeps them separate', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  await rowBox(page, 'ca-2026-summer').check();
  await editAll(page).click();
  const add = bulkDialog(page).locator('#cp-bg-add');
  await add.focus();
  await add.evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'alpha\nbeta\r\n\ngamma');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(add).toHaveValue('alpha, beta, gamma');
  await expect(bulkDialog(page).locator('[data-cp-bg-change="ca-2026-summer"] td').nth(2)).toHaveText(/alpha\s*beta\s*gamma/);
});
