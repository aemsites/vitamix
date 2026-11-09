import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

/**
 * Regression coverage for the Promotion Control Center after its schedule loaders moved to
 * `promotion-sources.js`: it must still read every source for every locale, report the same
 * status lines, and fall back to the fcors proxy when a direct content fetch is blocked.
 */
const origin = 'http://commerce-admin.test';
const PREVIEW = 'https://main--vitamix--aemsites.aem.page';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function fakeJwt() {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${enc({ alg: 'none' })}.${enc({ exp, iat: exp - 60, email: 'admin@example.com' })}.sig`;
}

const row = (start, end, text) => `<div><div>${start}</div><div>${end}</div><div>${text}</div><div>xanadu</div></div>`;
const NAV = `<div><div class="alert-banners">
  ${row('6/23/2025 9am', '12/31/2026 11:59pm', 'Free shipping')}
  ${row('10/14/2026 12am', '10/30/2026 11:59pm', 'Up to $320 Off')}
  ${row('11/5/2026 12am', '11/10/2026 11:59pm', 'Holiday Sale')}
</div></div>`;
const GIFTS = `<div><div class="free-gifts"><div><div>11/5/2026 12am</div><div>11/10/2026 11:59pm</div>
  <div>$299.95</div><div>FREE Scraper</div><div></div><div></div></div></div></div>`;
const SCHEDULE = JSON.stringify({
  data: [
    { Start: '10/2/2026 12am', End: '10/4/2026 2:59am', Promotion: 'fall-1' },
    { Start: '11/5/2026 12am', End: '11/10/2026 11:59pm', Promotion: 'holiday' },
  ],
});

/** Content documents by path, as the preview content origin would serve them. */
function content(pathname) {
  if (pathname.endsWith('/nav/nav-banners.plain.html')) return { type: 'text/html', body: NAV };
  if (pathname.endsWith('/config/free-gifts.plain.html')) return { type: 'text/html', body: GIFTS };
  if (pathname.endsWith('/promotions/promo-schedule.json')) return { type: 'application/json', body: SCHEDULE };
  if (pathname === '/metadata.json') return { type: 'application/json', body: JSON.stringify({ data: [] }) };
  return null;
}

async function setup(page, { directContent }) {
  const proxied = [];
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
    const target = new URL(new URL(route.request().url()).searchParams.get('url'));
    if (target.origin === PREVIEW) {
      proxied.push(target.pathname);
      const doc = content(target.pathname);
      await route.fulfill(doc ? { contentType: doc.type, body: doc.body } : { status: 404, body: '' });
      return;
    }
    const path = target.pathname.replace('/aemsites/sites/vitamix/', '');
    if (path === 'price-rules/catalog') await route.fulfill({ json: { promotions: [] } });
    else await route.fulfill({ json: {} });
  });
  await page.route(`${PREVIEW}/**`, async (route) => {
    const doc = directContent ? content(new URL(route.request().url()).pathname) : null;
    if (!directContent) await route.abort();
    else await route.fulfill(doc ? { contentType: doc.type, body: doc.body } : { status: 404, body: '' });
  });
  return proxied;
}

const statusTexts = (page) => page.locator('#pcc-status-list li').allTextContents();

test.describe('Promotion Control Center after the loader extraction', () => {
  test('reads nav banners, promo schedules and free gifts for every locale', async ({ page }) => {
    await setup(page, { directContent: true });
    await page.goto(`${origin}/tools/commerce-admin/misc/promotion-control-center.html`);
    await expect(page.locator('#pcc-status-list li')).toHaveCount(11);
    await expect.poll(async () => (await statusTexts(page)).some((t) => t.startsWith('Commerce promotions'))).toBe(true);
    await expect.poll(async () => (await statusTexts(page)).filter((t) => t.includes(': loading')).length).toBe(0);

    const texts = await statusTexts(page);
    ['us/en_us', 'ca/en_us', 'ca/fr_ca'].forEach((locale) => {
      expect(texts).toContain(`/${locale}/nav/nav-banners: 3 banners`);
      expect(texts).toContain(`/${locale}/promotions/promo-schedule.json: 2 entries`);
      expect(texts).toContain(`/${locale}/products/config/free-gifts: 1 gifts`);
    });
    expect(texts).toContain('/metadata.json: 0 pages with schedule = promo-schedule');
    expect(texts.some((t) => t.startsWith('Commerce promotions (staging): 0 promotion'))).toBe(true);
    await expect(page.locator('#pcc-status-list li.pcc-status-error')).toHaveCount(0);
  });

  test('falls back to the fcors proxy when the direct content fetch is blocked', async ({ page }) => {
    const proxied = await setup(page, { directContent: false });
    await page.goto(`${origin}/tools/commerce-admin/misc/promotion-control-center.html`);
    await expect.poll(async () => (await statusTexts(page)).includes('/us/en_us/nav/nav-banners: 3 banners')).toBe(true);
    expect(proxied).toContain('/us/en_us/nav/nav-banners.plain.html');
    expect(proxied).toContain('/us/en_us/promotions/promo-schedule.json');
    expect(proxied).toContain('/us/en_us/products/config/free-gifts.plain.html');
    await expect(page.locator('#pcc-status-list li.pcc-status-error')).toHaveCount(0);
  });
});
