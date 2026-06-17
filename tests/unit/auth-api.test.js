/**
 * Unit tests for scripts/auth-api.js — token storage helpers and the
 * localStorage-backed session that is shared across browser tabs.
 *
 * Run with `npm run test:unit`. The setup file installs the fetch mock and
 * browser globals (localStorage, document) that auth-api.js depends on.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_TOKEN_KEY,
  AUTH_USER_KEY,
  AUTH_EVENT,
  getToken,
  setToken,
  clearToken,
  isLoggedIn,
  getUser,
  verifyCode,
  logout,
} from '../../scripts/auth-api.js';

beforeEach(() => {
  globalThis.__resetTestState();
});

/** Returns the most recently dispatched AUTH_EVENT, or undefined. */
function lastAuthEvent() {
  return [...globalThis.__events].reverse().find((e) => e.type === AUTH_EVENT);
}

// --- Storage helpers --------------------------------------------------------

test('setToken writes the JWT to localStorage (shared across tabs)', () => {
  setToken('jwt-123');
  assert.equal(localStorage.getItem(AUTH_TOKEN_KEY), 'jwt-123');
  assert.equal(getToken(), 'jwt-123');
});

test('getToken returns null when no token is stored', () => {
  assert.equal(getToken(), null);
});

test('clearToken removes the JWT but leaves the cached user object', () => {
  setToken('jwt-123');
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify({ email: 'a@b.com', roles: ['user'] }));
  clearToken();
  assert.equal(getToken(), null);
  assert.ok(localStorage.getItem(AUTH_USER_KEY), 'user object should remain');
});

test('isLoggedIn reflects the presence of a token in localStorage', () => {
  assert.equal(isLoggedIn(), false);
  setToken('jwt-123');
  assert.equal(isLoggedIn(), true);
  clearToken();
  assert.equal(isLoggedIn(), false);
});

test('the token is not written to sessionStorage', () => {
  setToken('jwt-123');
  assert.equal(sessionStorage.getItem(AUTH_TOKEN_KEY), null);
});

// --- verifyCode -------------------------------------------------------------

test('verifyCode stores the JWT in localStorage and dispatches a logged-in event', async () => {
  globalThis.__setFetchMock(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true, token: 'jwt-abc', email: 'user@example.com', roles: ['user'],
    }),
    headers: { get: () => null },
  }));

  const data = await verifyCode('user@example.com', '123456', 'hash', Date.now() + 60000);

  assert.equal(data.token, 'jwt-abc');
  assert.equal(localStorage.getItem(AUTH_TOKEN_KEY), 'jwt-abc');
  assert.deepEqual(getUser(), { email: 'user@example.com', roles: ['user'] });
  assert.equal(isLoggedIn(), true);

  const evt = lastAuthEvent();
  assert.ok(evt, 'an AUTH_EVENT should be dispatched');
  assert.deepEqual(evt.detail, { loggedIn: true, email: 'user@example.com' });
});

// --- logout -----------------------------------------------------------------

test('logout clears token and user from localStorage and dispatches a logged-out event', async () => {
  setToken('jwt-abc');
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify({ email: 'user@example.com', roles: ['user'] }));
  globalThis.__setFetchMock(async () => ({ ok: true, status: 204, json: async () => ({}) }));

  await logout();

  assert.equal(getToken(), null);
  assert.equal(localStorage.getItem(AUTH_USER_KEY), null);
  assert.equal(isLoggedIn(), false);

  const evt = lastAuthEvent();
  assert.ok(evt, 'an AUTH_EVENT should be dispatched');
  assert.deepEqual(evt.detail, { loggedIn: false, email: null });
});

test('logout still clears local state when the server call fails', async () => {
  setToken('jwt-abc');
  globalThis.__setFetchMock(async () => { throw new Error('network down'); });

  await logout();

  assert.equal(getToken(), null);
  assert.equal(isLoggedIn(), false);
});
