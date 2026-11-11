import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const origin = 'http://commerce-admin.test';
const email = 'jane.doe@example.com';
const apiUrl = `https://api.adobecommerce.live/aemsites/sites/vitamix/customers/${encodeURIComponent(email)}`;

/** Requests the admin page sent through the fcors proxy, as `{ method, target }`. */
let apiCalls;
/** fcors response for the customer DELETE. */
let deleteResponse;

test.beforeEach(async ({ page }) => {
  apiCalls = [];
  deleteResponse = { status: 200, json: { success: true } };
  await page.route(`${origin}/**`, async (route) => {
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
  await page.route('https://fcors.org/**', async (route) => {
    const request = route.request();
    apiCalls.push({
      method: request.method(),
      target: new URL(request.url()).searchParams.get('url'),
    });
    await route.fulfill(deleteResponse);
  });
  await page.goto(`${origin}/tools/commerce-admin/customers.html?stage=false`);
  await page.addStyleTag({ url: './detail.css' });
  await page.evaluate(async (address) => {
    const moduleUrl = new URL('./customer-delete.js', window.location.href).href;
    const { openDeleteCustomerDialog } = await import(moduleUrl);
    window.deletedEmails = [];
    openDeleteCustomerDialog(address, {
      onDeleted: (deleted) => window.deletedEmails.push(deleted),
    });
  }, email);
});

test('explains what is and is not deleted and shows the API call', async ({ page }) => {
  const dialog = page.locator('.customers-delete-dialog');
  await expect(dialog.getByRole('heading', { name: 'Delete customer?' })).toBeVisible();
  await expect(dialog).toContainText('profile, saved addresses and order history links');
  await expect(dialog).toContainText('Orders are not deleted');
  await expect(dialog.locator('.pim-delete-dialog-call code')).toHaveText(`DELETE ${apiUrl}`);
  await expect(dialog.locator('input')).toBeFocused();
});

test('requires typing the email before deleting', async ({ page }) => {
  const confirm = page.getByRole('button', { name: 'Delete customer', exact: true });
  const input = page.getByLabel('Enter the customer email to confirm');
  await expect(confirm).toBeDisabled();
  await input.fill('someone.else@example.com');
  await expect(confirm).toBeDisabled();
  await input.fill(`  ${email.toUpperCase()} `);
  await expect(confirm).toBeEnabled();
  await input.fill('jane.doe@example');
  await expect(confirm).toBeDisabled();
  expect(apiCalls).toEqual([]);
});

test('deletes the customer, closes the dialog and reports the email', async ({ page }) => {
  await page.getByLabel('Enter the customer email to confirm').fill(email);
  await page.getByRole('button', { name: 'Delete customer', exact: true }).click();
  await expect(page.locator('.customers-delete-dialog')).toHaveCount(0);
  expect(apiCalls.filter((call) => call.method === 'DELETE')).toEqual([
    { method: 'DELETE', target: apiUrl },
  ]);
  expect(await page.evaluate(() => window.deletedEmails)).toEqual([email]);
});

test('keeps the dialog open and shows the API error when the delete fails', async ({ page }) => {
  deleteResponse = {
    status: 500,
    headers: { 'x-error': 'storage unavailable', 'access-control-expose-headers': 'x-error' },
    body: '',
  };
  const confirm = page.getByRole('button', { name: 'Delete customer', exact: true });
  await page.getByLabel('Enter the customer email to confirm').fill(email);
  await confirm.click();
  await expect(page.locator('[data-customers-delete-status]')).toHaveText('storage unavailable');
  await expect(page.locator('.customers-delete-dialog')).toHaveCount(1);
  await expect(confirm).toBeEnabled();
  await expect(page.getByLabel('Enter the customer email to confirm')).toBeEnabled();
  expect(await page.evaluate(() => window.deletedEmails)).toEqual([]);
});

test('Cancel and Escape dismiss without calling the API', async ({ page }) => {
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.customers-delete-dialog')).toHaveCount(0);
  await page.evaluate(async (address) => {
    const moduleUrl = new URL('./customer-delete.js', window.location.href).href;
    const { openDeleteCustomerDialog } = await import(moduleUrl);
    openDeleteCustomerDialog(address);
  }, email);
  await expect(page.locator('.customers-delete-dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.customers-delete-dialog')).toHaveCount(0);
  expect(apiCalls.filter((call) => call.method === 'DELETE')).toEqual([]);
});

test('does nothing without an email', async ({ page }) => {
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.evaluate(async () => {
    const moduleUrl = new URL('./customer-delete.js', window.location.href).href;
    const { openDeleteCustomerDialog } = await import(moduleUrl);
    openDeleteCustomerDialog('   ');
    openDeleteCustomerDialog();
  });
  await expect(page.locator('.customers-delete-dialog')).toHaveCount(0);
});
