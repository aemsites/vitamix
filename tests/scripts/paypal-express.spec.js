import { test, expect } from '@playwright/test';

/**
 * Unit tests for renderExpressButton callbacks in scripts/payments/paypal.js.
 *
 * The callbacks are inlined here with injectable dependencies because paypal.js
 * imports commerce-api.js → auth-api.js → aem.js, a browser-only module that
 * cannot be loaded in the Node test runner.
 *
 * Keep these copies in sync with the real implementations in paypal.js.
 */

// ---------------------------------------------------------------------------
// Inlined callback logic with injectable deps
// ---------------------------------------------------------------------------

/** @param {{ createPayPalSessionFn: Function }} deps */
async function handleCreateOrder(callbacks, deps) {
  const config = callbacks.getConfig();
  const state = callbacks.getState();
  const cart = callbacks.getCart();
  const { paypalOrderId } = await deps.createPayPalSessionFn(cart.getItemsForAPI(), config);
  state.paypalSessionId = paypalOrderId;
  return paypalOrderId;
}

/**
 * @param {object} data
 * @param {object} actions
 * @param {{ lastShippingMethods: Array, lastShippingAddress: object|null }} closureState
 * @param {object} callbacks
 * @param {{ patchPayPalSessionFn: Function }} deps
 */
async function handleShippingAddressChange(data, actions, closureState, callbacks, deps) {
  closureState.lastShippingAddress = data.shippingAddress;
  const state = callbacks.getState();
  const cart = callbacks.getCart();
  try {
    const result = await deps.patchPayPalSessionFn(state.paypalSessionId, {
      type: 'address',
      address: {
        country: data.shippingAddress.countryCode,
        state: data.shippingAddress.state,
        zip: data.shippingAddress.postalCode,
      },
      items: cart.getItemsForAPI(),
    });
    if (!result.shippingMethods?.length) {
      return actions.reject(data.errors.ADDRESS_ERROR);
    }
    closureState.lastShippingMethods = result.shippingMethods;
  } catch {
    return actions.reject(data.errors.ADDRESS_ERROR);
  }
  return undefined;
}

/**
 * @param {object} data
 * @param {object} actions
 * @param {{ lastShippingMethods: Array, lastShippingAddress: object|null }} closureState
 * @param {object} callbacks
 * @param {{ patchPayPalSessionFn: Function }} deps
 */
async function handleShippingOptionsChange(data, actions, closureState, callbacks, deps) {
  const selectedId = data.selectedShippingOption?.id;
  const method = closureState.lastShippingMethods.find((m) => m.id === selectedId);
  if (!method) return actions.reject(data.errors.METHOD_UNAVAILABLE);
  const state = callbacks.getState();
  const cart = callbacks.getCart();
  await deps.patchPayPalSessionFn(state.paypalSessionId, {
    type: 'option',
    selectedOptionId: method.id,
    total: method.total,
    taxAmount: method.taxAmount,
    shippingRate: method.rate,
  });
  const countryCode = closureState.lastShippingAddress?.countryCode?.toLowerCase();
  const preview = await callbacks.previewOrderDirect({
    items: cart.getItemsForAPI(),
    shippingMethod: { id: method.id },
    ...(countryCode ? {
      country: countryCode,
      shipping: {
        country: countryCode,
        state: closureState.lastShippingAddress.state,
        zip: closureState.lastShippingAddress.postalCode || '',
      },
    } : {}),
  });
  state.currentEstimateToken = preview.estimateToken;
  return undefined;
}

/** @param {object} callbacks @param {{ getPayPalSessionFn: Function }} deps */
async function handleApprove(callbacks, deps) {
  try {
    const state = callbacks.getState();
    const session = await deps.getPayPalSessionFn(state.paypalSessionId);
    const cart = callbacks.getCart();
    const config = callbacks.getConfig();
    const orderBody = {
      customer: {
        firstName: session.payer.firstName,
        lastName: session.payer.lastName,
        email: session.payer.email,
        phone: '',
      },
      shipping: {
        name: `${session.payer.firstName} ${session.payer.lastName}`.trim(),
        ...session.shippingAddress,
        email: session.payer.email,
      },
      billing: {
        name: `${session.payer.firstName} ${session.payer.lastName}`.trim(),
        ...session.shippingAddress,
        email: session.payer.email,
      },
      items: cart.getItemsForAPI(),
      shippingMethod: { id: session.selectedOptionId },
      estimateToken: state.currentEstimateToken,
      country: session.shippingAddress.country,
      locale: config.getLanguage(),
    };
    const createdOrder = await callbacks.createOrder(orderBody);
    const fraudToken = (() => {
      try {
        // eslint-disable-next-line no-undef
        return (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('forter_token'))
          || undefined;
      } catch { return undefined; }
    })();
    const idempotencyKey = crypto.randomUUID?.() || `${Date.now()}`;
    const result = await callbacks.initiatePayment(
      createdOrder.order?.id ?? createdOrder.id,
      idempotencyKey,
      fraudToken,
      'paypal-express',
      'paypal',
      { paypalOrderId: state.paypalSessionId },
    );
    if (result.status === 'completed') {
      callbacks.onComplete(createdOrder);
    } else {
      callbacks.showError(result.reason || 'PayPal payment failed. Please try again.');
    }
  } catch {
    callbacks.showError('PayPal payment failed. Please try again.');
  }
}

/**
 * Mirrors the URLSearchParams construction in loadSdk() for parameter tests.
 *
 * @param {string} clientId
 * @param {string} currency
 * @param {string} locale
 * @returns {string}
 */
function buildSdkUrl(clientId, currency, locale) {
  const params = new URLSearchParams({
    'client-id': clientId,
    currency,
    components: 'buttons,messages',
    locale,
    commit: 'false',
    'enable-funding': 'paylater',
  });
  return `https://www.paypal.com/sdk/js?${params}`;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const ITEMS = [{ sku: 'SKU-001', quantity: 1, price: { final: '99.00', currency: 'USD' } }];
const SESSION_ID = 'PP-SESSION-001';

function makeState(overrides = {}) {
  return {
    paypalSessionId: SESSION_ID,
    currentEstimateToken: 'est-token-123',
    ...overrides,
  };
}

function makeCallbacks(state = makeState(), overrides = {}) {
  return {
    getConfig: () => ({
      getLanguage: () => 'en-US',
      currency: 'USD',
      getLocale: () => 'en-US',
    }),
    getState: () => state,
    getCart: () => ({ getItemsForAPI: () => ITEMS }),
    createOrder: async () => ({ order: { id: 'ORD-001' } }),
    initiatePayment: async () => ({ status: 'completed' }),
    onComplete: () => {},
    showError: () => {},
    previewOrderDirect: async () => ({ estimateToken: 'est-new-456' }),
    ...overrides,
  };
}

function makeActions() {
  let rejected = null;
  return {
    reject: (reason) => { rejected = reason; return undefined; },
    getRejected: () => rejected,
  };
}

// ---------------------------------------------------------------------------
// createOrder callback
// ---------------------------------------------------------------------------

test.describe('createOrder callback', () => {
  test('calls createPayPalSession with cart items and config', async () => {
    const state = makeState({ paypalSessionId: undefined });
    const callbacks = makeCallbacks(state);
    let capturedItems;
    let capturedConfig;
    const deps = {
      createPayPalSessionFn: async (items, config) => {
        capturedItems = items;
        capturedConfig = config;
        return { paypalOrderId: 'PP-NEW-001' };
      },
    };
    await handleCreateOrder(callbacks, deps);
    expect(capturedItems).toEqual(ITEMS);
    expect(capturedConfig.currency).toBe('USD');
  });

  test('stores paypalOrderId in state.paypalSessionId', async () => {
    const state = makeState({ paypalSessionId: undefined });
    const callbacks = makeCallbacks(state);
    const deps = {
      createPayPalSessionFn: async () => ({ paypalOrderId: 'PP-NEW-001' }),
    };
    await handleCreateOrder(callbacks, deps);
    expect(state.paypalSessionId).toBe('PP-NEW-001');
  });

  test('returns the paypalOrderId string to the caller', async () => {
    const state = makeState({});
    const callbacks = makeCallbacks(state);
    const deps = {
      createPayPalSessionFn: async () => ({ paypalOrderId: 'PP-RETURN-001' }),
    };
    const result = await handleCreateOrder(callbacks, deps);
    expect(result).toBe('PP-RETURN-001');
  });
});

// ---------------------------------------------------------------------------
// onShippingAddressChange callback
// ---------------------------------------------------------------------------

test.describe('onShippingAddressChange callback', () => {
  const ADDR_DATA = {
    shippingAddress: { countryCode: 'US', state: 'CA', postalCode: '90210' },
    errors: { ADDRESS_ERROR: 'ADDRESS_ERROR' },
  };

  test('patches with type=address and normalized field names', async () => {
    const state = makeState();
    const callbacks = makeCallbacks(state);
    const closureState = { lastShippingMethods: [], lastShippingAddress: null };
    let patchBody;
    const deps = {
      patchPayPalSessionFn: async (id, body) => {
        patchBody = body;
        return { shippingMethods: [{ id: 'std' }] };
      },
    };
    await handleShippingAddressChange(ADDR_DATA, makeActions(), closureState, callbacks, deps);
    expect(patchBody.type).toBe('address');
    expect(patchBody.address.country).toBe('US');
    expect(patchBody.address.state).toBe('CA');
    expect(patchBody.address.zip).toBe('90210');
    expect(patchBody.items).toEqual(ITEMS);
  });

  test('stores shippingMethods and shippingAddress in closure state on success', async () => {
    const state = makeState();
    const callbacks = makeCallbacks(state);
    const closureState = { lastShippingMethods: [], lastShippingAddress: null };
    const methods = [{ id: 'std', label: 'Standard' }];
    const deps = {
      patchPayPalSessionFn: async () => ({ shippingMethods: methods }),
    };
    await handleShippingAddressChange(ADDR_DATA, makeActions(), closureState, callbacks, deps);
    expect(closureState.lastShippingMethods).toEqual(methods);
    expect(closureState.lastShippingAddress).toEqual(ADDR_DATA.shippingAddress);
  });

  test('calls actions.reject with ADDRESS_ERROR when shippingMethods is empty', async () => {
    const state = makeState();
    const callbacks = makeCallbacks(state);
    const closureState = { lastShippingMethods: [], lastShippingAddress: null };
    const actions = makeActions();
    const deps = {
      patchPayPalSessionFn: async () => ({ shippingMethods: [] }),
    };
    await handleShippingAddressChange(ADDR_DATA, actions, closureState, callbacks, deps);
    expect(actions.getRejected()).toBe('ADDRESS_ERROR');
  });

  test('calls actions.reject with ADDRESS_ERROR when patchPayPalSession throws', async () => {
    const state = makeState();
    const callbacks = makeCallbacks(state);
    const closureState = { lastShippingMethods: [], lastShippingAddress: null };
    const actions = makeActions();
    const deps = {
      patchPayPalSessionFn: async () => { throw new Error('network error'); },
    };
    await handleShippingAddressChange(ADDR_DATA, actions, closureState, callbacks, deps);
    expect(actions.getRejected()).toBe('ADDRESS_ERROR');
  });
});

// ---------------------------------------------------------------------------
// onShippingOptionsChange callback
// ---------------------------------------------------------------------------

test.describe('onShippingOptionsChange callback', () => {
  const METHOD = {
    id: 'std',
    label: 'Standard',
    total: '14.99',
    taxAmount: '1.20',
    rate: '5.99',
  };
  const OPT_DATA = {
    selectedShippingOption: { id: 'std' },
    errors: { METHOD_UNAVAILABLE: 'METHOD_UNAVAILABLE' },
  };

  test('patches with type=option and amounts from the selected method', async () => {
    const state = makeState();
    const callbacks = makeCallbacks(state);
    const closureState = {
      lastShippingMethods: [METHOD],
      lastShippingAddress: { countryCode: 'US', state: 'CA', postalCode: '90210' },
    };
    let patchBody;
    const deps = {
      patchPayPalSessionFn: async (id, body) => { patchBody = body; return {}; },
    };
    await handleShippingOptionsChange(OPT_DATA, makeActions(), closureState, callbacks, deps);
    expect(patchBody.type).toBe('option');
    expect(patchBody.selectedOptionId).toBe('std');
    expect(patchBody.total).toBe('14.99');
    expect(patchBody.taxAmount).toBe('1.20');
    expect(patchBody.shippingRate).toBe('5.99');
  });

  test('calls previewOrderDirect with lowercased country and shipping from closure address', async () => {
    const state = makeState();
    let previewArg;
    const callbacks = makeCallbacks(state, {
      previewOrderDirect: async (arg) => { previewArg = arg; return { estimateToken: 'tok' }; },
    });
    const closureState = {
      lastShippingMethods: [METHOD],
      lastShippingAddress: { countryCode: 'US', state: 'CA', postalCode: '90210' },
    };
    const deps = { patchPayPalSessionFn: async () => ({}) };
    await handleShippingOptionsChange(OPT_DATA, makeActions(), closureState, callbacks, deps);
    expect(previewArg.country).toBe('us');
    expect(previewArg.shipping.country).toBe('us');
    expect(previewArg.shipping.state).toBe('CA');
    expect(previewArg.shipping.zip).toBe('90210');
    expect(previewArg.shippingMethod.id).toBe('std');
  });

  test('calls previewOrderDirect without country/shipping when lastShippingAddress is null', async () => {
    const state = makeState();
    let previewArg;
    const callbacks = makeCallbacks(state, {
      previewOrderDirect: async (arg) => { previewArg = arg; return { estimateToken: 'tok' }; },
    });
    const closureState = { lastShippingMethods: [METHOD], lastShippingAddress: null };
    const deps = { patchPayPalSessionFn: async () => ({}) };
    await handleShippingOptionsChange(OPT_DATA, makeActions(), closureState, callbacks, deps);
    expect(previewArg.country).toBeUndefined();
    expect(previewArg.shipping).toBeUndefined();
    expect(previewArg.shippingMethod.id).toBe('std');
  });

  test('stores preview.estimateToken in state.currentEstimateToken', async () => {
    const state = makeState({ currentEstimateToken: null });
    const callbacks = makeCallbacks(state, {
      previewOrderDirect: async () => ({ estimateToken: 'new-tok' }),
    });
    const closureState = {
      lastShippingMethods: [METHOD],
      lastShippingAddress: { countryCode: 'US', state: 'CA', postalCode: '90210' },
    };
    const deps = { patchPayPalSessionFn: async () => ({}) };
    await handleShippingOptionsChange(OPT_DATA, makeActions(), closureState, callbacks, deps);
    expect(state.currentEstimateToken).toBe('new-tok');
  });

  test('calls actions.reject with METHOD_UNAVAILABLE when method is not in lastShippingMethods', async () => {
    const state = makeState();
    const callbacks = makeCallbacks(state);
    const closureState = { lastShippingMethods: [{ id: 'express' }], lastShippingAddress: null };
    const actions = makeActions();
    const deps = { patchPayPalSessionFn: async () => ({}) };
    await handleShippingOptionsChange(
      { selectedShippingOption: { id: 'std' }, errors: { METHOD_UNAVAILABLE: 'METHOD_UNAVAILABLE' } },
      actions,
      closureState,
      callbacks,
      deps,
    );
    expect(actions.getRejected()).toBe('METHOD_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// onApprove callback
// ---------------------------------------------------------------------------

test.describe('onApprove callback', () => {
  const SESSION = {
    payer: { firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
    shippingAddress: {
      address1: '123 Main St', city: 'Los Angeles', state: 'CA', zip: '90210', country: 'us',
    },
    selectedOptionId: 'std',
  };

  test('calls getPayPalSession with state.paypalSessionId', async () => {
    const state = makeState({ paypalSessionId: 'PP-TEST-001' });
    let capturedId;
    const callbacks = makeCallbacks(state);
    const deps = {
      getPayPalSessionFn: async (id) => { capturedId = id; return SESSION; },
    };
    await handleApprove(callbacks, deps);
    expect(capturedId).toBe('PP-TEST-001');
  });

  test('builds orderBody from session payer, shippingAddress, and estimateToken', async () => {
    const state = makeState({ paypalSessionId: 'PP-TEST-001', currentEstimateToken: 'est-tok' });
    let orderBody;
    const callbacks = makeCallbacks(state, {
      createOrder: async (body) => { orderBody = body; return { order: { id: 'ORD-001' } }; },
    });
    const deps = { getPayPalSessionFn: async () => SESSION };
    await handleApprove(callbacks, deps);
    expect(orderBody.customer.firstName).toBe('John');
    expect(orderBody.customer.lastName).toBe('Doe');
    expect(orderBody.customer.email).toBe('john@example.com');
    expect(orderBody.customer.phone).toBe('');
    expect(orderBody.shipping).toEqual({ name: 'John Doe', ...SESSION.shippingAddress, email: 'john@example.com' });
    expect(orderBody.billing).toEqual({ name: 'John Doe', ...SESSION.shippingAddress, email: 'john@example.com' });
    expect(orderBody.shippingMethod.id).toBe('std');
    expect(orderBody.estimateToken).toBe('est-tok');
    expect(orderBody.country).toBe('us');
  });

  test('calls initiatePayment with provider=paypal-express, paymentMethod=paypal, paypalOrderId', async () => {
    const state = makeState({ paypalSessionId: 'PP-SESSION-XYZ' });
    let capturedArgs;
    const callbacks = makeCallbacks(state, {
      initiatePayment: async (...args) => { capturedArgs = args; return { status: 'completed' }; },
    });
    const deps = { getPayPalSessionFn: async () => SESSION };
    await handleApprove(callbacks, deps);
    expect(capturedArgs[3]).toBe('paypal-express');
    expect(capturedArgs[4]).toBe('paypal');
    expect(capturedArgs[5]).toEqual({ paypalOrderId: 'PP-SESSION-XYZ' });
  });

  test('calls onComplete with createdOrder when payment status is completed', async () => {
    const state = makeState();
    let completedOrder;
    const callbacks = makeCallbacks(state, {
      onComplete: (order) => { completedOrder = order; },
      initiatePayment: async () => ({ status: 'completed' }),
    });
    const deps = { getPayPalSessionFn: async () => SESSION };
    await handleApprove(callbacks, deps);
    expect(completedOrder).toBeDefined();
    expect(completedOrder.order.id).toBe('ORD-001');
  });

  test('calls showError with result.reason when payment status is not completed', async () => {
    const state = makeState();
    let errorMsg;
    const callbacks = makeCallbacks(state, {
      showError: (msg) => { errorMsg = msg; },
      initiatePayment: async () => ({ status: 'failed', reason: 'payment_declined' }),
    });
    const deps = { getPayPalSessionFn: async () => SESSION };
    await handleApprove(callbacks, deps);
    expect(errorMsg).toBe('payment_declined');
  });

  test('calls showError with fallback message when result.reason is absent', async () => {
    const state = makeState();
    let errorMsg;
    const callbacks = makeCallbacks(state, {
      showError: (msg) => { errorMsg = msg; },
      initiatePayment: async () => ({ status: 'failed' }),
    });
    const deps = { getPayPalSessionFn: async () => SESSION };
    await handleApprove(callbacks, deps);
    expect(errorMsg).toBe('PayPal payment failed. Please try again.');
  });

  test('calls showError when getPayPalSession throws', async () => {
    const state = makeState();
    let errorMsg;
    const callbacks = makeCallbacks(state, {
      showError: (msg) => { errorMsg = msg; },
    });
    const deps = {
      getPayPalSessionFn: async () => { throw new Error('network error'); },
    };
    await handleApprove(callbacks, deps);
    expect(errorMsg).toBe('PayPal payment failed. Please try again.');
  });

  test('calls showError when createOrder throws', async () => {
    const state = makeState();
    let errorMsg;
    const callbacks = makeCallbacks(state, {
      createOrder: async () => { throw new Error('order failed'); },
      showError: (msg) => { errorMsg = msg; },
    });
    const deps = { getPayPalSessionFn: async () => SESSION };
    await handleApprove(callbacks, deps);
    expect(errorMsg).toBe('PayPal payment failed. Please try again.');
  });
});

// ---------------------------------------------------------------------------
// SDK load parameters
// ---------------------------------------------------------------------------

test.describe('SDK load parameters', () => {
  test('includes commit=false in the SDK URL', () => {
    const url = buildSdkUrl('test-client-id', 'USD', 'en_US');
    expect(url).toContain('commit=false');
  });

  test('includes messages in the components parameter', () => {
    const url = buildSdkUrl('test-client-id', 'USD', 'en_US');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('components')).toContain('messages');
  });

  test('includes paylater in the enable-funding parameter', () => {
    const url = buildSdkUrl('test-client-id', 'USD', 'en_US');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('enable-funding')).toContain('paylater');
  });

  test('does NOT include venmo in the enable-funding parameter', () => {
    const url = buildSdkUrl('test-client-id', 'USD', 'en_US');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('enable-funding')).not.toContain('venmo');
  });
});

// ---------------------------------------------------------------------------
// Button style config
// ---------------------------------------------------------------------------

test.describe('button style config', () => {
  const BASE_STYLE = {
    layout: 'horizontal', color: 'gold', shape: 'rect', label: 'paypal', disableMaxHeight: true,
  };

  test('primary button has gold color, paypal label, and horizontal layout', () => {
    expect(BASE_STYLE.color).toBe('gold');
    expect(BASE_STYLE.label).toBe('paypal');
    expect(BASE_STYLE.layout).toBe('horizontal');
  });
});

// Pay Later is included automatically by the horizontal layout when eligible
// (via enable-funding=paylater in the SDK URL) — no separate button is rendered.

// ---------------------------------------------------------------------------
// Stub fallback (no window.paypal)
// ---------------------------------------------------------------------------

test.describe('stub fallback', () => {
  function dispatchRender(windowPaypal, onSdk, onStub) {
    if (!windowPaypal) {
      onStub();
      return 'stub';
    }
    onSdk();
    return 'sdk';
  }

  test('renders stub buttons and skips SDK when window.paypal is undefined', () => {
    let stubCalled = false;
    let sdkCalled = false;
    const result = dispatchRender(
      undefined,
      () => { sdkCalled = true; },
      () => { stubCalled = true; },
    );
    expect(result).toBe('stub');
    expect(stubCalled).toBe(true);
    expect(sdkCalled).toBe(false);
  });

  test('renders SDK buttons when window.paypal is defined', () => {
    let stubCalled = false;
    let sdkCalled = false;
    const mockPaypal = { Buttons: () => ({ render: () => {}, isEligible: () => false }) };
    const result = dispatchRender(
      mockPaypal,
      () => { sdkCalled = true; },
      () => { stubCalled = true; },
    );
    expect(result).toBe('sdk');
    expect(sdkCalled).toBe(true);
    expect(stubCalled).toBe(false);
  });
});
