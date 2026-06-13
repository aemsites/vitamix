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
// Inlined dual validation comparison helpers
// ---------------------------------------------------------------------------

function validationOutcome(result) {
  const action = result?.action || null;
  if (action === 'FIX') return 'block';
  if (action === 'CONFIRM_ADD_SUBPREMISES') return 'needs-subpremise';
  if (action === 'ACCEPT' || action === 'CONFIRM') return 'pass';
  return action ? 'review' : 'unknown';
}

function compareAddressValidationResults(google, addressDoctor) {
  const googleOutcome = validationOutcome(google);
  const addressDoctorOutcome = validationOutcome(addressDoctor);
  const mismatchReasons = [];

  if (googleOutcome !== addressDoctorOutcome) {
    mismatchReasons.push('outcome');
  }

  return {
    mismatch: mismatchReasons.length > 0,
    mismatchReasons,
    googleAction: google?.action || null,
    addressDoctorAction: addressDoctor?.action || null,
    googleOutcome,
    addressDoctorOutcome,
  };
}

function localAddressDoctorFix() {
  return {
    provider: 'addressdoctor',
    action: 'FIX',
    formattedAddress: null,
    addressComponents: null,
    uspsDeliverable: false,
  };
}

async function callDualValidateAddress(cfg, body, token, fetchFn = fetch, logFn = () => {}) {
  async function call(apiOrigin, sessionToken) {
    return callValidateAddress(apiOrigin, body, sessionToken, fetchFn);
  }
  const [googleResult, addressDoctorResult] = await Promise.allSettled([
    call(cfg.apiOrigin, token),
    call(cfg.addressDoctorOrigin, null),
  ]);

  const google = googleResult.status === 'fulfilled' ? googleResult.value : null;
  const addressDoctor = addressDoctorResult.status === 'fulfilled' ? addressDoctorResult.value : null;

  if (google && addressDoctor) {
    const comparison = compareAddressValidationResults(google, addressDoctor);
    if (comparison.mismatch) {
      logFn('error', {
        kind: 'address-validation-mismatch',
        providerPrimary: 'addressdoctor',
        providerCompared: 'google',
        mismatchReasons: comparison.mismatchReasons,
        googleAction: comparison.googleAction,
        addressDoctorAction: comparison.addressDoctorAction,
        googleOutcome: comparison.googleOutcome,
        addressDoctorOutcome: comparison.addressDoctorOutcome,
        country: body.address?.regionCode || null,
      });
    }

    if (google.action === 'CONFIRM_ADD_SUBPREMISES' && addressDoctor.action !== 'FIX') {
      return google;
    }
  }

  return addressDoctor || localAddressDoctorFix();
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

const apiOrigin = 'https://api.adobecommerce.live/org/sites/site';
const addressDoctorOrigin = 'https://vitamix-address-doctor-proxy-worker.adobeaem.workers.dev';
const payload = { address: { regionCode: 'US', addressLines: ['123 Main St', 'Springfield, IL 62701'] } };

test.describe('callValidateAddress', () => {
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
// dual validation tests
// ---------------------------------------------------------------------------

test.describe('callDualValidateAddress', () => {
  const googleAccept = {
    action: 'ACCEPT',
    formattedAddress: '123 Main St, Springfield, IL 62701',
    addressComponents: [
      { longText: '123', shortText: '123', types: ['street_number'] },
      { longText: 'Main St', shortText: 'Main St', types: ['route'] },
      { longText: 'Springfield', shortText: 'Springfield', types: ['locality'] },
      { longText: 'IL', shortText: 'IL', types: ['administrative_area_level_1'] },
      { longText: '62701', shortText: '62701', types: ['postal_code'] },
      { longText: 'US', shortText: 'US', types: ['country'] },
    ],
    uspsDeliverable: true,
  };

  const addressDoctorConfirm = {
    provider: 'addressdoctor',
    action: 'CONFIRM',
    formattedAddress: '123 Main St, Springfield IL 62701-0001',
    addressComponents: [
      { longText: '123', shortText: '123', types: ['street_number'] },
      { longText: 'Main St', shortText: 'Main St', types: ['route'] },
      { longText: 'Springfield', shortText: 'Springfield', types: ['locality'] },
      { longText: 'Illinois', shortText: 'IL', types: ['administrative_area_level_1'] },
      { longText: '62701-0001', shortText: '62701-0001', types: ['postal_code'] },
      { longText: 'US', shortText: 'US', types: ['country'] },
    ],
    uspsDeliverable: true,
  };

  test('uses AddressDoctor result when both providers succeed', async () => {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      return {
        ok: true,
        json: async () => {
          if (url.startsWith(addressDoctorOrigin)) return addressDoctorConfirm;
          return googleAccept;
        },
      };
    };

    const cfg = { apiOrigin, addressDoctorOrigin };
    const result = await callDualValidateAddress(cfg, payload, 'tok-1', fetchFn);

    expect(result).toEqual(addressDoctorConfirm);
    expect(urls[0]).toContain(`${apiOrigin}/places/validate?sessiontoken=tok-1`);
    expect(urls[1]).toBe(`${addressDoctorOrigin}/places/validate`);
  });

  test('logs concise non-PII mismatch metadata when provider outcomes differ', async () => {
    const logs = [];
    const addressDoctorFix = {
      ...addressDoctorConfirm,
      action: 'FIX',
      uspsDeliverable: false,
    };
    const fetchFn = async (url) => ({
      ok: true,
      json: async () => {
        if (url.startsWith(addressDoctorOrigin)) return addressDoctorFix;
        return googleAccept;
      },
    });

    const cfg = { apiOrigin, addressDoctorOrigin };
    const logFn = (...args) => logs.push(args);
    await callDualValidateAddress(cfg, payload, null, fetchFn, logFn);

    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toBe('error');
    expect(logs[0][1]).toEqual({
      kind: 'address-validation-mismatch',
      providerPrimary: 'addressdoctor',
      providerCompared: 'google',
      mismatchReasons: ['outcome'],
      googleAction: 'ACCEPT',
      addressDoctorAction: 'FIX',
      googleOutcome: 'pass',
      addressDoctorOutcome: 'block',
      country: 'US',
    });
    expect(logs[0][1]).not.toHaveProperty('mismatchFields');
    expect(JSON.stringify(logs[0][1])).not.toContain('Springfield IL 62701-0001');
  });

  test('does not log when provider outcomes match', async () => {
    const logs = [];
    const fetchFn = async () => ({ ok: true, json: async () => googleAccept });
    const cfg = { apiOrigin, addressDoctorOrigin };
    const logFn = (...args) => logs.push(args);
    const result = await callDualValidateAddress(cfg, payload, null, fetchFn, logFn);

    expect(result).toEqual(googleAccept);
    expect(logs).toHaveLength(0);
  });

  test('preserves Google add-subpremise action when AddressDoctor does not reject', async () => {
    const googleSubpremise = {
      ...googleAccept,
      action: 'CONFIRM_ADD_SUBPREMISES',
    };
    const fetchFn = async (url) => ({
      ok: true,
      json: async () => {
        if (url.startsWith(addressDoctorOrigin)) return addressDoctorConfirm;
        return googleSubpremise;
      },
    });

    const cfg = { apiOrigin, addressDoctorOrigin };
    const result = await callDualValidateAddress(cfg, payload, null, fetchFn);

    expect(result).toEqual(googleSubpremise);
  });

  test('keeps AddressDoctor FIX over Google add-subpremise action', async () => {
    const googleSubpremise = {
      ...googleAccept,
      action: 'CONFIRM_ADD_SUBPREMISES',
    };
    const addressDoctorFix = {
      ...addressDoctorConfirm,
      action: 'FIX',
      uspsDeliverable: false,
    };
    const fetchFn = async (url) => ({
      ok: true,
      json: async () => {
        if (url.startsWith(addressDoctorOrigin)) return addressDoctorFix;
        return googleSubpremise;
      },
    });

    const cfg = { apiOrigin, addressDoctorOrigin };
    const result = await callDualValidateAddress(cfg, payload, null, fetchFn);

    expect(result).toEqual(addressDoctorFix);
  });

  test('uses AddressDoctor when Google validation fails', async () => {
    const fetchFn = async (url) => {
      if (url.startsWith(apiOrigin)) throw new Error('google down');
      return { ok: true, json: async () => addressDoctorConfirm };
    };

    const cfg = { apiOrigin, addressDoctorOrigin };
    const result = await callDualValidateAddress(cfg, payload, null, fetchFn);

    expect(result).toEqual(addressDoctorConfirm);
  });

  test('returns local FIX when AddressDoctor validation fails', async () => {
    const fetchFn = async (url) => {
      if (url.startsWith(addressDoctorOrigin)) throw new Error('addressdoctor down');
      return { ok: true, json: async () => googleAccept };
    };

    const cfg = { apiOrigin, addressDoctorOrigin };
    const result = await callDualValidateAddress(cfg, payload, null, fetchFn);

    expect(result).toEqual({
      provider: 'addressdoctor',
      action: 'FIX',
      formattedAddress: null,
      addressComponents: null,
      uspsDeliverable: false,
    });
  });
});

test.describe('compareAddressValidationResults', () => {
  test('compares checkout outcomes instead of formatting or deliverability differences', () => {
    const google = {
      action: 'ACCEPT',
      formattedAddress: '1 Main St, Brooklyn NY 11201',
      uspsDeliverable: true,
    };
    const addressDoctor = {
      action: 'CONFIRM',
      formattedAddress: '1 Main Street, Brooklyn NY 11201-1234',
      uspsDeliverable: false,
    };

    const result = compareAddressValidationResults(google, addressDoctor);
    expect(result).toEqual({
      mismatch: false,
      mismatchReasons: [],
      googleAction: 'ACCEPT',
      addressDoctorAction: 'CONFIRM',
      googleOutcome: 'pass',
      addressDoctorOutcome: 'pass',
    });
  });

  test('reports outcome mismatches', () => {
    const result = compareAddressValidationResults(
      { action: 'CONFIRM_ADD_SUBPREMISES', uspsDeliverable: true },
      { action: 'FIX', uspsDeliverable: false },
    );

    expect(result).toEqual({
      mismatch: true,
      mismatchReasons: ['outcome'],
      googleAction: 'CONFIRM_ADD_SUBPREMISES',
      addressDoctorAction: 'FIX',
      googleOutcome: 'needs-subpremise',
      addressDoctorOutcome: 'block',
    });
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

  test('uses locality over sublocality_level_1 when both are present', () => {
    // sublocality_level_1 is not the same key as sublocality — locality wins.
    // The CONFIRM modal uses formattedAddress directly to avoid this ambiguity.
    const addr = [
      { longText: '50', shortText: '50', types: ['street_number'] },
      { longText: 'Queen Elizabeth Boulevard', shortText: 'Queen Elizabeth Blvd', types: ['route'] },
      { longText: 'Toronto', shortText: 'Toronto', types: ['locality'] },
      { longText: 'ON', shortText: 'ON', types: ['administrative_area_level_1'] },
      { longText: 'M8Z 1M1', shortText: 'M8Z 1M1', types: ['postal_code'] },
      { longText: 'Etobicoke', shortText: 'Etobicoke', types: ['sublocality_level_1'] },
    ];
    expect(formatSuggestedAddressLines(addr)).toEqual([
      '50 Queen Elizabeth Boulevard',
      'Toronto, ON M8Z 1M1',
    ]);
  });
});

// ---------------------------------------------------------------------------
// splitFormattedAddress
// ---------------------------------------------------------------------------

function splitFormattedAddress(formattedAddress) {
  const commaIdx = formattedAddress.indexOf(',');
  return commaIdx >= 0
    ? [formattedAddress.slice(0, commaIdx).trim(), formattedAddress.slice(commaIdx + 1).trim()]
    : [formattedAddress];
}

test.describe('splitFormattedAddress', () => {
  test('splits at first comma into street and rest', () => {
    expect(splitFormattedAddress('50 Queen Elizabeth Boulevard, Etobicoke, ON M8Z 1M1, Canada'))
      .toEqual(['50 Queen Elizabeth Boulevard', 'Etobicoke, ON M8Z 1M1, Canada']);
  });

  test('returns single-element array when no comma present', () => {
    expect(splitFormattedAddress('123 Main St')).toEqual(['123 Main St']);
  });

  test('trims whitespace around the split', () => {
    expect(splitFormattedAddress('123 Main St , Springfield, IL'))
      .toEqual(['123 Main St', 'Springfield, IL']);
  });
});

// ---------------------------------------------------------------------------
// Inlined addressesMatchEntered
// ---------------------------------------------------------------------------

function normalizeAddressPart(value) {
  return (value || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

function getEnteredAddressParts(formData, prefix = 'shipping-') {
  return {
    street: normalizeAddressPart(formData.get(`${prefix}street-0`)),
    unit: normalizeAddressPart(formData.get(`${prefix}street-1`)),
    city: normalizeAddressPart(formData.get(`${prefix}city`)),
    state: normalizeAddressPart(formData.get(`${prefix}state`)),
    zip: normalizeAddressPart(formData.get(`${prefix}zip`)),
  };
}

function getSuggestedAddressParts(addressComponents) {
  const c = {};
  addressComponents.forEach((comp) => {
    comp.types.forEach((type) => { c[type] = comp; });
  });
  const street = [c.street_number?.longText, c.route?.longText].filter(Boolean).join(' ');
  const zip = c.postal_code?.longText || '';
  const zipSuffix = c.postal_code_suffix?.longText || '';
  return {
    street: normalizeAddressPart(street),
    unit: normalizeAddressPart(c.subpremise?.longText || ''),
    city: normalizeAddressPart((c.locality || c.sublocality || c.postal_town)?.longText || ''),
    state: normalizeAddressPart(c.administrative_area_level_1?.shortText || ''),
    zip: normalizeAddressPart(zipSuffix ? `${zip}-${zipSuffix}` : zip),
  };
}

function addressPartsMatch(left, right) {
  return left.street === right.street
    && left.unit === right.unit
    && left.city === right.city
    && left.state === right.state
    && left.zip === right.zip;
}

function addressesMatchEntered(formData, prefix, addressComponents, formattedAddress) {
  if (addressComponents?.length) {
    return addressPartsMatch(
      getEnteredAddressParts(formData, prefix),
      getSuggestedAddressParts(addressComponents),
    );
  }

  if (formattedAddress) {
    const entered = formatEnteredAddressLines(formData, prefix).map(normalizeAddressPart);
    const suggested = splitFormattedAddress(formattedAddress)
      .map((line) => normalizeAddressPart(line.replace(/,\s*(USA|Canada)$/i, '')));
    if (entered.length !== suggested.length) return false;
    return entered.every((line, i) => line === suggested[i]);
  }

  return true;
}

const BOLIVIA_COMPONENTS = [
  { longText: '714', shortText: '714', types: ['street_number'] },
  { longText: 'Lakeside Drive Southeast', shortText: 'Lakeside Drive Southeast', types: ['route'] },
  { longText: 'Bolivia', shortText: 'Bolivia', types: ['locality'] },
  { longText: 'NC', shortText: 'NC', types: ['administrative_area_level_1'] },
  { longText: '28422', shortText: '28422', types: ['postal_code'] },
  { longText: 'USA', shortText: 'USA', types: ['country'] },
];

test.describe('addressesMatchEntered', () => {
  test('returns true when no suggestion data is returned', () => {
    const fd = new FormData();
    fd.set('shipping-street-0', '714 Lakeside Dr');
    expect(addressesMatchEntered(fd, 'shipping-', null, null)).toBe(true);
  });

  test('returns false when the validated street differs from the entered street', () => {
    const fd = new FormData();
    fd.set('shipping-street-0', '714 Lakeside Dr');
    fd.set('shipping-city', 'Bolivia');
    fd.set('shipping-state', 'NC');
    fd.set('shipping-zip', '28422');
    expect(addressesMatchEntered(fd, 'shipping-', BOLIVIA_COMPONENTS, null)).toBe(false);
  });

  test('returns true when the validated address exactly matches the entered address', () => {
    const fd = new FormData();
    fd.set('shipping-street-0', '714 Lakeside Drive Southeast');
    fd.set('shipping-city', 'Bolivia');
    fd.set('shipping-state', 'NC');
    fd.set('shipping-zip', '28422');
    expect(addressesMatchEntered(fd, 'shipping-', BOLIVIA_COMPONENTS, null)).toBe(true);
  });

  test('compares formattedAddress lines when components are absent', () => {
    const fd = new FormData();
    fd.set('shipping-street-0', '124 Main Street');
    fd.set('shipping-city', 'San Francisco');
    fd.set('shipping-state', 'CA');
    fd.set('shipping-zip', '94103');
    expect(addressesMatchEntered(
      fd,
      'shipping-',
      null,
      '124 Main Street, San Francisco, CA 94103, USA',
    )).toBe(true);
    expect(addressesMatchEntered(
      fd,
      'shipping-',
      null,
      '124 Main St, San Francisco, CA 94103, USA',
    )).toBe(false);
  });
});
