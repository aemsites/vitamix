import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isProfileIncomplete, buildProfileUpdate } from '../../blocks/header/auth-profile.js';

// --- isProfileIncomplete -----------------------------------------------------

test('isProfileIncomplete: incomplete when name missing or record absent', () => {
  assert.equal(isProfileIncomplete(null), true);
  assert.equal(isProfileIncomplete({}), true);
  assert.equal(isProfileIncomplete({ firstName: 'Ada' }), true);
  assert.equal(isProfileIncomplete({ lastName: 'Lovelace' }), true);
});

test('isProfileIncomplete: complete with first and last name, ignores zip/custom', () => {
  assert.equal(isProfileIncomplete({ firstName: 'Ada', lastName: 'Lovelace' }), false);
  // a checked-out customer with a name but no survey data is still complete
  assert.equal(isProfileIncomplete({ firstName: 'Ada', lastName: 'Lovelace', custom: {} }), false);
});

// --- buildProfileUpdate ------------------------------------------------------

test('buildProfileUpdate: names only, no custom bag when no survey answers', () => {
  const body = buildProfileUpdate({ firstName: ' Ada ', lastName: ' Lovelace ' });
  assert.deepEqual(body, { firstName: 'Ada', lastName: 'Lovelace' });
  assert.equal('custom' in body, false);
});

test('buildProfileUpdate: collects provided survey answers into custom', () => {
  const body = buildProfileUpdate(
    {
      firstName: 'Ada', lastName: 'Lovelace', plannedUse: 'home', ownsVitamix: 'no',
    },
  );
  assert.deepEqual(body.custom, { plannedUse: 'home', ownsVitamix: 'no' });
});

test('buildProfileUpdate: stamps termsAcceptedAt with the supplied time when agreed', () => {
  const now = '2026-08-10T00:00:00.000Z';
  const body = buildProfileUpdate({ firstName: 'Ada', lastName: 'Lovelace', termsAccepted: true }, now);
  assert.equal(body.custom.termsAcceptedAt, now);
});

test('buildProfileUpdate: omits terms timestamp when not agreed', () => {
  const body = buildProfileUpdate({ firstName: 'Ada', lastName: 'Lovelace', termsAccepted: false });
  assert.equal('custom' in body, false);
});

test('buildProfileUpdate: omits empty name fields so a partial PATCH cannot clear them', () => {
  const body = buildProfileUpdate({ firstName: '', lastName: '', plannedUse: 'business' });
  assert.equal('firstName' in body, false);
  assert.equal('lastName' in body, false);
  assert.deepEqual(body.custom, { plannedUse: 'business' });
});
