import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAndCollapseAddress } from '../../blocks/checkout/checkout-address.js';

const originalDocument = globalThis.document;
const OriginalFormData = globalThis.FormData;

function createFakeElement(tag, buttonTextToClick) {
  const element = {
    tagName: tag.toUpperCase(),
    children: [],
    listeners: {},
    className: '',
    textContent: '',
    type: '',
    set innerHTML(value) { this.html = value; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; },
    setAttribute() {},
    addEventListener(type, listener) {
      this.listeners[type] ||= [];
      this.listeners[type].push(listener);
    },
    remove() { this.removed = true; },
    close() { this.listeners.close?.forEach((listener) => listener()); },
    showModal() {
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

function installDialogDocument(buttonTextToClick) {
  const createElement = (tag) => createFakeElement(tag, buttonTextToClick);
  globalThis.document = {
    ...originalDocument,
    createElement,
    querySelectorAll: () => [],
    body: createElement('body'),
  };
}

function installFormData(values) {
  function TestFormData() {}
  TestFormData.prototype.get = (name) => values[name] ?? '';
  globalThis.FormData = TestFormData;
}

function section(form) {
  return {
    closest(selector) {
      assert.equal(selector, 'form');
      return form;
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[required]');
      return [{
        name: 'shipping-street-0',
        value: '999 New Development Rd',
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

const form = {};
const config = {
  getLocale: () => 'us',
  apiOrigin: 'https://api.adobecommerce.live/org/sites/site',
  addressDoctorOrigin: 'https://vitamix-address-doctor-proxy-worker.adobeaem.workers.dev',
};

const strings = {
  addressUnvalidatedHeading: 'Address Verification',
  addressUnvalidatedMessage: 'We are unable to verify the address you entered. Please confirm that the address below is correct before proceeding to the next step.',
  addressContinueEntered: 'Continue with this address',
  addressChange: 'Change Address',
};

const addressValues = {
  'shipping-street-0': '999 New Development Rd',
  'shipping-street-1': '',
  'shipping-city': 'Bolivia',
  'shipping-state': 'NC',
  'shipping-zip': '28422',
};

function mockValidationResponse(response) {
  globalThis.__setFetchMock(async () => ({
    ok: true,
    json: async () => response,
  }));
}

afterEach(() => {
  globalThis.document = originalDocument;
  globalThis.FormData = OriginalFormData;
  globalThis.__resetTestState();
});

test('validateAndCollapseAddress records false when shopper continues unvalidated address', async () => {
  installDialogDocument('Continue with this address');
  installFormData(addressValues);
  mockValidationResponse({
    provider: 'addressdoctor',
    action: 'CONFIRM_UNVALIDATED',
    formattedAddress: null,
    addressComponents: null,
    uspsDeliverable: false,
  });

  let collapsed = false;
  let validationState;
  const result = await validateAndCollapseAddress(
    section(form),
    () => { collapsed = true; },
    config,
    strings,
    null,
    'shipping-',
    (value) => { validationState = value; },
  );

  assert.equal(result, true);
  assert.equal(collapsed, true);
  assert.equal(validationState, false);
});

test('validateAndCollapseAddress keeps section open when shopper changes unvalidated address', async () => {
  installDialogDocument('Change Address');
  installFormData(addressValues);
  mockValidationResponse({
    provider: 'addressdoctor',
    action: 'CONFIRM_UNVALIDATED',
    formattedAddress: null,
    addressComponents: null,
    uspsDeliverable: false,
  });

  let collapsed = false;
  let validationState;
  const result = await validateAndCollapseAddress(
    section(form),
    () => { collapsed = true; },
    config,
    strings,
    null,
    'shipping-',
    (value) => { validationState = value; },
  );

  assert.equal(result, false);
  assert.equal(collapsed, false);
  assert.equal(validationState, undefined);
});

test('validateAndCollapseAddress records true for confirmed usable suggestions', async () => {
  installFormData(addressValues);
  mockValidationResponse({
    provider: 'addressdoctor',
    action: 'CONFIRM',
    formattedAddress: null,
    addressComponents: null,
    uspsDeliverable: true,
  });

  let collapsed = false;
  let validationState;
  const result = await validateAndCollapseAddress(
    section(form),
    () => { collapsed = true; },
    config,
    strings,
    null,
    'shipping-',
    (value) => { validationState = value; },
  );

  assert.equal(result, true);
  assert.equal(collapsed, true);
  assert.equal(validationState, true);
});
