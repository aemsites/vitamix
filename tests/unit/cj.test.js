import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

// cj.js reads window.location and touches DOM APIs at call time, so the browser
// surfaces have to exist before the module graph is imported.
function installLocation(href) {
  const url = new URL(href);
  globalThis.location = url;
  globalThis.window.location = url;
}

const appendedScripts = [];
let elementsById = {};

globalThis.document.body = { classList: { contains: () => false } };
globalThis.document.querySelector = () => null;
globalThis.document.getElementById = (id) => elementsById[id] || null;
globalThis.document.createElement = () => ({});
globalThis.document.head = {
  appendChild(node) {
    appendedScripts.push(node);
    elementsById[node.id] = node;
    return node;
  },
};
globalThis.document.addEventListener = () => {};

installLocation('https://www.vitamix.com/us/en_us/order/complete?orderId=abc-123');

const { buildCjOrder, getCjevent, CJEVENT_MAX_AGE_MS } = await import('../../scripts/cj.js');

const CJEVENT = '656e8fa049ec11ea8237023d0a240612';

/** Mirrors the capture written by setAffiliateCoupon() in scripts.js. */
function captureCjevent(value, ts = Date.now()) {
  localStorage.setItem('cjevent', value);
  localStorage.setItem('cjevent_captured', String(ts));
}

const ORDER_CONTEXT = {
  orderId: 'abc-123',
  order: {
    friendlyId: 'OC6849504389',
    currencyCode: 'USD',
    estimates: {
      discounts: [{ amount: -25 }],
      tax: { amount: 8.5 },
      shippingMethod: { rate: 10 },
    },
    items: [
      { sku: 'A2500', quantity: 1, price: { final: 449.95 } },
      { sku: 'TAMPER', quantity: 2, price: { final: 10 } },
    ],
  },
  displayItems: [
    { sku: 'A2500', quantity: 1, price: { final: 449.95 } },
    { sku: 'TAMPER', quantity: 2, price: { final: 10 }, discount: -5 },
  ],
  couponCode: '06-AFFILIATE',
};

beforeEach(() => {
  globalThis.__resetTestState();
  appendedScripts.length = 0;
  elementsById = {};
  delete globalThis.window.cj;
  installLocation('https://www.vitamix.com/us/en_us/order/complete?orderId=abc-123');
});

test('buildCjOrder uses the prod action tracker only on www.vitamix.com', () => {
  assert.equal(buildCjOrder(ORDER_CONTEXT).actionTrackerId, '392823');
});

test('buildCjOrder falls back to the stage action tracker on every other host', () => {
  ['vitamix.com', 'test.vitamix.com', 'uat.vitamix.com', 'localhost'].forEach((host) => {
    installLocation(`https://${host}/us/en_us/order/complete?orderId=abc-123`);
    assert.equal(buildCjOrder(ORDER_CONTEXT).actionTrackerId, '427761', host);
  });
});

test('buildCjOrder reports amount excluding tax and shipping, with discount separate', () => {
  const cjOrder = buildCjOrder(ORDER_CONTEXT);
  assert.equal(cjOrder.amount, 469.95);
  assert.equal(cjOrder.discount, 25);
  assert.equal(cjOrder.taxAmount, 8.5);
});

test('buildCjOrder prefers the friendly order number and sets the confirmation page type', () => {
  const cjOrder = buildCjOrder(ORDER_CONTEXT);
  assert.equal(cjOrder.orderId, 'OC6849504389');
  assert.equal(cjOrder.pageType, 'conversionConfirmation');
  assert.equal(cjOrder.enterpriseId, '1541135');
});

test('buildCjOrder emits line items with per-line discounts only when non-zero', () => {
  assert.deepEqual(buildCjOrder(ORDER_CONTEXT).items, [
    { itemId: 'A2500', quantity: 1, unitPrice: 449.95 },
    { itemId: 'TAMPER', quantity: 2, unitPrice: 10, discount: 5 },
  ]);
});

test('buildCjOrder omits cjeventOrder entirely when no click ID is stored', () => {
  const cjOrder = buildCjOrder(ORDER_CONTEXT);
  assert.ok(!('cjeventOrder' in cjOrder));
});

test('buildCjOrder includes cjeventOrder when a click ID is available', () => {
  captureCjevent(CJEVENT);
  assert.equal(buildCjOrder(ORDER_CONTEXT).cjeventOrder, CJEVENT);
});

test('getCjevent returns the captured value inside the retention window', () => {
  captureCjevent(CJEVENT);
  assert.equal(getCjevent(), CJEVENT);
});

test('getCjevent evicts a value past the retention window', () => {
  captureCjevent(CJEVENT, Date.now() - CJEVENT_MAX_AGE_MS - 1);
  assert.equal(getCjevent(), '');
  assert.equal(localStorage.getItem('cjevent'), null);
  assert.equal(localStorage.getItem('cjevent_captured'), null);
});

test('getCjevent keeps a value written by CJ\'s own tag, which records no timestamp', () => {
  localStorage.setItem('cjevent', CJEVENT);
  assert.equal(getCjevent(), CJEVENT);
});

test('getCjevent normalises the earlier JSON storage format', () => {
  const ts = Date.now() - 1000;
  localStorage.setItem('cjevent', JSON.stringify({ value: CJEVENT, ts }));
  assert.equal(getCjevent(), CJEVENT);
  assert.equal(localStorage.getItem('cjevent'), CJEVENT);
  assert.equal(localStorage.getItem('cjevent_captured'), String(ts));
});

test('getCjevent discards an expired value in the earlier JSON format', () => {
  localStorage.setItem('cjevent', JSON.stringify({
    value: CJEVENT,
    ts: Date.now() - CJEVENT_MAX_AGE_MS - 1,
  }));
  assert.equal(getCjevent(), '');
});

test('getCjevent falls back to the cje and cjevent_dc cookies', () => {
  document.cookie = `cje=${CJEVENT}; path=/`;
  assert.equal(getCjevent(), CJEVENT);
  globalThis.__resetTestState();
  document.cookie = `cjevent_dc=${CJEVENT}; path=/`;
  assert.equal(getCjevent(), CJEVENT);
});

test('getCjevent URI-decodes cookie values the way CJ\'s tag does', () => {
  document.cookie = `cje=${encodeURIComponent('abc/123')}; path=/`;
  assert.equal(getCjevent(), 'abc/123');
});

test('getCjevent prefers the captured value over the cookies', () => {
  document.cookie = 'cje=from-cookie; path=/';
  captureCjevent(CJEVENT);
  assert.equal(getCjevent(), CJEVENT);
});

test('getCjevent returns an empty string when nothing is stored', () => {
  assert.equal(getCjevent(), '');
});

test('getCjevent recovers from unexpected content in the storage slot', () => {
  localStorage.setItem('cjevent', '{not json');
  document.cookie = `cje=${CJEVENT}; path=/`;
  assert.equal(getCjevent(), CJEVENT);
});

test('buildCjOrder derives CAD for the Canadian locale when the order omits currency', () => {
  installLocation('https://www.vitamix.com/ca/fr_ca/order/complete?orderId=abc-123');
  const context = { ...ORDER_CONTEXT, order: { ...ORDER_CONTEXT.order, currencyCode: undefined } };
  const cjOrder = buildCjOrder(context);
  assert.equal(cjOrder.currency, 'CAD');
  assert.equal(cjOrder.customerCountry, 'CA');
});

test('buildCjOrder returns null without an order id or line items', () => {
  assert.equal(buildCjOrder({ orderId: '', order: null }), null);
  assert.equal(buildCjOrder({ orderId: 'abc-123', order: { items: [] } }), null);
});

// The module guards against duplicate conversions with module-level state, so each
// firing test needs a fresh instance.
async function freshCjModule(tag) {
  return import(`../../scripts/cj.js?fresh=${tag}`);
}

test('fireCjConversion publishes the payload and injects the tag once', async () => {
  const cj = await freshCjModule('publish');
  assert.equal(cj.fireCjConversion(ORDER_CONTEXT), true);
  assert.equal(globalThis.window.cj.order.orderId, 'OC6849504389');
  assert.equal(appendedScripts.length, 1);
  assert.equal(appendedScripts[0].src, 'https://www.mczbf.com/tags/11931/tag.js');
  assert.equal(appendedScripts[0].id, 'cjapitag');

  // A repeat call within the same page view is a no-op.
  assert.equal(cj.fireCjConversion(ORDER_CONTEXT), false);
  assert.equal(appendedScripts.length, 1);
});

test('fireCjConversion does not re-publish for an order already tracked this session', async () => {
  const cj = await freshCjModule('dedupe');
  sessionStorage.setItem('cj_conversion_OC6849504389', 'true');
  assert.equal(cj.fireCjConversion(ORDER_CONTEXT), false);
  assert.equal(appendedScripts.length, 0);
  assert.ok(!globalThis.window.cj);
});

test('fireCjConversion reuses a tag already injected by consented.js', async () => {
  const cj = await freshCjModule('existing-tag');
  elementsById.cjapitag = { id: 'cjapitag' };
  assert.equal(cj.fireCjConversion(ORDER_CONTEXT), true);
  assert.equal(appendedScripts.length, 0);
  assert.equal(globalThis.window.cj.order.orderId, 'OC6849504389');
});

test('reportCjConversion returns false instead of throwing on bad input', async () => {
  const cj = await freshCjModule('report-guard');
  assert.equal(cj.reportCjConversion(null), false);
  assert.equal(appendedScripts.length, 0);
});

test('reportCjConversion publishes a valid order context', async () => {
  const cj = await freshCjModule('report-ok');
  assert.equal(cj.reportCjConversion(ORDER_CONTEXT), true);
  assert.equal(globalThis.window.cj.order.orderId, 'OC6849504389');
});
