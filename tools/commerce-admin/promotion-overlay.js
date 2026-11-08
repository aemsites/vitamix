/**
 * Promotion overlay for the commerce-admin orders chart.
 *
 * Turns the storefront's promotion schedule (nav banners and free gifts, see
 * `promotion-sources.js`) and market go-live events (`orders-chart-events.js`) into chart
 * annotations, following the usual conventions for annotating a time series:
 *
 * - a promotion (a period) is a light band behind the bars, labelled at its start above the chart;
 * - a launch or a checkout go-live (a moment) is a vertical line on top of the bars;
 * - the time before a market's go-live is striped, because its orders were not in the chart yet;
 * - a list below the chart (collapsed by default) repeats every annotation in text.
 *
 * Bands and lines are positioned by absolute instant against the chart's time window, not
 * snapped to bar columns: the chart buckets by browser-local day while the schedule is authored
 * in Eastern time. Everything except {@link loadOverlaySchedule} and {@link wireOverlayHover} is
 * pure, so it can be unit tested without a DOM.
 */
import { escapeHtml } from './commerce-otp-ui.js';
import { ET_TIMEZONE, formatInstantInEastern } from './commerce-eastern-time.js';
import {
  MARKET_LOCALES,
  loadFreeGifts,
  loadNavBanners,
  marketKeyForLocale,
} from './promotion-sources.js';
import { MARKET_LIVE_EVENTS, marketLiveEvents } from './orders-chart-events.js';

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

/** Windows longer than this (the free-shipping banner) are standing messages, not promotions. */
export const ALWAYS_ON_MS = 120 * DAY_MS;

/** A promotion with less time than this inside the chart would be a sliver at the edge: skip it. */
export const MIN_VISIBLE_MS = 6 * HOUR_MS;

/** Label rows above the chart; further labels share a row and are shortened. */
export const MAX_LABEL_ROWS = 3;
const LABEL_ROW_PX = 20;
const LABEL_GAP_PX = 10;

/** Short titles follow the usual guidance of about 50 characters, one sentence. */
const TITLE_MAX = 50;
const LIST_TITLE_MAX = 90;

/** `promos` = promotions without launches (default), `all` = with launches, `off` = nothing. */
export const OVERLAY_MODES = ['promos', 'all', 'off'];

/** Display order of market keys. */
const MARKET_ORDER = ['us', 'ca-en', 'ca-fr', 'mx'];
const KIND_ORDER = { sale: 0, gift: 1, launch: 2 };

/** Opening words of a launch announcement (English and French, as authored today). */
const LAUNCH_RE = /^(now available|meet the new|introducing|nouveau|nouvelle)\b/i;

/**
 * @param {string|null|undefined} value `overlay` URL param
 * @returns {'promos'|'all'|'off'} unknown or missing values fall back to `promos`
 */
export function parseOverlayMode(value) {
  const v = String(value || '').trim().toLowerCase();
  return OVERLAY_MODES.includes(v) ? v : 'promos';
}

/**
 * Chart market filter value → market keys the overlay draws.
 *
 * @param {string} filterValue Market select value: '' (all), `ca`, or a market key
 * @param {string[]} availableKeys market keys present in the loaded orders
 * @returns {string[]} keys that have a locale mapping, in display order
 */
export function overlayMarketKeys(filterValue, availableKeys) {
  const known = (k) => Boolean(MARKET_LOCALES[k]);
  let keys;
  if (!filterValue) keys = availableKeys.filter(known);
  else if (filterValue === 'ca') keys = ['ca-en', 'ca-fr'].filter((k) => availableKeys.includes(k));
  else keys = known(filterValue) ? [filterValue] : [];
  return MARKET_ORDER.filter((k) => keys.includes(k));
}

/**
 * @param {string[]} marketKeys
 * @returns {string[]} storefront locale folders to read
 */
export function localesForMarketKeys(marketKeys) {
  return marketKeys.flatMap((k) => MARKET_LOCALES[k] || []);
}

/**
 * `US · CA` for display. Both Canadian store views together read as `CA`.
 * @param {string[]} markets chart market keys
 */
export function marketsText(markets) {
  const hasEn = markets.includes('ca-en');
  const hasFr = markets.includes('ca-fr');
  const names = [];
  MARKET_ORDER.concat(markets.filter((m) => !MARKET_ORDER.includes(m))).forEach((m) => {
    if (!markets.includes(m)) return;
    if (m === 'us') names.push('US');
    else if (m === 'ca-en') names.push(hasFr ? 'CA' : 'CA EN');
    else if (m === 'ca-fr') { if (!hasEn) names.push('CA FR'); } else names.push(m.toUpperCase());
  });
  return names.join(' · ');
}

/**
 * First sentence of a banner message, shortened at a word boundary.
 * @param {string} text
 * @param {number} [max]
 */
export function shortTitle(text, max = TITLE_MAX) {
  const first = String(text || '').split(/\s[–—-]\s|[.!?](?:\s|$)/)[0].trim();
  if (first.length <= max) return first;
  return `${first.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

/**
 * Kind of a schedule row. An explicit `type` cell wins; otherwise open-ended or very long rows
 * are `always-on`, announcements are `launch`, and everything else is a `sale`.
 *
 * @param {{ label?: string, start: Date|null, end: Date|null, type?: string, source?: string }} row
 * @returns {'sale'|'gift'|'launch'|'always-on'}
 */
export function classifyItem(row) {
  const type = String(row.type || '').trim().toLowerCase();
  if (type === 'info' || type === 'hidden') return 'always-on';
  const isGift = row.source === 'free-gifts';
  if (type === 'sale' || type === 'launch') return isGift ? 'gift' : type;
  if (!row.start || !row.end || row.end - row.start > ALWAYS_ON_MS) return 'always-on';
  if (isGift) return 'gift';
  return LAUNCH_RE.test(String(row.label || '').trim()) ? 'launch' : 'sale';
}

/**
 * @typedef {object} OverlayItem
 * @property {string} id `${kind}|${startMs}|${endMs}`
 * @property {'sale'|'gift'|'launch'} kind
 * @property {string[]} markets chart market keys
 * @property {{ market: string, label: string }[]} variants one message per market
 * @property {Date} start
 * @property {Date} end
 * @property {OverlayItem[]} [gifts] free-gift offers that run with this sale
 */

/**
 * Collapses items with the same kind, start and end across markets into one item that lists
 * every market and keeps each market's message. Sorted by start, then sale, gift, launch.
 *
 * @param {OverlayItem[]} items
 * @returns {OverlayItem[]}
 */
export function mergeOverlayItems(items) {
  const merged = new Map();
  items.forEach((item) => {
    const existing = merged.get(item.id);
    if (!existing) {
      merged.set(item.id, { ...item, markets: [...item.markets], variants: [...item.variants] });
      return;
    }
    item.markets.forEach((m) => {
      if (!existing.markets.includes(m)) existing.markets.push(m);
    });
    existing.variants.push(...item.variants);
  });
  return [...merged.values()]
    .map((i) => ({
      ...i,
      markets: MARKET_ORDER.filter((m) => i.markets.includes(m))
        .concat(i.markets.filter((m) => !MARKET_ORDER.includes(m))),
      variants: [...i.variants].sort(
        (a, b) => MARKET_ORDER.indexOf(a.market) - MARKET_ORDER.indexOf(b.market),
      ),
    }))
    .sort((a, b) => a.start - b.start || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.end - b.end);
}

/** Share of `inner`'s duration that falls inside `outer`. */
function overlapRatio(inner, outer) {
  const overlap = Math.min(inner.end, outer.end) - Math.max(inner.start, outer.start);
  const length = inner.end - inner.start;
  return length > 0 ? Math.max(0, overlap) / length : 0;
}

/**
 * Folds a free-gift offer into the sale it runs with, so it shows as a tag on that sale. A sale
 * qualifies when it shares a market and holds at least 80% of the gift's time; of those, the one
 * whose length is closest to the gift's wins (a gift that ran Oct 4–8 belongs to the Oct 4–8
 * sale, not to a longer sale around it). Gifts without a sale stay items of their own.
 *
 * @param {OverlayItem[]} items
 * @returns {OverlayItem[]}
 */
export function attachGifts(items) {
  const sales = items.filter((i) => i.kind === 'sale');
  const out = [];
  items.forEach((item) => {
    if (item.kind !== 'gift') {
      out.push(item);
      return;
    }
    const length = (i) => i.end - i.start;
    const host = sales
      .filter((s) => s.markets.some((m) => item.markets.includes(m)))
      .filter((s) => overlapRatio(item, s) >= 0.8)
      .sort((a, b) => Math.abs(length(a) - length(item)) - Math.abs(length(b) - length(item)))[0];
    if (host) host.gifts = [...(host.gifts || []), item];
    else out.push(item);
  });
  return out;
}

/**
 * Schedule rows → overlay items for the markets in view: classify, drop always-on rows, drop
 * rows outside the selected markets, apply the mode, merge across markets and attach gifts.
 *
 * @param {import('./promotion-sources.js').ScheduleItem[]} scheduleItems
 * @param {{ marketKeys: string[], mode: 'all'|'promos'|'off' }} opts
 * @returns {OverlayItem[]}
 */
export function buildOverlayItems(scheduleItems, { marketKeys, mode }) {
  if (mode === 'off') return [];
  const items = [];
  scheduleItems.forEach((row) => {
    const market = marketKeyForLocale(row.where);
    if (!market || !marketKeys.includes(market)) return;
    const kind = classifyItem(row);
    if (kind === 'always-on') return;
    if (kind === 'launch' && mode !== 'all') return;
    items.push({
      id: `${kind}|${row.start.getTime()}|${row.end.getTime()}`,
      kind,
      markets: [market],
      variants: [{ market, label: row.label }],
      start: row.start,
      end: row.end,
    });
  });
  return attachGifts(mergeOverlayItems(items));
}

/**
 * @typedef {object} ChartWindow
 * @property {number} startMs first bucket's local midnight
 * @property {number} endMs end of the last bucket
 */

/**
 * Position of a period on the chart's time axis.
 *
 * @param {{ start: Date, end: Date }} item
 * @param {ChartWindow} win
 * @returns {{ leftPct: number, widthPct: number, clippedStart: boolean, clippedEnd: boolean }|null}
 *   null when less than {@link MIN_VISIBLE_MS} of it falls inside the window
 */
export function overlaySpan(item, win) {
  const s = item.start.getTime();
  const e = item.end.getTime();
  const left = Math.max(s, win.startMs);
  const right = Math.min(e, win.endMs);
  if (right - left < MIN_VISIBLE_MS) return null;
  const total = win.endMs - win.startMs;
  return {
    leftPct: ((left - win.startMs) / total) * 100,
    widthPct: ((right - left) / total) * 100,
    clippedStart: s < win.startMs,
    clippedEnd: e > win.endMs,
  };
}

/** Position of a moment, or null when it falls outside the window. */
function pointPct(ms, win) {
  if (ms < win.startMs || ms >= win.endMs) return null;
  return ((ms - win.startMs) / (win.endMs - win.startMs)) * 100;
}

/**
 * @typedef {object} OverlayLayout
 * @property {{ item: OverlayItem, label: string, title: string, leftPct: number,
 *   widthPct: number, clippedStart: boolean, clippedEnd: boolean }[]} bands sales and gifts
 * @property {{ item: OverlayItem, label: string, title: string, leftPct: number }[]} launches
 * @property {{ event: import('./orders-chart-events.js').MarketLiveEvent, leftPct: number }[]}
 *   events go-live moments inside the window
 * @property {{ widthPct: number, events: import('./orders-chart-events.js').MarketLiveEvent[] }
 *   | null} stripes from the window start to the last go-live inside it
 */

/** Message to show for an item under the current Market filter. */
function labelForFilter(item, filterValue) {
  const variant = item.variants.find((v) => v.market === filterValue) || item.variants[0];
  return variant ? variant.label : '';
}

/**
 * Places items and events on the chart's time axis.
 *
 * @param {{
 *   items: OverlayItem[],
 *   marketKeys: string[],
 *   win: ChartWindow,
 *   filterValue?: string,
 *   events?: import('./orders-chart-events.js').MarketLiveEvent[],
 * }} params
 * @returns {OverlayLayout}
 */
export function layoutOverlay({
  items, marketKeys, win, filterValue = '', events = MARKET_LIVE_EVENTS,
}) {
  const bands = [];
  const launches = [];
  items.forEach((item) => {
    const label = labelForFilter(item, filterValue);
    const title = shortTitle(label);
    if (item.kind === 'launch') {
      const leftPct = pointPct(item.start.getTime(), win);
      if (leftPct !== null) {
        launches.push({
          item, label, title, leftPct,
        });
      }
      return;
    }
    const span = overlaySpan(item, win);
    if (span) {
      bands.push({
        item, label, title, ...span,
      });
    }
  });
  const inView = marketLiveEvents(marketKeys, events)
    .map((event) => ({ event, leftPct: pointPct(new Date(event.at).getTime(), win) }))
    .filter((e) => e.leftPct !== null);
  const last = inView[inView.length - 1];
  return {
    bands,
    launches,
    events: inView,
    stripes: last ? { widthPct: last.leftPct, events: inView.map((e) => e.event) } : null,
  };
}

/** Annotations that get a label above the chart, in time order. */
export function labelEntries(layout) {
  return [...layout.bands, ...layout.launches].sort((a, b) => a.leftPct - b.leftPct);
}

/**
 * Lays labels out left to right in the first row where they fit (at most
 * {@link MAX_LABEL_ROWS}). A label near the right edge ends at the edge. When no row is free, the
 * label starts after the row that frees up first and is shortened to fit.
 *
 * @template {{ leftPct: number }} T
 * @param {T[]} entries in time order
 * @param {number} widthPx width of the label area
 * @param {(entry: T) => number} measure natural label width in px
 * @returns {(T & { row: number, x: number, maxWidth: number })[]}
 */
export function placeLabels(entries, widthPx, measure) {
  const rowEnds = [];
  return entries.map((entry) => {
    const width = Math.min(measure(entry), widthPx);
    const x = Math.max(0, Math.min((entry.leftPct / 100) * widthPx, widthPx - width));
    let row = rowEnds.findIndex((end) => x >= end + LABEL_GAP_PX);
    if (row === -1 && rowEnds.length < MAX_LABEL_ROWS) row = rowEnds.length;
    if (row !== -1) {
      rowEnds[row] = x + width;
      return {
        ...entry, row, x, maxWidth: width,
      };
    }
    row = rowEnds.indexOf(Math.min(...rowEnds));
    const shifted = Math.min(rowEnds[row] + LABEL_GAP_PX, Math.max(0, widthPx - 60));
    const maxWidth = Math.max(60, Math.min(width, widthPx - shifted));
    rowEnds[row] = shifted + maxWidth;
    return {
      ...entry, row, x: shifted, maxWidth,
    };
  });
}

/** `Oct 4` in Eastern time. */
function etDay(date) {
  return date.toLocaleDateString('en-US', { timeZone: ET_TIMEZONE, month: 'short', day: 'numeric' });
}

function easternText(date) {
  return formatInstantInEastern(date.toISOString());
}

/** `Oct 15, 4:04 PM EDT`: a moment in Eastern time, short enough for the list. */
function etMoment(date) {
  return date.toLocaleString('en-US', {
    timeZone: ET_TIMEZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

/** Full text for tooltips and the list: message, Eastern times, markets, per-market wording. */
function itemDetail(item, label) {
  const lines = [
    `${item.kind === 'launch' ? 'Launch: ' : ''}${label}`,
    `${easternText(item.start)} → ${easternText(item.end)}`,
    `Markets: ${marketsText(item.markets)}`,
  ];
  const labels = new Set(item.variants.map((v) => v.label));
  if (labels.size > 1) {
    item.variants.forEach((v) => lines.push(`${marketsText([v.market])}: ${v.label}`));
  }
  (item.gifts || []).forEach((g) => lines.push(`Free gift: ${g.variants[0].label}`));
  return lines.join('\n');
}

function eventDetail(event) {
  return `${event.label}\n${easternText(new Date(event.at))}\n${event.note}\n${event.ref}`;
}

function stripesDetail(stripes) {
  const names = marketsText(stripes.events.map((e) => e.market));
  const until = stripes.events[stripes.events.length - 1];
  return `Before ${etMoment(new Date(until.at))}, ${names} checkout was not on Edge checkout,`
    + ` so few ${names} orders are in this chart.`;
}

const pct = (n) => `${Number(n.toFixed(3))}%`;
const giftTag = (item) => (item.gifts?.length ? '<span class="orders-chart-gift-tag">+ free gift</span>' : '');

/**
 * Label rows above the chart. Decorative duplicates of the list below the chart, so hidden from
 * assistive technology.
 *
 * @param {ReturnType<typeof placeLabels>} placed
 * @returns {string}
 */
export function overlayLabelsHtml(placed) {
  if (!placed.length) return '';
  const rows = Math.max(...placed.map((p) => p.row)) + 1;
  const height = rows * LABEL_ROW_PX + 2;
  const html = placed.map((p) => {
    const { kind } = p.item;
    const tick = p.clippedStart ? ''
      : `<div class="orders-chart-label-tick orders-chart-label-tick-${kind}" style="left:${pct(p.leftPct)};`
        + `top:${p.row * LABEL_ROW_PX + 18}px;height:${height - p.row * LABEL_ROW_PX - 18}px"></div>`;
    return `<div class="orders-chart-label orders-chart-label-${kind}" data-overlay-id="${escapeHtml(p.item.id)}"`
      + ` style="left:${Math.round(p.x)}px;top:${p.row * LABEL_ROW_PX}px;max-width:${Math.round(p.maxWidth)}px"`
      + ` title="${escapeHtml(itemDetail(p.item, p.label))}">${escapeHtml(p.title)}`
      + `<span class="orders-chart-label-markets"> · ${escapeHtml(marketsText(p.item.markets))}</span>`
      + `${giftTag(p.item)}</div>${tick}`;
  }).join('');
  return `<div class="orders-chart-labels" aria-hidden="true" style="height:${height}px">${html}</div>`;
}

/**
 * Layers drawn inside the chart: `back` (stripes and bands) goes behind the bars, `front`
 * (launch and go-live lines) on top of them.
 *
 * @param {OverlayLayout} layout
 * @returns {{ back: string, front: string }}
 */
export function overlayLayersHtml(layout) {
  const stripes = layout.stripes
    ? `<div class="orders-chart-stripes" style="width:${pct(layout.stripes.widthPct)}"`
      + ` title="${escapeHtml(stripesDetail(layout.stripes))}"></div>` : '';
  const bands = layout.bands.map((b) => {
    const classes = ['orders-chart-band', `orders-chart-band-${b.item.kind}`,
      b.clippedStart ? '' : 'orders-chart-band-start', b.clippedEnd ? '' : 'orders-chart-band-end']
      .filter(Boolean).join(' ');
    return `<div class="${classes}" data-overlay-id="${escapeHtml(b.item.id)}"`
      + ` style="left:${pct(b.leftPct)};width:${pct(b.widthPct)}" title="${escapeHtml(itemDetail(b.item, b.label))}"></div>`;
  }).join('');
  const launches = layout.launches.map((l) => `<div class="orders-chart-launch-line" data-overlay-id="${escapeHtml(l.item.id)}"`
    + ` style="left:${pct(l.leftPct)}"></div>`).join('');
  const events = layout.events.map(({ event, leftPct }) => {
    const side = leftPct > 75 ? `right:calc(${pct(100 - leftPct)} + 6px)` : `left:calc(${pct(leftPct)} + 6px)`;
    return `<div class="orders-chart-event-line" style="left:${pct(leftPct)}"></div>`
      + `<div class="orders-chart-event-pill" style="${side}" title="${escapeHtml(eventDetail(event))}">`
      + `${escapeHtml(event.chartLabel)}</div>`;
  }).join('');
  return {
    back: stripes || bands ? `<div class="orders-chart-annot orders-chart-annot-back" aria-hidden="true">${stripes}${bands}</div>` : '',
    front: launches || events ? `<div class="orders-chart-annot orders-chart-annot-front" aria-hidden="true">${launches}${events}</div>` : '',
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The annotations as a list below the chart, in a `<details>` that is collapsed unless `open`.
 * This is the accessible version of everything drawn on the chart.
 *
 * @param {OverlayLayout} layout
 * @param {{ open?: boolean }} [opts]
 * @returns {string} empty when there is nothing to list
 */
export function overlayListHtml(layout, { open = false } = {}) {
  const rows = [];
  layout.bands.forEach((b) => rows.push({
    at: b.item.start.getTime(),
    html: `<li data-overlay-id="${escapeHtml(b.item.id)}" title="${escapeHtml(itemDetail(b.item, b.label))}">`
      + `<span class="orders-chart-swatch orders-chart-swatch-${b.item.kind}" aria-hidden="true"></span>`
      + `<span class="orders-chart-list-when">${escapeHtml(`${etDay(b.item.start)} – ${etDay(b.item.end)}`)}</span>`
      + `<span class="orders-chart-list-what">${escapeHtml(shortTitle(b.label, LIST_TITLE_MAX))}${giftTag(b.item)}</span>`
      + `<span class="orders-chart-list-markets">${escapeHtml(marketsText(b.item.markets))}</span></li>`,
  }));
  layout.launches.forEach((l) => rows.push({
    at: l.item.start.getTime(),
    html: `<li data-overlay-id="${escapeHtml(l.item.id)}" title="${escapeHtml(itemDetail(l.item, l.label))}">`
      + '<span class="orders-chart-swatch orders-chart-swatch-launch" aria-hidden="true"></span>'
      + `<span class="orders-chart-list-when">${escapeHtml(etDay(l.item.start))}</span>`
      + `<span class="orders-chart-list-what">Launch: ${escapeHtml(shortTitle(l.label, LIST_TITLE_MAX))}</span>`
      + `<span class="orders-chart-list-markets">${escapeHtml(marketsText(l.item.markets))}</span></li>`,
  }));
  layout.events.forEach(({ event }) => rows.push({
    at: new Date(event.at).getTime(),
    html: `<li title="${escapeHtml(eventDetail(event))}">`
      + '<span class="orders-chart-swatch orders-chart-swatch-event" aria-hidden="true"></span>'
      + `<span class="orders-chart-list-when">${escapeHtml(etMoment(new Date(event.at)))}</span>`
      + `<span class="orders-chart-list-what">${escapeHtml(`${event.label}: ${event.note}`)}</span>`
      + `<span class="orders-chart-list-markets">${escapeHtml(marketsText([event.market]))}</span></li>`,
  }));
  if (layout.stripes) {
    rows.push({
      at: -Infinity,
      html: '<li><span class="orders-chart-swatch orders-chart-swatch-stripes" aria-hidden="true"></span>'
        + '<span class="orders-chart-list-when">Striped</span>'
        + `<span class="orders-chart-list-what">${escapeHtml(stripesDetail(layout.stripes))}</span>`
        + '<span class="orders-chart-list-markets"></span></li>',
    });
  }
  if (!rows.length) return '';
  const counts = [
    layout.bands.length ? plural(layout.bands.length, 'promotion', 'promotions') : '',
    layout.launches.length ? plural(layout.launches.length, 'launch', 'launches') : '',
    layout.events.length ? plural(layout.events.length, 'checkout change', 'checkout changes') : '',
  ].filter(Boolean).join(', ');
  return `<details class="orders-chart-annotations"${open ? ' open' : ''}>`
    + `<summary>${escapeHtml(counts || 'Chart notes')} in this range</summary>`
    + `<ul class="orders-chart-annotations-list">${rows.sort((a, b) => a.at - b.at).map((r) => r.html).join('')}</ul>`
    + '</details>';
}

/**
 * Highlights every element of an annotation (label, band, line, list row) while any one of them
 * is hovered or focused.
 *
 * @param {HTMLElement} root element containing the labels, the chart and the list
 */
export function wireOverlayHover(root) {
  let current = '';
  const set = (id) => {
    if (id === current) return;
    root.querySelectorAll('.is-highlighted').forEach((n) => n.classList.remove('is-highlighted'));
    current = id;
    if (!id) return;
    root.querySelectorAll('[data-overlay-id]').forEach((n) => {
      if (n.dataset.overlayId === id) n.classList.add('is-highlighted');
    });
  };
  const onEnter = (e) => set(e.target.closest?.('[data-overlay-id]')?.dataset.overlayId || '');
  root.addEventListener('mouseover', onEnter);
  root.addEventListener('focusin', onEnter);
  root.addEventListener('mouseleave', () => set(''));
}

/* ---------- loading ---------- */

/** @type {Map<string, Promise<{ locale: string, items: object[], failed: boolean }>>} */
const scheduleCache = new Map();

async function loadLocale(locale, fetchContent) {
  let failed = false;
  const onStatus = (key, text, error, info) => {
    if (info?.httpStatus && info.httpStatus !== 404) failed = true;
  };
  const options = { onStatus, fetchContent };
  const results = await Promise.allSettled([
    loadNavBanners(locale, options),
    loadFreeGifts(locale, options),
  ]);
  if (results.some((r) => r.status === 'rejected')) failed = true;
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (failed) {
    // eslint-disable-next-line no-console
    console.warn(`[commerce-admin] promotion overlay: could not fully read the ${locale} schedule`);
  }
  return { locale, items, failed };
}

/**
 * Same-origin content fetch. The admin is served from the site's own host (and `aem up` proxies
 * content locally), so the schedule documents are read without a cross-origin request: the
 * free-gifts document is served without CORS headers.
 */
function sameOriginFetch(path) {
  return fetch(path, { cache: 'no-store' });
}

/**
 * Reads the nav-banner and free-gift rows of the given locales. Results (including failures)
 * are cached for the life of the page; a reload refetches.
 *
 * @param {string[]} locales
 * @param {{ fetchContent?: (path: string) => Promise<Response> }} [options]
 * @returns {Promise<{ items: import('./promotion-sources.js').ScheduleItem[],
 *   failedLocales: string[] }>}
 */
export async function loadOverlaySchedule(locales, options = {}) {
  const loaded = await Promise.all([...new Set(locales)].map((locale) => {
    if (options.fetchContent) return loadLocale(locale, options.fetchContent);
    if (!scheduleCache.has(locale)) scheduleCache.set(locale, loadLocale(locale, sameOriginFetch));
    return scheduleCache.get(locale);
  }));
  return {
    items: loaded.flatMap((l) => l.items),
    failedLocales: loaded.filter((l) => l.failed).map((l) => l.locale),
  };
}

/** Test hook: forget cached schedule responses. */
export function clearOverlayScheduleCache() {
  scheduleCache.clear();
}
