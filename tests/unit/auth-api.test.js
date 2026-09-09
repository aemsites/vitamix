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
  getTokenExpirySec,
  isAuthTokenExpired,
  scheduleAuthExpiry,
} from '../../scripts/auth-api.js';

beforeEach(() => {
  globalThis.__resetTestState();
});

/** Build a JWT-shaped token whose payload carries the given claims. */
function makeJwt(claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
}
const nowSec = () => Math.floor(Date.now() / 1000);
const FUTURE_JWT = makeJwt({ exp: nowSec() + 3600 });
const EXPIRED_JWT = makeJwt({ exp: nowSec() - 3600 });

/** Returns the most recently dispatched AUTH_EVENT, or undefined. */
function lastAuthEvent() {
  return [...globalThis.__events].reverse().find((e) => e.type === AUTH_EVENT);
}

// --- Storage helpers --------------------------------------------------------

test('setToken writes the JWT to localStorage (shared across tabs)', () => {
  setToken(FUTURE_JWT);
  assert.equal(localStorage.getItem(AUTH_TOKEN_KEY), FUTURE_JWT);
  assert.equal(getToken(), FUTURE_JWT);
});

test('getToken returns null when no token is stored', () => {
  assert.equal(getToken(), null);
});

test('clearToken removes the JWT but leaves the cached user object', () => {
  setToken(FUTURE_JWT);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify({ email: 'a@b.com', roles: ['user'] }));
  clearToken();
  assert.equal(getToken(), null);
  assert.ok(localStorage.getItem(AUTH_USER_KEY), 'user object should remain');
});

test('isLoggedIn reflects the presence of a live token in localStorage', () => {
  assert.equal(isLoggedIn(), false);
  setToken(FUTURE_JWT);
  assert.equal(isLoggedIn(), true);
  clearToken();
  assert.equal(isLoggedIn(), false);
});

test('the token is not written to sessionStorage', () => {
  setToken(FUTURE_JWT);
  assert.equal(sessionStorage.getItem(AUTH_TOKEN_KEY), null);
});

// --- Expiry -----------------------------------------------------------------

test('getTokenExpirySec reads exp, falling back to iat + 24h', () => {
  assert.equal(getTokenExpirySec(makeJwt({ exp: 1000 })), 1000);
  assert.equal(getTokenExpirySec(makeJwt({ iat: 2000 })), 2000 + 86400);
  assert.equal(getTokenExpirySec('not-a-jwt'), null);
});

test('isAuthTokenExpired is true for expired and undecodable tokens', () => {
  assert.equal(isAuthTokenExpired(FUTURE_JWT), false);
  assert.equal(isAuthTokenExpired(EXPIRED_JWT), true);
  assert.equal(isAuthTokenExpired('garbage'), true);
});

test('getToken clears and reports an expired token as absent', () => {
  localStorage.setItem(AUTH_TOKEN_KEY, EXPIRED_JWT);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify({ email: 'a@b.com', roles: ['user'] }));
  assert.equal(getToken(), null);
  assert.equal(localStorage.getItem(AUTH_TOKEN_KEY), null, 'expired token should be removed');
  assert.equal(localStorage.getItem(AUTH_USER_KEY), null, 'cached user should be removed');
  assert.equal(isLoggedIn(), false);
});

test('scheduleAuthExpiry logs out immediately when the token is already expired', () => {
  localStorage.setItem(AUTH_TOKEN_KEY, EXPIRED_JWT);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify({ email: 'a@b.com', roles: ['user'] }));
  scheduleAuthExpiry();
  assert.equal(localStorage.getItem(AUTH_TOKEN_KEY), null);
  const evt = lastAuthEvent();
  assert.ok(evt, 'an AUTH_EVENT should be dispatched');
  assert.deepEqual(evt.detail, { loggedIn: false, email: null });
});

test('scheduleAuthExpiry is a no-op when no token is stored', () => {
  scheduleAuthExpiry();
  assert.equal(lastAuthEvent(), undefined);
});

// --- verifyCode -------------------------------------------------------------

test('verifyCode stores the JWT in localStorage and dispatches a logged-in event', async () => {
  globalThis.__setFetchMock(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true, token: FUTURE_JWT, email: 'user@example.com', roles: ['user'],
    }),
    headers: { get: () => null },
  }));

  const data = await verifyCode('user@example.com', '123456', 'hash', Date.now() + 60000);

  assert.equal(data.token, FUTURE_JWT);
  assert.equal(localStorage.getItem(AUTH_TOKEN_KEY), FUTURE_JWT);
  assert.deepEqual(getUser(), { email: 'user@example.com', roles: ['user'] });
  assert.equal(isLoggedIn(), true);

  const evt = lastAuthEvent();
  assert.ok(evt, 'an AUTH_EVENT should be dispatched');
  assert.deepEqual(evt.detail, { loggedIn: true, email: 'user@example.com' });
});

// --- logout -----------------------------------------------------------------

test('logout clears token and user from localStorage and dispatches a logged-out event', async () => {
  setToken(FUTURE_JWT);
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
  setToken(FUTURE_JWT);
  globalThis.__setFetchMock(async () => { throw new Error('network down'); });

  await logout();

  assert.equal(getToken(), null);
  assert.equal(isLoggedIn(), false);
});
