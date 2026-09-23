import { test, expect } from '@playwright/test';
import {
  orderMarketKey,
  currencyForMarketKey,
  filterByMarket,
  uniqueMarkets,
  ordersPerPeriodBuckets,
  ordersPerPeriodChartHtml,
} from '../../tools/commerce-admin/orders-page.js';

test.describe('orderMarketKey', () => {
  test('returns ca-en for Canada with a non-French locale', () => {
    expect(orderMarketKey({ country: 'ca', locale: 'en-US' })).toBe('ca-en');
    expect(orderMarketKey({ country: 'CA', locale: 'en-CA' })).toBe('ca-en');
  });

  test('returns ca-fr for Canada with a French locale', () => {
    expect(orderMarketKey({ country: 'ca', locale: 'fr-CA' })).toBe('ca-fr');
  });

  test('returns lowercase country for US and MX', () => {
    expect(orderMarketKey({ country: 'US', locale: 'en-US' })).toBe('us');
    expect(orderMarketKey({ country: 'mx', locale: 'es-MX' })).toBe('mx');
  });

  test('returns empty string when country is missing', () => {
    expect(orderMarketKey(null)).toBe('');
    expect(orderMarketKey({})).toBe('');
  });
});

test.describe('currencyForMarketKey', () => {
  test('maps known market keys to their currency code, including combined CA', () => {
    expect(currencyForMarketKey('us')).toBe('USD');
    expect(currencyForMarketKey('ca')).toBe('CAD');
    expect(currencyForMarketKey('ca-en')).toBe('CAD');
    expect(currencyForMarketKey('ca-fr')).toBe('CAD');
    expect(currencyForMarketKey('mx')).toBe('MXN');
  });

  test('returns empty string for unknown or empty market keys', () => {
    expect(currencyForMarketKey('')).toBe('');
    expect(currencyForMarketKey('gb')).toBe('');
  });
});

test.describe('filterByMarket', () => {
  const orders = [
    { id: 1, country: 'us', locale: 'en-US' },
    { id: 2, country: 'ca', locale: 'en-US' },
    { id: 3, country: 'ca', locale: 'fr-CA' },
    { id: 4, country: 'mx', locale: 'es-MX' },
  ];

  test('returns all orders when marketKey is empty', () => {
    expect(filterByMarket(orders, '')).toHaveLength(4);
  });

  test('matches an exact sub-market key (ca-en / ca-fr) only', () => {
    expect(filterByMarket(orders, 'ca-en').map((o) => o.id)).toEqual([2]);
    expect(filterByMarket(orders, 'ca-fr').map((o) => o.id)).toEqual([3]);
  });

  test('a bare "ca" matches both CA store views ("CA · All")', () => {
    expect(filterByMarket(orders, 'ca').map((o) => o.id).sort()).toEqual([2, 3]);
  });

  test('still matches US and MX by their plain key', () => {
    expect(filterByMarket(orders, 'us').map((o) => o.id)).toEqual([1]);
    expect(filterByMarket(orders, 'mx').map((o) => o.id)).toEqual([4]);
  });
});

test.describe('uniqueMarkets', () => {
  test('adds a combined "CA · All" option when both CA store views are present', () => {
    const orders = [
      { country: 'us', locale: 'en-US' },
      { country: 'ca', locale: 'en-US' },
      { country: 'ca', locale: 'fr-CA' },
    ];
    const markets = uniqueMarkets(orders);
    const keys = markets.map((m) => m.key);
    expect(keys).toContain('ca');
    expect(keys).toContain('ca-en');
    expect(keys).toContain('ca-fr');
    expect(markets.find((m) => m.key === 'ca').label).toBe('CA · All');
    // "CA · All" sorts before its two sub-options.
    expect(keys.indexOf('ca')).toBeLessThan(keys.indexOf('ca-en'));
    expect(keys.indexOf('ca')).toBeLessThan(keys.indexOf('ca-fr'));
  });

  test('does not add a combined CA option when only one CA store view is present', () => {
    const orders = [
      { country: 'us', locale: 'en-US' },
      { country: 'ca', locale: 'en-US' },
    ];
    const keys = uniqueMarkets(orders).map((m) => m.key);
    expect(keys).not.toContain('ca');
    expect(keys).toContain('ca-en');
  });

  test('returns an empty list for orders with no country', () => {
    expect(uniqueMarkets([{ }, { country: '' }])).toEqual([]);
  });
});

test.describe('ordersPerPeriodBuckets — day granularity', () => {
  test('zero-fills days across explicit bounds, ascending, with count + amount', () => {
    const orders = [
      { createdAt: '2026-01-02T10:00:00.000Z', total: '10.00' },
      { createdAt: '2026-01-02T18:00:00.000Z', total: '5.50' },
      { createdAt: '2026-01-04T09:00:00.000Z', subtotal: '20' },
    ];
    // Local-midnight Jan 1 through (exclusive) Jan 5 → buckets for Jan 1-4.
    const since = new Date(2026, 0, 1).toISOString();
    const until = new Date(2026, 0, 5).toISOString();
    const buckets = ordersPerPeriodBuckets(orders, { since, until }, 'day');

    expect(buckets).toHaveLength(4);
    expect(buckets.map((b) => b.count)).toEqual([0, 2, 0, 1]);
    expect(buckets.map((b) => b.amount)).toEqual([0, 15.5, 0, 20]);
    // strictly ascending by period
    const keys = buckets.map((b) => b.periodStart);
    expect([...keys].sort()).toEqual(keys);
    // Orders with no `state` default to 'pending', grouped into one byState entry.
    expect(buckets[1].byState).toHaveLength(1);
    expect(buckets[1].byState[0]).toMatchObject({ state: 'pending', count: 2, amount: 15.5 });
  });

  test('derives bounds from min/max createdAt when no bounds are given', () => {
    const orders = [
      { createdAt: '2026-03-05T12:00:00.000Z' },
      { createdAt: '2026-03-08T12:00:00.000Z' },
    ];
    const buckets = ordersPerPeriodBuckets(orders);
    expect(buckets.length).toBeGreaterThanOrEqual(2);
    expect(buckets[0].count + buckets[buckets.length - 1].count).toBeGreaterThan(0);
  });

  test('returns empty array for empty orders and no bounds', () => {
    expect(ordersPerPeriodBuckets([])).toEqual([]);
  });

  test('ignores orders with missing or invalid createdAt', () => {
    const orders = [{ createdAt: null }, { createdAt: 'not-a-date' }];
    expect(ordersPerPeriodBuckets(orders)).toEqual([]);
  });

  test('breaks a bucket down per state, ordered success → pending → processing → ... → danger', () => {
    const orders = [
      { createdAt: '2026-04-01T10:00:00.000Z', state: 'payment_completed', total: '10' },
      { createdAt: '2026-04-01T11:00:00.000Z', state: 'payment_completed', total: '20' },
      { createdAt: '2026-04-01T12:00:00.000Z', state: 'payment_processing', total: '5' },
      { createdAt: '2026-04-01T13:00:00.000Z', state: 'payment_cancelled', total: '7' },
    ];
    const since = new Date(2026, 3, 1).toISOString();
    const until = new Date(2026, 3, 2).toISOString();
    const [bucket] = ordersPerPeriodBuckets(orders, { since, until }, 'day');

    expect(bucket.count).toBe(4);
    expect(bucket.amount).toBe(42);
    expect(bucket.byState.map((s) => s.state)).toEqual([
      'payment_completed', 'payment_processing', 'payment_cancelled',
    ]);
    expect(bucket.byState.map((s) => s.badgeClass)).toEqual([
      'orders-badge-success', 'orders-badge-processing', 'orders-badge-danger',
    ]);
    expect(bucket.byState[0]).toMatchObject({ count: 2, amount: 30 });
    expect(bucket.byState[1]).toMatchObject({ count: 1, amount: 5 });
    expect(bucket.byState[2]).toMatchObject({ count: 1, amount: 7 });
  });

  test('a single-state bucket (e.g. state filter applied) has exactly one byState entry', () => {
    const orders = [
      { createdAt: '2026-04-01T10:00:00.000Z', state: 'payment_completed' },
      { createdAt: '2026-04-01T11:00:00.000Z', state: 'payment_completed' },
    ];
    const [bucket] = ordersPerPeriodBuckets(orders);
    expect(bucket.byState).toHaveLength(1);
    expect(bucket.byState[0].count).toBe(2);
  });
});

test.describe('ordersPerPeriodBuckets — week granularity', () => {
  test('buckets by Sunday-start week and steps by 7 days', () => {
    const orders = [
      { createdAt: '2026-01-06T10:00:00.000Z', total: '100' }, // Tuesday
      { createdAt: '2026-01-15T10:00:00.000Z', total: '50' }, // following Thursday
    ];
    // Sunday 2026-01-04 through the Saturday-inclusive end of the week containing Jan 15.
    const since = new Date(2026, 0, 4).toISOString();
    const until = new Date(2026, 0, 18).toISOString();
    const buckets = ordersPerPeriodBuckets(orders, { since, until }, 'week');

    expect(buckets.length).toBe(2);
    expect(buckets[0].periodStart).toBe('2026-01-04');
    expect(buckets[1].periodStart).toBe('2026-01-11');
    expect(buckets[0].count).toBe(1);
    expect(buckets[0].amount).toBe(100);
    expect(buckets[1].count).toBe(1);
    expect(buckets[1].amount).toBe(50);
  });
});

test.describe('ordersPerPeriodChartHtml', () => {
  test('renders an empty-state message for no buckets', () => {
    const html = ordersPerPeriodChartHtml([]);
    expect(html).toContain('orders-chart-empty');
    expect(html).toContain('No orders in the current view.');
  });

  test('renders one bar column per bucket with accessible order-count labels by default', () => {
    const buckets = [
      {
        periodStart: '2026-01-01', count: 0, amount: 0, byState: [],
      },
      {
        periodStart: '2026-01-02',
        count: 3,
        amount: 45,
        byState: [{
          state: 'payment_completed', badgeClass: 'orders-badge-success', count: 3, amount: 45,
        }],
      },
    ];
    const html = ordersPerPeriodChartHtml(buckets);
    expect((html.match(/orders-chart-bar-col/g) || []).length).toBe(2);
    expect(html).toContain('3 orders');
    expect(html).toContain('orders-chart');
  });

  test('renders revenue amounts with currency code in revenue metric mode', () => {
    const buckets = [
      {
        periodStart: '2026-01-01',
        count: 2,
        amount: 150.5,
        byState: [{
          state: 'payment_completed', badgeClass: 'orders-badge-success', count: 2, amount: 150.5,
        }],
      },
    ];
    const html = ordersPerPeriodChartHtml(buckets, { metric: 'revenue', currencyCode: 'CAD' });
    expect(html).toContain('$150.50 CAD');
    expect(html).not.toContain('2 orders');
  });

  test('week granularity shows a start–end range in the accessible label', () => {
    const buckets = [
      {
        periodStart: '2026-01-04',
        count: 5,
        amount: 0,
        byState: [{
          state: 'pending', badgeClass: 'orders-badge-pending', count: 5, amount: 0,
        }],
      },
    ];
    const html = ordersPerPeriodChartHtml(buckets, { granularity: 'week' });
    expect(html).toMatch(/Jan 4.*Jan 10/);
  });

  test('includes a screen-reader summary of total orders and periods', () => {
    const buckets = [
      {
        periodStart: '2026-02-01',
        count: 1,
        amount: 10,
        byState: [{
          state: 'pending', badgeClass: 'orders-badge-pending', count: 1, amount: 10,
        }],
      },
      {
        periodStart: '2026-02-02',
        count: 2,
        amount: 20,
        byState: [{
          state: 'pending', badgeClass: 'orders-badge-pending', count: 2, amount: 20,
        }],
      },
    ];
    const html = ordersPerPeriodChartHtml(buckets);
    expect(html).toContain('pim-sr-only');
    expect(html).toContain('3 orders across 2 days');
  });

  test('renders one colored segment per state, using STATE badge colors, when multiple states share a bucket', () => {
    const buckets = [
      {
        periodStart: '2026-03-01',
        count: 3,
        amount: 0,
        byState: [
          {
            state: 'payment_completed', badgeClass: 'orders-badge-success', count: 2, amount: 0,
          },
          {
            state: 'payment_cancelled', badgeClass: 'orders-badge-danger', count: 1, amount: 0,
          },
        ],
      },
    ];
    const html = ordersPerPeriodChartHtml(buckets);
    expect((html.match(/orders-chart-bar-segment/g) || []).length).toBe(2);
    // success segment is 2/3 of the bar; matches the STATE column badge text color.
    expect(html).toContain('height:67%;background:#78ae9e');
    // cancelled segment is 1/3 of the bar; matches the danger badge text color.
    expect(html).toContain('height:33%;background:#c48c7c');
    expect(html).toContain('payment completed: 2 orders');
    expect(html).toContain('payment cancelled: 1 order');
  });

  test('does not include a redundant breakdown in the tooltip for a single-state bucket', () => {
    const buckets = [
      {
        periodStart: '2026-03-01',
        count: 2,
        amount: 0,
        byState: [{
          state: 'payment_completed', badgeClass: 'orders-badge-success', count: 2, amount: 0,
        }],
      },
    ];
    const html = ordersPerPeriodChartHtml(buckets);
    expect(html).not.toContain('(payment completed:');
  });
});
