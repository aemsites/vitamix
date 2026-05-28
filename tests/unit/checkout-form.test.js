import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhoneDisplay } from '../../blocks/checkout/checkout-form.js';

// --- partial entry -----------------------------------------------------------

test('empty string returns empty', () => {
  assert.equal(formatPhoneDisplay(''), '');
});

test('1-3 digits returned as-is', () => {
  assert.equal(formatPhoneDisplay('5'), '5');
  assert.equal(formatPhoneDisplay('55'), '55');
  assert.equal(formatPhoneDisplay('555'), '555');
});

test('4-6 digits formatted with area code', () => {
  assert.equal(formatPhoneDisplay('5551'), '(555) 1');
  assert.equal(formatPhoneDisplay('55512'), '(555) 12');
  assert.equal(formatPhoneDisplay('555123'), '(555) 123');
});

test('7+ digits formatted with hyphen', () => {
  assert.equal(formatPhoneDisplay('5551234'), '(555) 123-4');
  assert.equal(formatPhoneDisplay('55512345'), '(555) 123-45');
  assert.equal(formatPhoneDisplay('555123456'), '(555) 123-456');
});

// --- full 10-digit number ----------------------------------------------------

test('10 digits formats to (XXX) XXX-XXXX', () => {
  assert.equal(formatPhoneDisplay('5551234567'), '(555) 123-4567');
});

test('canadian number formats identically', () => {
  assert.equal(formatPhoneDisplay('4165551234'), '(416) 555-1234');
  assert.equal(formatPhoneDisplay('5145551234'), '(514) 555-1234');
});

// --- +1 country code strip ---------------------------------------------------

test('11 digits starting with 1 strips country code', () => {
  assert.equal(formatPhoneDisplay('15551234567'), '(555) 123-4567');
});

test('+1 CA number strips country code', () => {
  assert.equal(formatPhoneDisplay('14165551234'), '(416) 555-1234');
});

// --- main bug: 11 digits NOT starting with 1 should not strip from front ----

test('11 digits not starting with 1 drops last digit, not first', () => {
  // pre-fix: would have dropped first digit → (551) 234-5678
  assert.equal(formatPhoneDisplay('55512345678'), '(555) 123-4567');
});

test('11 digits starting with 9 drops last digit, keeps first 10', () => {
  assert.equal(formatPhoneDisplay('95551234567'), '(955) 512-3456');
});

// --- excess digits beyond 11 -------------------------------------------------

test('12+ digits capped at first 10', () => {
  assert.equal(formatPhoneDisplay('555123456789'), '(555) 123-4567');
});

// --- non-digit characters stripped -------------------------------------------

test('letters are stripped before formatting', () => {
  assert.equal(formatPhoneDisplay('555abc1234567'), '(555) 123-4567');
});

test('formatted paste with dashes formats correctly', () => {
  assert.equal(formatPhoneDisplay('555-123-4567'), '(555) 123-4567');
});

test('formatted paste with spaces formats correctly', () => {
  assert.equal(formatPhoneDisplay('555 123 4567'), '(555) 123-4567');
});

test('formatted paste with existing parens formats correctly', () => {
  assert.equal(formatPhoneDisplay('(555) 123-4567'), '(555) 123-4567');
});

test('+1 with spaces and formatting strips country code', () => {
  assert.equal(formatPhoneDisplay('+1 (555) 123-4567'), '(555) 123-4567');
});

test('+1 CA with spaces strips country code', () => {
  assert.equal(formatPhoneDisplay('+1 416 555 1234'), '(416) 555-1234');
});

test('1-XXX-XXX-XXXX format strips country code', () => {
  assert.equal(formatPhoneDisplay('1-555-123-4567'), '(555) 123-4567');
});
