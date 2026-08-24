import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistrationPayload } from '../../widgets/forms/product-registration.js';

const ctx = { locale: 'us', language: 'en_us', pageUrl: 'https://uat.vitamix.com/us/en_us/customer-service/product-registration' };

// --- issue #783: phone must reach SFDC via the `mobile` field ----------------

test('mirrors the phone field into mobile (SFDC Lead phone mapping)', () => {
  const payload = buildRegistrationPayload({ phone: '(555) 123-4567' }, ctx);
  assert.equal(payload.mobile, '(555) 123-4567');
  // original phone key is preserved for backward compatibility
  assert.equal(payload.phone, '(555) 123-4567');
});

test('does not add an empty mobile when phone is missing', () => {
  const payload = buildRegistrationPayload({ email: 'a@b.com' }, ctx);
  assert.equal('mobile' in payload, false);
});

test('does not add mobile when phone is an empty string', () => {
  const payload = buildRegistrationPayload({ phone: '' }, ctx);
  assert.equal('mobile' in payload, false);
});

// --- context fields ----------------------------------------------------------

test('sets formId and pageUrl from context', () => {
  const payload = buildRegistrationPayload({ phone: '5551234567' }, ctx);
  assert.equal(payload.formId, 'us/en_us/product-registration');
  assert.equal(payload.pageUrl, ctx.pageUrl);
});

test('scopes formId to the ca/fr_ca locale', () => {
  const payload = buildRegistrationPayload(
    { phone: '4165551234' },
    { locale: 'ca', language: 'fr_ca', pageUrl: 'https://uat.vitamix.com/ca/fr_ca/' },
  );
  assert.equal(payload.formId, 'ca/fr_ca/product-registration');
});

// --- preserves the rest of the form -----------------------------------------

test('preserves all other form entries (opt-in flags, name, address)', () => {
  const entries = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '5551234567',
    serialNumber: '123456789012345678',
    smsOptIn: 'yes',
    marketingOptIn: 'yes',
    acceptTerms: 'yes',
  };
  const payload = buildRegistrationPayload(entries, ctx);
  assert.equal(payload.firstName, 'Ada');
  assert.equal(payload.lastName, 'Lovelace');
  assert.equal(payload.email, 'ada@example.com');
  assert.equal(payload.serialNumber, '123456789012345678');
  assert.equal(payload.smsOptIn, 'yes');
  assert.equal(payload.marketingOptIn, 'yes');
  assert.equal(payload.acceptTerms, 'yes');
});

test('does not mutate the input entries object', () => {
  const entries = { phone: '5551234567' };
  buildRegistrationPayload(entries, ctx);
  assert.deepEqual(entries, { phone: '5551234567' });
});
