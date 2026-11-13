/**
 * Unit tests for the email used after OTP verification in blocks/header/auth-panel.js.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCode } from '../../scripts/auth-api.js';
import { getVerifiedEmail } from '../../blocks/header/auth-panel.js';

beforeEach(() => {
  globalThis.__resetTestState();
});

test('uses the lowercase email returned by /auth/callback for the typed mixed-case email', async () => {
  const typed = 'Name@Example.COM';
  globalThis.__setFetchMock(async () => ({
    ok: true,
    json: async () => ({
      success: true, token: 'tok', email: 'name@example.com', roles: [],
    }),
  }));
  const verified = await verifyCode(typed, '123456', 'hash', 1);
  assert.equal(getVerifiedEmail(typed, verified), 'name@example.com');
});

test('falls back to the typed email lowercased when the response has no email', () => {
  assert.equal(getVerifiedEmail('Name@Example.COM', {}), 'name@example.com');
  assert.equal(getVerifiedEmail('Name@Example.COM', undefined), 'name@example.com');
});
