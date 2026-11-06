import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const origin = 'http://commerce-admin.test';
const email = 'jane.doe@example.com';

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.sig`;
}

const auth = {
  token: jwt({ email: 'admin@example.com', exp: Math.floor(Date.now() / 1000) + 3600 }),
  roles: ['admin'],
  email: 'admin@example.com',
};

let calls;
let deleted;

test.beforeEach(async ({ page }) => {
  calls = [];
  deleted = false;
  await page.addInitScript((state) => {
    localStorage.setItem('pbus-auth-aemsites-vitamix-prod', JSON.stringify(state));
  }, auth);
  await page.route(`${origin}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    let contentType = 'text/javascript';
    if (pathname.endsWith('.html')) contentType = 'text/html';
    else if (pathname.endsWith('.css')) contentType = 'text/css';
    await route.fulfill({ contentType, body: await readFile(`.${pathname}`, 'utf8') });
  });
  await page.route('https://fcors.org/**', async (route) => {
    const request = route.request();
    const target = new URL(request.url()).searchParams.get('url');
    const { pathname } = new URL(target);
    const method = request.method();
    calls.push(`${method} ${pathname.replace('/aemsites/sites/vitamix/', '')}`);
    const customerPath = `/aemsites/sites/vitamix/customers/${encodeURIComponent(email)}`;
    if (method === 'DELETE' && pathname === customerPath) {
      deleted = true;
      await route.fulfill({ json: { success: true } });
    } else if (method === 'GET' && pathname === customerPath) {
      await (deleted
        ? route.fulfill({ status: 404, json: {} })
        : route.fulfill({
          json: { customer: { email, firstName: 'Jane', lastName: 'Doe' } },
        }));
    } else if (method === 'GET' && pathname === `${customerPath}/orders`) {
      await route.fulfill({ json: { orders: [] } });
    } else {
      await route.fulfill({ json: {} });
    }
  });
});

test('admin deletes a customer from the detail modal and sees a deleted notice', async ({ page }) => {
  await page.goto(`${origin}/tools/commerce-admin/customers.html?stage=false&email=${encodeURIComponent(email)}`);

  const detail = page.locator('.customers-detail-dialog');
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Delete customer…' }).click();

  const confirmDialog = page.locator('.customers-delete-dialog');
  await expect(confirmDialog).toContainText('Orders are not deleted');
  const confirm = confirmDialog.getByRole('button', { name: 'Delete customer', exact: true });
  await expect(confirm).toBeDisabled();
  await confirmDialog.getByLabel('Enter the customer email to confirm').fill(email);
  await confirm.click();

  await expect(confirmDialog).toHaveCount(0);
  await expect(detail).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Customer deleted' })).toBeVisible();
  await expect(page.locator('#customers-table')).toContainText(email);
  await expect(page.locator('#customers-table')).toContainText('Order records are not deleted');
  await expect(page.locator('#customers-count')).toHaveText('');
  expect(calls.filter((call) => call.startsWith('DELETE'))).toEqual([
    `DELETE customers/${encodeURIComponent(email)}`,
  ]);
});

test('cancelling the confirmation keeps the customer and sends no DELETE', async ({ page }) => {
  await page.goto(`${origin}/tools/commerce-admin/customers.html?stage=false&email=${encodeURIComponent(email)}`);
  const detail = page.locator('.customers-detail-dialog');
  await detail.getByRole('button', { name: 'Delete customer…' }).click();
  await page.locator('.customers-delete-dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.customers-delete-dialog')).toHaveCount(0);
  await expect(detail).toBeVisible();
  expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
});

test('Delete customer is also reachable when reopening the customer from the table row', async ({ page }) => {
  await page.goto(`${origin}/tools/commerce-admin/customers.html?stage=false&email=${encodeURIComponent(email)}`);
  await expect(page.locator('.customers-detail-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.customers-detail-dialog')).toHaveCount(0);
  await page.locator('tr.customers-row-open').click();
  const detail = page.locator('.customers-detail-dialog');
  await detail.getByRole('button', { name: 'Delete customer…' }).click();
  await page.getByLabel('Enter the customer email to confirm').fill(email);
  await page.getByRole('button', { name: 'Delete customer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Customer deleted' })).toBeVisible();
});
