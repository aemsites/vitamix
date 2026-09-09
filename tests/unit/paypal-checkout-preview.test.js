import { test } from 'node:test';
import assert from 'node:assert/strict';
import ensureCheckoutPreviewToken, {
  getPayPalExpressContext,
  withPayPalExpressContext,
} from '../../scripts/payments/paypal-context.js';

test('getPayPalExpressContext preserves the express button entry point', () => {
  assert.deepEqual(getPayPalExpressContext('checkout'), {
    paymentMethod: 'paypal',
    checkoutFlow: 'express',
    entryPoint: 'checkout',
  });
});

test('withPayPalExpressContext adds authoritative context to payloads', () => {
  assert.deepEqual(withPayPalExpressContext({
    paymentMethod: 'incorrect',
    items: [{ sku: 'sku-1' }],
  }, 'cart'), {
    paymentMethod: 'paypal',
    checkoutFlow: 'express',
    entryPoint: 'cart',
    items: [{ sku: 'sku-1' }],
  });
});

/**
 * Build a minimal JWT with the given `exp` (seconds since epoch).
 * The signature is irrelevant — only the payload is decoded client-side.
 */
function fakeJwt(exp) {
  const header = btoa(JSON.stringify({ alg: 'HS256' }));
  const payload = btoa(JSON.stringify({ exp }));
  return `${header}.${payload}.fake-sig`;
}

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
  // Token that expires 1 hour from now — well within the buffer.
  const validToken = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
  const state = { currentEstimateToken: validToken };
  const { callbacks, getUpdatePreviewCalls } = callbacksForState(state);

  assert.equal(await ensureCheckoutPreviewToken(callbacks), true);
  assert.equal(getUpdatePreviewCalls(), 0);
  assert.equal(state.currentEstimateToken, validToken);
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
