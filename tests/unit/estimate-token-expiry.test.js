import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEstimateExpiringSoon } from '../../scripts/estimate-token.js';

/**
 * Build a minimal JWT with the given `exp` (seconds since epoch).
 * The signature is irrelevant — only the payload is decoded client-side.
 */
function fakeJwt(exp) {
  const header = btoa(JSON.stringify({ alg: 'HS256' }));
  const payload = btoa(JSON.stringify({ exp }));
  return `${header}.${payload}.fake-sig`;
}

test('isEstimateExpiringSoon returns true for null/undefined tokens', () => {
  assert.equal(isEstimateExpiringSoon(null), true);
  assert.equal(isEstimateExpiringSoon(undefined), true);
  assert.equal(isEstimateExpiringSoon(''), true);
});

test('isEstimateExpiringSoon returns true for malformed tokens', () => {
  assert.equal(isEstimateExpiringSoon('not-a-jwt'), true);
  assert.equal(isEstimateExpiringSoon('a.b.c'), true);
});

test('isEstimateExpiringSoon returns true for an already-expired token', () => {
  const expired = fakeJwt(Math.floor(Date.now() / 1000) - 60);
  assert.equal(isEstimateExpiringSoon(expired), true);
});

test('isEstimateExpiringSoon returns true when token expires within the buffer', () => {
  // Expires in 2 minutes — inside the default 5-minute buffer
  const soonToken = fakeJwt(Math.floor(Date.now() / 1000) + 120);
  assert.equal(isEstimateExpiringSoon(soonToken), true);
});

test('isEstimateExpiringSoon returns false when token has plenty of time left', () => {
  // Expires in 1 hour — well outside the 5-minute buffer
  const freshToken = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
  assert.equal(isEstimateExpiringSoon(freshToken), false);
});

test('isEstimateExpiringSoon respects a custom buffer', () => {
  // Expires in 10 minutes
  const token = fakeJwt(Math.floor(Date.now() / 1000) + 600);
  // With a 15-minute buffer → expiring soon
  assert.equal(isEstimateExpiringSoon(token, 15 * 60 * 1000), true);
  // With a 5-minute buffer → not expiring soon
  assert.equal(isEstimateExpiringSoon(token, 5 * 60 * 1000), false);
});
