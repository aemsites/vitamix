/**
 * Unit tests for reCAPTCHA failures in the Apple Pay express sheet
 * (scripts/payments/apple-pay.js).
 *
 * A failed security check must not be shown as "address unserviceable":
 * that message sends shoppers into futile address retries. These tests drive
 * the real session handlers with a fake ApplePaySession.
 *
 * Run with `npm run test:unit`.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import applePay from '../../scripts/payments/apple-pay.js';

const ITEMS = [{ sku: 'sku-1', quantity: 1, price: { final: '10.00' } }];
const CONTACT = { countryCode: 'US', administrativeArea: 'CA', postalCode: '90210' };

let session;
let clickHandler;

class FakeApplePaySession {
  constructor(version, request) {
    this.version = version;
    this.request = request;
    this.aborted = false;
    this.contactUpdates = [];
    this.methodUpdates = [];
    session = this;
  }

  begin() { this.begun = true; }

  abort() { this.aborted = true; }

  completeShippingContactSelection(update) { this.contactUpdates.push(update); }

  completeShippingMethodSelection(update) { this.methodUpdates.push(update); }
}

/** Constructor stand-in for window.ApplePayError (one class per file). */
function FakeApplePayError(code, contactField, message) {
  this.code = code;
  this.contactField = contactField;
  this.message = message;
}

function recaptchaError() {
  const err = new Error('recaptcha token required');
  err.status = 403;
  err.code = 'ADOBE_COMMERCE_RECAPTCHA_FAILED';
  return err;
}

function installApplePay() {
  session = undefined;
  clickHandler = undefined;
  globalThis.window.ApplePaySession = FakeApplePaySession;
  globalThis.window.ApplePayError = FakeApplePayError;
  globalThis.document.createElement = () => ({
    setAttribute() {},
    addEventListener(type, fn) { if (type === 'click') clickHandler = fn; },
  });
  // estimate/order (not reCAPTCHA-gated) returns one shipping method.
  globalThis.__setFetchMock(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ shippingMethods: [{ id: 'std', label: 'Standard', rate: '0.00' }] }),
    headers: { get: () => null },
  }));
}

function makeCallbacks({ previewError, strings }) {
  const errors = [];
  const callbacks = {
    expressEntryPoint: 'cart',
    getConfig: () => ({
      getLocale: () => 'us',
      getLanguage: () => 'en_us',
      currency: 'USD',
      site: 'Vitamix',
    }),
    getCart: () => ({ subtotal: 10, getItemsForAPI: () => ITEMS }),
    getState: () => ({}),
    previewOrderDirect: async () => { throw previewError; },
    showError: (msg) => errors.push(msg),
    strings,
  };
  return { callbacks, errors };
}

/** Render the express button, tap it, and return the live session. */
function startSession(options) {
  const { callbacks, errors } = makeCallbacks(options);
  applePay.renderExpressButton({ appendChild() {} }, callbacks);
  clickHandler();
  return { errors };
}

const STRINGS = {
  errorRecaptcha: 'Security check failed. Refresh and try again.',
  errorApplePayGeneric: 'Generic Apple Pay error.',
};

beforeEach(() => {
  globalThis.__resetTestState();
  installApplePay();
});

test('shipping contact: a reCAPTCHA failure closes the sheet and explains on the page', async () => {
  const { errors } = startSession({ previewError: recaptchaError(), strings: STRINGS });

  await session.onshippingcontactselected({ shippingContact: CONTACT });

  assert.equal(session.aborted, true);
  assert.deepEqual(errors, [STRINGS.errorRecaptcha]);
  assert.equal(session.contactUpdates.length, 0, 'must not report the address as unserviceable');
});

test('shipping contact: other preview failures still report the address as unserviceable', async () => {
  const { errors } = startSession({ previewError: new Error('tax service down'), strings: STRINGS });

  await session.onshippingcontactselected({ shippingContact: CONTACT });

  assert.equal(session.aborted, false);
  assert.deepEqual(errors, []);
  assert.equal(session.contactUpdates.length, 1);
  assert.equal(session.contactUpdates[0].errors[0].code, 'addressUnserviceable');
});

test('shipping contact: falls back to a default message when strings lack errorRecaptcha', async () => {
  const { errors } = startSession({ previewError: recaptchaError(), strings: {} });

  await session.onshippingcontactselected({ shippingContact: CONTACT });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /refresh the page/i);
});

test('shipping method: a reCAPTCHA failure shows the security message', async () => {
  const { errors } = startSession({ previewError: recaptchaError(), strings: STRINGS });

  await session.onshippingmethodselected({ shippingMethod: { identifier: 'std' } });

  assert.equal(session.aborted, true);
  assert.deepEqual(errors, [STRINGS.errorRecaptcha]);
});

test('shipping method: other failures keep the generic message', async () => {
  const { errors } = startSession({ previewError: new Error('boom'), strings: STRINGS });

  await session.onshippingmethodselected({ shippingMethod: { identifier: 'std' } });

  assert.equal(session.aborted, true);
  assert.deepEqual(errors, [STRINGS.errorApplePayGeneric]);
});
