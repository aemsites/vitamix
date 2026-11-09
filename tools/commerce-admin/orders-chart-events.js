/**
 * Events drawn on the orders chart that explain a change in order volume without being a
 * promotion: a market's orders only reach the Commerce API once Edge checkout is enabled for it.
 *
 * Source of truth for each date is the commit that added the locale to `EDGE_CHECKOUT_LOCALES`
 * in `scripts/scripts.js` on `main` (merge time, accurate to about a day; the storefront picks it
 * up shortly after).
 */

/**
 * @typedef {object} MarketLiveEvent
 * @property {string} market chart market key (`us`, `ca-en`, `ca-fr`, `mx`)
 * @property {string} at ISO instant
 * @property {string} label
 * @property {string} chartLabel short text drawn on the chart
 * @property {string} note what it means for the chart
 * @property {string} ref commit or PR that made the change
 */

/** @type {MarketLiveEvent[]} */
export const MARKET_LIVE_EVENTS = [
  {
    market: 'ca-fr',
    at: '2026-09-10T15:33:11-04:00',
    label: 'Edge checkout live (CA FR)',
    chartLabel: 'CA FR orders start',
    note: 'CA FR orders appear in this chart from here',
    ref: 'aemsites/vitamix@4663657c',
  },
  {
    market: 'ca-en',
    at: '2026-09-23T10:10:48-04:00',
    label: 'Edge checkout live (CA EN)',
    chartLabel: 'CA EN orders start',
    note: 'CA EN orders appear in this chart from here',
    ref: 'aemsites/vitamix@469435d2',
  },
  {
    market: 'us',
    at: '2026-10-15T16:04:09-04:00',
    label: 'Edge checkout live (US)',
    chartLabel: 'US orders start',
    note: 'US orders appear in this chart from here',
    ref: 'aemsites/vitamix#959',
  },
];

/**
 * Events for the markets currently shown by the chart.
 *
 * @param {string[]} marketKeys chart market keys in view
 * @param {MarketLiveEvent[]} [events]
 * @returns {MarketLiveEvent[]} ascending by time
 */
export function marketLiveEvents(marketKeys, events = MARKET_LIVE_EVENTS) {
  return events
    .filter((e) => marketKeys.includes(e.market) && !Number.isNaN(new Date(e.at).getTime()))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
