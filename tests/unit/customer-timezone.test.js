import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getCustomerTimezone } from '../../scripts/commerce-api.js';

const originalDateTimeFormat = Intl.DateTimeFormat;

afterEach(() => {
  Intl.DateTimeFormat = originalDateTimeFormat;
});

function mockTimeZone(timeZone) {
  Intl.DateTimeFormat = () => ({
    resolvedOptions: () => ({ timeZone }),
  });
}

test('getCustomerTimezone returns the browser timezone', () => {
  mockTimeZone('America/New_York');

  assert.equal(getCustomerTimezone(), 'America/New_York');
});

test('getCustomerTimezone returns undefined when Intl throws', () => {
  Intl.DateTimeFormat = () => {
    throw new Error('unsupported');
  };

  assert.equal(getCustomerTimezone(), undefined);
});

test('getCustomerTimezone returns undefined when no timezone is reported', () => {
  mockTimeZone(undefined);

  assert.equal(getCustomerTimezone(), undefined);
});
