import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import buildCartItem from '../../scripts/commerce/cart-item.js';

/**
 * Minimal stand-in for a DOM element: enough surface for buildCartItem to
 * wire up listeners and write text/value/hidden/disabled state.
 *
 * @returns {Object} fake element with `emit(type)` to fire registered listeners
 */
function fakeElement() {
  const listeners = {};
  const el = {
    value: '',
    textContent: '',
    className: '',
    hidden: false,
    disabled: false,
    appendChild() {},
    before() {},
    remove() { el.removed = true; },
    addEventListener(type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    emit(type) {
      (listeners[type] || []).forEach((fn) => fn({ target: el, preventDefault() {} }));
    },
  };
  return el;
}

/**
 * Builds a cart row against a fake DOM and returns handles on the controls.
 *
 * @param {Object} item cart item passed to buildCartItem
 * @returns {{ qtyInput: Object, inc: Object, dec: Object, price: Object,
 *   limitMessage: Object, qtyChanges: Array, removals: Array }}
 */
function mountRow(item) {
  const parts = new Map();
  globalThis.document.createElement = () => {
    const root = fakeElement();
    root.querySelector = (selector) => {
      if (!parts.has(selector)) parts.set(selector, fakeElement());
      return parts.get(selector);
    };
    return root;
  };

  const qtyChanges = [];
  const removals = [];
  buildCartItem(item, {
    onQtyChange: (sku, qty) => qtyChanges.push([sku, qty]),
    onRemove: (sku) => removals.push(sku),
  });

  return {
    qtyInput: parts.get('.qty-input'),
    inc: parts.get('.qty-inc'),
    dec: parts.get('.qty-dec'),
    price: parts.get('.cart-item-price'),
    limitMessage: parts.get('.cart-item-qty-limit-message'),
    qtyChanges,
    removals,
  };
}

/**
 * Simulates a shopper typing a quantity into the input and committing it
 * (Enter / blur), which fires `change` with the new value already in the field.
 *
 * @param {Object} qtyInput fake qty input
 * @param {number|string} value typed value
 */
function typeQty(qtyInput, value) {
  qtyInput.value = String(value);
  qtyInput.emit('change');
}

const baseItem = (overrides = {}) => ({
  sku: 'VX1',
  name: 'Vitamix VX1',
  price: '100',
  quantity: 1,
  ...overrides,
});

beforeEach(() => {
  globalThis.__resetTestState();
  globalThis.HTMLElement = class HTMLElement {};
});

test('typing a new quantity commits it to the cart and updates the row total', () => {
  const row = mountRow(baseItem());

  typeQty(row.qtyInput, 3);

  assert.deepEqual(row.qtyChanges, [['VX1', 3]]);
  assert.equal(row.price.textContent, '$300.00');
});

test('typing a quantity above the limit commits the clamped quantity', () => {
  const row = mountRow(baseItem({ custom: { maxCartQty: 3 } }));

  typeQty(row.qtyInput, 50);

  assert.deepEqual(row.qtyChanges, [['VX1', 3]]);
  assert.equal(row.qtyInput.value, 3);
  assert.equal(row.limitMessage.hidden, false);
});

test('typing the quantity already in the cart does not commit again', () => {
  const row = mountRow(baseItem({ quantity: 2 }));

  typeQty(row.qtyInput, 2);

  assert.deepEqual(row.qtyChanges, []);
});

test('typing the same quantity twice commits only once', () => {
  const row = mountRow(baseItem());

  typeQty(row.qtyInput, 4);
  typeQty(row.qtyInput, 4);

  assert.deepEqual(row.qtyChanges, [['VX1', 4]]);
});

test('typing a different quantity after a committed change commits again', () => {
  const row = mountRow(baseItem());

  typeQty(row.qtyInput, 4);
  typeQty(row.qtyInput, 2);

  assert.deepEqual(row.qtyChanges, [['VX1', 4], ['VX1', 2]]);
});

test('typing a quantity above the limit when already at the limit does not commit', () => {
  const row = mountRow(baseItem({ quantity: 3, custom: { maxCartQty: 3 } }));

  typeQty(row.qtyInput, 50);

  assert.deepEqual(row.qtyChanges, []);
  assert.equal(row.qtyInput.value, 3);
  assert.equal(row.limitMessage.hidden, false);
});

test('increment button commits quantity + 1', () => {
  const row = mountRow(baseItem({ quantity: 2 }));

  row.inc.emit('click');

  assert.deepEqual(row.qtyChanges, [['VX1', 3]]);
  assert.equal(row.price.textContent, '$300.00');
});

test('increment button at the limit does not commit and shows the limit message', () => {
  const row = mountRow(baseItem({ quantity: 3, custom: { maxCartQty: 3 } }));

  row.inc.emit('click');

  assert.deepEqual(row.qtyChanges, []);
  assert.equal(row.limitMessage.hidden, false);
  assert.equal(row.inc.disabled, true);
});

test('decrement button commits quantity - 1', () => {
  const row = mountRow(baseItem({ quantity: 3 }));

  row.dec.emit('click');

  assert.deepEqual(row.qtyChanges, [['VX1', 2]]);
});

test('typing a quantity below 1 removes the item instead of committing', () => {
  const row = mountRow(baseItem({ quantity: 2 }));

  typeQty(row.qtyInput, 0);

  assert.deepEqual(row.removals, ['VX1']);
  assert.deepEqual(row.qtyChanges, []);
});
