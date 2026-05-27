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

// ---------------------------------------------------------------------------
// Inlined formatEnteredAddressLines
// ---------------------------------------------------------------------------

function formatEnteredAddressLines(formData) {
  const line1 = (formData.get('shipping-street-0') || '').toString().trim();
  const line2 = (formData.get('shipping-street-1') || '').toString().trim();
  const city = (formData.get('shipping-city') || '').toString().trim();
  const state = (formData.get('shipping-state') || '').toString().trim();
  const zip = (formData.get('shipping-zip') || '').toString().trim();
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  return [line1, line2, cityStateZip].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Inlined formatSuggestedAddressLines
// ---------------------------------------------------------------------------

function formatSuggestedAddressLines(components) {
  const c = {};
  components.forEach((comp) => {
    comp.types.forEach((type) => { c[type] = comp; });
  });
  const street = [c.street_number?.longText, c.route?.longText].filter(Boolean).join(' ');
  const unit = c.subpremise?.longText ? `Apt ${c.subpremise.longText}` : '';
  const city = (c.locality || c.sublocality || c.postal_town)?.longText || '';
  const state = c.administrative_area_level_1?.shortText || '';
  const zip = c.postal_code?.longText || '';
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  return [street, unit, cityStateZip].filter(Boolean);
}

// ---------------------------------------------------------------------------
// formatEnteredAddressLines tests
// ---------------------------------------------------------------------------

test.describe('formatEnteredAddressLines', () => {
  test('formats a full address into three lines', () => {
    const fd = new FormData();
    fd.set('shipping-street-0', '123 William St');
    fd.set('shipping-street-1', '#123');
    fd.set('shipping-city', 'New York');
    fd.set('shipping-state', 'NY');
    fd.set('shipping-zip', '10038');
    expect(formatEnteredAddressLines(fd)).toEqual([
      '123 William St',
      '#123',
      'New York, NY 10038',
    ]);
  });

  test('omits empty street-1', () => {
    const fd = new FormData();
    fd.set('shipping-street-0', '123 Main St');
    fd.set('shipping-city', 'Springfield');
    fd.set('shipping-state', 'IL');
    fd.set('shipping-zip', '62701');
    expect(formatEnteredAddressLines(fd)).toEqual([
      '123 Main St',
      'Springfield, IL 62701',
    ]);
  });

  test('trims whitespace from each field', () => {
    const fd = new FormData();
    fd.set('shipping-street-0', '  123 Main St  ');
    fd.set('shipping-city', '  Springfield  ');
    fd.set('shipping-state', 'IL');
    fd.set('shipping-zip', '62701');
    expect(formatEnteredAddressLines(fd)).toEqual([
      '123 Main St',
      'Springfield, IL 62701',
    ]);
  });

  test('handles zip-only on third line', () => {
    const fd = new FormData();
    fd.set('shipping-street-0', '123 Main St');
    fd.set('shipping-zip', '62701');
    expect(formatEnteredAddressLines(fd)).toEqual([
      '123 Main St',
      '62701',
    ]);
  });

  test('returns empty array when everything is blank', () => {
    expect(formatEnteredAddressLines(new FormData())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatSuggestedAddressLines tests
// ---------------------------------------------------------------------------

test.describe('formatSuggestedAddressLines', () => {
  const usAddress = [
    { longText: '123', shortText: '123', types: ['street_number'] },
    { longText: 'William Street', shortText: 'William St', types: ['route'] },
    { longText: 'New York', shortText: 'New York', types: ['locality'] },
    { longText: 'New York', shortText: 'NY', types: ['administrative_area_level_1'] },
    { longText: '10038', shortText: '10038', types: ['postal_code'] },
  ];

  test('formats a full US address into two lines', () => {
    expect(formatSuggestedAddressLines(usAddress)).toEqual([
      '123 William Street',
      'New York, NY 10038',
    ]);
  });

  test('uses shortText for state but longText for everything else', () => {
    // The state row has longText "California" but shortText "CA" — we want CA.
    // City row has longText "Mountain View" — we want the longText.
    const addr = [
      { longText: '1600', shortText: '1600', types: ['street_number'] },
      { longText: 'Amphitheatre Parkway', shortText: 'Amphitheatre Pkwy', types: ['route'] },
      { longText: 'Mountain View', shortText: 'Mountain View', types: ['locality'] },
      { longText: 'California', shortText: 'CA', types: ['administrative_area_level_1'] },
      { longText: '94043', shortText: '94043', types: ['postal_code'] },
    ];
    expect(formatSuggestedAddressLines(addr)).toEqual([
      '1600 Amphitheatre Parkway',
      'Mountain View, CA 94043',
    ]);
  });

  test('inserts an "Apt N" line when subpremise is present', () => {
    const addr = [
      ...usAddress,
      { longText: '4B', shortText: '4B', types: ['subpremise'] },
    ];
    expect(formatSuggestedAddressLines(addr)).toEqual([
      '123 William Street',
      'Apt 4B',
      'New York, NY 10038',
    ]);
  });

  test('falls back to sublocality when locality is missing', () => {
    const addr = [
      { longText: '1', shortText: '1', types: ['street_number'] },
      { longText: 'Main', shortText: 'Main', types: ['route'] },
      { longText: 'Brooklyn', shortText: 'Brooklyn', types: ['sublocality'] },
      { longText: 'New York', shortText: 'NY', types: ['administrative_area_level_1'] },
      { longText: '11201', shortText: '11201', types: ['postal_code'] },
    ];
    expect(formatSuggestedAddressLines(addr)).toEqual([
      '1 Main',
      'Brooklyn, NY 11201',
    ]);
  });

  test('falls back to postal_town when locality and sublocality are missing', () => {
    const addr = [
      { longText: '10', shortText: '10', types: ['street_number'] },
      { longText: 'Downing St', shortText: 'Downing St', types: ['route'] },
      { longText: 'London', shortText: 'London', types: ['postal_town'] },
      { longText: 'England', shortText: 'England', types: ['administrative_area_level_1'] },
      { longText: 'SW1A 2AA', shortText: 'SW1A 2AA', types: ['postal_code'] },
    ];
    expect(formatSuggestedAddressLines(addr)).toEqual([
      '10 Downing St',
      'London, England SW1A 2AA',
    ]);
  });

  test('handles missing components gracefully', () => {
    const addr = [
      { longText: '1', shortText: '1', types: ['street_number'] },
      { longText: 'Main', shortText: 'Main', types: ['route'] },
    ];
    expect(formatSuggestedAddressLines(addr)).toEqual(['1 Main']);
  });

  test('returns empty array when components list is empty', () => {
    expect(formatSuggestedAddressLines([])).toEqual([]);
  });
});
