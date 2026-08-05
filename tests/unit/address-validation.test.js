import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidPostalCode, ZIP_US_RE, ZIP_CA_RE } from '../../scripts/address-validation.js';

// --- US ZIP ------------------------------------------------------------------

test('accepts a 5-digit US ZIP', () => {
  assert.equal(isValidPostalCode('43068'), true);
});

test('accepts a ZIP+4 US ZIP', () => {
  assert.equal(isValidPostalCode('43068-1234'), true);
});

test('trims surrounding whitespace before validating', () => {
  assert.equal(isValidPostalCode('  43068  '), true);
});

test('rejects the all-zeros placeholder ZIP', () => {
  assert.equal(isValidPostalCode('00000'), false);
});

test('rejects a too-short US ZIP', () => {
  assert.equal(isValidPostalCode('4306'), false);
});

test('rejects a Canadian postal code when not in Canada mode', () => {
  assert.equal(isValidPostalCode('K1A 0B1'), false);
});

// --- Canadian postal code ----------------------------------------------------

test('accepts a Canadian postal code with a space', () => {
  assert.equal(isValidPostalCode('K1A 0B1', true), true);
});

test('accepts a Canadian postal code without a space', () => {
  assert.equal(isValidPostalCode('K1A0B1', true), true);
});

test('accepts a Canadian postal code with a hyphen separator', () => {
  assert.equal(isValidPostalCode('K1A-0B1', true), true);
});

test('is case-insensitive for Canadian postal codes', () => {
  assert.equal(isValidPostalCode('k1a0b1', true), true);
});

test('rejects a US ZIP in Canada mode', () => {
  assert.equal(isValidPostalCode('43068', true), false);
});

test('rejects a Canadian postal code using a forbidden letter (D)', () => {
  assert.equal(isValidPostalCode('D1A 0B1', true), false);
});

// --- edge cases --------------------------------------------------------------

test('rejects empty / nullish input', () => {
  assert.equal(isValidPostalCode(''), false);
  assert.equal(isValidPostalCode(null), false);
  assert.equal(isValidPostalCode(undefined), false);
});

test('exports the underlying patterns', () => {
  assert.ok(ZIP_US_RE instanceof RegExp);
  assert.ok(ZIP_CA_RE instanceof RegExp);
});
