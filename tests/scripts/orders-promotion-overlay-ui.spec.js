import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const origin = 'http://commerce-admin.test';
const ordersUrl = (query = '') => `${origin}/tools/commerce-admin/orders.html?range=custom&from=2026-10-08&to=2026-11-08${query}`;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

/** Unsigned JWT with a future expiry; the admin only decodes the payload. */
function fakeJwt() {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${enc({ alg: 'none' })}.${enc({ exp, iat: exp - 60, email: 'admin@example.com' })}.sig`;
}

const bannerRow = (start, end, html, color = 'xanadu') => `<div><div>${start}</div><div>${end}</div><div>${html}</div><div>${color}</div></div>`;
const banners = (...rows) => `<div><div class="alert-banners">${rows.join('')}</div></div>`;

const NAV = {
  'us/en_us': banners(
    bannerRow('6/23/2025 9am', '12/31/2026 11:59pm', 'Free Standard Shipping on Orders $150 or more.'),
    bannerRow('10/2/2026 12am', '10/13/2026 11:59pm', 'Save Up to $180 on Vitamix Blenders – Limited-Time Only!'),
    bannerRow('10/14/2026 12am', '10/30/2026 11:59pm', 'Up to $320 Off Select Reconditioned Blenders. Reconditioned units…'),
    bannerRow('10/31/2026 12am', '11/4/2026 11:59pm', 'Now Available: Vitamix MaxExtract Cold Press Juicer.'),
    bannerRow('11/5/2026 12am', '11/10/2026 11:59pm', 'Vitamix Holiday Sale: up to $220 Off! Get a head start.'),
  ),
  'ca/en_us': banners(
    bannerRow('10/2/2026 12am', '10/13/2026 11:59pm', 'Save Up to $180 on Vitamix Blenders – Limited-Time Only!'),
    bannerRow('11/5/2026 12am', '11/10/2026 11:59pm', 'Vitamix Holiday Sale: up to $220 Off! Get a head start.'),
  ),
  'ca/fr_ca': banners(
    bannerRow('10/2/2026 12am', '10/13/2026 11:59pm', 'Jusqu’à 180 $ d’économies – Offre limitée !'),
    bannerRow('11/5/2026 12am', '11/10/2026 11:59pm', 'Offre spéciale des fêtes : jusqu’à 220 $ de rabais !'),
  ),
};

const FREE_GIFTS = {
  'us/en_us': `<div><div class="free-gifts"><div><div>11/5/2026 12am</div><div>11/10/2026 11:59pm</div><div>$299.95</div>
    <div>FREE Under Blade Scraper</div><div></div><div></div></div></div></div>`,
};

const order = (id, createdAt, country, locale) => ({
  id, createdAt, country, locale, state: 'completed', total: '100.00',
});

const ORDERS = [
  order('om1', '2026-10-12T15:00:00Z', 'ca', 'en-US'),
  order('om2', '2026-10-14T15:00:00Z', 'ca', 'fr-CA'),
  order('om3', '2026-10-16T15:00:00Z', 'us', 'en-US'),
  order('om4', '2026-10-20T15:00:00Z', 'us', 'en-US'),
  order('om5', '2026-11-05T15:00:00Z', 'us', 'en-US'),
  order('om6', '2026-11-05T16:00:00Z', 'ca', 'en-US'),
  order('om7', '2026-11-06T15:00:00Z', 'us', 'en-US'),
];

test.use({ timezoneId: 'America/New_York', locale: 'en-US' });

/** Schedule documents on the admin's own origin, as on aem.live and under `aem up`. */
const CONTENT = new RegExp(`^${origin}/[a-z]{2}/[a-z]{2}_[a-z]{2}/(nav|products)/`);

/**
 * Serves the real admin page from disk with a signed-in session, a stubbed Commerce API (through
 * the fcors proxy) and stubbed schedule documents.
 */
async function setup(page, { schedule = 'ok' } = {}) {
  const contentRequests = [];
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
    const path = target.pathname.replace('/aemsites/sites/vitamix/', '');
    if (path === 'orders') await route.fulfill({ json: { orders: ORDERS } });
    else if (path.startsWith('auth/')) await route.fulfill({ json: {} });
    else await route.fulfill({ status: 404, json: {} });
  });
  await page.route(CONTENT, async (route) => {
    const { pathname } = new URL(route.request().url());
    contentRequests.push(pathname);
    if (schedule === 'fail') {
      await route.fulfill({ status: 503, body: '' });
      return;
    }
    const locale = pathname.split('/').slice(1, 3).join('/');
    if (pathname.endsWith('/nav/nav-banners.plain.html') && NAV[locale]) {
      await route.fulfill({ contentType: 'text/html', body: NAV[locale] });
    } else if (pathname.endsWith('/config/free-gifts.plain.html') && FREE_GIFTS[locale]) {
      await route.fulfill({ contentType: 'text/html', body: FREE_GIFTS[locale] });
    } else {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  return contentRequests;
}

const bands = (page) => page.locator('#orders-chart .orders-chart-band');
const labels = (page) => page.locator('#orders-chart-overlay .orders-chart-label');
const columns = (page) => page.locator('.orders-chart-bar-col');
const param = (page) => new URL(page.url()).searchParams.get('overlay');

test.describe('orders chart annotations', () => {
  test('draws promotion bands behind the bars, labelled above, with launch and go-live lines', async ({ page }) => {
    await setup(page);
    await page.goto(ordersUrl());
    await expect(bands(page)).toHaveCount(3);
    await expect(columns(page)).toHaveCount(32);

    // Labels: the three promotions, first sentence only, with markets. Launches are off by default.
    await expect(labels(page)).toHaveCount(3);
    await expect(labels(page).nth(0)).toHaveText('Save Up to $180 on Vitamix Blenders · US · CA');
    await expect(labels(page).filter({ hasText: 'Holiday Sale' })).toContainText('+ free gift');
    await expect(page.locator('#orders-overlay-launches')).not.toBeChecked();
    await expect(page.locator('.orders-chart-launch-line')).toHaveCount(0);

    // Bands sit behind the bars, lines on top of them.
    const z = await page.evaluate(() => ['.orders-chart-annot-back', '.orders-chart-bar-col', '.orders-chart-annot-front']
      .map((sel) => Number(getComputedStyle(document.querySelector(sel)).zIndex)));
    expect(z[0]).toBeLessThan(z[1]);
    expect(z[2]).toBeGreaterThan(z[1]);
    await expect(page.locator('.orders-chart-event-pill')).toHaveText('US orders start');
    await expect(page.locator('.orders-chart-stripes')).toHaveCount(1);

    // 11/5 12am ET in an Eastern browser: the holiday band starts at the Nov 5 bar.
    const holiday = await bands(page).nth(2).boundingBox();
    const nov5 = await columns(page).nth(28).boundingBox();
    expect(Math.abs(holiday.x - nov5.x)).toBeLessThan(2.5);
    // Bands cover the bars' area only, not the date labels below them.
    const track = await page.locator('.orders-chart-bar-track').first().boundingBox();
    expect(Math.abs(holiday.y - track.y)).toBeLessThan(1);
    expect(Math.abs(holiday.height - track.height)).toBeLessThan(1);

    // The list below the chart is collapsed by default and holds every annotation.
    const details = page.locator('details.orders-chart-annotations');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(details.locator('summary')).toHaveText('3 promotions, 1 checkout change in this range');
    await expect(details.locator('li')).toHaveCount(5);
  });

  test('the checkboxes add launches or hide everything, and keep their state in the URL', async ({ page }) => {
    await setup(page);
    await page.goto(ordersUrl());
    await expect(labels(page)).toHaveCount(3);
    expect(param(page)).toBeNull();

    await page.check('#orders-overlay-launches');
    await expect(labels(page)).toHaveCount(4);
    await expect(page.locator('.orders-chart-label-launch')).toHaveText('Now Available: Vitamix MaxExtract Cold Press… · US');
    await expect(page.locator('.orders-chart-launch-line')).toHaveCount(1);
    await expect(page.locator('details.orders-chart-annotations summary')).toHaveText('3 promotions, 1 launch, 1 checkout change in this range');
    expect(param(page)).toBe('all');

    await page.uncheck('#orders-overlay-launches');
    await expect(labels(page)).toHaveCount(3);
    expect(param(page)).toBeNull();

    await page.uncheck('#orders-overlay-show');
    await expect(bands(page)).toHaveCount(0);
    await expect(page.locator('#orders-chart-overlay')).toBeEmpty();
    await expect(page.locator('#orders-chart-annotations')).toBeEmpty();
    await expect(page.locator('#orders-overlay-launches')).toBeDisabled();
    await expect(columns(page)).toHaveCount(32);
    expect(param(page)).toBe('off');

    await page.check('#orders-overlay-show');
    await expect(labels(page)).toHaveCount(3);
    expect(param(page)).toBeNull();
  });

  test('?overlay=off draws nothing and makes no content requests', async ({ page }) => {
    const contentRequests = await setup(page);
    await page.goto(ordersUrl('&overlay=off'));
    await expect(columns(page)).toHaveCount(32);
    await expect(page.locator('#orders-overlay-show')).not.toBeChecked();
    await page.waitForTimeout(300);
    expect(contentRequests).toEqual([]);
    await expect(bands(page)).toHaveCount(0);
  });

  test('?overlay=all starts with launches checked', async ({ page }) => {
    await setup(page);
    await page.goto(ordersUrl('&overlay=all'));
    await expect(bands(page)).toHaveCount(3);
    await expect(page.locator('#orders-overlay-launches')).toBeChecked();
    await expect(page.locator('.orders-chart-label-launch')).toHaveCount(1);
  });

  test('the Market filter scopes the annotations and uses that market\'s message', async ({ page }) => {
    await setup(page);
    await page.goto(ordersUrl());
    await expect(bands(page)).toHaveCount(3);

    await page.selectOption('#orders-market', 'ca-fr');
    await expect(bands(page)).toHaveCount(2);
    await expect(labels(page).first()).toHaveText('Jusqu’à 180 $ d’économies · CA FR');
    // CA FR went live on Sep 10, before the range: no go-live line, no stripes.
    await expect(page.locator('.orders-chart-event-pill')).toHaveCount(0);
    await expect(page.locator('.orders-chart-stripes')).toHaveCount(0);

    await page.selectOption('#orders-market', 'us');
    await expect(bands(page)).toHaveCount(3);
    await expect(page.locator('.orders-chart-event-pill')).toHaveCount(1);
  });

  test('hovering a label highlights its band and list row; an opened list stays open', async ({ page }) => {
    await setup(page);
    await page.goto(ordersUrl());
    await expect(bands(page)).toHaveCount(3);

    await page.locator('details.orders-chart-annotations summary').click();
    await page.selectOption('#orders-chart-group', 'week');
    await expect(columns(page)).toHaveCount(6);
    await expect(page.locator('details.orders-chart-annotations')).toHaveAttribute('open', '');

    await labels(page).filter({ hasText: 'Reconditioned' }).hover();
    const id = await labels(page).filter({ hasText: 'Reconditioned' }).getAttribute('data-overlay-id');
    await expect(page.locator(`.orders-chart-band[data-overlay-id="${id}"]`)).toHaveClass(/is-highlighted/);
    await expect(page.locator(`.orders-chart-annotations-list li[data-overlay-id="${id}"]`)).toHaveClass(/is-highlighted/);
    await expect(page.locator('.orders-chart-band.is-highlighted')).toHaveCount(1);
  });

  test('when the schedule cannot be read the chart is unchanged and nothing is drawn on it', async ({ page }) => {
    await setup(page, { schedule: 'fail' });
    await page.goto(ordersUrl());
    await expect(page.locator('#orders-overlay-toggles')).toHaveAttribute('title', /Promotion schedule unavailable for us\/en_us/);
    await expect(bands(page)).toHaveCount(0);
    await expect(page.locator('#orders-chart-overlay')).toBeEmpty();
    // The checkout go-live comes from code, not the schedule, so it is still drawn.
    await expect(page.locator('.orders-chart-event-pill')).toHaveText('US orders start');
    await expect(columns(page)).toHaveCount(32);
    await expect(page.locator('#orders-table')).toContainText(/om3/i);
  });

  test('changing filters does not refetch the schedule', async ({ page }) => {
    const contentRequests = await setup(page);
    await page.goto(ordersUrl());
    await expect(bands(page)).toHaveCount(3);
    const before = contentRequests.length;
    await page.selectOption('#orders-chart-group', 'week');
    await expect(columns(page)).toHaveCount(6);
    await expect(bands(page)).toHaveCount(3);
    await page.selectOption('#orders-market', 'us');
    await expect(bands(page)).toHaveCount(3);
    expect(contentRequests).toHaveLength(before);
  });
});
