/**
 * Unit tests for scripts/cart.js.
 *
 * Run with `npm run test:unit` (which sets `--import=./tests/unit/setup.mjs`).
 * The setup file installs browser globals and registers a loader that mocks
 * scripts/commerce-config.js.
 *
 * Each test gets a freshly cleared localStorage / cookies / event log via the
 * beforeEach hook below. Tests construct their own Cart instances; the
 * module-level `window.cart` singleton is created on import but its state is
 * wiped before each test runs.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Cart } from '../../scripts/cart.js';
import { __setCurrency } from './mocks/commerce-config.mjs';

beforeEach(() => {
  globalThis.__resetTestState();
});

const STORAGE_KEY = 'cart:us';

const sampleItem = (overrides = {}) => ({
  sku: 'foo',
  quantity: 1,
  price: '10.00',
  name: 'Foo',
  ...overrides,
});

// --- shape ------------------------------------------------------------------

test('starts empty', () => {
  const cart = new Cart();
  assert.deepEqual(cart.items, []);
  assert.equal(cart.itemCount, 0);
  assert.equal(cart.subtotal, 0);
});

test('items is an array', () => {
  const cart = new Cart();
  assert.equal(Array.isArray(cart.items), true);
});

// --- addItem ----------------------------------------------------------------

test('addItem stores a new item', () => {
  const cart = new Cart();
  cart.addItem(sampleItem());
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].sku, 'foo');
  assert.equal(cart.items[0].quantity, 1);
});

test('addItem with the same SKU merges and increments quantity', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ quantity: 1 }));
  cart.addItem(sampleItem({ quantity: 2 }));
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 3);
});

test('addItem with different SKUs creates separate entries', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ sku: 'foo' }));
  cart.addItem(sampleItem({ sku: 'bar' }));
  assert.equal(cart.items.length, 2);
  assert.deepEqual(cart.items.map((i) => i.sku), ['foo', 'bar']);
});

test('addItem preserves insertion order across many entries', () => {
  const cart = new Cart();
  ['a', 'b', 'c', 'd'].forEach((sku) => cart.addItem(sampleItem({ sku })));
  assert.deepEqual(cart.items.map((i) => i.sku), ['a', 'b', 'c', 'd']);
});

// --- updateItem -------------------------------------------------------------

test('updateItem sets quantity on an existing entry', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ quantity: 1 }));
  cart.updateItem('foo', 5);
  assert.equal(cart.items[0].quantity, 5);
});

test('updateItem updates the correct entry when multiple SKUs are present', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ sku: 'foo', quantity: 1 }));
  cart.addItem(sampleItem({ sku: 'bar', quantity: 1 }));
  cart.updateItem('bar', 7);
  const bar = cart.items.find((i) => i.sku === 'bar');
  const foo = cart.items.find((i) => i.sku === 'foo');
  assert.equal(bar.quantity, 7);
  assert.equal(foo.quantity, 1);
});

test('updateItem throws when sku is not in the cart', () => {
  const cart = new Cart();
  assert.throws(() => cart.updateItem('missing', 1), /not found/);
});

// --- removeItem -------------------------------------------------------------

test('removeItem removes the entry', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ sku: 'foo' }));
  cart.addItem(sampleItem({ sku: 'bar' }));
  cart.removeItem('foo');
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].sku, 'bar');
});

test('removeItem on a missing sku does not throw', () => {
  const cart = new Cart();
  assert.doesNotThrow(() => cart.removeItem('missing'));
  assert.equal(cart.items.length, 0);
});

// --- clear ------------------------------------------------------------------

test('clear empties the cart', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ sku: 'foo' }));
  cart.addItem(sampleItem({ sku: 'bar' }));
  cart.clear();
  assert.deepEqual(cart.items, []);
});

test('clear persists the empty state to localStorage immediately', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ sku: 'foo' }));
  cart.clear();
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
  assert.deepEqual(stored.items, []);
});

// --- itemCount / subtotal ---------------------------------------------------

test('itemCount sums quantities across entries', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ sku: 'foo', quantity: 2 }));
  cart.addItem(sampleItem({ sku: 'bar', quantity: 3 }));
  assert.equal(cart.itemCount, 5);
});

test('visibleItemCount excludes entries with local.showInCart === false', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ sku: 'foo', quantity: 2 }));
  cart.addItem(sampleItem({
    sku: 'addon',
    quantity: 2,
    local: { showInCart: false },
  }));
  assert.equal(cart.itemCount, 4);
  assert.equal(cart.visibleItemCount, 2);
});

test('visibleItemCount equals itemCount when no entries are hidden', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ sku: 'foo', quantity: 2 }));
  cart.addItem(sampleItem({ sku: 'bar', quantity: 3, local: { showInCart: true } }));
  assert.equal(cart.visibleItemCount, 5);
});

test('subtotal multiplies quantity by string price', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ sku: 'foo', quantity: 2, price: '10.00' }));
  cart.addItem(sampleItem({ sku: 'bar', quantity: 3, price: '5.50' }));
  // 2 * 10.00 + 3 * 5.50 = 20 + 16.5 = 36.5
  assert.equal(cart.subtotal, 36.5);
});

test('subtotal treats numeric price as integer cents', () => {
  const cart = new Cart();
  // 1099 cents = $10.99
  cart.addItem(sampleItem({ sku: 'foo', quantity: 2, price: 1099 }));
  assert.equal(cart.subtotal, 21.98);
});

// --- toJSON / persistence shape --------------------------------------------

test('toJSON produces { version: 1, items: [...] }', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ sku: 'foo' }));
  const json = cart.toJSON();
  assert.equal(json.version, 1);
  assert.equal(Array.isArray(json.items), true);
  assert.equal(json.items.length, 1);
  assert.equal(json.items[0].sku, 'foo');
});

test('toJSON returns the array form (not a SKU-keyed object)', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ sku: 'foo' }));
  cart.addItem(sampleItem({ sku: 'bar' }));
  const json = cart.toJSON();
  assert.equal(Array.isArray(json.items), true);
  assert.equal(json.items.length, 2);
});

// --- restore ----------------------------------------------------------------

test('restores from localStorage with matching version', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    items: [
      { sku: 'foo', quantity: 2, price: '10.00', name: 'Foo' },
      { sku: 'bar', quantity: 1, price: '5.00', name: 'Bar' },
    ],
  }));
  const cart = new Cart();
  assert.equal(cart.items.length, 2);
  assert.equal(cart.itemCount, 3);
});

test('discards localStorage with mismatched version', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 99,
    items: [{ sku: 'foo', quantity: 1, price: '10.00', name: 'Foo' }],
  }));
  const cart = new Cart();
  assert.equal(cart.items.length, 0);
});

test('restore is a no-op when localStorage is empty', () => {
  const cart = new Cart();
  assert.equal(cart.items.length, 0);
});

// --- getItemsForAPI ---------------------------------------------------------

test('getItemsForAPI projects expected fields', () => {
  const cart = new Cart();
  cart.addItem({
    sku: 'foo',
    quantity: 2,
    price: '10.00',
    name: 'Foo',
    path: '/products/foo',
    image: 'https://example.com/foo.jpg',
    url: 'https://example.com/foo',
  });
  const api = cart.getItemsForAPI();
  assert.equal(api.length, 1);
  assert.deepEqual(api[0], {
    sku: 'foo',
    path: '/products/foo',
    quantity: 2,
    name: 'Foo',
    price: { final: '10.00', currency: 'USD' },
    imageUrl: 'https://example.com/foo.jpg',
    productUrl: 'https://example.com/foo',
  });
});

test('getItemsForAPI derives path from url when path is missing', () => {
  // Setup needs a window.location for the URL constructor used by getItemsForAPI.
  globalThis.window.location = { origin: 'https://example.com' };
  const cart = new Cart();
  cart.addItem({
    sku: 'foo',
    quantity: 1,
    price: '10.00',
    name: 'Foo',
    url: 'https://example.com/products/foo',
  });
  const api = cart.getItemsForAPI();
  assert.equal(api[0].path, '/products/foo');
});

test('getItemsForAPI omits imageUrl/productUrl when not present', () => {
  const cart = new Cart();
  cart.addItem({
    sku: 'foo',
    quantity: 1,
    price: '10.00',
    name: 'Foo',
    path: '/products/foo',
  });
  const api = cart.getItemsForAPI();
  assert.equal('imageUrl' in api[0], false);
  assert.equal('productUrl' in api[0], false);
});

// --- cart:change events -----------------------------------------------------

const eventsByAction = (action) => globalThis.__events.filter((e) => e.detail.action === action);

test('cart:change event fires on addItem with action="add"', () => {
  const cart = new Cart();
  globalThis.__events.length = 0;
  cart.addItem(sampleItem());
  assert.equal(eventsByAction('add').length, 1);
});

test('cart:change event fires on updateItem with action="update"', () => {
  const cart = new Cart();
  cart.addItem(sampleItem());
  globalThis.__events.length = 0;
  cart.updateItem('foo', 5);
  assert.equal(eventsByAction('update').length, 1);
});

test('cart:change event fires on removeItem with action="remove"', () => {
  const cart = new Cart();
  cart.addItem(sampleItem());
  globalThis.__events.length = 0;
  cart.removeItem('foo');
  assert.equal(eventsByAction('remove').length, 1);
});

test('cart:change event fires on clear with action="clear"', () => {
  const cart = new Cart();
  cart.addItem(sampleItem());
  globalThis.__events.length = 0;
  cart.clear();
  assert.equal(eventsByAction('clear').length, 1);
});

test('cart:change empty event fires when quantity drops to 0 via update', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ quantity: 1 }));
  globalThis.__events.length = 0;
  cart.updateItem('foo', 0);
  assert.equal(eventsByAction('empty').length, 1);
});

test('cart:change empty event fires when last item is removed', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ quantity: 1 }));
  globalThis.__events.length = 0;
  cart.removeItem('foo');
  assert.equal(eventsByAction('empty').length, 1);
});

test('cart:change restore event fires when constructor loads from localStorage', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    items: [{ sku: 'foo', quantity: 1, price: '10.00', name: 'Foo' }],
  }));
  globalThis.__events.length = 0;
  // eslint-disable-next-line no-new
  new Cart();
  assert.equal(eventsByAction('restore').length, 1);
});

// --- cookie -----------------------------------------------------------------

test('cart_items_count cookie is updated on persist', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ quantity: 2 }));
  cart.clear(); // forces immediate persist; resets count to 0
  assert.match(document.cookie, /cart_items_count=0/);
});

// --- addItem: custom merge --------------------------------------------------

test('addItem merges entries with deep-equal custom payloads', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ custom: { linkedTo: 'parent-sku' } }));
  cart.addItem(sampleItem({
    quantity: 2,
    custom: { linkedTo: 'parent-sku' },
  }));
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 3);
});

test('addItem merges cleanly when neither item has a custom field', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ quantity: 1 }));
  cart.addItem(sampleItem({ quantity: 2 }));
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 3);
  assert.equal('custom' in cart.items[0], false);
});

test('addItem throws when custom payloads differ', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ custom: { linkedTo: 'A' } }));
  assert.throws(
    () => cart.addItem(sampleItem({ custom: { linkedTo: 'B' } })),
    /incompatible custom payloads/,
  );
});

test('addItem throws when only one side has a custom field', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({ custom: { linkedTo: 'A' } }));
  assert.throws(
    () => cart.addItem(sampleItem()),
    /incompatible custom payloads/,
  );
});

test('addItem merges deeply nested custom payloads when structurally equal', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({
    custom: {
      availableWarranties: [
        { sku: 'w1', name: '3yr', price: '75.00' },
        { sku: 'w2', name: '5yr', price: '125.00' },
      ],
    },
  }));
  cart.addItem(sampleItem({
    quantity: 2,
    custom: {
      availableWarranties: [
        { sku: 'w1', name: '3yr', price: '75.00' },
        { sku: 'w2', name: '5yr', price: '125.00' },
      ],
    },
  }));
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 3);
});

test('addItem throws when nested custom payloads differ', () => {
  const cart = new Cart();
  cart.addItem(sampleItem({
    custom: { availableWarranties: [{ sku: 'w1', price: '75.00' }] },
  }));
  assert.throws(
    () => cart.addItem(sampleItem({
      custom: { availableWarranties: [{ sku: 'w1', price: '80.00' }] },
    })),
    /incompatible custom payloads/,
  );
});

// --- getItemsForAPI: passthrough --------------------------------------------

test('getItemsForAPI does not forward selectedOptions', () => {
  // selectedOptions is cart-local; the Commerce API does not accept it.
  const cart = new Cart();
  cart.addItem({
    sku: 'foo',
    quantity: 1,
    price: '10.00',
    name: 'Foo',
    path: '/foo',
    selectedOptions: [{ id: 'color', value: 'Red' }],
  });
  const [api] = cart.getItemsForAPI();
  assert.equal('selectedOptions' in api, false);
});

test('getItemsForAPI forwards custom verbatim', () => {
  const cart = new Cart();
  cart.addItem({
    sku: 'foo',
    quantity: 1,
    price: '10.00',
    name: 'Foo',
    path: '/foo',
    custom: {
      linkedTo: 'parent-sku',
      showInCart: false,
      availableWarranties: [{ sku: 'w1', name: '3yr', price: '75.00' }],
    },
  });
  const [api] = cart.getItemsForAPI();
  assert.deepEqual(api.custom, {
    linkedTo: 'parent-sku',
    showInCart: false,
    availableWarranties: [{ sku: 'w1', name: '3yr', price: '75.00' }],
  });
});

test('getItemsForAPI resolves currency from a function when config provides one', () => {
  __setCurrency((locale) => (locale === 'us' ? 'USD' : 'EUR'));
  const cart = new Cart();
  cart.addItem({
    sku: 'foo',
    quantity: 1,
    price: '10.00',
    name: 'Foo',
    path: '/foo',
  });
  const [api] = cart.getItemsForAPI();
  assert.equal(api.price.currency, 'USD');
});

test('getItemsForAPI does not forward `local`', () => {
  // `local` is site-defined cart-UI data; the cart class never sends it
  // to the order body.
  const cart = new Cart();
  cart.addItem({
    sku: 'foo',
    quantity: 1,
    price: '10.00',
    name: 'Foo',
    path: '/foo',
    local: { availableWarranties: [{ sku: 'w1' }], showInCart: true },
  });
  const [api] = cart.getItemsForAPI();
  assert.equal('local' in api, false);
});

test('getItemsForAPI omits custom when not present', () => {
  const cart = new Cart();
  cart.addItem({
    sku: 'foo',
    quantity: 1,
    price: '10.00',
    name: 'Foo',
    path: '/foo',
  });
  const [api] = cart.getItemsForAPI();
  assert.equal('custom' in api, false);
});
