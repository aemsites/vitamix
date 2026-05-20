/**
 * Test mock for scripts/commerce-config.js. Returned by the loader hook in
 * tests/unit/loader.mjs when any module imports `commerce-config.js`.
 *
 * Keep this in sync with the real getConfig() contract — at minimum, the
 * fields cart.js reads: getLocale() and currency.
 */
export function getConfig() {
  return {
    getLocale: () => 'us',
    getLanguage: () => 'en_us',
    currency: 'USD',
    getStrings: () => ({}),
    getOrderPath: (key) => `/${key}`,
  };
}
