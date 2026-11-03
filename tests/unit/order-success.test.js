import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const ORDER_CONTEXT = {
  orderId: 'internal-123',
  order: {
    id: 'internal-123',
    friendlyId: 'VMX-123',
    items: [{
      sku: 'BLENDER', name: 'Blender', quantity: 1, price: { final: 100 },
    }],
    estimates: { tax: { amount: 8 }, shippingMethod: { rate: 0 } },
  },
};

let importId = 0;
let listeners;
let beacons;
let launchCalls;

beforeEach((t) => {
  globalThis.__resetTestState();
  window.location = new URL('https://www.vitamix.com/us/en_us/order/complete?orderId=internal-123');
  window.vitamixEdsAnalytics = {};
  delete window._satellite;
  delete window.s;
  delete window.s_c_il;
  delete window.Cookiebot;
  delete window.digitalData;
  document.body = { classList: { contains: () => true } };
  listeners = [];
  beacons = [];
  launchCalls = [];
  document.addEventListener = t.mock.fn((name, callback) => {
    if (name === 'order:confirmed') listeners.push(callback);
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
});

async function loadTracking() {
  importId += 1;
  return import(`../../scripts/consented/instrumentation/order-success.js?test=${importId}`);
}

function confirmOrder() {
  window.vitamixEdsAnalytics.orderConfirmedContext = ORDER_CONTEXT;
  listeners.forEach((callback) => callback({ detail: ORDER_CONTEXT }));
}

function installLaunch({ sendsPurchase = false } = {}) {
  window.s = {
    t() {
      beacons.push({
        events: this.events,
        purchaseID: this.purchaseID,
        products: this.products,
      });
    },
  };
  window._satellite = {
    track(event) {
      launchCalls.push(event);
      if (sendsPurchase && event === 'purchase') {
        window.s.events = 'purchase';
        window.s.t();
      }
    },
  };
}

async function advance(t, milliseconds) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
    t.mock.timers.tick(Math.min(100, milliseconds - elapsed));
    // Let beacon and readiness continuations run between timer ticks.
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

test('purchase waits beyond five seconds and sends the existing fallback payload', async (t) => {
  await loadTracking();
  confirmOrder();
  await advance(t, 6000);
  assert.equal(beacons.length, 0);

  installLaunch();
  await advance(t, 3000);

  assert.deepEqual(launchCalls, ['purchase']);
  assert.deepEqual(beacons, [{
    events: 'purchase,event49=8.00,event51=108.00',
    purchaseID: 'VMX-123',
    products: ';Blender;1;100.00;;',
  }]);
});

test('purchase still waits for Launch near the thirty-second limit', async (t) => {
  await loadTracking();
  confirmOrder();
  await advance(t, 29000);
  installLaunch();
  await advance(t, 3000);
  assert.equal(beacons.length, 1);
});

test('post-Launch registration retries a context after polling has expired', async (t) => {
  const tracking = await loadTracking();
  confirmOrder();
  await advance(t, 31000);
  installLaunch();
  await advance(t, 3000);
  assert.equal(beacons.length, 0, 'early polling must have expired');

  tracking.registerOrderPurchaseTracking();
  tracking.registerOrderPurchaseTracking();
  await advance(t, 3000);

  assert.equal(listeners.length, 1);
  assert.deepEqual(launchCalls, ['purchase']);
  assert.equal(beacons.length, 1);
  tracking.registerOrderPurchaseTracking();
  await advance(t, 3000);
  assert.equal(beacons.length, 1, 'a successful purchase must not be retried');
});

test('overlapping early polling and post-Launch retry send only once', async (t) => {
  const tracking = await loadTracking();
  confirmOrder();
  await advance(t, 6000);
  installLaunch();
  tracking.registerOrderPurchaseTracking();
  await advance(t, 3000);
  assert.deepEqual(launchCalls, ['purchase']);
  assert.equal(beacons.length, 1);
});

test('confirmation arriving after post-Launch registration is still tracked', async (t) => {
  const tracking = await loadTracking();
  installLaunch({ sendsPurchase: true });
  tracking.registerOrderPurchaseTracking();
  confirmOrder();
  await advance(t, 3000);
  assert.equal(listeners.length, 1);
  assert.deepEqual(launchCalls, ['purchase']);
  assert.equal(beacons.length, 1, 'Launch purchase must not also send the fallback');
});

test('a failed attempt releases the in-flight guard for a later retry', async (t) => {
  const tracking = await loadTracking();
  const transaction = tracking.buildPurchaseTransactionData(ORDER_CONTEXT);
  await tracking.firePurchase(transaction);
  installLaunch();
  const purchase = tracking.firePurchase(transaction);
  await advance(t, 3000);
  await purchase;
  assert.equal(beacons.length, 1);
});

test('a thrown send error propagates and releases the in-flight guard', async (t) => {
  const tracking = await loadTracking();
  const transaction = tracking.buildPurchaseTransactionData(ORDER_CONTEXT);
  installLaunch();
  window._satellite.track = () => { throw new Error('Launch failure'); };
  await assert.rejects(tracking.firePurchase(transaction), /Launch failure/);
  installLaunch();
  const purchase = tracking.firePurchase(transaction);
  await advance(t, 3000);
  await purchase;
  assert.equal(beacons.length, 1);
});

test('post-Launch retry preserves consent gating', async (t) => {
  const tracking = await loadTracking();
  confirmOrder();
  await advance(t, 31000);
  document.body.classList.contains = () => false;
  installLaunch();
  tracking.registerOrderPurchaseTracking();
  await advance(t, 3000);
  assert.equal(launchCalls.length, 0);
  assert.equal(beacons.length, 0);
});

test('cancelled confirmation does not register or replay a purchase', async (t) => {
  window.location.search = '?orderId=internal-123&reason=customer_cancelled';
  const tracking = await loadTracking();
  window.vitamixEdsAnalytics.orderConfirmedContext = ORDER_CONTEXT;
  installLaunch();
  tracking.registerOrderPurchaseTracking();
  await advance(t, 3000);
  assert.equal(listeners.length, 0);
  assert.equal(beacons.length, 0);
});

test('instrumentation initialization replays confirmation after the early wait expires', async (t) => {
  document.querySelector = () => null;
  t.mock.method(window, 'setInterval', () => 1);
  await import('../../scripts/consented/instrumentation/order-success.js');
  confirmOrder();
  await advance(t, 31000);
  installLaunch();

  const { initInstrumentation } = await import('../../scripts/consented/instrumentation/index.js');
  await initInstrumentation();
  await advance(t, 3000);

  assert.equal(listeners.length, 1);
  assert.deepEqual(launchCalls, ['purchase']);
  assert.equal(beacons.length, 1);
});
