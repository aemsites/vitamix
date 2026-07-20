/* eslint-disable import/no-extraneous-dependencies */
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDefaultCustomerAddress,
  normalizeAddresses,
  populateDefaultShippingAddress,
  prefillDefaultShippingAddress,
  watchCustomerAddressPrefill,
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
      'shipping-telephone': field(),
      ...overrides,
    },
  };
}

function signIn(email = 'jane@example.com') {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    .toString('base64url');
  localStorage.setItem('auth_token', `header.${payload}.signature`);
  localStorage.setItem('auth_user', JSON.stringify({ email, roles: [] }));
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
    assert.equal(form.elements['shipping-telephone'].value, '2165550123');
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

  test('does not use an address without a country', () => {
    const form = checkoutForm();
    const populated = populateDefaultShippingAddress(form, {
      address1: '123 Main St',
    }, 'us');

    assert.equal(populated, false);
  });

  test('returns null without an authenticated customer', async () => {
    assert.equal(await getDefaultCustomerAddress(), null);
  });

  test('returns a complete default address from the list response', async () => {
    signIn();
    let requests = 0;
    globalThis.__setFetchMock(async (url, options) => {
      requests += 1;
      assert.match(String(url), /customers\/jane%40example\.com\/addresses$/);
      assert.equal(new Headers(options.headers).get('Authorization')?.startsWith('Bearer '), true);
      return jsonResponse({
        addresses: [{
          id: 'address-1',
          isDefault: true,
          address1: '123 Main St',
          city: 'Cleveland',
          zip: '44114',
          country: 'us',
        }],
      });
    });

    const address = await getDefaultCustomerAddress();
    assert.equal(address.address1, '123 Main St');
    assert.equal(address.email, 'jane@example.com');
    assert.equal(requests, 1);
  });

  test('hydrates a default address list stub from the detail endpoint', async () => {
    signIn();
    const urls = [];
    globalThis.__setFetchMock(async (url) => {
      urls.push(String(url));
      if (urls.length === 1) {
        return jsonResponse({ data: { addresses: [{ id: 'address-1', isDefault: true }] } });
      }
      return jsonResponse({
        data: {
          address: {
            address1: '123 Main St',
            city: 'Cleveland',
            zip: '44114',
            country: 'us',
          },
        },
      });
    });

    const address = await getDefaultCustomerAddress();
    assert.equal(address.address1, '123 Main St');
    assert.match(urls[1], /\/addresses\/address-1$/);
  });

  test('returns null when no default or hydratable address exists', async () => {
    signIn();
    globalThis.__setFetchMock(async () => jsonResponse({ addresses: [{ id: 'address-1' }] }));
    assert.equal(await getDefaultCustomerAddress(), null);

    globalThis.__setFetchMock(async () => jsonResponse({
      addresses: [{ isDefault: true }],
    }));
    assert.equal(await getDefaultCustomerAddress(), null);
  });

  test('rejects when the customer address API fails', async () => {
    signIn();
    globalThis.__setFetchMock(async () => jsonResponse({ message: 'failed' }, 500));
    await assert.rejects(getDefaultCustomerAddress(), /customer address request failed: 500/);
  });

  test('runs the checkout prefill lifecycle in order', async () => {
    const form = checkoutForm();
    const calls = [];
    const activated = await prefillDefaultShippingAddress({
      form,
      locale: 'us',
      loadAddress: async () => ({ address1: '123 Main St', country: 'us' }),
      save: () => calls.push('save'),
      validate: async () => { calls.push('validate'); return true; },
      refresh: () => calls.push('refresh'),
    });

    assert.equal(activated, true);
    assert.deepEqual(calls, ['save', 'validate', 'refresh']);
  });

  test('reruns prefill after login but not after logout', () => {
    const listeners = new Map();
    const eventTarget = {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type, listener) => {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    };
    let prefillCalls = 0;
    const stopWatching = watchCustomerAddressPrefill(eventTarget, () => { prefillCalls += 1; });

    assert.equal(prefillCalls, 1);
    listeners.get('commerce:auth-state-changed')({ detail: { loggedIn: true } });
    assert.equal(prefillCalls, 2);
    listeners.get('commerce:auth-state-changed')({ detail: { loggedIn: false } });
    assert.equal(prefillCalls, 2);

    stopWatching();
    assert.equal(listeners.has('commerce:auth-state-changed'), false);
  });

  test('does not refresh shipping when prefill is skipped or validation fails', async () => {
    const existingForm = checkoutForm({ 'shipping-street-0': field('Existing address') });
    const skippedCalls = [];
    const skipped = await prefillDefaultShippingAddress({
      form: existingForm,
      locale: 'us',
      loadAddress: async () => ({ address1: 'Default address', country: 'us' }),
      save: () => skippedCalls.push('save'),
      validate: async () => true,
      refresh: () => skippedCalls.push('refresh'),
    });
    assert.equal(skipped, false);
    assert.deepEqual(skippedCalls, []);

    const invalidCalls = [];
    const invalid = await prefillDefaultShippingAddress({
      form: checkoutForm(),
      locale: 'us',
      loadAddress: async () => ({ address1: 'Bad address', country: 'us' }),
      save: () => invalidCalls.push('save'),
      validate: async () => { invalidCalls.push('validate'); return false; },
      refresh: () => invalidCalls.push('refresh'),
    });
    assert.equal(invalid, false);
    assert.deepEqual(invalidCalls, ['save', 'validate']);
  });
});
