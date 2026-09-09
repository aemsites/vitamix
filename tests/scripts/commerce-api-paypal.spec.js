import { test, expect } from '@playwright/test';

/**
 * Unit tests for the PayPal session helpers in scripts/commerce-api.js.
 *
 * The functions are inlined here with injectable dependencies because
 * scripts/commerce-api.js imports auth-api.js and recaptcha.js, which in
 * turn import aem.js — a browser-only module that sets window.hlx at load
 * time and cannot be imported in the Node test runner. This mirrors the
 * pattern used in pricing.spec.js and recaptcha.spec.js.
 *
 * Keep these copies in sync with the real implementations.
 */

// ---------------------------------------------------------------------------
// Inlined implementations with injectable deps
// ---------------------------------------------------------------------------

class CommerceApiError extends Error {
  constructor(status, body, errorHeader) {
    super(body?.message || `API error ${status}`);
    this.status = status;
    this.body = body;
    this.errorHeader = errorHeader || null;
  }
}

/**
 * @param {string} path
 * @param {object|null} body
 * @param {string} method
 * @param {{ apiOrigin: string, token: string|null, fetchFn: Function }} deps
 */
async function request(path, body, method, { apiOrigin, token, fetchFn }) {
  const headers = {};
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetchFn(`${apiOrigin}${path}`, {
    method,
    headers,
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  const data = await resp.json();
  if (!resp.ok) throw new CommerceApiError(resp.status, data, resp.headers.get('x-error'));
  return data;
}

async function createPayPalSession(items, config, deps) {
  const currency = typeof config.currency === 'function'
    ? config.currency(config.getLocale())
    : config.currency;
  return request('/payments/paypal/session', {
    items,
    currency,
    locale: config.getLanguage().replace('-', '_'),
  }, 'POST', deps);
}

async function patchPayPalSession(paypalOrderId, data, deps) {
  return request(`/payments/paypal/session/${paypalOrderId}`, data, 'PATCH', deps);
}

async function getPayPalSession(paypalOrderId, deps) {
  return request(`/payments/paypal/session/${paypalOrderId}`, null, 'GET', deps);
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const ORIGIN = 'https://api.example.com';
const PAYPAL_ORDER_ID = 'PP-ORDER-001';
const SAMPLE_ITEMS = [
  { sku: 'SKU-001', quantity: 2, price: { final: '49.99', currency: 'USD' } },
];

function makeDeps({ token = null, responseBody = {}, status = 200 } = {}) {
  const headers = new Map([['x-error', null]]);
  const fetchFn = async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => responseBody,
    headers: { get: (k) => headers.get(k) ?? null },
  });
  return { apiOrigin: ORIGIN, token, fetchFn };
}

function makeCapturingDeps({ token = null, responseBody = {}, status = 200 } = {}) {
  let captured;
  const fetchFn = async (url, init) => {
    captured = { url, init };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => responseBody,
      headers: { get: () => null },
    };
  };
  return {
    deps: { apiOrigin: ORIGIN, token, fetchFn },
    getCapture: () => captured,
  };
}

// ---------------------------------------------------------------------------
// createPayPalSession
// ---------------------------------------------------------------------------

test.describe('createPayPalSession', () => {
  const CONFIG = {
    currency: 'USD',
    getLocale: () => 'en-US',
    getLanguage: () => 'en-US',
  };

  test('POSTs to /payments/paypal/session', async () => {
    const { deps, getCapture } = makeCapturingDeps({ responseBody: { paypalOrderId: 'PP-001' } });
    await createPayPalSession(SAMPLE_ITEMS, CONFIG, deps);
    expect(getCapture().url).toBe(`${ORIGIN}/payments/paypal/session`);
    expect(getCapture().init.method).toBe('POST');
  });

  test('sends items, currency, and locale in the request body', async () => {
    const { deps, getCapture } = makeCapturingDeps({ responseBody: { paypalOrderId: 'PP-001' } });
    await createPayPalSession(SAMPLE_ITEMS, CONFIG, deps);
    const body = JSON.parse(getCapture().init.body);
    expect(body.items).toEqual(SAMPLE_ITEMS);
    expect(body.currency).toBe('USD');
    expect(body.locale).toBe('en_US');
  });

  test('converts locale hyphen to underscore', async () => {
    const config = { ...CONFIG, getLanguage: () => 'fr-CA' };
    const { deps, getCapture } = makeCapturingDeps({ responseBody: { paypalOrderId: 'PP-001' } });
    await createPayPalSession(SAMPLE_ITEMS, config, deps);
    const body = JSON.parse(getCapture().init.body);
    expect(body.locale).toBe('fr_CA');
  });

  test('resolves currency via function when config.currency is a function', async () => {
    const config = {
      currency: (locale) => (locale === 'en-US' ? 'USD' : 'CAD'),
      getLocale: () => 'en-US',
      getLanguage: () => 'en-US',
    };
    const { deps, getCapture } = makeCapturingDeps({ responseBody: { paypalOrderId: 'PP-001' } });
    await createPayPalSession(SAMPLE_ITEMS, config, deps);
    const body = JSON.parse(getCapture().init.body);
    expect(body.currency).toBe('USD');
  });

  test('returns the parsed response body', async () => {
    const deps = makeDeps({ responseBody: { paypalOrderId: 'PP-NEW-001' } });
    const result = await createPayPalSession(SAMPLE_ITEMS, CONFIG, deps);
    expect(result.paypalOrderId).toBe('PP-NEW-001');
  });

  test('throws CommerceApiError on non-2xx response', async () => {
    const deps = makeDeps({ status: 422, responseBody: { message: 'invalid items' } });
    await expect(createPayPalSession(SAMPLE_ITEMS, CONFIG, deps))
      .rejects.toBeInstanceOf(CommerceApiError);
  });
});

// ---------------------------------------------------------------------------
// patchPayPalSession
// ---------------------------------------------------------------------------

test.describe('patchPayPalSession', () => {
  const PATCH_DATA = { type: 'address', currency: 'USD', address: { country: 'us' } };

  test('makes PATCH request to /payments/paypal/session/:paypalOrderId', async () => {
    const { deps, getCapture } = makeCapturingDeps({ responseBody: {} });
    await patchPayPalSession(PAYPAL_ORDER_ID, PATCH_DATA, deps);
    expect(getCapture().url).toBe(`${ORIGIN}/payments/paypal/session/${PAYPAL_ORDER_ID}`);
    expect(getCapture().init.method).toBe('PATCH');
  });

  test('sends the data object as the request body', async () => {
    const { deps, getCapture } = makeCapturingDeps({ responseBody: {} });
    await patchPayPalSession(PAYPAL_ORDER_ID, PATCH_DATA, deps);
    expect(JSON.parse(getCapture().init.body)).toEqual(PATCH_DATA);
  });

  test('returns the parsed response body', async () => {
    const deps = makeDeps({ responseBody: { shippingMethods: [], subtotal: '99.98' } });
    const result = await patchPayPalSession(PAYPAL_ORDER_ID, PATCH_DATA, deps);
    expect(result.subtotal).toBe('99.98');
  });

  test('throws CommerceApiError on non-2xx response', async () => {
    const deps = makeDeps({ status: 502, responseBody: { message: 'paypal_token_error' } });
    let err;
    try {
      await patchPayPalSession(PAYPAL_ORDER_ID, PATCH_DATA, deps);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CommerceApiError);
    expect(err.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// getPayPalSession
// ---------------------------------------------------------------------------

test.describe('getPayPalSession', () => {
  test('makes GET request to /payments/paypal/session/:paypalOrderId', async () => {
    const { deps, getCapture } = makeCapturingDeps({ responseBody: {} });
    await getPayPalSession(PAYPAL_ORDER_ID, deps);
    expect(getCapture().url).toBe(`${ORIGIN}/payments/paypal/session/${PAYPAL_ORDER_ID}`);
    expect(getCapture().init.method).toBe('GET');
  });

  test('sends no body on GET', async () => {
    const { deps, getCapture } = makeCapturingDeps({ responseBody: {} });
    await getPayPalSession(PAYPAL_ORDER_ID, deps);
    expect(getCapture().init.body).toBeUndefined();
  });

  test('returns normalized payer and shipping details', async () => {
    const responseBody = {
      payer: { email_address: 'buyer@example.com' },
      shippingAddress: { country: 'us' },
      selectedOptionId: 'method-standard',
    };
    const deps = makeDeps({ responseBody });
    const result = await getPayPalSession(PAYPAL_ORDER_ID, deps);
    expect(result.payer.email_address).toBe('buyer@example.com');
    expect(result.selectedOptionId).toBe('method-standard');
  });

  test('throws CommerceApiError on non-2xx response', async () => {
    const deps = makeDeps({ status: 404, responseBody: { message: 'not found' } });
    await expect(getPayPalSession(PAYPAL_ORDER_ID, deps))
      .rejects.toBeInstanceOf(CommerceApiError);
  });
});

// ---------------------------------------------------------------------------
// request helper behaviour (tested via the wrappers above)
// ---------------------------------------------------------------------------

test.describe('request helper', () => {
  test('attaches Authorization header when token is present', async () => {
    const { deps, getCapture } = makeCapturingDeps({ token: 'my-token', responseBody: {} });
    await getPayPalSession(PAYPAL_ORDER_ID, deps);
    expect(getCapture().init.headers.Authorization).toBe('Bearer my-token');
  });

  test('omits Authorization header when token is absent', async () => {
    const { deps, getCapture } = makeCapturingDeps({ responseBody: {} });
    await getPayPalSession(PAYPAL_ORDER_ID, deps);
    expect(getCapture().init.headers.Authorization).toBeUndefined();
  });

  test('sets Content-Type: application/json when body is non-null', async () => {
    const { deps, getCapture } = makeCapturingDeps({ responseBody: {} });
    await patchPayPalSession(
      PAYPAL_ORDER_ID,
      { type: 'address', currency: 'USD' },
      deps,
    );
    expect(getCapture().init.headers['Content-Type']).toBe('application/json');
  });

  test('omits Content-Type when body is null (GET)', async () => {
    const { deps, getCapture } = makeCapturingDeps({ responseBody: {} });
    await getPayPalSession(PAYPAL_ORDER_ID, deps);
    expect(getCapture().init.headers['Content-Type']).toBeUndefined();
  });

  test('does not attach a reCAPTCHA token (PayPal endpoints are rate-limited)', async () => {
    const { deps, getCapture } = makeCapturingDeps({ responseBody: {} });
    await getPayPalSession(PAYPAL_ORDER_ID, deps);
    expect(getCapture().init.headers['X-Recaptcha-Token']).toBeUndefined();
  });
});
