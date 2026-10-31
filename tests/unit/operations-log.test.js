/**
 * Unit tests for scripts/operations-log.js.
 *
 * Run with `npm run test:unit`. Uses the shared fetch mock and Web Storage
 * shims from setup.mjs. `window.location` is set per-test for origin checks.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  logOperation, getCheckoutId, clearCheckoutId, anonymize, logApiError, logNetworkError, logError,
  errorDetails, isIgnoredErrorSource,
} from '../../scripts/operations-log.js';

const PATH = '/us/en_us/products/operations-log';

let lastUrl;
let lastInit;

function captureFetch() {
  globalThis.__setFetchMock(async (url, init) => {
    lastUrl = url;
    lastInit = init;
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

function setHostname(hostname, pathname = '/us/en_us/products/ascent-x5') {
  globalThis.window.location = { hostname, origin: `https://${hostname}`, pathname };
}

// Node exposes a configurable `navigator` global (userAgent "Node.js/<v>");
// tests override it per case and restore the original afterwards.
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function setUserAgent(userAgent) {
  Object.defineProperty(globalThis, 'navigator', {
    value: userAgent === undefined ? undefined : { userAgent },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
  else delete globalThis.navigator;
});

beforeEach(() => {
  lastUrl = undefined;
  lastInit = undefined;
  globalThis.__resetTestState();
  delete globalThis.window.IS_TEST_MODE;
  setHostname('main--vitamix--aemsites.aem.network');
});

// --- origin selection -------------------------------------------------------

test('logOperation: posts to AEM network origin on aem.network hosts', () => {
  captureFetch();
  setHostname('main--vitamix--aemsites.aem.network');
  logOperation('cart-view');
  assert.equal(lastUrl, `https://main--vitamix--aemsites.aem.network${PATH}`);
});

test('logOperation: posts same-origin (relative) only on production www.vitamix.com', () => {
  captureFetch();
  setHostname('www.vitamix.com');
  logOperation('cart-view');
  assert.equal(lastUrl, PATH);
});

test('logOperation: non-production vitamix.com hosts use the AEM network origin', () => {
  captureFetch();
  setHostname('integration.vitamix.com');
  logOperation('cart-view');
  assert.equal(lastUrl, `https://main--vitamix--aemsites.aem.network${PATH}`);
});

// --- request shape ----------------------------------------------------------

test('logOperation: includes action, timestamp, and extra data', () => {
  captureFetch();
  logOperation('added-to-cart', { sku: 'abc', quantity: 2 });
  const body = JSON.parse(lastInit.body);
  assert.equal(body.action, 'added-to-cart');
  assert.equal(body.sku, 'abc');
  assert.equal(body.quantity, 2);
  assert.equal(typeof body.ts, 'number');
  assert.equal(lastInit.method, 'POST');
  assert.equal(lastInit.keepalive, true);
});

// --- href -------------------------------------------------------------------

test('logOperation: includes href as origin + pathname', () => {
  captureFetch();
  setHostname('www.vitamix.com', '/us/en_us/products/ascent-x5');
  logOperation('cart-view');
  const body = JSON.parse(lastInit.body);
  assert.equal(body.href, 'https://www.vitamix.com/us/en_us/products/ascent-x5');
});

test('logOperation: href drops the query string and hash', () => {
  captureFetch();
  globalThis.window.location = {
    hostname: 'www.vitamix.com',
    origin: 'https://www.vitamix.com',
    pathname: '/us/en_us/order/complete',
    search: '?orderId=ord-1&token=secret&email=a%40b.com',
    hash: '#receipt',
  };
  logOperation('checkout-complete');
  const { href } = JSON.parse(lastInit.body);
  assert.equal(href, 'https://www.vitamix.com/us/en_us/order/complete');
  assert.ok(!href.includes('?'), 'query string must not be logged');
  assert.ok(!href.includes('#'), 'hash must not be logged');
});

test('logOperation: omits href when location is unavailable', () => {
  captureFetch();
  globalThis.window.location = { hostname: 'www.vitamix.com' };
  logOperation('cart-view');
  const body = JSON.parse(lastInit.body);
  assert.ok(!('href' in body), 'href should be dropped rather than sent as null');
});

test('logOperation: caller-supplied href wins over the current location', () => {
  captureFetch();
  setHostname('www.vitamix.com', '/us/en_us/cart');
  logOperation('checkout-redirect-return', { href: 'https://www.vitamix.com/us/en_us/checkout' });
  const body = JSON.parse(lastInit.body);
  assert.equal(body.href, 'https://www.vitamix.com/us/en_us/checkout');
});

test('logError: carries href so errors can be grouped by page', () => {
  captureFetch();
  setHostname('www.vitamix.com', '/us/en_us/products/ascent-x5');
  logError('window.error', new Error('boom'));
  const body = JSON.parse(lastInit.body);
  assert.equal(body.href, 'https://www.vitamix.com/us/en_us/products/ascent-x5');
  assert.equal(body.message, 'boom');
});

// --- test mode --------------------------------------------------------------

test('logOperation: skips network calls when window.IS_TEST_MODE is true', () => {
  captureFetch();
  globalThis.window.IS_TEST_MODE = true;
  logOperation('checkout-start');
  assert.equal(lastUrl, undefined);
  assert.equal(lastInit, undefined);
});

// --- never throws -----------------------------------------------------------

test('logOperation: swallows fetch rejections (never throws)', () => {
  globalThis.__setFetchMock(async () => { throw new Error('network down'); });
  assert.doesNotThrow(() => logOperation('error'));
});

test('logOperation: swallows non-serializable payloads (never throws)', () => {
  captureFetch();
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => logOperation('error', circular));
});

// --- checkout id ------------------------------------------------------------

test('getCheckoutId: mints once and is stable across calls', () => {
  const first = getCheckoutId();
  const second = getCheckoutId();
  assert.equal(first, second);
  assert.ok(first);
});

test('clearCheckoutId: next call mints a fresh id', () => {
  const first = getCheckoutId();
  clearCheckoutId();
  const second = getCheckoutId();
  assert.notEqual(first, second);
});

// --- anonymize --------------------------------------------------------------

test('anonymize: strips PII and payment fields, keeps debug fields', () => {
  const result = anonymize({
    country: 'us',
    couponCode: 'SAVE10',
    estimateToken: 'tok-123',
    customer: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
    shipping: {
      country: 'us', state: 'CA', zip: '94016', street: '1 Main St', name: 'Jane Doe',
    },
    shippingMethod: { id: 'ground', rate: '9.99', label: 'Ground' },
    payment: { cardNumber: '4111111111111111' },
    fraudToken: 'ft-xyz',
    items: [{
      sku: 's1', path: '/p', quantity: 1, price: { value: 10 }, secret: 'x',
    }],
  });
  assert.deepEqual(result, {
    country: 'us',
    couponCode: 'SAVE10',
    estimateToken: 'tok-123',
    shipping: { country: 'us', state: 'CA', zip: '94016' },
    shippingMethod: { id: 'ground' },
    items: [{
      sku: 's1', path: '/p', quantity: 1, price: { value: 10 },
    }],
  });
});

test('anonymize: returns undefined for non-objects', () => {
  assert.equal(anonymize(null), undefined);
  assert.equal(anonymize('string'), undefined);
});

// --- logApiError ------------------------------------------------------------

test('logApiError: logs error action with anonymized request body', () => {
  captureFetch();
  logApiError({
    method: 'POST',
    path: '/orders',
    status: 422,
    responseBody: { message: 'bad' },
    requestBody: { country: 'us', customer: { email: 'jane@example.com' } },
  });
  const body = JSON.parse(lastInit.body);
  assert.equal(body.action, 'error');
  assert.equal(body.kind, 'api');
  assert.equal(body.status, 422);
  assert.deepEqual(body.responseBody, { message: 'bad' });
  assert.deepEqual(body.requestBody, { country: 'us' });
  assert.equal(body.requestBody.customer, undefined);
});

// --- logNetworkError --------------------------------------------------------

test('logNetworkError: logs error action with kind network and anonymized body', () => {
  captureFetch();
  logNetworkError({
    method: 'POST',
    path: '/orders',
    error: new TypeError('Failed to fetch'),
    requestBody: { country: 'us', shipping: { state: 'CA', street: '1 Main St' } },
  });
  const body = JSON.parse(lastInit.body);
  assert.equal(body.action, 'error');
  assert.equal(body.kind, 'network');
  assert.equal(body.path, '/orders');
  assert.equal(body.message, 'Failed to fetch');
  // undefined keys (country/zip) are dropped by JSON serialization.
  assert.deepEqual(body.requestBody, { country: 'us', shipping: { state: 'CA' } });
});

test('logNetworkError: now carries name and stack (not message-only)', () => {
  captureFetch();
  const err = new TypeError('Failed to fetch');
  err.stack = 'TypeError: Failed to fetch\n    at postOrder (https://x/scripts/commerce.js:42:9)';
  logNetworkError({
    method: 'POST', path: '/orders', error: err, requestBody: {},
  });
  const body = JSON.parse(lastInit.body);
  assert.equal(body.name, 'TypeError');
  assert.ok(body.stack.includes('postOrder'), 'stack should be included');
  assert.equal(body.fileName, 'https://x/scripts/commerce.js');
  assert.equal(body.lineNumber, 42);
  assert.equal(body.columnNumber, 9);
});

// --- errorDetails -----------------------------------------------------------

test('errorDetails: parses file/line/col from a V8 stack frame', () => {
  const err = new Error('boom');
  err.stack = 'Error: boom\n    at fn (https://x/scripts/mod.js:12:34)';
  const d = errorDetails(err);
  assert.equal(d.name, 'Error');
  assert.equal(d.message, 'boom');
  assert.equal(d.fileName, 'https://x/scripts/mod.js');
  assert.equal(d.lineNumber, 12);
  assert.equal(d.columnNumber, 34);
});

test('errorDetails: parses a SpiderMonkey/JSC (fn@url) frame', () => {
  const err = { message: 'boom', stack: 'postOrder@https://x/scripts/mod.js:5:7' };
  const d = errorDetails(err);
  assert.equal(d.fileName, 'https://x/scripts/mod.js');
  assert.equal(d.lineNumber, 5);
  assert.equal(d.columnNumber, 7);
});

test('errorDetails: native Firefox fileName/lineNumber override the parsed frame', () => {
  const err = new Error('boom');
  err.stack = 'Error: boom\n    at fn (https://x/scripts/mod.js:12:34)';
  err.fileName = 'https://x/scripts/real.js';
  err.lineNumber = 99;
  err.columnNumber = 1;
  const d = errorDetails(err);
  assert.equal(d.fileName, 'https://x/scripts/real.js');
  assert.equal(d.lineNumber, 99);
  assert.equal(d.columnNumber, 1);
});

test('errorDetails: safe on non-Error throwables', () => {
  const d = errorDetails('just a string');
  assert.equal(d.message, 'just a string');
  assert.equal(d.stack, undefined);
  assert.equal(d.fileName, undefined);
});

// --- logError ---------------------------------------------------------------

test('logError: records the error name alongside message', () => {
  captureFetch();
  const err = new TypeError('cannot read property');
  logError('checkout-order', err, { orderId: 'ord-1' });
  const body = JSON.parse(lastInit.body);
  assert.equal(body.action, 'error');
  assert.equal(body.scope, 'checkout-order');
  assert.equal(body.name, 'TypeError');
  assert.equal(body.message, 'cannot read property');
  assert.equal(body.orderId, 'ord-1');
});

// --- ignored error sources --------------------------------------------------

test('isIgnoredErrorSource: ignores browser-extension scripts', () => {
  assert.equal(
    isIgnoredErrorSource('chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js'),
    true,
  );
  assert.equal(isIgnoredErrorSource('moz-extension://abc/content.js'), true);
});

test('isIgnoredErrorSource: ignores sources under an ignored path prefix', () => {
  assert.equal(isIgnoredErrorSource('https://www.vitamix.com/scripts/consented/at.js'), true);
});

test('isIgnoredErrorSource: keeps first-party AEM-scope sources', () => {
  assert.equal(isIgnoredErrorSource('https://www.vitamix.com/scripts/commerce.js'), false);
  assert.equal(isIgnoredErrorSource('https://www.vitamix.com/blocks/cart/cart.js'), false);
});

test('isIgnoredErrorSource: fails open on non-URL / empty input', () => {
  assert.equal(isIgnoredErrorSource(undefined), false);
  assert.equal(isIgnoredErrorSource(''), false);
  assert.equal(isIgnoredErrorSource('not a url'), false);
});

test('logError: drops chrome-extension errors reported via fileName', () => {
  captureFetch();
  logError('window.error', { message: 'Failed to connect to MetaMask' }, {
    fileName: 'chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js',
    lineNumber: 7,
    columnNumber: 84292,
  });
  assert.equal(lastUrl, undefined, 'extension error must not be sent');
});

test('logError: drops chrome-extension errors detected from the stack only', () => {
  captureFetch();
  const err = {
    message: 'Failed to connect to MetaMask',
    stack: 'i: Failed to connect to MetaMask\n    at Object.connect (chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js:7:84292)',
  };
  logError('unhandledrejection', err);
  assert.equal(lastUrl, undefined, 'extension error must not be sent');
});

test('logError: drops errors from an ignored /scripts/consented/ source', () => {
  captureFetch();
  const err = {
    message: 'Network request failed',
    stack: 'Error: Network request failed\n@https://www.vitamix.com/scripts/consented/at.js:19:44964',
  };
  logError('unhandledrejection', err);
  assert.equal(lastUrl, undefined, 'consented third-party error must not be sent');
});

test('logError: still logs first-party AEM-scope errors', () => {
  captureFetch();
  const err = new Error('boom');
  err.stack = 'Error: boom\n    at fn (https://www.vitamix.com/scripts/commerce.js:12:34)';
  logError('checkout-order', err);
  assert.equal(lastUrl, `https://main--vitamix--aemsites.aem.network${PATH}`);
  assert.equal(JSON.parse(lastInit.body).message, 'boom');
});

test('logError: retains stack frames past the old 5-line cap', () => {
  captureFetch();
  const err = new Error('boom');
  // Simulate a deep async stack where the originating app frame is line 8.
  err.stack = ['Error: boom', ...Array.from(
    { length: 15 },
    (_, i) => `    at fn${i} (https://x/scripts/mod.js:${i + 1}:3)`,
  )].join('\n');
  logError('global', err);
  const body = JSON.parse(lastInit.body);
  assert.ok(body.stack.includes('fn8'), 'frame past line 5 should be retained');
  assert.ok(body.stack.includes(':9:3'), 'line numbers should be preserved');
});

// --- bot/scraper fetch & import failures -------------------------------------

const UA = {
  baidu: 'Mozilla/5.0 (compatible; Baiduspider-render/2.0; +http://www.baidu.com/search/spider.html)',
  yisou: 'YisouSpider',
  storebot: 'Mozilla/5.0 (X11; Linux x86_64; Storebot-Google/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
};

/** A Chrome dynamic-import failure: the URL is in the message, the stack has no frames. */
function importFailure(url = 'https://www.vitamix.com/scripts/gift-with-purchase.js') {
  const err = new TypeError(`Failed to fetch dynamically imported module: ${url}`);
  err.stack = `TypeError: ${err.message}`;
  return err;
}

test('logError: drops a failed dynamic import from a bot user agent', () => {
  captureFetch();
  setUserAgent(UA.baidu);
  logError('unhandledrejection', importFailure());
  assert.equal(lastUrl, undefined, 'bot import failure must not be sent');
});

test('logError: drops a failed fetch from a bot user agent', () => {
  captureFetch();
  setUserAgent(UA.yisou);
  const err = new TypeError('Failed to fetch');
  err.stack = 'TypeError: Failed to fetch\n    at fetchSheet (https://www.vitamix.com/widgets/locator/locator.js:36:24)';
  logError('unhandledrejection', err);
  assert.equal(lastUrl, undefined, 'bot fetch failure must not be sent');
});

test('logError: drops Safari and Firefox fetch/import wording from a bot user agent', () => {
  setUserAgent(UA.storebot);
  [
    'Load failed',
    'NetworkError when attempting to fetch resource.',
    'Importing a module script failed.',
    'error loading dynamically imported module: https://www.vitamix.com/blocks/modal/modal.js',
  ].forEach((message) => {
    lastUrl = undefined;
    captureFetch();
    logError('unhandledrejection', { message });
    assert.equal(lastUrl, undefined, `"${message}" from a bot must not be sent`);
  });
});

test('logError: drops a wrapped fetch failure (extra.cause) from a bot user agent', () => {
  setUserAgent(UA.baidu);
  ['HTTP 503', 'HTTP 404', 'Failed to fetch'].forEach((cause) => {
    lastUrl = undefined;
    captureFetch();
    const copyPath = '/widgets/product-list/product-list.json';
    logError('widget-copy', new Error(`Widget copy failed to load: ${copyPath}`), { copyPath, cause });
    assert.equal(lastUrl, undefined, `widget copy "${cause}" from a bot must not be sent`);
  });
});

test('logError: drops a wrapped fetch failure (Error.cause) from a bot user agent', () => {
  captureFetch();
  setUserAgent(UA.baidu);
  logError('widget-copy', new Error('Widget copy failed to load', { cause: new Error('HTTP 503') }));
  assert.equal(lastUrl, undefined);
});

test('logError: still logs a wrapped fetch failure from a normal browser', () => {
  captureFetch();
  setUserAgent(UA.chrome);
  const copyPath = '/widgets/product-list/product-list.json';
  logError('widget-copy', new Error(`Widget copy failed to load: ${copyPath}`), { copyPath, cause: 'HTTP 503' });
  assert.equal(JSON.parse(lastInit.body).cause, 'HTTP 503');
});

test('logError: still logs a bot error whose cause is not a fetch failure', () => {
  captureFetch();
  setUserAgent(UA.baidu);
  logError('widget-copy', new Error('Widget copy failed to load: /x.json'), { cause: 'Unexpected token < in JSON at position 0' });
  assert.equal(JSON.parse(lastInit.body).scope, 'widget-copy');
});

test('logError: still logs a failed dynamic import from a normal browser', () => {
  captureFetch();
  setUserAgent(UA.chrome);
  logError('unhandledrejection', importFailure());
  assert.equal(lastUrl, `https://main--vitamix--aemsites.aem.network${PATH}`);
  assert.match(JSON.parse(lastInit.body).message, /gift-with-purchase\.js$/);
});

test('logError: still logs non-fetch errors from a bot user agent', () => {
  captureFetch();
  setUserAgent(UA.storebot);
  logError('modal', new Error('Modal fragment failed to load: /us/en_us/nav/modals/search'));
  assert.equal(JSON.parse(lastInit.body).scope, 'modal');
});

test('logError: an app error that only mentions fetch is not a fetch failure', () => {
  captureFetch();
  setUserAgent(UA.storebot);
  logError('order', new Error('Failed to fetch order ord-1'));
  assert.equal(JSON.parse(lastInit.body).message, 'Failed to fetch order ord-1');
});

test('logError: logs fetch/import failures when the user agent is unavailable', () => {
  captureFetch();
  setUserAgent(undefined);
  logError('unhandledrejection', importFailure());
  assert.equal(lastUrl, `https://main--vitamix--aemsites.aem.network${PATH}`);
});

test('logApiError and logNetworkError: still log API failures from a bot user agent', () => {
  setUserAgent(UA.storebot);
  captureFetch();
  logApiError({
    method: 'POST', path: '/orders', status: 403, responseBody: { code: 'ADOBE_COMMERCE_RECAPTCHA_FAILED' },
  });
  assert.equal(JSON.parse(lastInit.body).status, 403);
  lastInit = undefined;
  logNetworkError({ method: 'POST', path: '/estimate/shipping', error: new TypeError('Failed to fetch') });
  const body = JSON.parse(lastInit.body);
  assert.equal(body.kind, 'network');
  assert.equal(body.message, 'Failed to fetch');
});
