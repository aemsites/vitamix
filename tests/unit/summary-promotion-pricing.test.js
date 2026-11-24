import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import cart from '../../scripts/cart.js';
import { setManualCoupon } from '../../scripts/commerce/coupon-state.js';
import { __setMetadata } from './mocks/aem.mjs';

globalThis.window.location = new URL('https://example.com/us/en_us/order/cart');
const { default: decorateCart } = await import('../../blocks/cart-summary/cart-summary.js');
const { default: decorateOrder } = await import('../../blocks/order-summary/order-summary.js');

function element() {
  const parts = new Map();
  const listeners = new Map();
  let text = '';
  return {
    children: [],
    hidden: false,
    value: '',
    className: '',
    classList: { add() {}, remove() {} },
    get textContent() { return text + this.children.map((child) => child.textContent || '').join(''); },
    set textContent(value) { text = String(value); this.children = []; },
    set innerHTML(value) { this.textContent = value; },
    get childElementCount() { return this.children.length; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.textContent = ''; this.append(...children); },
    setAttribute() {},
    insertAdjacentElement() {},
    closest() { return null; },
    querySelector(selector) {
      if (selector === 'a' || selector === '.order-summary-toggle') return null;
      if (!parts.has(selector)) parts.set(selector, element());
      return parts.get(selector);
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    emit(type, detail) {
      listeners.get(type)?.forEach((fn) => fn({ type, detail }));
    },
  };
}

let events;
let requests;
let response;

beforeEach(() => {
  globalThis.__resetTestState();
  globalThis.HTMLElement = class HTMLElement {};
  cart.clear();
  __setMetadata({ 'disabled-providers': 'apple-pay,google-pay,paypal' });
  const eventTarget = element();
  document.createElement = element;
  document.addEventListener = eventTarget.addEventListener;
  document.querySelectorAll = () => [];
  document.getElementById = () => ({});
  events = eventTarget;
  requests = [];
  globalThis.__setFetchMock(async (url, init) => {
    assert.ok(url.endsWith('/estimate/price'), `Unexpected request: ${url}`);
    requests.push(JSON.parse(init.body));
    return { ok: true, json: async () => response };
  });
});

function seedCart(price = '200.00', coupon = 'SAVE') {
  cart.addItem({
    sku: 'test-sku', name: 'Test Product', path: '/products/test-product', quantity: 1, price,
  });
  if (coupon) setManualCoupon(coupon);
}

const promotion = (amount = 40) => ({
  id: 'test-promo', name: 'Test promotion', source: 'promotion', amount,
});
const coupon = (amount = 30) => ({
  id: 'coupon:SAVE', name: 'Test coupon', source: 'coupon', amount,
});

[['cart-summary', decorateCart], ['order-summary', decorateOrder]].forEach(([prefix, decorate]) => {
  const mount = async () => {
    const block = element();
    await decorate(block);
    await setImmediate();
    return {
      block,
      subtotal: block.querySelector(`.${prefix}-subtotal`),
      total: block.querySelector(`.${prefix}-grand-total`),
      discounts: block.querySelector(`.${prefix}-discounts`),
    };
  };

  [
    ['regular-price cart', '200.00', 40, 70],
    ['promotional-price cart', '160.00', 0, 30],
    ['normalized API total', '200.00', 40, 30],
  ].forEach(([label, price, promoAmount, scalar]) => {
    test(`${prefix}: ${label} counts the promotion only once`, async () => {
      seedCart(price);
      response = {
        subtotal: 160, orderDiscountTotal: scalar, discounts: [promotion(promoAmount), coupon()],
      };
      const summary = await mount();
      assert.equal(requests[0].items[0].price.final, price);
      assert.equal(cart.items[0].price, price);
      assert.equal(summary.subtotal.textContent, `$${price}`);
      assert.equal(summary.total.textContent, '130.00');
      assert.equal(summary.discounts.childElementCount, promoAmount ? 2 : 1);
      if (promoAmount) assert.match(summary.discounts.textContent, /Test promotion.*-\$40.00/);
      else assert.doesNotMatch(summary.discounts.textContent, /Test promotion/);
      if (prefix === 'order-summary') {
        const line = summary.block.querySelector('.order-summary-items').children[0];
        assert.equal(line.querySelector('.cart-item-price').textContent, `$${price}`);
      }
      assert.match(summary.discounts.textContent, /-\$30.00/);
      assert.equal(summary.discounts.hidden, false);
    });
  });

  test(`${prefix}: promotion-only savings explain the difference from stored line prices`, async () => {
    seedCart();
    response = { subtotal: 160, orderDiscountTotal: 40, discounts: [promotion()] };
    const summary = await mount();
    assert.equal(summary.subtotal.textContent, '$200.00');
    assert.equal(summary.total.textContent, '160.00');
    assert.equal(summary.discounts.childElementCount, 1);
    assert.match(summary.discounts.textContent, /Test promotion.*-\$40.00/);
    assert.equal(summary.discounts.hidden, false);
  });

  test(`${prefix}: coupon and cart-rule discounts still reduce the subtotal`, async () => {
    seedCart('160.00');
    response = {
      subtotal: '160.00',
      orderDiscountTotal: 35.25,
      discounts: [coupon('30.00'), { id: 'cart-rule', source: 'auto', name: 'Cart savings', amount: '5.25' }],
    };
    const summary = await mount();
    assert.equal(summary.total.textContent, '124.75');
    assert.equal(summary.discounts.childElementCount, 2);
    assert.match(summary.discounts.textContent, /-\$30.00/);
    assert.match(summary.discounts.textContent, /-\$5.25/);
  });

  test(`${prefix}: sums additional discounts in cents`, async () => {
    seedCart('1.00');
    response = { subtotal: '1.00', discounts: [coupon('0.10'), { amount: '0.20' }] };
    const summary = await mount();
    assert.equal(summary.total.textContent, '0.70');
  });

  test(`${prefix}: preserves a zero net subtotal with a full promotional deduction`, async () => {
    seedCart();
    response = { subtotal: '0.00', orderDiscountTotal: 200, discounts: [promotion(200)] };
    const summary = await mount();
    assert.equal(summary.subtotal.textContent, '$200.00');
    assert.match(summary.discounts.textContent, /-\$200.00/);
    assert.equal(summary.total.textContent, '0.00');
  });

  test(`${prefix}: preserves a zero subtotal without promotional deductions`, async () => {
    seedCart();
    response = { subtotal: '0.00', discounts: [] };
    const summary = await mount();
    assert.equal(summary.subtotal.textContent, '$0.00');
    assert.equal(summary.total.textContent, '0.00');
  });

  [['missing', undefined], ['non-numeric', 'invalid'], ['non-finite', Infinity]]
    .forEach(([label, subtotal]) => {
      test(`${prefix}: ${label} subtotal falls back to the stored cart subtotal`, async () => {
        seedCart();
        response = { subtotal, discounts: [coupon()] };
        const summary = await mount();
        assert.equal(summary.subtotal.textContent, '$200.00');
        assert.equal(summary.total.textContent, '170.00');
      });
    });

  test(`${prefix}: mixed regular and promoted lines retain an additive summary`, async () => {
    seedCart();
    cart.addItem({
      sku: 'second-sku', name: 'Second Product', quantity: 1, price: '100.00',
    });
    response = {
      subtotal: 260, discounts: [promotion('40.00'), promotion('0.00'), coupon()],
    };
    const summary = await mount();
    assert.equal(summary.subtotal.textContent, '$300.00');
    assert.equal(summary.total.textContent, '230.00');
    assert.equal(summary.discounts.childElementCount, 2);
    assert.equal(cart.subtotal, 300);
  });

  test(`${prefix}: promotion savings cover the full line quantity`, async () => {
    seedCart();
    cart.updateItem('test-sku', 2);
    response = { subtotal: 320, discounts: [promotion(80), coupon()] };
    const summary = await mount();
    assert.equal(summary.subtotal.textContent, '$400.00');
    assert.equal(summary.total.textContent, '290.00');
    assert.match(summary.discounts.textContent, /-\$80.00/);
    assert.equal(cart.subtotal, 400);
  });

  test(`${prefix}: missing discounts do not reuse the aggregate discount total`, async () => {
    seedCart('160.00');
    response = { subtotal: 160, orderDiscountTotal: 40 };
    const summary = await mount();
    assert.equal(summary.total.textContent, '160.00');
    assert.equal(summary.discounts.hidden, true);
  });

  test(`${prefix}: no coupon keeps the initial cart total without a price request`, async () => {
    seedCart('160.00', '');
    const summary = await mount();
    assert.equal(summary.total.textContent, '160.00');
    assert.equal(requests.length, 0);
  });

  test(`${prefix}: additional discounts cannot make the estimated total negative`, async () => {
    seedCart('10.00');
    response = { subtotal: 10, discounts: [coupon(20)] };
    const summary = await mount();
    assert.equal(summary.total.textContent, '0.00');
  });
});

test('order-summary: promotion rows stay additive through shipping selection and preview', async () => {
  seedCart();
  response = { subtotal: 160, orderDiscountTotal: 70, discounts: [promotion(), coupon()] };
  const block = element();
  await decorateOrder(block);
  await setImmediate();
  const total = block.querySelector('.order-summary-grand-total');
  assert.equal(total.textContent, '130.00');

  events.emit('checkout:shipping-selected', { shippingMethod: { rate: '10.00' } });
  assert.equal(total.textContent, '140.00');
  assert.equal(block.querySelector('.order-summary-header-total').textContent, '$140.00');

  events.emit('checkout:preview', {
    preview: {
      subtotal: '160.00',
      total: '147.23',
      taxAmount: '7.23',
      shippingMethod: { rate: '10.00' },
      discounts: [promotion(), coupon()],
    },
  });
  assert.equal(total.textContent, '147.23');
  assert.equal(block.querySelector('.order-summary-subtotal').textContent, '$200.00');
  assert.equal(block.querySelector('.order-summary-header-total').textContent, '$147.23');
  assert.equal(block.querySelector('.order-summary-taxes').textContent, '$7.23');
  const discounts = block.querySelector('.order-summary-discounts');
  assert.equal(discounts.childElementCount, 2);
  assert.match(discounts.textContent, /Test promotion.*-\$40.00/);
  assert.match(discounts.textContent, /-\$30.00/);

  events.emit('checkout:preview', {
    preview: {
      subtotal: '160.00',
      total: '147.23',
      taxAmount: '7.23',
      shippingMethod: { rate: '10.00' },
      discounts: [promotion(0), coupon()],
    },
  });
  assert.equal(block.querySelector('.order-summary-subtotal').textContent, '$160.00');
  assert.equal(total.textContent, '147.23');
  assert.equal(discounts.childElementCount, 1);
  assert.doesNotMatch(discounts.textContent, /Test promotion/);
});
