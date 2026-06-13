import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { callDualValidateAddress } from '../../blocks/checkout/checkout-address.js';

const apiOrigin = 'https://api.adobecommerce.live/org/sites/site';
const addressDoctorOrigin = 'https://vitamix-address-doctor-proxy-worker.adobeaem.workers.dev';
const payload = { address: { regionCode: 'US', addressLines: ['1450 Brickell Avenue', 'Miami, FL 33131'] } };

const googleSubpremise = {
  action: 'CONFIRM_ADD_SUBPREMISES',
  formattedAddress: '1450 Brickell Ave, Miami, FL 33131, USA',
  addressComponents: [
    { longText: '1450', shortText: '1450', types: ['street_number'] },
    { longText: 'Brickell Avenue', shortText: 'Brickell Avenue', types: ['route'] },
    { longText: 'Miami', shortText: 'Miami', types: ['locality'] },
    { longText: 'Florida', shortText: 'FL', types: ['administrative_area_level_1'] },
    { longText: '33131', shortText: '33131', types: ['postal_code'] },
  ],
  uspsDeliverable: true,
};

const addressDoctorConfirm = {
  provider: 'addressdoctor',
  action: 'CONFIRM',
  formattedAddress: '1450 Brickell Ave, Miami FL 33131',
  addressComponents: [],
  uspsDeliverable: true,
};

afterEach(() => {
  window.IS_TEST_MODE = false;
  globalThis.__resetTestState();
});

function mockFetch(google, addressDoctor) {
  window.IS_TEST_MODE = true;
  globalThis.__setFetchMock(async (url) => ({
    ok: true,
    json: async () => (url.startsWith(addressDoctorOrigin) ? addressDoctor : google),
  }));
}

test('callDualValidateAddress preserves Google add-subpremise action when AddressDoctor does not reject', async () => {
  mockFetch(googleSubpremise, addressDoctorConfirm);

  const result = await callDualValidateAddress(
    { apiOrigin, addressDoctorOrigin },
    payload,
    'tok-1',
  );

  assert.equal(result, googleSubpremise);
});

test('callDualValidateAddress keeps AddressDoctor FIX over Google add-subpremise action', async () => {
  const addressDoctorFix = { ...addressDoctorConfirm, action: 'FIX', uspsDeliverable: false };
  mockFetch(googleSubpremise, addressDoctorFix);

  const result = await callDualValidateAddress(
    { apiOrigin, addressDoctorOrigin },
    payload,
    'tok-1',
  );

  assert.equal(result, addressDoctorFix);
});
