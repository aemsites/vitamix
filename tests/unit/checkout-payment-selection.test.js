import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPaymentSection } from '../../blocks/checkout/checkout-payment.js';
import { getSelectedPaymentMethod } from '../../blocks/checkout/checkout-order.js';

function createClassList(element) {
  return {
    add(...classes) {
      const existing = element.className ? element.className.split(/\s+/) : [];
      element.className = [...new Set([...existing, ...classes])].join(' ');
    },
    remove(...classes) {
      const remove = new Set(classes);
      element.className = (element.className || '')
        .split(/\s+/)
        .filter((name) => name && !remove.has(name))
        .join(' ');
    },
    contains(className) {
      return (element.className || '').split(/\s+/).includes(className);
    },
    toggle(className, force) {
      if (force) this.add(className);
      else this.remove(className);
    },
  };
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.eventListeners = {};
    this.className = '';
    this.classList = createClassList(this);
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(type, handler) {
    this.eventListeners[type] = handler;
  }

  closest(selector) {
    if (selector === 'form') {
      return this.tagName === 'FORM' ? this : this.parentElement?.closest(selector) || null;
    }
    if (selector.startsWith('.')) {
      return this.classList.contains(selector.slice(1))
        ? this
        : this.parentElement?.closest(selector) || null;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const matches = (element) => {
      if (selector === 'input[type="radio"]') {
        return element.tagName === 'INPUT' && element.type === 'radio';
      }
      if (selector === 'input[type="radio"][name="paymentMethod"]') {
        return element.tagName === 'INPUT' && element.type === 'radio' && element.name === 'paymentMethod';
      }
      if (selector === '[name="paymentMethod"]:checked') {
        return element.name === 'paymentMethod' && element.checked === true;
      }
      if (selector === '.payment-option-card') {
        return element.classList.contains('payment-option-card');
      }
      if (selector === '.billing-section') {
        return element.classList.contains('billing-section');
      }
      return false;
    };
    const visit = (element) => {
      if (matches(element)) results.push(element);
      element.children.forEach(visit);
    };
    visit(this);
    return results;
  }
}

const strings = {
  paymentSecureTitle: 'Secure payment',
  paymentSecureSub: 'Pay securely',
  paymentHow: 'How would you like to pay?',
  creditCard: 'Credit card',
  creditCardSub: 'Pay by card',
  paypalLabel: 'PayPal',
  paypalSub: 'Continue with PayPal',
  applePayLabel: 'Apple Pay',
  applePaySub: 'Continue with Apple Pay',
  affirmLabel: 'Affirm',
  affirmSub: 'Pay over time',
};

function withFakeDocument(fn) {
  const originalDocument = globalThis.document;
  const originalInput = globalThis.HTMLInputElement;
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
  };
  globalThis.HTMLInputElement = FakeElement;
  try {
    fn();
  } finally {
    globalThis.document = originalDocument;
    globalThis.HTMLInputElement = originalInput;
  }
}

test('renderPaymentSection does not select card by default', () => {
  withFakeDocument(() => {
    const container = new FakeElement('fieldset');

    renderPaymentSection(container, [{ id: 'chase' }], {}, strings, { cardProvider: 'chase' });

    const radios = container.querySelectorAll('input[type="radio"][name="paymentMethod"]');
    assert.equal(radios.length, 1);
    assert.equal(radios[0].value, 'chase');
    assert.equal(radios[0].checked, undefined);
    assert.equal(container.querySelector('.payment-option-card').classList.contains('payment-option-active'), false);
  });
});

test('renderPaymentSection does not select first wallet provider when card is unavailable', () => {
  withFakeDocument(() => {
    const container = new FakeElement('fieldset');
    const paypal = {
      id: 'paypal',
      renderCheckoutButton: () => {},
    };

    renderPaymentSection(container, [paypal], {}, strings, { cardProvider: 'chase' });

    const radios = container.querySelectorAll('input[type="radio"][name="paymentMethod"]');
    assert.equal(radios.length, 1);
    assert.equal(radios[0].value, 'paypal');
    assert.equal(radios[0].checked, undefined);
    assert.equal(container.querySelector('.payment-option-card').classList.contains('payment-option-active'), false);
  });
});

test('getSelectedPaymentMethod returns null until the shopper selects a method', () => {
  const form = new FakeElement('form');
  const radio = new FakeElement('input');
  radio.name = 'paymentMethod';
  radio.value = 'chase';
  radio.type = 'radio';
  form.appendChild(radio);

  assert.equal(getSelectedPaymentMethod(form), null);
  radio.checked = true;
  assert.equal(getSelectedPaymentMethod(form), 'chase');
});
