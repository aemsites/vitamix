/* eslint-disable import/no-extraneous-dependencies */
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAddresses,
  populateDefaultShippingAddress,
} from '../../blocks/checkout/checkout-customer-address.js';

function field(value = '') {
  return {
    value,
    classList: { toggle() {} },
  };
}

function checkoutForm(overrides = {}) {
  return {
    elements: {
      email: field(),
      'shipping-firstname': field(),
      'shipping-lastname': field(),
      'shipping-street-0': field(),
      'shipping-street-1': field(),
      'shipping-city': field(),
      'shipping-state': field(),
      'shipping-zip': field(),
      'shipping-phone': field(),
      ...overrides,
    },
  };
}

describe('default checkout customer address', () => {
  beforeEach(() => globalThis.__resetTestState());

  test('normalizes supported address-list response shapes', () => {
    const address = { id: 'address-1', isDefault: true };
    assert.deepEqual(normalizeAddresses([address]), [address]);
    assert.deepEqual(normalizeAddresses({ data: { addresses: [address] } }), [address]);
    assert.deepEqual(normalizeAddresses({ items: [address] }), [address]);
    assert.deepEqual(normalizeAddresses(null), []);
  });

  test('populates all shipping fields from the default mailing address', () => {
    const form = checkoutForm();
    const populated = populateDefaultShippingAddress(form, {
      email: 'jane@example.com',
      name: 'Jane Mary Doe',
      address1: '123 Main St',
      address2: 'Apt 4',
      city: 'Cleveland',
      state: 'OH',
      zip: '44114',
      country: 'us',
      phone: '2165550123',
    }, 'us');

    assert.equal(populated, true);
    assert.equal(form.elements.email.value, 'jane@example.com');
    assert.equal(form.elements['shipping-firstname'].value, 'Jane');
    assert.equal(form.elements['shipping-lastname'].value, 'Mary Doe');
    assert.equal(form.elements['shipping-street-0'].value, '123 Main St');
    assert.equal(form.elements['shipping-street-1'].value, 'Apt 4');
    assert.equal(form.elements['shipping-city'].value, 'Cleveland');
    assert.equal(form.elements['shipping-state'].value, 'OH');
    assert.equal(form.elements['shipping-zip'].value, '44114');
    assert.equal(form.elements['shipping-phone'].value, '2165550123');
  });

  test('does not overwrite a restored or manually entered shipping address', () => {
    const form = checkoutForm({ 'shipping-street-0': field('Existing address') });
    const populated = populateDefaultShippingAddress(form, {
      address1: 'Default address',
      country: 'us',
    }, 'us');

    assert.equal(populated, false);
    assert.equal(form.elements['shipping-street-0'].value, 'Existing address');
  });

  test('does not use an address from a different storefront country', () => {
    const form = checkoutForm();
    const populated = populateDefaultShippingAddress(form, {
      address1: '1 Yonge St',
      country: 'ca',
    }, 'us');

    assert.equal(populated, false);
    assert.equal(form.elements['shipping-street-0'].value, '');
  });
});
