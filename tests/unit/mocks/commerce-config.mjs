/**
 * Test mock for scripts/commerce-config.js. Returned by the loader hook in
 * tests/unit/loader.mjs when any module imports `commerce-config.js`.
 *
 * Keep this in sync with the real getConfig() contract — at minimum, the
 * fields cart.js reads: getLocale() and currency.
 *
 * Tests can override `currency` (string vs function) via __setCurrency,
 * and __resetConfig restores defaults — wired into __resetTestState in setup.mjs.
 */
let currencyOverride;

export function __setCurrency(value) {
  currencyOverride = value;
}

export function __resetConfig() {
  currencyOverride = undefined;
}

export function formatPrice(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(value);
}

export function formatPriceAmount(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function getConfig() {
  return {
    getLocale: () => 'us',
    getLanguage: () => 'en_us',
    currency: currencyOverride !== undefined ? currencyOverride : 'USD',
    getStrings: () => ({}),
    getOrderPath: (key) => `/${key}`,
    apiOrigin: 'https://api.test.com/test-org/sites/test-site',
  };
}
