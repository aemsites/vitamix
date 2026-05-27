/* eslint-disable import/no-extraneous-dependencies */
import { test, expect } from '@playwright/test';

/**
 * Unit tests for buildAddressPayload and callValidateAddress
 * from blocks/checkout/checkout-address.js.
 *
 * Functions are inlined here with injectable fetch so they can run in the
 * Node test runner without importing the source module (which uses DOM APIs
 * at call time in other functions). Keep these copies in sync with the real
 * implementation in checkout-address.js.
 */

// ---------------------------------------------------------------------------
// Inlined buildAddressPayload
// ---------------------------------------------------------------------------

function buildAddressPayload(formData, regionCode) {
  const line1 = formData.get('shipping-street-0') || '';
  const line2 = formData.get('shipping-street-1') || '';
  const city = formData.get('shipping-city') || '';
  const state = formData.get('shipping-state') || '';
  const zip = formData.get('shipping-zip') || '';

  const streetLines = [line1, line2].filter(Boolean);
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const addressLines = [...streetLines, cityStateZip].filter(Boolean);

  const payload = { address: { addressLines } };
  if (regionCode) payload.address.regionCode = regionCode;
  return payload;
}

// ---------------------------------------------------------------------------
// Inlined callValidateAddress (fetchFn injectable for test isolation)
// ---------------------------------------------------------------------------

async function callValidateAddress(apiOrigin, payload, sessionToken, fetchFn = fetch) {
  const url = new URL(`${apiOrigin}/places/validate`);
  if (sessionToken) url.searchParams.set('sessiontoken', sessionToken);

  const resp = await fetchFn(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) throw new Error(`address validation failed: ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// buildAddressPayload tests
// ---------------------------------------------------------------------------

test.describe('buildAddressPayload', () => {
  test('builds payload with all fields present', () => {
    const fd = new FormData();
    fd.set('shipping-street-0', '123 Main St');
    fd.set('shipping-street-1', 'Apt 4');
    fd.set('shipping-city', 'Springfield');
    fd.set('shipping-state', 'IL');
    fd.set('shipping-zip', '62701');

    const result = buildAddressPayload(fd, 'US');
    expect(result).toEqual({
      address: {
        regionCode: 'US',
        addressLines: ['123 Main St', 'Apt 4', 'Springfield, IL 62701'],
      },
    });
  });

  test('omits street-1 when empty', () => {
    const fd = new FormData();
    fd.set('shipping-street-0', '123 Main St');
    fd.set('shipping-city', 'Springfield');
    fd.set('shipping-state', 'IL');
    fd.set('shipping-zip', '62701');

    const result = buildAddressPayload(fd, 'US');
    expect(result.address.addressLines).toEqual(['123 Main St', 'Springfield, IL 62701']);
  });

  test('omits regionCode when not provided', () => {
    const fd = new FormData();
    fd.set('shipping-street-0', '123 Main St');
    fd.set('shipping-city', 'Springfield');
    fd.set('shipping-state', 'IL');
    fd.set('shipping-zip', '62701');

    const result = buildAddressPayload(fd, '');
    expect('regionCode' in result.address).toBe(false);
  });

  test('returns empty addressLines when all fields are empty', () => {
    const fd = new FormData();
    const result = buildAddressPayload(fd, 'US');
    expect(result.address.addressLines).toEqual([]);
  });

  test('handles city only (no state, no zip)', () => {
    const fd = new FormData();
    fd.set('shipping-street-0', '123 Main St');
    fd.set('shipping-city', 'Springfield');

    const result = buildAddressPayload(fd, 'US');
    expect(result.address.addressLines).toEqual(['123 Main St', 'Springfield']);
  });

  test('handles state and zip without city', () => {
    const fd = new FormData();
    fd.set('shipping-street-0', '123 Main St');
    fd.set('shipping-state', 'IL');
    fd.set('shipping-zip', '62701');

    const result = buildAddressPayload(fd, 'US');
    expect(result.address.addressLines).toEqual(['123 Main St', 'IL 62701']);
  });

  test('uses CA regionCode for Canada', () => {
    const fd = new FormData();
    fd.set('shipping-street-0', '1 Yonge St');
    fd.set('shipping-city', 'Toronto');
    fd.set('shipping-state', 'ON');
    fd.set('shipping-zip', 'M5E 1E5');

    const result = buildAddressPayload(fd, 'CA');
    expect(result.address.regionCode).toBe('CA');
    expect(result.address.addressLines).toEqual(['1 Yonge St', 'Toronto, ON M5E 1E5']);
  });
});

// ---------------------------------------------------------------------------
// callValidateAddress tests
// ---------------------------------------------------------------------------

test.describe('callValidateAddress', () => {
  const apiOrigin = 'https://api.adobecommerce.live/org/sites/site';
  const payload = { address: { regionCode: 'US', addressLines: ['123 Main St', 'Springfield, IL 62701'] } };

  test('POSTs to the correct URL', async () => {
    let capturedUrl;
    const fetchFn = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ action: 'ACCEPT' }) };
    };

    await callValidateAddress(apiOrigin, payload, null, fetchFn);
    expect(capturedUrl).toBe(`${apiOrigin}/places/validate`);
  });

  test('sends POST method with JSON content-type', async () => {
    let capturedOpts;
    const fetchFn = async (url, opts) => {
      capturedOpts = opts;
      return { ok: true, json: async () => ({ action: 'ACCEPT' }) };
    };

    await callValidateAddress(apiOrigin, payload, null, fetchFn);
    expect(capturedOpts.method).toBe('POST');
    expect(capturedOpts.headers['Content-Type']).toBe('application/json');
  });

  test('sends the payload as JSON body', async () => {
    let capturedBody;
    const fetchFn = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ action: 'ACCEPT' }) };
    };

    await callValidateAddress(apiOrigin, payload, null, fetchFn);
    expect(capturedBody).toEqual(payload);
  });

  test('appends sessiontoken query param when provided', async () => {
    let capturedUrl;
    const fetchFn = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ action: 'ACCEPT' }) };
    };

    await callValidateAddress(apiOrigin, payload, 'tok-abc-123', fetchFn);
    expect(capturedUrl).toContain('sessiontoken=tok-abc-123');
  });

  test('omits sessiontoken when null', async () => {
    let capturedUrl;
    const fetchFn = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ action: 'ACCEPT' }) };
    };

    await callValidateAddress(apiOrigin, payload, null, fetchFn);
    expect(capturedUrl).not.toContain('sessiontoken');
  });

  test('omits sessiontoken when empty string', async () => {
    let capturedUrl;
    const fetchFn = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ action: 'ACCEPT' }) };
    };

    await callValidateAddress(apiOrigin, payload, '', fetchFn);
    expect(capturedUrl).not.toContain('sessiontoken');
  });

  test('returns parsed JSON on success', async () => {
    const responseData = {
      action: 'ACCEPT',
      formattedAddress: '123 Main St, Springfield, IL 62701',
      addressComponents: [],
      uspsDeliverable: true,
    };
    const fetchFn = async () => ({ ok: true, json: async () => responseData });

    const result = await callValidateAddress(apiOrigin, payload, null, fetchFn);
    expect(result).toEqual(responseData);
  });

  test('throws on non-2xx response', async () => {
    const fetchFn = async () => ({ ok: false, status: 502 });

    await expect(callValidateAddress(apiOrigin, payload, null, fetchFn))
      .rejects.toThrow('address validation failed: 502');
  });

  test('propagates network errors', async () => {
    const fetchFn = async () => { throw new Error('network error'); };

    await expect(callValidateAddress(apiOrigin, payload, null, fetchFn))
      .rejects.toThrow('network error');
  });
});
