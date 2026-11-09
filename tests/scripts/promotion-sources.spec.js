import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const origin = 'http://commerce-admin.test';
const pageUrl = `${origin}/tools/commerce-admin/orders.html`;
const PREVIEW = 'https://main--vitamix--aemsites.aem.page';

const NAV_BANNERS = `<div><div class="alert-banners">
  <div><div>6/23/2025 9am</div><div>12/31/2026 11:59pm</div><div>Free Standard Shipping on Orders $150 or more.</div><div>xanadu</div></div>
  <div><div>10/14/2026 12am</div><div>10/30/2026 11:59pm</div><div><strong>Up to $320 Off</strong>
    Select <a href="/shop/sale">Reconditioned</a> Blenders.</div><div>charcoal</div></div>
  <div><div>10/31/2026 12am</div><div>11/4/2026 11:59pm</div><div>Now Available: Vitamix MaxExtract</div><div>xanadu</div><div> Launch </div></div>
  <div><div>not a date</div><div>11/4/2026 11:59pm</div><div>Broken row</div><div>xanadu</div></div>
  <div><div></div><div></div><div>Open ended</div><div></div></div>
</div></div>`;

const FREE_GIFTS = `<div><div class="free-gifts">
  <div><div>11/5/2026 12am</div><div>11/10/2026 11:59pm</div><div>$299.95</div>
    <div><strong>FREE Under Blade Scraper</strong></div><div><p><picture></picture></p></div><div>e320, e310</div></div>
  <div><div></div></div>
</div></div>`;

const PROMO_SCHEDULE = JSON.stringify({
  data: [
    { Start: '10/2/2026 12am', End: '10/4/2026 2:59am', Promotion: '2026-fall-promo-1' },
    { Start: '2026-10-05T00:00:00Z', End: 'garbage', Promotion: 'iso-start' },
  ],
});

test.beforeEach(async ({ page }) => {
  await page.route(`${origin}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    await route.fulfill({
      contentType: pathname.endsWith('.html') ? 'text/html' : 'text/javascript',
      body: pathname.endsWith('.html') ? '<html><body></body></html>'
        : await readFile(`.${pathname}`, 'utf8'),
    });
  });
  await page.goto(pageUrl);
});

/** Runs `fn(modules, args)` in the page with the shared modules imported. */
function inPage(page, fn, args) {
  return page.evaluate(async ({ source, payload }) => {
    const base = new URL('./', window.location.href).href;
    const modules = {
      sources: await import(`${base}promotion-sources.js`),
      overlay: await import(`${base}promotion-overlay.js`),
      orders: await import(`${base}orders-page.js`),
    };
    // eslint-disable-next-line no-new-func
    return new Function('modules', 'payload', `return (${source})(modules, payload);`)(modules, payload);
  }, { source: fn.toString(), payload: args });
}

test.describe('promotion-sources loaders', () => {
  test('nav banners: parses rows, collapses text, reads the type cell, reports bad rows', async ({ page }) => {
    const result = await inPage(page, async ({ sources }, { html }) => {
      const statuses = [];
      const items = await sources.loadNavBanners('us/en_us', {
        fetchContent: async () => new Response(html, { status: 200 }),
        onStatus: (key, text, error) => statuses.push({ key, text, error }),
      });
      return {
        items: items.map((i) => ({
          ...i, start: i.start && i.start.toISOString(), end: i.end && i.end.toISOString(),
        })),
        last: statuses[statuses.length - 1],
      };
    }, { html: NAV_BANNERS });

    expect(result.items).toHaveLength(4);
    expect(result.items[0]).toMatchObject({
      source: 'nav-banners',
      market: 'us',
      where: 'us/en_us',
      label: 'Free Standard Shipping on Orders $150 or more.',
      start: '2025-06-23T13:00:00.000Z',
      end: '2027-01-01T04:59:00.000Z',
    });
    expect(result.items[0].type).toBeUndefined();
    expect(result.items[1].label).toBe('Up to $320 Off Select Reconditioned Blenders.');
    expect(result.items[1].start).toBe('2026-10-14T04:00:00.000Z');
    expect(result.items[2].type).toBe('launch');
    expect(result.items[3]).toMatchObject({ label: 'Open ended', start: null, end: null });
    expect(result.last.key).toBe('nav-banners:us/en_us');
    expect(result.last.error).toBe(true);
    expect(result.last.text).toContain('row 4: Invalid datetime format');
  });

  test('free gifts: reads label, price and products; an empty row has no dates', async ({ page }) => {
    const items = await inPage(page, async ({ sources }, { html }) => {
      const rows = await sources.loadFreeGifts('us/en_us', {
        fetchContent: async () => new Response(html, { status: 200 }),
      });
      return rows.map((i) => ({
        ...i, start: i.start && i.start.toISOString(), end: i.end && i.end.toISOString(),
      }));
    }, { html: FREE_GIFTS });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: 'free-gifts',
      label: 'FREE Under Blade Scraper',
      detail: 'min price: $299.95 · products: e320, e310',
      start: '2026-11-05T05:00:00.000Z',
    });
    expect(items[1]).toMatchObject({ label: '(no label)', start: null, end: null });
  });

  test('an empty document (as mx/es_mx serves today) is zero rows, reported but not thrown', async ({ page }) => {
    const result = await inPage(page, async ({ sources }) => {
      const statuses = [];
      const items = await sources.loadNavBanners('mx/es_mx', {
        fetchContent: async () => new Response('<div></div>', { status: 200 }),
        onStatus: (key, text, error, info) => statuses.push({ text, error, info }),
      });
      return { items, last: statuses[statuses.length - 1] };
    });
    expect(result.items).toEqual([]);
    expect(result.last.text).toContain('no alert-banners block found');
    expect(result.last.info).toBeUndefined();
  });

  test('HTTP failures: 404 is quiet, others are errors, both carry the status; a network error rejects', async ({ page }) => {
    const result = await inPage(page, async ({ sources }) => {
      const load = async (status) => {
        const statuses = [];
        const items = await sources.loadNavBanners('us/en_us', {
          fetchContent: async () => new Response('', { status }),
          onStatus: (key, text, error, info) => statuses.push({ text, error, info }),
        });
        return { items, last: statuses[statuses.length - 1] };
      };
      const out = { 404: await load(404), 500: await load(500) };
      const offline = async () => { throw new Error('offline'); };
      try {
        await sources.loadFreeGifts('us/en_us', { fetchContent: offline });
        out.rejected = false;
      } catch (e) {
        out.rejected = e.message;
      }
      return out;
    });
    expect(result[404].items).toEqual([]);
    expect(result[404].last).toMatchObject({ error: false, info: { httpStatus: 404 } });
    expect(result[500].last).toMatchObject({ error: true, info: { httpStatus: 500 } });
    expect(result.rejected).toBe('offline');
  });

  test('promo schedule: Eastern dates, with the storefront fallback for other formats', async ({ page }) => {
    const items = await inPage(page, async ({ sources }, { json }) => {
      const rows = await sources.loadPromoSchedule('us/en_us', {
        fetchContent: async () => new Response(json, { status: 200 }),
      });
      return rows.map((i) => ({
        promotion: i.promotion,
        start: i.start && i.start.toISOString(),
        end: i.end && i.end.toISOString(),
      }));
    }, { json: PROMO_SCHEDULE });
    expect(items).toEqual([
      { promotion: '2026-fall-promo-1', start: '2026-10-02T04:00:00.000Z', end: '2026-10-04T06:59:00.000Z' },
      { promotion: 'iso-start', start: '2026-10-05T00:00:00.000Z', end: null },
    ]);
  });

  test('content origin follows the API environment', async ({ page }) => {
    const origins = await inPage(page, async ({ sources }) => {
      sessionStorage.removeItem('productbus-stage');
      const stage = sources.contentOrigin();
      sessionStorage.setItem('productbus-stage', 'false');
      const prod = sources.contentOrigin();
      sessionStorage.removeItem('productbus-stage');
      return { stage, prod };
    });
    expect(origins).toEqual({
      stage: 'https://main--vitamix--aemsites.aem.page',
      prod: 'https://main--vitamix--aemsites.aem.live',
    });
  });
});

/** Schedule documents, served from the admin's own origin (as on aem.live and under `aem up`). */
const CONTENT = (path) => new RegExp(`^${origin}/[a-z]{2}/[a-z]{2}_[a-z]{2}/${path}`);

test.describe('loadOverlaySchedule', () => {
  test('reads nav banners and free gifts per locale from the page origin, and caches them', async ({ page }) => {
    const requests = [];
    const preview = [];
    await page.route(`${PREVIEW}/**`, (route) => { preview.push(route.request().url()); return route.abort(); });
    await page.route(CONTENT('(nav|products)/'), async (route) => {
      const { pathname } = new URL(route.request().url());
      requests.push(pathname);
      if (pathname.endsWith('/nav/nav-banners.plain.html')) {
        await route.fulfill({ contentType: 'text/html', body: NAV_BANNERS });
      } else if (pathname.endsWith('/config/free-gifts.plain.html')) {
        await route.fulfill({ status: 404, body: '' });
      } else {
        await route.fulfill({ status: 500, body: '' });
      }
    });

    const first = await inPage(page, async ({ overlay }) => {
      const r = await overlay.loadOverlaySchedule(['us/en_us', 'ca/fr_ca', 'us/en_us']);
      return { count: r.items.length, failed: r.failedLocales };
    });
    // 4 parsable rows from each of 2 locales; the free-gifts 404 is an empty source, not a failure.
    expect(first).toEqual({ count: 8, failed: [] });
    expect(requests.sort()).toEqual([
      '/ca/fr_ca/nav/nav-banners.plain.html',
      '/ca/fr_ca/products/config/free-gifts.plain.html',
      '/us/en_us/nav/nav-banners.plain.html',
      '/us/en_us/products/config/free-gifts.plain.html',
    ]);

    await inPage(page, async ({ overlay }) => {
      await overlay.loadOverlaySchedule(['us/en_us']);
      await overlay.loadOverlaySchedule(['ca/fr_ca']);
    });
    expect(requests).toHaveLength(4);
    expect(preview).toEqual([]);
  });

  test('a locale that fails is named, and the others still load', async ({ page }) => {
    await page.route(CONTENT('(nav|products)/'), async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname.startsWith('/ca/fr_ca/nav/')) await route.fulfill({ status: 503, body: '' });
      else if (pathname.includes('/nav/')) await route.fulfill({ contentType: 'text/html', body: NAV_BANNERS });
      else await route.fulfill({ status: 404, body: '' });
    });
    const result = await inPage(page, async ({ overlay }) => {
      const r = await overlay.loadOverlaySchedule(['us/en_us', 'ca/fr_ca']);
      return { count: r.items.length, failed: r.failedLocales };
    });
    expect(result).toEqual({ count: 4, failed: ['ca/fr_ca'] });
  });

  test('a network failure marks every requested locale failed without throwing', async ({ page }) => {
    await page.route(CONTENT('(nav|products)/'), (route) => route.abort());
    const result = await inPage(page, async ({ overlay }) => {
      const r = await overlay.loadOverlaySchedule(['us/en_us']);
      return { count: r.items.length, failed: r.failedLocales };
    });
    expect(result).toEqual({ count: 0, failed: ['us/en_us'] });
  });
});

test.describe('overlay positions are exact in any browser time zone', () => {
  // Oct 8 00:00 local to Nov 9 00:00 local, as UTC instants, per zone.
  const zones = [
    { id: 'America/New_York', start: Date.UTC(2026, 9, 8, 4), end: Date.UTC(2026, 10, 9, 5) },
    { id: 'America/Denver', start: Date.UTC(2026, 9, 8, 6), end: Date.UTC(2026, 10, 9, 7) },
    { id: 'Asia/Kolkata', start: Date.UTC(2026, 9, 7, 18, 30), end: Date.UTC(2026, 10, 8, 18, 30) },
  ];
  const holidayStart = Date.UTC(2026, 10, 5, 5); // 11/5/2026 12am EST

  zones.forEach((zone) => {
    test.describe(zone.id, () => {
      test.use({ timezoneId: zone.id });

      test('the 11/5 12am ET start lands at the same instant on the chart', async ({ page }) => {
        const result = await inPage(page, async (m, { since, until }) => {
          const { sources, overlay, orders } = m;
          const buckets = orders.ordersPerPeriodBuckets([], { since, until }, 'day');
          const win = orders.chartWindowMs(buckets, 'day');
          const holiday = {
            kind: 'sale',
            markets: ['us'],
            variants: [{ market: 'us', label: 'Holiday' }],
            start: sources.parseEasternDateTime('11/5/2026 12am'),
            end: sources.parseEasternDateTime('11/10/2026 11:59pm'),
          };
          return { win, span: overlay.overlaySpan(holiday, win), buckets: buckets.length };
        }, {
          since: await page.evaluate(() => new Date(2026, 9, 8).toISOString()),
          until: await page.evaluate(() => new Date(2026, 10, 9).toISOString()),
        });

        expect(result.buckets).toBe(32);
        expect(result.win).toEqual({ startMs: zone.start, endMs: zone.end });
        expect(result.span.leftPct).toBeCloseTo(
          ((holidayStart - zone.start) / (zone.end - zone.start)) * 100,
          6,
        );
        expect(result.span.clippedEnd).toBe(true);
      });
    });
  });
});
