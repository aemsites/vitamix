import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const origin = 'http://commerce-admin.test';
const ordersUrl = `${origin}/tools/commerce-admin/orders.html?stage=false`;
const paths = [
  'orders?since=2026-10-01&until=2026-11-01',
  'orders/om123',
  'customers/test%40example.com/orders',
  'orders/journal?orderId=om123',
  'auth/admins/test%40example.com',
];

test.beforeEach(async ({ page }) => {
  await page.route(`${origin}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    await route.fulfill({
      contentType: pathname.endsWith('.html') ? 'text/html' : 'text/javascript',
      body: pathname.endsWith('.html') ? '<html><body></body></html>'
        : await readFile(`.${pathname}`, 'utf8'),
    });
  });
  await page.route('https://fcors.org/**', (route) => route.fulfill({ json: {} }));
  await page.goto(ordersUrl);
});

async function fetchResources(page, method = 'GET', cache = undefined) {
  return page.evaluate(async ({ resourcePaths, requestMethod, requestCache }) => {
    const moduleUrl = new URL('./commerce-otp-api.js', window.location.href).href;
    const { apiFetch } = await import(moduleUrl);
    const requests = [];
    const originalFetch = window.fetch;
    window.fetch = (url, options) => {
      requests.push({
        target: new URL(url).searchParams.get('url'),
        cache: options.cache,
        method: options.method,
      });
      return originalFetch(url, options);
    };
    try {
      await Promise.all(resourcePaths.map((path) => apiFetch('aemsites', 'vitamix', path, {
        method: requestMethod, cache: requestCache,
      })));
    } finally {
      window.fetch = originalFetch;
    }
    return requests;
  }, { resourcePaths: paths, requestMethod: method, requestCache: cache });
}

test('reload freshly fetches every Commerce API read using the latest reload timestamp', async ({ page }) => {
  await page.reload();
  const first = await fetchResources(page, 'GET', 'force-cache');
  const second = await fetchResources(page);
  await expect.poll(() => page.evaluate(() => Date.now())).toBeGreaterThan(Number(new URL(first[0].target).searchParams.get('_')));
  await page.reload();
  const third = await fetchResources(page);
  const requests = [...first, ...second, ...third];
  const cacheBusters = requests.map((request) => new URL(request.target).searchParams.get('_'));
  expect(cacheBusters.every(Boolean)).toBe(true);
  expect(new Set(cacheBusters).size).toBe(2);
  expect(new URL(second[0].target).searchParams.get('_')).toBe(new URL(first[0].target).searchParams.get('_'));
  expect(Number(new URL(third[0].target).searchParams.get('_'))).toBeGreaterThan(Number(new URL(first[0].target).searchParams.get('_')));
  requests.forEach((request, index) => {
    expect(request.cache).toBe('no-store');
    const target = new URL(request.target);
    target.searchParams.delete('_');
    expect(target.href).toBe(`https://api.adobecommerce.live/aemsites/sites/vitamix/${paths[index % paths.length]}`);
  });
  const heads = await fetchResources(page, 'HEAD');
  expect(heads.every((request) => request.cache === 'no-store'
    && new URL(request.target).searchParams.has('_'))).toBe(true);
});

test('normal navigation preserves caching and shares the latest reload timestamp across pages', async ({ page }) => {
  const navigated = await fetchResources(page);
  await page.goto(`${origin}/tools/commerce-admin/catalog.html?stage=false`);
  const otherPage = await fetchResources(page);
  [...navigated, ...otherPage].forEach((request) => {
    expect(request.cache).toBeUndefined();
    expect(new URL(request.target).searchParams.has('_')).toBe(false);
  });
  await page.reload();
  const reloaded = await fetchResources(page);
  const timestamp = new URL(reloaded[0].target).searchParams.get('_');
  expect(timestamp).toBeTruthy();
  expect(reloaded.every((request) => request.cache === 'no-store')).toBe(true);
  await page.goto(ordersUrl);
  const afterNavigation = await fetchResources(page);
  afterNavigation.forEach((request) => {
    expect(new URL(request.target).searchParams.get('_')).toBe(timestamp);
    expect(request.cache).toBeUndefined();
  });
});

['POST', 'PUT', 'PATCH', 'DELETE'].forEach((method) => {
  test(`reload does not change ${method} URLs or explicit cache options`, async ({ page }) => {
    await page.reload();
    const requests = await fetchResources(page, method, 'no-cache');
    requests.forEach((request) => {
      expect(request.method).toBe(method);
      expect(request.cache).toBe('no-cache');
      expect(new URL(request.target).searchParams.has('_')).toBe(false);
    });
  });
});
