import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlacesAutocompleteInput,
  setAddressFieldValue,
  fillAddressFields,
} from '../../blocks/checkout/checkout-address.js';

// Minimal field mock compatible with setAddressFieldValue/clearFieldError:
// closest() returns null so clearFieldError early-returns, and dispatchEvent
// is a no-op recorder.
function fieldMock(value = '') {
  return {
    value,
    closest() { return null; },
    removeAttribute() {},
    dispatchEvent() { return true; },
    classList: { toggle() {} },
  };
}

// Section mock for fillAddressFields, which queries by [autocomplete="..."]
// for line2/city/zip and select[name$="-state"] for the state dropdown.
function sectionForFill(fields) {
  return {
    querySelector(selector) {
      return fields[selector] || null;
    },
  };
}

function component(types, longText, shortText = longText) {
  return { types, longText, shortText };
}

function sectionWithFields(fields) {
  return {
    querySelector(selector) {
      const match = selector.match(/^\[name="(.+)"\]$/);
      if (!match) return null;
      return fields[match[1]] || null;
    },
  };
}

function input(value) {
  return { value };
}

function select(value, textContent = '') {
  return {
    value,
    selectedOptions: textContent ? [{ textContent }] : [],
  };
}

test('buildPlacesAutocompleteInput includes city and selected state label', () => {
  const section = sectionWithFields({
    'shipping-city': input('Bolivia'),
    'shipping-state': select('NC', 'North Carolina'),
    'shipping-zip': input(''),
  });

  assert.equal(
    buildPlacesAutocompleteInput(section, '714 Lakeside Drive'),
    '714 Lakeside Drive, Bolivia, North Carolina',
  );
});

test('buildPlacesAutocompleteInput includes ZIP when present', () => {
  const section = sectionWithFields({
    'shipping-city': input('Springfield'),
    'shipping-state': select('IL', 'Illinois'),
    'shipping-zip': input('62701'),
  });

  assert.equal(
    buildPlacesAutocompleteInput(section, '123 Main St'),
    '123 Main St, Springfield, Illinois 62701',
  );
});

test('buildPlacesAutocompleteInput falls back to state value', () => {
  const section = sectionWithFields({
    'billing-city': input('Toronto'),
    'billing-state': select('ON'),
    'billing-zip': input('M5E 1E5'),
  });

  assert.equal(
    buildPlacesAutocompleteInput(section, '1 Yonge St', 'billing-'),
    '1 Yonge St, Toronto, ON M5E 1E5',
  );
});

test('buildPlacesAutocompleteInput omits empty locality fields', () => {
  const section = sectionWithFields({});

  assert.equal(
    buildPlacesAutocompleteInput(section, '  714 Lakeside Drive  '),
    '714 Lakeside Drive',
  );
});

test('setAddressFieldValue clears stale field errors without reopening autocomplete', () => {
  const events = [];
  let removed = false;
  const wrapper = {
    classList: {
      removed: [],
      remove(name) { this.removed.push(name); },
    },
    querySelector(selector) {
      assert.equal(selector, '.field-error');
      return { remove: () => { removed = true; } };
    },
  };
  const inputEl = {
    value: '',
    closest(selector) {
      assert.equal(selector, '.form-field');
      return wrapper;
    },
    removeAttribute(name) {
      events.push(`remove:${name}`);
    },
    dispatchEvent(event) {
      events.push(event.type);
      return true;
    },
  };

  setAddressFieldValue(inputEl, '28422-7728');

  assert.equal(inputEl.value, '28422-7728');
  assert.deepEqual(wrapper.classList.removed, ['has-error']);
  assert.equal(removed, true);
  assert.deepEqual(events, ['remove:aria-invalid', 'remove:aria-describedby', 'change']);
});

test('fillAddressFields keeps the house number when Place Details omits street_number', () => {
  // Regression: Google occasionally returns a `route` with no `street_number`.
  // Rebuilding from components alone dropped the number the user already had,
  // turning "32501 Dufferin Street" into "Dufferin Street".
  const addressInput = fieldMock('32501 Dufferin Street');
  const section = sectionForFill({});

  fillAddressFields(section, addressInput, [
    component(['route'], 'Dufferin Street'),
    component(['locality'], 'Toronto'),
  ]);

  assert.equal(addressInput.value, '32501 Dufferin Street');
});

test('fillAddressFields rebuilds street from components when street_number is present', () => {
  const addressInput = fieldMock('32501 Dufferin');
  const section = sectionForFill({});

  fillAddressFields(section, addressInput, [
    component(['street_number'], '32501'),
    component(['route'], 'Dufferin Street'),
  ]);

  assert.equal(addressInput.value, '32501 Dufferin Street');
});

test('fillAddressFields populates an empty street from a route-only result', () => {
  const addressInput = fieldMock('');
  const section = sectionForFill({});

  fillAddressFields(section, addressInput, [
    component(['route'], 'Dufferin Street'),
  ]);

  assert.equal(addressInput.value, 'Dufferin Street');
});
