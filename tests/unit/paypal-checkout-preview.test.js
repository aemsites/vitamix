import { test } from 'node:test';
import assert from 'node:assert/strict';
import ensureCheckoutPreviewToken from '../../scripts/payments/paypal-context.js';

function callbacksForState(state) {
  let updatePreviewCalls = 0;
  return {
    callbacks: {
      getState: () => state,
      updatePreview: async () => {
        updatePreviewCalls += 1;
        state.currentEstimateToken = 'generated-token';
      },
    },
    getUpdatePreviewCalls: () => updatePreviewCalls,
  };
}

test('ensureCheckoutPreviewToken reuses an existing PayPal checkout estimate token', async () => {
  const state = { currentEstimateToken: 'existing-token' };
  const { callbacks, getUpdatePreviewCalls } = callbacksForState(state);

  assert.equal(await ensureCheckoutPreviewToken(callbacks), true);
  assert.equal(getUpdatePreviewCalls(), 0);
  assert.equal(state.currentEstimateToken, 'existing-token');
});

test('ensureCheckoutPreviewToken creates a PayPal checkout estimate token when missing', async () => {
  const state = {};
  const { callbacks, getUpdatePreviewCalls } = callbacksForState(state);

  assert.equal(await ensureCheckoutPreviewToken(callbacks), true);
  assert.equal(getUpdatePreviewCalls(), 1);
  assert.equal(state.currentEstimateToken, 'generated-token');
});

test('ensureCheckoutPreviewToken reports failure when preview does not return a token', async () => {
  let updatePreviewCalls = 0;
  const callbacks = {
    getState: () => ({}),
    updatePreview: async () => { updatePreviewCalls += 1; },
  };

  assert.equal(await ensureCheckoutPreviewToken(callbacks), false);
  assert.equal(updatePreviewCalls, 1);
});
