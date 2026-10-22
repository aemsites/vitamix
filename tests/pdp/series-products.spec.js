import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const category = { name: 'Ascent Series', url_key: 'ascent-series' };
const rows = [
  {
    sku: 'ten',
    urlKey: 'model-10',
    title: 'Model 10',
    price: '549.95',
    image: './ten.png',
    categoriesUrlKey: 'ascent-series',
  },
  {
    sku: 'two',
    urlKey: 'model-2',
    title: 'Model 2',
    price: '499.95',
    image: './two.png',
    categoriesUrlKey: 'all-blenders, ascent-series',
  },
  {
    sku: 'one',
    urlKey: 'model-1',
    title: 'Model 1 with a longer product name',
    price: '399.95',
    image: './one.png',
    categoriesUrlKey: 'ascent-series',
  },
  { sku: 'red', parentSku: 'ten', color: 'Candy Apple Red' },
  { sku: 'red-duplicate', parentSku: 'ten', color: 'Candy Apple Red' },
  { sku: 'black', parentSku: 'ten', color: 'Black' },
  {
    sku: 'unrelated',
    urlKey: 'unrelated',
    title: 'Not in series',
    categoriesUrlKey: 'ascent-series-accessories',
  },
];

async function mount(page, {
  categories = [category], products = rows, status = 200, commercial = false,
} = {}) {
  const files = new Map(await Promise.all([
    '/blocks/pdp/series-products.js',
    '/scripts/plp-data.js',
    '/blocks/pdp/pdp.css',
    '/blocks/pdp/gallery.css',
  ].map(async (path) => [path, await readFile(`.${path}`, 'utf8')])));
  const scripts = await readFile('scripts/scripts.js', 'utf8');
  const formatPrice = scripts.match(/export function formatPrice\(value, ph\) \{[\s\S]*?\n\}/)[0];
  files.set('/scripts/scripts.js', `${formatPrice}
    export function getLocaleAndLanguage() { return { locale: 'us', language: 'en_us' }; }`);
  files.set('/scripts/aem.js', `export function toClassName(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }`);

  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let requests = 0;
  const indexUrls = [];
  // Local hosts load the index through the fcors proxy, like the other product loaders.
  await page.route('https://fcors.org/**', async (route) => {
    const target = new URL(new URL(route.request().url()).searchParams.get('url'));
    requests += 1;
    indexUrls.push(`${target.origin}${target.pathname}`);
    await pending;
    if (status !== 200) {
      await route.fulfill({ status, contentType: 'text/plain', body: 'Service Unavailable' });
    } else {
      await route.fulfill({ json: { data: products } });
    }
  });
  await page.route('https://pdp.test/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (files.has(pathname)) {
      await route.fulfill({
        contentType: pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
        body: files.get(pathname),
      });
    } else if (pathname === '/us/en_us/products/model-2') {
      await route.fulfill({
        contentType: 'text/html',
        body: `<link rel="stylesheet" href="/blocks/pdp/pdp.css">
          <style>
            :root { --body-size-s: 14px; --color-gray-300: #eee;
              --color-charcoal: #333; --color-gray-400: #ccc;
              --color-white: #fff; --color-text: #222; }
            body { font-family: Arial, sans-serif; margin: 16px; }
            .pdp-buy-box { width: 100%; max-width: 480px; }
          </style>
          <div class="pdp"><div class="pdp-buy-box">
            <button id="compare">Compare</button><div id="share">Share</div>
          </div></div>`,
      });
    } else {
      await route.fulfill({ status: 204 });
    }
  });
  await page.goto('https://pdp.test/us/en_us/products/model-2', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ customCategories, isCommercial }) => {
    const modulePath = '/blocks/pdp/series-products.js';
    const { default: render } = await import(modulePath);
    const picker = render({}, {
      name: 'Model 2',
      image: '/current.png',
      offers: [{ price: '499.95' }],
      custom: { categories: customCategories, isCommercial },
    });
    if (picker) document.querySelector('#share').before(picker);
  }, { customCategories: categories, isCommercial: commercial });
  return { release, requests: () => requests, indexUrls };
}

test('series picker reserves space without waiting and renders sorted cards @cross-browser', async ({ page }) => {
  const { release, indexUrls } = await mount(page);
  const picker = page.locator('.pdp-series-products');
  await expect(picker).toHaveAttribute('aria-busy', 'true');
  await expect(picker.locator('.pdp-series-skeleton')).toHaveCount(3);
  const shareBefore = await page.locator('#share').boundingBox();
  const pickerBefore = await picker.boundingBox();
  await page.locator('#compare').click();
  release();

  await expect(picker).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.pdp-series-name')).toHaveText([
    'Model 1 with a longer product name', 'Model 2', 'Model 10',
  ]);
  const current = page.locator('.pdp-series-card.is-selected');
  await expect(current).toHaveCount(1);
  await expect(current.locator('.pdp-series-product')).toHaveAttribute('aria-current', 'page');
  await expect(current.locator('.pdp-series-price')).toHaveText('$499.95');
  await expect(current.locator('img')).toHaveAttribute('src', 'https://main--vitamix--aemsites.aem.network/us/en_us/products/two.png');
  expect(indexUrls).toEqual(['https://main--vitamix--aemsites.aem.network/us/en_us/products/index.json']);
  const ten = page.locator('.pdp-series-card').last();
  await expect(ten.locator('.pdp-series-swatch')).toHaveCount(2);
  await expect(ten.getByRole('link', { name: 'Model 10 - Candy Apple Red' }))
    .toHaveAttribute('href', '/us/en_us/products/model-10?color=candy-apple-red');
  const first = page.locator('.pdp-series-card').first();
  await expect(first.locator('.pdp-series-colors')).toHaveCount(0);
  const imageBox = await first.locator('img').boundingBox();
  const firstBox = await first.boundingBox();
  expect(imageBox.x - firstBox.x).toBeLessThanOrEqual(1);
  expect(imageBox.y - firstBox.y).toBeLessThanOrEqual(1);
  expect(Math.abs(imageBox.width - imageBox.height)).toBeLessThanOrEqual(1);
  expect((await ten.boundingBox()).height).toBe(firstBox.height);
  expect(firstBox.height).toBeLessThanOrEqual(200);
  const shareAfter = await page.locator('#share').boundingBox();
  const pickerAfter = await picker.boundingBox();
  expect(shareAfter.y).toBe(shareBefore.y);
  expect(pickerAfter.height).toBe(pickerBefore.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});

test('no series category means no picker or index request @cross-browser', async ({ page }) => {
  const fixture = await mount(page, {
    categories: [{ name: 'All Blenders', url_key: 'all-blenders' }],
  });
  await expect(page.locator('.pdp-series-products')).toHaveCount(0);
  expect(fixture.requests()).toBe(0);
  fixture.release();
});

test('commercial products load the commercial index through fcors @cross-browser', async ({ page }) => {
  const { release, indexUrls } = await mount(page, { commercial: true });
  release();
  await expect(page.locator('.pdp-series-products')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.pdp-series-card')).toHaveCount(3);
  expect(indexUrls).toEqual(['https://main--vitamix--aemsites.aem.network/us/en_us/products/commercial/index.json']);
});

test('single-product series retains its reserved space and selected card @cross-browser', async ({ page }) => {
  const { release } = await mount(page, { products: [] });
  const before = await page.locator('#share').boundingBox();
  release();
  await expect(page.locator('.pdp-series-products')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.pdp-series-card')).toHaveCount(1);
  await expect(page.locator('.pdp-series-card')).toHaveClass(/is-selected/);
  expect((await page.locator('#share').boundingBox()).y).toBe(before.y);
});

test('index errors are logged and shown without collapsing the reserved space @cross-browser', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const { release } = await mount(page, { status: 503 });
  const before = await page.locator('#share').boundingBox();
  release();
  await expect(page.getByRole('status')).toHaveText('Unable to load products in this series.');
  await expect(page.locator('.pdp-series-products')).toHaveAttribute('aria-busy', 'false');
  expect((await page.locator('#share').boundingBox()).y).toBe(before.y);
  expect(errors.some((error) => error.includes('pdp-series-products: failed to load series'))).toBe(true);
});
