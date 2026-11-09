import { test, expect } from '@playwright/test';
import {
  ALWAYS_ON_MS,
  MAX_LABEL_ROWS,
  MIN_VISIBLE_MS,
  attachGifts,
  buildOverlayItems,
  classifyItem,
  labelEntries,
  layoutOverlay,
  localesForMarketKeys,
  marketsText,
  mergeOverlayItems,
  overlayLabelsHtml,
  overlayLayersHtml,
  overlayListHtml,
  overlayMarketKeys,
  overlaySpan,
  parseOverlayMode,
  placeLabels,
  shortTitle,
} from '../../tools/commerce-admin/promotion-overlay.js';
import {
  MARKET_LIVE_EVENTS,
  marketLiveEvents,
} from '../../tools/commerce-admin/orders-chart-events.js';
import {
  marketKeyForLocale,
  parseEasternDateTime,
} from '../../tools/commerce-admin/promotion-sources.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;

/** Schedule row as the loaders produce it; dates are authored (Eastern) strings. */
function row(source, where, label, start, end, extra = {}) {
  return {
    source,
    market: where.split('/')[0],
    where,
    label,
    detail: '',
    start: start ? parseEasternDateTime(start) : null,
    end: end ? parseEasternDateTime(end) : null,
    ...extra,
  };
}

const nav = (where, label, start, end, extra) => row('nav-banners', where, label, start, end, extra);
const gift = (where, label, start, end) => row('free-gifts', where, label, start, end);

/** Rows copied from the live documents (2026-11-08) that overlap Oct 8 to Nov 8, 2026. */
const US = 'us/en_us';
const CA_EN = 'ca/en_us';
const CA_FR = 'ca/fr_ca';
const SCREENSHOT_ROWS = [
  nav(US, 'Free Standard Shipping on Orders $150 or more.', '6/23/2025 9am', '12/31/2026 11:59pm'),
  nav(CA_EN, 'Free Standard Shipping on Orders $250 or more.', '6/23/2025 9am', '12/31/2026 11:59pm'),
  nav(US, 'Save Up to $180 on Vitamix Blenders', '10/2/2026 12am', '10/13/2026 11:59pm'),
  nav(CA_EN, 'Save Up to $180 on Vitamix Blenders', '10/2/2026 12am', '10/13/2026 11:59pm'),
  nav(CA_FR, 'Jusqu’à 180 $ d’économies', '10/2/2026 12am', '10/13/2026 11:59pm'),
  nav(US, 'Save Up to $250 on Vitamix Blenders', '10/4/2026 3am', '10/8/2026 2:59am'),
  nav(CA_EN, 'Save Up to $360 on Vitamix Blenders', '10/4/2026 3am', '10/8/2026 2:59am'),
  nav(CA_FR, 'Économisez jusqu’à 360 $', '10/4/2026 3am', '10/8/2026 2:59am'),
  gift(US, 'FREE Under Blade Scraper with purchase of $299.95 or more!', '10/4/2026 3am', '10/8/2026 2:59am'),
  nav(US, 'Up to $320 Off Select Reconditioned Blenders.', '10/14/2026 12am', '10/30/2026 11:59pm'),
  nav(US, 'Now Available: Vitamix MaxExtract™ Cold Press Juicer.', '10/31/2026 12am', '11/4/2026 11:59pm'),
  nav(CA_EN, 'Now Available: Vitamix MaxExtract™ Cold Press Juicer.', '10/15/2026 8am', '11/4/2026 11:59pm'),
  nav(CA_FR, 'Nouveau : Extracteur de jus à froid Vitamix MaxExtract™.', '10/15/2026 8am', '11/4/2026 11:59pm'),
  nav(US, 'Vitamix Holiday Sale: up to $220 Off!', '11/5/2026 12am', '11/10/2026 11:59pm'),
  nav(CA_EN, 'Vitamix Holiday Sale: up to $220 Off!', '11/5/2026 12am', '11/10/2026 11:59pm'),
  nav(CA_FR, 'Offre spéciale pour les fêtes : jusqu’à 220 $ de rabais !', '11/5/2026 12am', '11/10/2026 11:59pm'),
  gift(US, 'FREE Under Blade Scraper with purchase of $299.95 or more!', '11/5/2026 12am', '11/10/2026 11:59pm'),
];

/** Oct 8 00:00 Mountain (MDT) to Nov 9 00:00 Mountain (MST): the example's chart window. */
const MOUNTAIN_WINDOW = {
  startMs: Date.UTC(2026, 9, 8, 6, 0, 0),
  endMs: Date.UTC(2026, 10, 9, 7, 0, 0),
};

const item = (kind, start, end, markets = ['us'], label = 'Label') => ({
  id: `${kind}|${start ? start.getTime() : ''}|${end ? end.getTime() : ''}`,
  kind,
  markets,
  variants: markets.map((market) => ({ market, label })),
  start,
  end,
});

const at = (ms) => new Date(ms);

test.describe('parseOverlayMode', () => {
  test('keeps the three known modes and defaults to promotions without launches', () => {
    expect(parseOverlayMode('all')).toBe('all');
    expect(parseOverlayMode('promos')).toBe('promos');
    expect(parseOverlayMode(' OFF ')).toBe('off');
    expect(parseOverlayMode('')).toBe('promos');
    expect(parseOverlayMode(null)).toBe('promos');
    expect(parseOverlayMode('everything')).toBe('promos');
  });
});

test.describe('markets', () => {
  const available = ['ca-en', 'ca-fr', 'us'];

  test('All markets draws every available market that has a locale, in display order', () => {
    expect(overlayMarketKeys('', available)).toEqual(['us', 'ca-en', 'ca-fr']);
    expect(overlayMarketKeys('', ['mx', 'gb', 'us'])).toEqual(['us', 'mx']);
  });

  test('a single market, the combined ca option, and an unknown market', () => {
    expect(overlayMarketKeys('us', available)).toEqual(['us']);
    expect(overlayMarketKeys('ca', available)).toEqual(['ca-en', 'ca-fr']);
    expect(overlayMarketKeys('ca', ['ca-en', 'us'])).toEqual(['ca-en']);
    expect(overlayMarketKeys('gb', ['gb', 'us'])).toEqual([]);
  });

  test('maps market keys to storefront locale folders and back', () => {
    expect(localesForMarketKeys(['us', 'ca-en', 'ca-fr', 'mx']))
      .toEqual(['us/en_us', 'ca/en_us', 'ca/fr_ca', 'mx/es_mx']);
    expect(localesForMarketKeys(['gb'])).toEqual([]);
    expect(marketKeyForLocale('ca/fr_ca')).toBe('ca-fr');
    expect(marketKeyForLocale('de/de_de')).toBe('');
  });

  test('marketsText shows both Canadian store views as CA', () => {
    expect(marketsText(['us', 'ca-en', 'ca-fr'])).toBe('US · CA');
    expect(marketsText(['ca-fr', 'ca-en'])).toBe('CA');
    expect(marketsText(['ca-en'])).toBe('CA EN');
    expect(marketsText(['ca-fr', 'us'])).toBe('US · CA FR');
    expect(marketsText(['mx', 'gb'])).toBe('MX · GB');
  });
});

test.describe('shortTitle', () => {
  test('keeps the first sentence of a banner message', () => {
    expect(shortTitle('Save Up to $180 on Vitamix Blenders – Limited-Time Only! Shop Now.'))
      .toBe('Save Up to $180 on Vitamix Blenders');
    expect(shortTitle('Up to $320 Off Select Reconditioned Blenders. Reconditioned units offer…'))
      .toBe('Up to $320 Off Select Reconditioned Blenders');
    expect(shortTitle('Vitamix Holiday Sale: up to $220 Off! Get a head start.'))
      .toBe('Vitamix Holiday Sale: up to $220 Off');
    expect(shortTitle('Offre spéciale : jusqu’à 220 $ de rabais ! Prévoyez vos achats'))
      .toBe('Offre spéciale : jusqu’à 220 $ de rabais');
  });

  test('cuts long sentences at a word boundary, about 50 characters', () => {
    expect(shortTitle('Now Available: Vitamix MaxExtract™ Cold Press Juicer. Maximum Juice.'))
      .toBe('Now Available: Vitamix MaxExtract™ Cold Press…');
    expect(shortTitle('Free shipping', 5)).toBe('Free…');
    expect(shortTitle('')).toBe('');
  });
});

test.describe('classifyItem', () => {
  test('a standing banner (over 120 days) is always-on', () => {
    expect(classifyItem(nav(US, 'Free Standard Shipping on Orders $150 or more.', '6/23/2025 9am', '12/31/2026 11:59pm')))
      .toBe('always-on');
  });

  test('exactly 120 days is a promotion, one hour more is always-on', () => {
    const start = at(Date.UTC(2026, 0, 1));
    expect(classifyItem({ label: 'Sale', start, end: at(start.getTime() + ALWAYS_ON_MS) })).toBe('sale');
    expect(classifyItem({ label: 'Sale', start, end: at(start.getTime() + ALWAYS_ON_MS + HOUR) })).toBe('always-on');
  });

  test('a row with no start or no end is always-on', () => {
    expect(classifyItem({ label: 'Sale', start: null, end: at(1) })).toBe('always-on');
    expect(classifyItem({ label: 'Sale', start: at(1), end: null })).toBe('always-on');
  });

  test('announcements are launches in English and French', () => {
    const w = ['2/11/2026 12am', '2/12/2026 11:59pm'];
    expect(classifyItem(nav(US, 'Meet the new Vitamix® VX1™ .', ...w))).toBe('launch');
    expect(classifyItem(nav(US, 'Now Available: Vitamix Nano™.', ...w))).toBe('launch');
    expect(classifyItem(nav(US, 'Introducing the Ion', ...w))).toBe('launch');
    expect(classifyItem(nav(CA_FR, 'Nouveau : Vitamix Nano™.', ...w))).toBe('launch');
    expect(classifyItem(nav(CA_FR, 'Nouvelle gamme', ...w))).toBe('launch');
  });

  test('offers are sales, including ones that merely mention new products', () => {
    const w = ['10/2/2026 12am', '10/13/2026 11:59pm'];
    expect(classifyItem(nav(US, 'Save Up to $180 on Vitamix Blenders', ...w))).toBe('sale');
    expect(classifyItem(nav(US, 'Save on the new Vitamix Nano™', ...w))).toBe('sale');
    expect(classifyItem(nav(CA_FR, 'Jusqu’à 180 $ d’économies', ...w))).toBe('sale');
  });

  test('an explicit type cell overrides the heuristic', () => {
    const w = ['10/2/2026 12am', '10/13/2026 11:59pm'];
    expect(classifyItem(nav(US, 'Save Up to $180', ...w, { type: 'launch' }))).toBe('launch');
    expect(classifyItem(nav(US, 'Now Available: Nano', ...w, { type: 'sale' }))).toBe('sale');
    expect(classifyItem(nav(US, 'Save Up to $180', ...w, { type: 'info' }))).toBe('always-on');
    expect(classifyItem(nav(US, 'Save Up to $180', ...w, { type: 'hidden' }))).toBe('always-on');
    expect(classifyItem(nav(US, 'Save Up to $180', ...w, { type: 'whatever' }))).toBe('sale');
  });

  test('a dated free-gift row is a gift; an undated one (the empty ca/en_us row) is always-on', () => {
    expect(classifyItem(gift(US, 'FREE Under Blade Scraper', '8/13/2026 8am', '8/21/2026 3pm'))).toBe('gift');
    expect(classifyItem({
      source: 'free-gifts', label: '(no label)', start: null, end: null,
    })).toBe('always-on');
  });
});

test.describe('mergeOverlayItems / attachGifts / buildOverlayItems', () => {
  const all = ['us', 'ca-en', 'ca-fr'];

  test('rows with the same kind, start and end in several markets become one item', () => {
    const items = buildOverlayItems(SCREENSHOT_ROWS, { marketKeys: all, mode: 'all' });
    const b = items.find((i) => i.start.getTime() === parseEasternDateTime('10/4/2026 3am').getTime());
    expect(b.markets).toEqual(['us', 'ca-en', 'ca-fr']);
    expect(b.variants.map((v) => [v.market, v.label])).toEqual([
      ['us', 'Save Up to $250 on Vitamix Blenders'],
      ['ca-en', 'Save Up to $360 on Vitamix Blenders'],
      ['ca-fr', 'Économisez jusqu’à 360 $'],
    ]);
  });

  test('drops always-on rows, folds gifts into their sale, keeps launches in "all"', () => {
    const items = buildOverlayItems(SCREENSHOT_ROWS, { marketKeys: all, mode: 'all' });
    expect(items.map((i) => [i.kind, marketsText(i.markets), (i.gifts || []).length])).toEqual([
      ['sale', 'US · CA', 0], // 10/2 to 10/13
      ['sale', 'US · CA', 1], // 10/4 to 10/8, with the US scraper gift
      ['sale', 'US', 0], // 10/14 reconditioned
      ['launch', 'CA', 0], // 10/15 MaxExtract in Canada
      ['launch', 'US', 0], // 10/31 MaxExtract in the US
      ['sale', 'US · CA', 1], // 11/5 holiday, with the gift
    ]);
  });

  test('"promos" drops launches; "off" returns nothing', () => {
    const promos = buildOverlayItems(SCREENSHOT_ROWS, { marketKeys: all, mode: 'promos' });
    expect(promos.some((i) => i.kind === 'launch')).toBe(false);
    expect(promos).toHaveLength(4);
    expect(buildOverlayItems(SCREENSHOT_ROWS, { marketKeys: all, mode: 'off' })).toEqual([]);
  });

  test('only the markets in view are kept, and unknown locales are ignored', () => {
    const rows = [...SCREENSHOT_ROWS, nav('de/de_de', 'Sale', '10/2/2026 12am', '10/3/2026 12am')];
    const items = buildOverlayItems(rows, { marketKeys: ['ca-fr'], mode: 'all' });
    expect(items.every((i) => i.markets.join() === 'ca-fr')).toBe(true);
    expect(items).toHaveLength(4);
    expect(items.every((i) => !i.gifts)).toBe(true); // the gifts are US-only
  });

  test('two rows with the same window in one market keep both messages', () => {
    const start = at(Date.UTC(2026, 9, 1));
    const end = at(Date.UTC(2026, 9, 5));
    const merged = mergeOverlayItems([
      item('sale', start, end, ['us'], 'One'),
      item('sale', start, end, ['us'], 'Two'),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].variants.map((v) => v.label)).toEqual(['One', 'Two']);
  });

  test('a gift joins the sale whose window matches it best, not a longer one around it', () => {
    const d = (n) => at(Date.UTC(2026, 9, n));
    const long = item('sale', d(2), d(14), ['us'], 'Long');
    const match = item('sale', d(4), d(8), ['us'], 'Match');
    const g = item('gift', d(4), d(8), ['us'], 'Gift');
    const out = attachGifts([long, match, g]);
    expect(out).toHaveLength(2);
    expect(long.gifts).toBeUndefined();
    expect(match.gifts.map((x) => x.variants[0].label)).toEqual(['Gift']);
  });

  test('a gift with no sale in the same market, or mostly outside every sale, stays on its own', () => {
    const d = (n) => at(Date.UTC(2026, 9, n));
    const caSale = item('sale', d(4), d(8), ['ca-en'], 'CA sale');
    const usGift = item('gift', d(4), d(8), ['us'], 'US gift');
    const lateGift = item('gift', d(7), d(12), ['ca-en'], 'Late gift');
    const out = attachGifts([caSale, usGift, lateGift]);
    expect(out.map((i) => i.variants[0].label)).toEqual(['CA sale', 'US gift', 'Late gift']);
    expect(caSale.gifts).toBeUndefined();
  });
});

test.describe('overlaySpan', () => {
  const win = { startMs: 0, endMs: 100 * DAY };

  test('positions a period inside the window as percentages', () => {
    const span = overlaySpan(item('sale', at(10 * DAY), at(30 * DAY)), win);
    expect(span.leftPct).toBeCloseTo(10, 6);
    expect(span.widthPct).toBeCloseTo(20, 6);
    expect(span.clippedStart).toBe(false);
    expect(span.clippedEnd).toBe(false);
  });

  test('clips at both edges and marks the clipped sides', () => {
    const span = overlaySpan(item('sale', at(-5 * DAY), at(150 * DAY)), win);
    expect(span.leftPct).toBe(0);
    expect(span.widthPct).toBeCloseTo(100, 6);
    expect(span.clippedStart).toBe(true);
    expect(span.clippedEnd).toBe(true);
  });

  test('is null outside the window and for slivers under six hours', () => {
    expect(MIN_VISIBLE_MS).toBe(6 * HOUR);
    expect(overlaySpan(item('sale', at(-10 * DAY), at(0)), win)).toBeNull();
    expect(overlaySpan(item('sale', at(200 * DAY), at(210 * DAY)), win)).toBeNull();
    expect(overlaySpan(item('sale', at(-10 * DAY), at(5 * HOUR)), win)).toBeNull();
    expect(overlaySpan(item('sale', at(-10 * DAY), at(6 * HOUR)), win)).not.toBeNull();
    expect(overlaySpan(item('sale', at(50 * DAY), at(50 * DAY + 3 * HOUR)), win)).toBeNull();
  });
});

test.describe('market go-live events', () => {
  test('marketLiveEvents returns the events of the markets in view, ascending', () => {
    expect(marketLiveEvents(['us', 'ca-en', 'ca-fr']).map((e) => e.market)).toEqual(['ca-fr', 'ca-en', 'us']);
    expect(marketLiveEvents(['us']).map((e) => e.market)).toEqual(['us']);
    expect(marketLiveEvents(['mx'])).toEqual([]);
  });

  test('every event has a valid instant and the text the chart draws', () => {
    MARKET_LIVE_EVENTS.forEach((e) => {
      expect(Number.isNaN(new Date(e.at).getTime())).toBe(false);
      expect(e.label).toBeTruthy();
      expect(e.chartLabel).toBeTruthy();
      expect(e.note).toBeTruthy();
      expect(e.ref).toBeTruthy();
    });
  });
});

test.describe('layoutOverlay — the Oct 8 to Nov 8 example in a Mountain-time browser', () => {
  const marketKeys = ['us', 'ca-en', 'ca-fr'];
  const items = buildOverlayItems(SCREENSHOT_ROWS, { marketKeys, mode: 'all' });
  const layout = layoutOverlay({ items, marketKeys, win: MOUNTAIN_WINDOW });
  const at46140 = (min) => (min / 46140) * 100; // minutes into the 32-day window

  test('draws three bands; the Oct 4–8 sale (59 minutes in view) is dropped', () => {
    expect(layout.bands.map((b) => b.title)).toEqual([
      'Save Up to $180 on Vitamix Blenders',
      'Up to $320 Off Select Reconditioned Blenders',
      'Vitamix Holiday Sale: up to $220 Off',
    ]);
  });

  test('positions bands from their Eastern instants, not from bar columns', () => {
    const [a, recon, holiday] = layout.bands;
    // 10/2 to 10/13 11:59pm ET = 21:59 Mountain on Oct 13.
    expect(a.leftPct).toBe(0);
    expect(a.clippedStart).toBe(true);
    expect(a.widthPct).toBeCloseTo(at46140(8519), 4);
    // 10/14 12am ET = 22:00 Mountain on Oct 13, one minute after the first band ends.
    expect(recon.leftPct).toBeCloseTo(at46140(8520), 4);
    // 11/5 12am ET = 22:00 Mountain on Nov 4: 91.7% of the way through the Nov 4 day bar.
    expect(holiday.leftPct).toBeCloseTo(at46140(40260), 4);
    expect(holiday.clippedEnd).toBe(true);
    expect(holiday.leftPct + holiday.widthPct).toBeCloseTo(100, 6);
    expect(holiday.item.gifts).toHaveLength(1);
  });

  test('draws launches at their start, as moments', () => {
    expect(layout.launches.map((l) => marketsText(l.item.markets))).toEqual(['CA', 'US']);
    expect(layout.launches[0].leftPct).toBeCloseTo(at46140(10440), 4); // 10/15 8am ET
    expect(layout.launches[1].leftPct).toBeCloseTo(at46140(33000), 4); // 10/31 12am ET
  });

  test('draws the US go-live, and stripes the window up to it', () => {
    expect(layout.events.map((e) => e.event.market)).toEqual(['us']);
    const goLive = at46140((Date.parse('2026-10-15T16:04:09-04:00') - MOUNTAIN_WINDOW.startMs) / 60000);
    expect(layout.events[0].leftPct).toBeCloseTo(goLive, 6);
    expect(layout.stripes.widthPct).toBeCloseTo(goLive, 6);
    expect(layout.stripes.events.map((e) => e.market)).toEqual(['us']);
  });

  test('a market whose go-live is before the window has no stripes', () => {
    const ca = layoutOverlay({ items, marketKeys: ['ca-en', 'ca-fr'], win: MOUNTAIN_WINDOW });
    expect(ca.events).toEqual([]);
    expect(ca.stripes).toBeNull();
  });

  test('uses the message of the selected market, falling back to the first', () => {
    const fr = layoutOverlay({
      items, marketKeys: ['ca-fr'], win: MOUNTAIN_WINDOW, filterValue: 'ca-fr',
    });
    expect(fr.bands[0].title).toBe('Jusqu’à 180 $ d’économies');
    expect(layout.bands[0].title).toBe('Save Up to $180 on Vitamix Blenders');
  });

  test('labelEntries lists bands and launches in time order', () => {
    expect(labelEntries(layout).map((e) => e.item.kind)).toEqual(['sale', 'sale', 'launch', 'launch', 'sale']);
  });
});

test.describe('placeLabels', () => {
  const entries = (pcts) => pcts.map((leftPct, i) => ({ leftPct, id: i }));
  const fixed = (w) => () => w;

  test('fills the first free row left to right and keeps labels inside the edge', () => {
    const placed = placeLabels(entries([0, 18.465, 22.627, 71.52, 87.27]), 1000, fixed(200));
    expect(placed.map((p) => p.row)).toEqual([0, 1, 0, 0, 1]);
    expect(placed.map((p) => Math.round(p.x))).toEqual([0, 185, 226, 715, 800]);
    expect(placed.every((p) => p.maxWidth === 200)).toBe(true);
  });

  test('uses at most three rows; a fourth crowded label starts after the first row to free up', () => {
    expect(MAX_LABEL_ROWS).toBe(3);
    const placed = placeLabels(entries([10, 10, 10, 10]), 1000, fixed(150));
    expect(placed.map((p) => p.row)).toEqual([0, 1, 2, 0]);
    expect(placed[3].x).toBe(260);
    expect(placed[3].maxWidth).toBe(150);
  });

  test('a label wider than the chart is limited to the chart width', () => {
    const [p] = placeLabels(entries([50]), 300, fixed(900));
    expect(p.x).toBe(0);
    expect(p.maxWidth).toBe(300);
  });
});

test.describe('HTML', () => {
  const marketKeys = ['us', 'ca-en', 'ca-fr'];
  const items = buildOverlayItems(SCREENSHOT_ROWS, { marketKeys, mode: 'all' });
  const layout = layoutOverlay({ items, marketKeys, win: MOUNTAIN_WINDOW });
  const labels = overlayLabelsHtml(placeLabels(labelEntries(layout), 1200, () => 220));
  const { back, front } = overlayLayersHtml(layout);

  test('labels: one per band and launch, with markets, gift tag, and ticks except at a clipped start', () => {
    expect(labels).toContain('aria-hidden="true"');
    expect(labels.match(/class="orders-chart-label orders-chart-label-/g)).toHaveLength(5);
    expect(labels.match(/orders-chart-label-launch"/g)).toHaveLength(2);
    expect(labels.match(/class="orders-chart-label-tick /g)).toHaveLength(4);
    expect(labels).toContain('Vitamix Holiday Sale: up to $220 Off<span class="orders-chart-label-markets"> · US · CA</span><span class="orders-chart-gift-tag">+ free gift</span>');
    expect(labels).toMatch(/title="Launch: Now Available/);
  });

  test('tooltips give Eastern times, markets, each market\'s own message, and the gift', () => {
    expect(labels).toMatch(/title="Vitamix Holiday Sale: up to \$220 Off!\n/);
    expect(labels).toContain('11/5/2026, 12:00 AM EST');
    expect(labels).toContain('Markets: US · CA');
    expect(labels).toContain('CA FR: Offre spéciale pour les fêtes');
    expect(labels).toContain('Free gift: FREE Under Blade Scraper with purchase of $299.95 or more!');
  });

  test('back layer: stripes and one band per promotion, with start and end edges', () => {
    expect(back).toContain('class="orders-chart-annot orders-chart-annot-back"');
    expect(back.match(/class="orders-chart-stripes"/g)).toHaveLength(1);
    expect(back.match(/class="orders-chart-band /g)).toHaveLength(3);
    expect(back).toContain('class="orders-chart-band orders-chart-band-sale orders-chart-band-end"');
    expect(back).toContain('class="orders-chart-band orders-chart-band-sale orders-chart-band-start"');
    expect(back).toContain('US checkout was not on Edge checkout');
  });

  test('front layer: launch lines, the go-live line and its label', () => {
    expect(front.match(/class="orders-chart-launch-line"/g)).toHaveLength(2);
    expect(front.match(/class="orders-chart-event-line"/g)).toHaveLength(1);
    expect(front).toMatch(/class="orders-chart-event-pill" style="left:calc\([\d.]+% \+ 6px\)"[^>]*>US orders start</);
  });

  test('an event near the right edge puts its label on the left of the line', () => {
    const late = layoutOverlay({
      items: [], marketKeys: ['us'], win: { startMs: Date.parse('2026-10-01T00:00:00Z'), endMs: Date.parse('2026-10-16T00:00:00Z') },
    });
    expect(overlayLayersHtml(late).front).toMatch(/orders-chart-event-pill" style="right:calc\(/);
  });

  test('nothing to draw gives empty layers, labels and list', () => {
    const empty = layoutOverlay({ items: [], marketKeys: ['mx'], win: MOUNTAIN_WINDOW });
    expect(overlayLayersHtml(empty)).toEqual({ back: '', front: '' });
    expect(overlayLabelsHtml([])).toBe('');
    expect(overlayListHtml(empty)).toBe('');
  });

  test('list: collapsed by default, counts in the summary, every annotation in time order', () => {
    const list = overlayListHtml(layout);
    expect(list).toMatch(/^<details class="orders-chart-annotations">/);
    expect(list).toContain('<summary>3 promotions, 2 launches, 1 checkout change in this range</summary>');
    const whens = [...list.matchAll(/orders-chart-list-when">([^<]*)</g)].map((m) => m[1]);
    expect(whens).toEqual([
      'Striped', 'Oct 2 – Oct 13', 'Oct 14 – Oct 30', 'Oct 15', 'Oct 15, 4:04 PM EDT', 'Oct 31', 'Nov 5 – Nov 10',
    ]);
    expect(list).toContain('Launch: Now Available: Vitamix MaxExtract™ Cold Press Juicer');
    expect(list).toContain('Edge checkout live (US): US orders appear in this chart from here');
    expect(list).toContain('+ free gift');
  });

  test('list: open when asked, and one item reads in the singular', () => {
    expect(overlayListHtml(layout, { open: true })).toMatch(/^<details class="orders-chart-annotations" open>/);
    const one = layoutOverlay({
      items: items.slice(2, 3), marketKeys: ['us'], win: MOUNTAIN_WINDOW, events: [],
    });
    expect(overlayListHtml(one)).toContain('<summary>1 promotion in this range</summary>');
  });

  test('escapes message text everywhere', () => {
    const evil = [item('sale', at(MOUNTAIN_WINDOW.startMs + DAY), at(MOUNTAIN_WINDOW.startMs + 2 * DAY), ['us'], '<img src=x onerror=alert(1)> "q"')];
    const l = layoutOverlay({
      items: evil, marketKeys: ['us'], win: MOUNTAIN_WINDOW, events: [],
    });
    const html = overlayLabelsHtml(placeLabels(labelEntries(l), 1000, () => 100))
      + overlayLayersHtml(l).back + overlayListHtml(l);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &quot;q&quot;');
  });
});
