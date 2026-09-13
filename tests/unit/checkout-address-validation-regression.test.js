import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAndCollapseAddress } from '../../blocks/checkout/checkout-address.js';
import { buildOrderJSON } from '../../blocks/checkout/checkout-order.js';
import paypal from '../../scripts/payments/paypal.js';
import applePay from '../../scripts/payments/apple-pay.js';

const originalDocument = globalThis.document;
const originalFormData = globalThis.FormData;
const originalPaypal = globalThis.window.paypal;
const originalApplePaySession = globalThis.window.ApplePaySession;

function createElement(tag, buttonTextToClick = null) {
  const element = {
    tagName: tag.toUpperCase(),
    children: [],
    listeners: {},
    className: '',
    textContent: '',
    type: '',
    disabled: false,
    set innerHTML(value) { this.html = value; },
    get innerHTML() { return this.html || ''; },
    setAttribute(name, value) { this[name] = value; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; },
    querySelector() { return null; },
    addEventListener(type, listener) {
      this.listeners[type] ||= [];
      this.listeners[type].push(listener);
    },
    remove() { this.removed = true; },
    close() { this.listeners.close?.forEach((listener) => listener()); },
    showModal() {
      if (!buttonTextToClick) return;
      const buttons = [];
      const collectButtons = (node) => {
        if (node.tagName === 'BUTTON') buttons.push(node);
        node.children?.forEach(collectButtons);
      };
      collectButtons(this);
      const button = buttons.find((b) => b.textContent === buttonTextToClick);
      assert.ok(button, `expected dialog button ${buttonTextToClick}`);
      button.listeners.click?.forEach((listener) => listener());
    },
  };
  return element;
}

function installDocument(buttonTextToClick = null) {
  globalThis.document = {
    ...originalDocument,
    createElement: (tag) => createElement(tag, buttonTextToClick),
    querySelectorAll: () => [],
    querySelector: () => null,
    body: createElement('body', buttonTextToClick),
    head: createElement('head', buttonTextToClick),
  };
}

function installFormData(values) {
  function TestFormData() {}
  TestFormData.prototype.get = (name) => values[name] ?? '';
  globalThis.FormData = TestFormData;
}

const addressValues = {
  email: 'jane@example.com',
  'shipping-firstname': 'Jane',
  'shipping-lastname': 'Doe',
  'shipping-street-0': '999 New Development Rd',
  'shipping-street-1': '',
  'shipping-city': 'Bolivia',
  'shipping-state': 'NC',
  'shipping-zip': '28422',
  'shipping-telephone': '(555) 123-4567',
  paymentMethod: 'chase',
};

const form = {
  querySelector(selector) {
    if (selector === '[name="billing-choice"]:checked') return { value: 'same' };
    return null;
  },
};

function section() {
  return {
    closest(selector) {
      assert.equal(selector, 'form');
      return form;
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[required]');
      return [{
        name: 'shipping-street-0',
        value: addressValues['shipping-street-0'],
        required: true,
        form: { dataset: { locale: 'us', lang: 'en' } },
        checkValidity: () => true,
      }];
    },
    querySelector(selector) {
      if (selector === '.address-validation-error') return null;
      if (selector === '.form-fields') return null;
      return null;
    },
    append() {},
  };
}

const config = {
  getLocale: () => 'us',
  getLanguage: () => 'en_us',
  apiOrigin: 'https://api.example.test',
  addressDoctorOrigin: 'https://addressdoctor.example.test',
  currency: () => 'USD',
  site: 'Vitamix',
};

const strings = {
  addressUnvalidatedHeading: 'Address Verification',
  addressUnvalidatedMessage: 'We are unable to verify the address you entered. Please confirm that the address below is correct before proceeding to the next step.',
  addressContinueEntered: 'Continue with this address',
  addressChange: 'Change Address',
};

const cart = {
  subtotal: 10,
  getItemsForAPI: () => [{ sku: 'sku-1', path: '/products/sku-1', quantity: 1, price: { currency: 'USD', regular: '10.00' } }],
};

function mockAddressValidation(response) {
  globalThis.__setFetchMock(async () => ({ ok: true, json: async () => response }));
}

async function validateShipping(response, buttonText = null) {
  installDocument(buttonText);
  installFormData(addressValues);
  mockAddressValidation(response);
  const state = {};

  const valid = await validateAndCollapseAddress(
    section(),
    () => {},
    config,
    strings,
    null,
    'shipping-',
    (value) => { state.shippingAddressIsValidated = value; },
  );

  return { valid, state };
}

function orderFromState(state) {
  return buildOrderJSON({ get: (name) => addressValues[name] ?? '' }, form, cart, state, config);
}

afterEach(() => {
  globalThis.document = originalDocument;
  globalThis.FormData = originalFormData;
  globalThis.window.paypal = originalPaypal;
  globalThis.window.ApplePaySession = originalApplePaySession;
  globalThis.__resetTestState();
});

test('checkout persists shipping.isValidated false after continuing with unvalidated address', async () => {
  const { valid, state } = await validateShipping({
    provider: 'addressdoctor',
    action: 'CONFIRM_UNVALIDATED',
    formattedAddress: null,
    addressComponents: null,
    uspsDeliverable: false,
  }, 'Continue with this address');

  const order = orderFromState(state);

  assert.equal(valid, true);
  assert.equal(order.shipping.isValidated, false);
});

test('checkout persists shipping.isValidated true for AddressDoctor confirm suggestions', async () => {
  const { valid, state } = await validateShipping({
    provider: 'addressdoctor',
    action: 'CONFIRM',
    formattedAddress: null,
    addressComponents: null,
    uspsDeliverable: true,
    diagnostics: { processStatus: 'I3' },
  });

  const order = orderFromState(state);

  assert.equal(valid, true);
  assert.equal(order.shipping.isValidated, true);
});

test('PayPal Express order body omits address validation metadata', async () => {
  installDocument();
  let buttonConfig;
  globalThis.window.paypal = {
    FUNDING: { PAYPAL: 'paypal', PAYLATER: 'paylater' },
    Buttons(configArg) {
      buttonConfig ||= configArg;
      return { render() {}, isEligible: () => false };
    },
  };
  const container = createElement('div');
  const state = { paypalSessionId: 'PAYPAL-ORDER', currentEstimateToken: 'estimate-token' };
  const createdBodies = [];

  globalThis.__setFetchMock(async () => ({
    ok: true,
    json: async () => ({
      payer: { firstName: 'Pay', lastName: 'Pal', email: 'paypal@example.com' },
      shippingAddress: {
        address1: '123 PayPal St',
        city: 'San Jose',
        state: 'CA',
        zip: '95131',
        country: 'us',
        phone: '5555555555',
      },
      selectedOptionId: 'standard',
    }),
    headers: { get: () => null },
  }));

  paypal.renderExpressButton(container, {
    getConfig: () => config,
    getCart: () => cart,
    getState: () => state,
    createOrder: async (body) => { createdBodies.push(body); return { id: 'order-1' }; },
    initiatePayment: async () => ({ status: 'completed' }),
    onComplete() {},
    showError(message) { throw new Error(message); },
    previewOrderDirect: async () => ({ estimateToken: 'estimate-token' }),
    strings: {},
  });

  await buttonConfig.onApprove();

  assert.equal(createdBodies.length, 1);
  assert.equal(createdBodies[0].shipping.isValidated, undefined);
  assert.equal(createdBodies[0].billing.isValidated, undefined);
});

test('Apple Pay Express order body omits address validation metadata', async () => {
  installDocument();
  let session;
  class TestApplePaySession {
    static STATUS_SUCCESS = 1;

    static STATUS_FAILURE = 0;

    constructor() { session = this; }

    begin() { this.begun = true; }

    completePayment(status) { this.paymentStatus = status; }
  }
  globalThis.window.ApplePaySession = TestApplePaySession;
  const container = createElement('div');
  const state = { currentEstimateToken: 'estimate-token' };
  const createdBodies = [];

  applePay.renderExpressButton(container, {
    getConfig: () => config,
    getCart: () => cart,
    getState: () => state,
    createOrder: async (body) => { createdBodies.push(body); return { id: 'order-1' }; },
    initiatePayment: async () => ({ status: 'completed' }),
    onComplete() {},
    showError(message) { throw new Error(message); },
    strings: {},
  });

  const [button] = container.children;
  button.listeners.click[0]();
  await session.onpaymentauthorized({
    payment: {
      token: { paymentData: 'token' },
      billingContact: {},
      shippingMethod: { identifier: 'standard' },
      shippingContact: {
        givenName: 'Apple',
        familyName: 'Pay',
        addressLines: ['1 Infinite Loop'],
        locality: 'Cupertino',
        administrativeArea: 'CA',
        postalCode: '95014',
        countryCode: 'US',
        phoneNumber: '5555555555',
        emailAddress: 'apple@example.com',
      },
    },
  });

  assert.equal(createdBodies.length, 1);
  assert.equal(createdBodies[0].shipping.isValidated, undefined);
  assert.equal(createdBodies[0].billing.isValidated, undefined);
  assert.equal(session.paymentStatus, TestApplePaySession.STATUS_SUCCESS);
});
