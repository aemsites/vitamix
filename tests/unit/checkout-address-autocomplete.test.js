import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlacesAutocompleteInput } from '../../blocks/checkout/checkout-address.js';

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
