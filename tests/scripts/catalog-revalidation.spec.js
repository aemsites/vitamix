import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const path = '/us/en_us/products/alpha';
const base = 'https://api.adobecommerce.live';
const storageKey = `commerce-admin:pending-catalog:${base}/aemsites/vitamix`;
const product = {
  path,
  sku: '001',
  name: 'Updated Alpha',
  urlKey: 'alpha',
  url: 'https://www.vitamix.com/us/en_us/products/alpha',
  price: { final: '80.00', regular: '100.00', currency: 'USD' },
  availability: 'InStock',
  custom: { categories: [{ name: 'Blenders', url_key: 'blenders' }] },
  variants: [{
    sku: '001-red',
    name: 'Red Alpha',
    price: { final: '80.00', regular: '100.00', currency: 'USD' },
    availability: 'InStock',
    options: [{ id: 'color', value: 'Red' }],
  }],
};
const parentRow = {
  sku: '001',
  url: product.url,
  urlKey: 'alpha',
  title: product.name,
  price: '80',
  regularPrice: '100',
  currency: 'USD',
  availability: 'InStock',
  categories: 'Blenders',
  categoriesUrlKey: 'blenders',
  variantSkus: '001-red',
};
const variantRow = {
  parentSku: '001',
  sku: '001-red',
  url: product.url,
  title: 'Red Alpha',
  price: '80',
  regularPrice: '100',
  currency: 'USD',
  availability: 'InStock',
  color: 'Red',
};

test.beforeEach(async ({ page }) => {
  await page.route('http://commerce-admin.test/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    await route.fulfill({
      contentType: pathname.endsWith('.html') ? 'text/html' : 'text/javascript',
      body: pathname.endsWith('.html') ? '<html><body></body></html>'
        : await readFile(`.${pathname}`, 'utf8'),
    });
  });
  await page.goto('http://commerce-admin.test/tools/commerce-admin/catalog.html?stage=false');
});

async function loadIndex(page) {
  return page.evaluate(async () => {
    const moduleUrl = new URL('./pim.js', window.location.href).href;
    const { fetchProductsIndexForLocale } = await import(moduleUrl);
    return fetchProductsIndexForLocale('us/en_us');
  });
}

async function writeProduct(page, { method = 'PUT', env } = {}) {
  return page.evaluate(async ({ body, requestMethod, targetEnv }) => {
    const moduleUrl = new URL('./commerce-otp-api.js', window.location.href).href;
    const { apiFetch } = await import(moduleUrl);
    const response = await apiFetch('aemsites', 'vitamix', `catalog${body.path}.json`, {
      method: requestMethod, body: JSON.stringify(body), env: targetEnv,
    });
    return response.status;
  }, { body: product, requestMethod: method, targetEnv: env });
}

test('tracks writes across navigation, bypasses index cache, patches parents and variants until convergence', async ({ page }) => {
  let indexRows = [{
    ...parentRow, title: 'Stale', price: '1', variantSkus: 'old',
  }, {
    ...variantRow, sku: 'old',
  }];
  const requests = [];
  const messages = [];
  page.on('console', (message) => messages.push(message.text()));
  await page.route('https://fcors.org/**', async (route) => {
    const request = route.request();
    const target = new URL(new URL(request.url()).searchParams.get('url'));
    requests.push({ target: target.href, method: request.method(), headers: request.headers() });
    if (request.method() !== 'GET') return route.fulfill({ json: {} });
    if (target.pathname.endsWith('index.json')) {
      return route.fulfill({
        json: { data: target.pathname.includes('/commercial/') ? [] : indexRows },
      });
    }
    return route.fulfill({ json: product });
  });
  await writeProduct(page);
  const pending = () => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), storageKey);
  await expect.poll(pending)
    .toHaveProperty(path);
  await page.reload();
  const loaded = await loadIndex(page);
  expect(loaded.data.map((row) => row.sku)).toEqual(['001', '001-red']);
  expect(loaded.data[0]).toMatchObject({ title: product.name, price: '80.00' });
  const indexes = requests.filter((request) => request.target.includes('index.json'));
  expect(indexes).toHaveLength(2);
  indexes.forEach((request) => {
    expect(new URL(request.target).searchParams.has('_')).toBe(true);
    expect(request.headers['cache-control']).toContain('no-cache');
  });
  const direct = requests.find((request) => request.method === 'GET'
    && request.target.includes('catalog/us/'));
  expect(direct.target).toContain('_=');
  expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), storageKey))
    .toHaveProperty(path);
  indexRows = [parentRow, variantRow];
  await loadIndex(page);
  expect(await pending()).toEqual({});
  const count = requests.filter((request) => request.target.includes('/catalog/')).length;
  await loadIndex(page);
  expect(requests.filter((request) => request.target.includes('/catalog/'))).toHaveLength(count);
  expect(messages.some((message) => message.includes('still pending'))).toBe(true);
  expect(messages.some((message) => message.includes('removed from revalidation'))).toBe(true);
});

test('only successful catalog writes are tracked, scoped to target environment and locale', async ({ page }) => {
  let status = 500;
  await page.route('https://fcors.org/**', (route) => route.fulfill({ status, json: {} }));
  expect(await writeProduct(page)).toBe(500);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull();
  status = 200;
  await writeProduct(page, { env: 'stage' });
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull();
  await page.route('https://fcors.org/**', (route) => route.fulfill({ json: { data: [] } }));
  expect((await loadIndex(page)).data).toEqual([]);
  await page.evaluate(({ key, otherPath }) => {
    sessionStorage.setItem(key, JSON.stringify({ [otherPath]: Date.now() }));
  }, { key: storageKey, otherPath: '/ca/en_us/products/alpha' });
  expect((await loadIndex(page)).data).toEqual([]);
});

test('new and deleted products are patched and removed only after index convergence', async ({ page }) => {
  let rows = [];
  let deleted = false;
  await page.route('https://fcors.org/**', (route) => {
    const request = route.request();
    const target = new URL(new URL(request.url()).searchParams.get('url'));
    if (request.method() !== 'GET') return route.fulfill({ json: {} });
    if (target.pathname.endsWith('index.json')) {
      return route.fulfill({ json: { data: target.pathname.includes('/commercial/') ? [] : rows } });
    }
    return route.fulfill({ status: deleted ? 404 : 200, json: product });
  });
  await writeProduct(page);
  expect((await loadIndex(page)).data).toHaveLength(2);
  rows = [parentRow, variantRow];
  await writeProduct(page, { method: 'DELETE' });
  deleted = true;
  expect((await loadIndex(page)).data).toEqual([]);
  expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), storageKey))
    .toHaveProperty(path);
  rows = [];
  await loadIndex(page);
  const pending = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), storageKey);
  expect(pending).toEqual({});
});

test('failed direct reads surface errors and retain pending entries for retry', async ({ page }) => {
  await page.route('https://fcors.org/**', (route) => {
    const request = route.request();
    const target = new URL(new URL(request.url()).searchParams.get('url'));
    if (request.method() !== 'GET') return route.fulfill({ json: {} });
    if (target.pathname.endsWith('index.json')) return route.fulfill({ json: { data: [] } });
    return route.fulfill({ status: 503, json: {} });
  });
  await writeProduct(page);
  await expect(loadIndex(page)).rejects.toThrow('Could not revalidate');
  expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), storageKey))
    .toHaveProperty(path);
});

test('tracks PATCH fallback and cross-environment promotion without mixing sessions', async ({ page }) => {
  const methods = [];
  await page.route('https://fcors.org/**', (route) => {
    methods.push(route.request().method());
    return route.fulfill({
      status: route.request().method() === 'PUT' ? 405 : 200, json: {},
    });
  });
  await page.evaluate(async (body) => {
    const moduleUrl = new URL('./commerce-resource-save.js', window.location.href).href;
    const { putOrPatchResource } = await import(moduleUrl);
    await putOrPatchResource(`catalog${body.path}.json`, body);
  }, product);
  expect(methods).toEqual(['PUT', 'PATCH']);
  expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), storageKey))
    .toHaveProperty(path);
  await page.evaluate((key) => {
    sessionStorage.removeItem(key);
    sessionStorage.removeItem('productbus-stage');
  }, storageKey);
  await writeProduct(page, { method: 'PATCH', env: 'prod' });
  expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), storageKey))
    .toHaveProperty(path);
});
