import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const ROOT = resolve('.');
const PAGE_PATH = '/__diagnostics__/logged-fetch';
const PAYMENT_PATH = '/__diagnostics__/payments';
const LOGGER_PATH = '/scripts/scripts.js';
const CAPABILITY = 'paypal-capability-for-log-test';
const AUTHORIZATION = 'Bearer auth-token-for-log-test';
const PAYMENT_BODY = {
  provider: 'paypal-express',
  paypalOrderId: 'PP-TEST-1',
  paypalSessionToken: CAPABILITY,
};

/**
 * Serve an offline browser fixture and the actual scripts.js dependency graph.
 * The production embed mode skips page bootstrap; only external I/O is replaced.
 */
async function loadLogger(page, { hostname = 'uat.vitamix.com', status = 502 } = {}) {
  const requests = [];
  const diagnostics = [];
  const consoleMessages = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    consoleMessages.push(text);
    if (message.type() === 'error' && text.startsWith('{')) {
      diagnostics.push(JSON.parse(text));
    }
  });
  await page.route('**/*', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === PAGE_PATH) {
      await route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>Request diagnostics</title></head><body><main><h1>Request diagnostics</h1><pre id="diagnostic"></pre></main></body></html>',
      });
    } else if (pathname.startsWith('/scripts/') && pathname.endsWith('.js')) {
      await route.fulfill({ path: resolve(ROOT, pathname.slice(1)) });
    } else if (pathname === PAYMENT_PATH) {
      requests.push({
        method: route.request().method(),
        headers: route.request().headers(),
        body: route.request().postData(),
      });
      await route.fulfill({
        status,
        headers: { 'x-error': 'temporary failure', 'x-error-code': 'PROVIDER_ERROR' },
        json: { message: 'temporary failure', retryable: true },
      });
    } else {
      // Never fall through to the live storefront, analytics, or payments API.
      await route.abort();
    }
  });
  await page.goto(`https://${hostname}${PAGE_PATH}?embed=1&rum=off`);
  return {
    requests, diagnostics, consoleMessages, pageErrors,
  };
}

async function makeRequest(page, { headerForm = 'Authorization', body = PAYMENT_BODY } = {}) {
  return page.evaluate(async ({
    path, authorization, headerKind, requestBody, loggerPath,
  }) => {
    // Load the real export, not the unit-test loader's loggedFetch mock.
    const { loggedFetch } = await import(loggerPath);
    const entries = [['Content-Type', 'application/json']];
    if (headerKind !== 'none') entries.push([headerKind, authorization]);
    let headers;
    if (headerKind === 'Headers') {
      headers = new Headers({ 'Content-Type': 'application/json', Authorization: authorization });
    } else if (headerKind === 'tuples') {
      headers = Object.freeze(entries.map(([name, value]) => Object.freeze([
        name === 'tuples' ? 'aUtHoRiZaTiOn' : name, value,
      ])));
    } else {
      headers = Object.freeze(Object.fromEntries(entries));
    }
    window.diagnosticRequest = Object.freeze({
      method: 'POST', headers, body: JSON.stringify(requestBody),
    });
    const response = await loggedFetch(path, window.diagnosticRequest);
    return { status: response.status, body: await response.json() };
  }, {
    path: PAYMENT_PATH,
    loggerPath: LOGGER_PATH,
    authorization: AUTHORIZATION,
    headerKind: headerForm,
    requestBody: body,
  });
}

test.describe('loggedFetch credential redaction @cross-browser', () => {
  ['Authorization', 'authorization', 'aUtHoRiZaTiOn', 'Headers', 'tuples'].forEach((headerForm) => {
    test(`redacts credentials with ${headerForm} headers without changing the request`, async ({ page }, testInfo) => {
      const {
        requests, diagnostics, consoleMessages, pageErrors,
      } = await loadLogger(page);
      const response = await makeRequest(page, { headerForm });
      await expect.poll(() => diagnostics.length).toBe(1);
      expect(requests).toHaveLength(1);
      expect(requests[0].headers.authorization).toBe(AUTHORIZATION);
      expect(JSON.parse(requests[0].body)).toEqual(PAYMENT_BODY);
      expect(response).toEqual({
        status: 502, body: { message: 'temporary failure', retryable: true },
      });
      expect(diagnostics[0].requestBody.paypalSessionToken).toBe('[REDACTED]');
      expect(diagnostics[0].requestHeaders.authorization).toBe('[REDACTED]');
      expect(diagnostics[0].requestHeaders['content-type']).toBe('application/json');
      expect(diagnostics[0].requestBody.provider).toBe('paypal-express');
      expect(diagnostics[0].status).toBe(502);
      expect(diagnostics[0].xErrorCode).toBe('PROVIDER_ERROR');
      expect(consoleMessages.join('\n')).not.toContain(CAPABILITY);
      expect(consoleMessages.join('\n')).not.toContain(AUTHORIZATION);
      const original = await page.evaluate(() => ({
        authorization: new Headers(window.diagnosticRequest.headers).get('authorization'),
        body: window.diagnosticRequest.body,
      }));
      expect(original).toEqual({
        authorization: AUTHORIZATION, body: JSON.stringify(PAYMENT_BODY),
      });
      expect(pageErrors).toEqual([]);
      if (headerForm === 'Authorization') {
        await page.locator('#diagnostic').evaluate((element, text) => {
          element.textContent = text;
        }, JSON.stringify(diagnostics[0], null, 2));
        await testInfo.attach('redacted-diagnostics', {
          body: await page.screenshot(), contentType: 'image/png',
        });
      }
    });
  });

  test('redacts a guest capability without adding an authorization header', async ({ page }) => {
    const {
      diagnostics, requests, consoleMessages, pageErrors,
    } = await loadLogger(page);
    await makeRequest(page, { headerForm: 'none' });
    await expect.poll(() => diagnostics.length).toBe(1);
    expect(JSON.parse(requests[0].body)).toEqual(PAYMENT_BODY);
    expect(requests[0].headers).not.toHaveProperty('authorization');
    expect(diagnostics[0].requestBody.paypalSessionToken).toBe('[REDACTED]');
    expect(diagnostics[0].requestHeaders).not.toHaveProperty('authorization');
    expect(consoleMessages.join('\n')).not.toContain(CAPABILITY);
    expect(pageErrors).toEqual([]);
  });

  test('does not invent a capability when the request has none', async ({ page }) => {
    const { diagnostics, consoleMessages, pageErrors } = await loadLogger(page);
    await makeRequest(page, { body: { provider: 'paypal-express', paypalOrderId: 'PP-TEST-1' } });
    await expect.poll(() => diagnostics.length).toBe(1);
    expect(consoleMessages.join('\n')).not.toContain(AUTHORIZATION);
    expect(diagnostics[0].requestBody).toEqual({ provider: 'paypal-express', paypalOrderId: 'PP-TEST-1' });
    expect(diagnostics[0].requestHeaders.authorization).toBe('[REDACTED]');
    expect(pageErrors).toEqual([]);
  });

  test('preserves diagnostics for a request without init or credentials', async ({ page }) => {
    const { diagnostics, requests, pageErrors } = await loadLogger(page);
    const status = await page.evaluate(async (paths) => {
      const { loggedFetch } = await import(paths.logger);
      return (await loggedFetch(paths.payment)).status;
    }, { logger: LOGGER_PATH, payment: PAYMENT_PATH });
    await expect.poll(() => diagnostics.length).toBe(1);
    expect(status).toBe(502);
    expect(requests[0].method).toBe('GET');
    expect(diagnostics[0].method).toBe('GET');
    expect(diagnostics[0].requestBody).toBeUndefined();
    expect(pageErrors).toEqual([]);
  });

  [
    ['successful responses', { status: 200 }],
    ['the production host', { hostname: 'www.vitamix.com' }],
  ].forEach(([name, options]) => {
    test(`still skips diagnostics for ${name}`, async ({ page }) => {
      const { diagnostics, requests, pageErrors } = await loadLogger(page, options);
      await makeRequest(page);
      expect(requests).toHaveLength(1);
      expect(requests[0].headers.authorization).toBe(AUTHORIZATION);
      expect(JSON.parse(requests[0].body)).toEqual(PAYMENT_BODY);
      expect(diagnostics).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  });
});
