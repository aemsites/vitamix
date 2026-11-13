import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAndLoadCustomer } from '../../blocks/header/auth-panel.js';

beforeEach(() => {
  globalThis.__resetTestState();
});

const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const TOKEN = `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;

function mockApi(callbackBody, customerError = false) {
  const urls = [];
  globalThis.__setFetchMock(async (url) => {
    urls.push(String(url));
    if (customerError && String(url).includes('/customers/')) throw new Error('network');
    const body = String(url).includes('/auth/callback')
      ? callbackBody
      : { email: 'name@example.com', firstName: 'Name' };
    const status = 200;
    return {
      ok: status < 400,
      status,
      headers: new Map(),
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  });
  return urls;
}

test('looks up the customer by the lowercase email returned by /auth/callback', async () => {
  const urls = mockApi({
    success: true, token: TOKEN, email: 'name@example.com', roles: [],
  });
  const result = await verifyAndLoadCustomer('Name@Example.COM', '123456', 'hash', 1);
  assert.equal(result.email, 'name@example.com');
  const customerUrl = urls.find((u) => u.includes('/customers/'));
  assert.ok(customerUrl.endsWith('/customers/name%40example.com'), customerUrl);
});

test('falls back to the typed email lowercased when the response has no email', async () => {
  const urls = mockApi({ success: true, token: TOKEN, roles: [] });
  const result = await verifyAndLoadCustomer('Name@Example.COM', '123456', 'hash', 1);
  assert.equal(result.email, 'name@example.com');
  assert.ok(urls.some((u) => u.endsWith('/customers/name%40example.com')));
});

test('fails open when the customer lookup fails', async () => {
  mockApi({ success: true, token: TOKEN, email: 'name@example.com', roles: [] }, true);
  const result = await verifyAndLoadCustomer('Name@Example.COM', '123456', 'hash', 1);
  assert.equal(result.email, 'name@example.com');
  assert.equal(result.failed, true);
});
