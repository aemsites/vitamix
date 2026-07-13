/* eslint-disable no-console */
import { test, expect } from '@playwright/test';
import {
  getCurrentBranch,
  getBaseUrl,
} from '../utils/test-helpers.js';

/**
 * Integration tests for the edge checkout page at /us/en_us/order/checkout.
 *
 * Setup pattern for each test:
 *   1. Use page.addInitScript to seed the edge cart in localStorage so the
 *      checkout page renders the form instead of the empty state.
 *   2. Mock all commerce API endpoints (shipping, preview, order, payment).
 *   3. Block third-party SDKs (reCAPTCHA, PayPal, Apple Pay, Places) that
 *      add noise and instability.
 *   4. Navigate to /us/en_us/order/checkout?cart=edge.
 *   5. Fill the form, submit, and verify request bodies + side effects.
 *
 * Checkout flow under test:
 *   submit → validate → updatePreview (POST /orders/preview)
 *          → createOrder (POST /orders) → initiatePayment (POST /orders/:id/payments)
 *          → either redirect to payment URL or /order/complete?orderId=...
 */

const TEST_EMAIL = 'qa-test@example.com';

const VALID_ADDRESS = {
  firstName: 'Test',
  lastName: 'User',
  street: '123 Main St',
  city: 'San Francisco',
  state: 'CA',
  zip: '94102',
  phone: '5551234567',
};

const BILLING_ADDRESS = {
  firstName: 'Billing',
  lastName: 'User',
  street: '500 Market St',
  city: 'San Francisco',
  state: 'CA',
  zip: '94105',
  phone: '5559876543',
};

const MOCK_RATES = [
  {
    id: 'standard', label: 'Standard Shipping', rate: 5.99, eta: '3-5 business days',
  },
  {
    id: 'express', label: 'Express Shipping', rate: 19.99, eta: '1-2 business days',
  },
];

const MOCK_PREVIEW = {
  subtotal: 549.99,
  taxAmount: 48.12,
  taxRate: 0.0875,
  shippingMethod: { id: 'standard', rate: 5.99 },
  shippingRate: 5.99,
  discounts: [],
  total: 604.10,
  estimateToken: 'mock-estimate-token-abc',
};

const MOCK_ORDER_ID = 'mock-order-12345';

// ─── Helpers ────────────────────────────────────────────────────────────────

const MOCK_CART_ITEM = {
  sku: 'Ascent X2',
  name: 'Ascent X2',
  price: '549.99',
  quantity: 1,
  path: '/us/en_us/products/ascent-x2',
  url: '/us/en_us/products/ascent-x2',
  image: '/media_1f7f2a6d8df92c8a3ad36b03745d3b1f96c1f26ab.png',
  selectedOptions: [
    { id: 'color', value: 'black' },
  ],
  custom: {
    maxCartQty: 3,
  },
};

/**
 * Seed the edge cart directly before navigating to checkout.
 *
 * The previous helper visited a live PDP and clicked "Add to Cart" before
 * every checkout test. Across both Playwright browser projects and CI retries,
 * that multiplied branch-preview origin traffic by dozens of full PDP loads per
 * run. These tests exercise checkout behavior, not PDP add-to-cart behavior, so
 * seed the cart storage with the same schema that scripts/cart.js restores.
 */
async function seedCart(page, items = [MOCK_CART_ITEM]) {
  await page.addInitScript((cartItems) => {
    window.IS_TEST_MODE = true;

    // Keep the seed one-shot. addInitScript runs on every same-page reload and
    // redirect; re-seeding after cart.clear() would mask empty-cart behavior.
    if (!sessionStorage.getItem('checkout-test-cart-seeded')) {
      const visibleItemCount = cartItems.reduce((sum, item) => {
        if (item.local?.showInCart === false) return sum;
        if (item.custom?.giftWithPurchase) return sum;
        return sum + item.quantity;
      }, 0);
      const expires = new Date(Date.now() + 30 * 864e5).toUTCString();

      localStorage.setItem('cart:us', JSON.stringify({
        version: 1,
        items: cartItems,
      }));
      document.cookie = `cart_items_count=${visibleItemCount}; expires=${expires}; path=/`;
      sessionStorage.setItem('checkout-test-cart-seeded', 'true');
    }

    // Checkout tests mock totals explicitly and do not cover promotion rule
    // resolution. Disable GWP to avoid live promo rules adding product-page
    // fetches and extra hidden cart lines during checkout tests.
    localStorage.setItem('vitamix.priceRules.stub', JSON.stringify({ promotions: [] }));
  }, items);
}

/**
 * Register default mocks for all commerce API endpoints used by checkout.
 * Pass overrides to swap specific behaviour (e.g. failing endpoints, custom
 * preview values). Each handler key receives `(route, request)`.
 */
async function setupCheckoutMocks(page, overrides = {}) {
  await page.addInitScript(() => { window.IS_TEST_MODE = true; });

  // Suppress operations-log calls at the network layer too. This protects
  // local test runs against branch previews that do not yet include the
  // window.IS_TEST_MODE guard in scripts/operations-log.js.
  await page.route('**/us/en_us/products/operations-log', (route) => route.fulfill({ status: 204, body: '' }));

  // Block only the external Google reCAPTCHA SDK and Tag Manager — keep
  // the local `/scripts/recaptcha.js` wrapper alive (the checkout block
  // imports it; aborting it makes decorate() throw and render nothing).
  await page.route(
    /https:\/\/(?:www\.google\.com\/recaptcha|www\.gstatic\.com\/recaptcha|www\.recaptcha\.net|www\.googletagmanager\.com)/,
    (route) => route.abort(),
  );

  // Block Google Places address autocomplete to keep the address fields static
  await page.route('**/places/autocomplete*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ predictions: [] }),
  }));
  await page.route('**/places/details*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ result: null }),
  }));
  await page.route('**/places/validate*', overrides.validateAddress || (async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ action: 'ACCEPT' }),
    });
  }));

  // Shipping rates
  await page.route('**/estimate/shipping', overrides.shipping || (async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rates: MOCK_RATES }),
    });
  }));

  // Coupon validation / discount estimate
  await page.route('**/estimate/price', overrides.estimatePrice || (async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subtotal: 549.99,
        discounts: [],
        orderDiscountTotal: 0,
      }),
    });
  }));

  // Order preview — locks totals and returns estimateToken
  await page.route('**/orders/preview', overrides.preview || (async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PREVIEW),
    });
  }));

  // Order creation
  await page.route(/\/orders$/, overrides.createOrder || (async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        order: {
          id: MOCK_ORDER_ID,
          customer: {
            firstName: VALID_ADDRESS.firstName,
            lastName: VALID_ADDRESS.lastName,
            email: TEST_EMAIL,
          },
        },
      }),
    });
  }));

  // Payment initiation — defaults to synchronous success
  await page.route(/\/orders\/[^/]+\/payments$/, overrides.payment || (async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        orderId: MOCK_ORDER_ID,
        paymentAttemptId: 'pay-abc-123',
        status: 'completed',
      }),
    });
  }));

  // Stub the order-complete page. The real one loads slowly and triggers
  // `networkidle` issues. We only care that the redirect happens — the
  // destination's actual content is not part of the test.
  await page.route('**/us/en_us/order/complete*', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><body><h1>Order complete (stub)</h1></body></html>',
  }));
}

async function gotoCheckout(page, baseUrl) {
  // Do NOT wait for `networkidle` — the checkout page loads analytics /
  // RUM / Forter beacons that keep firing indefinitely. The subsequent
  // `expect(...).toBeVisible({ timeout })` calls do the waiting we need.
  await page.goto(`${baseUrl}/us/en_us/order/checkout?cart=edge&martech=off`);
}

/**
 * On mobile viewports the order-summary block starts collapsed
 * (.order-summary.is-collapsed, content height: 0, overflow: hidden).
 * Locators inside the collapsed content still resolve as "visible" to
 * Playwright but clicks don't reach handlers because the rendered
 * height is zero. Expand it before interacting.
 */
async function expandOrderSummary(page) {
  // Two elements have `.order-summary`: the outer AEM block wrapper
  // (`<div class="order-summary block">`) and the inner template div
  // (`<div class="order-summary is-collapsed">`). The collapse class is
  // applied to the inner one, so exclude the outer block wrapper.
  const summary = page.locator('.order-summary:not(.block)');
  await summary.waitFor({ state: 'attached', timeout: 15000 });
  const collapsed = await summary.evaluate((el) => el.classList.contains('is-collapsed'));
  if (collapsed) {
    await page.locator('.order-summary-toggle').click();
    // height transition is 0.35s; wait for it to settle.
    await page.waitForTimeout(500);
  }
}

// Field selectors must be scoped to the checkout form — the footer also
// renders a newsletter form with [name="email"] etc., which would match
// otherwise (strict-mode locator violation).
const field = (page, name) => page.locator(`.checkout-form [name="${name}"]`);

async function fillContact(page, email = TEST_EMAIL) {
  await field(page, 'email').fill(email);
}

async function fillShipping(page, address = VALID_ADDRESS) {
  await field(page, 'shipping-firstname').fill(address.firstName);
  await field(page, 'shipping-lastname').fill(address.lastName);
  await field(page, 'shipping-street-0').fill(address.street);
  await field(page, 'shipping-city').fill(address.city);
  // State must change last so it triggers the shipping rates fetch
  await field(page, 'shipping-zip').fill(address.zip);
  await field(page, 'shipping-telephone').fill(address.phone);
  await field(page, 'shipping-state').selectOption(address.state);
}

async function fillBilling(page, address = VALID_ADDRESS) {
  await field(page, 'billing-firstname').fill(address.firstName);
  await field(page, 'billing-lastname').fill(address.lastName);
  await field(page, 'billing-street-0').fill(address.street);
  await field(page, 'billing-city').fill(address.city);
  await field(page, 'billing-zip').fill(address.zip);
  await field(page, 'billing-telephone').fill(address.phone);
  await field(page, 'billing-state').selectOption(address.state);
}

async function selectCreditCardAndWaitForPreview(page) {
  const previewResponse = page.waitForResponse(
    (res) => res.url().includes('/orders/preview') && res.request().method() === 'POST',
    { timeout: 15000 },
  );
  await page.locator('.checkout-form [name="paymentMethod"][value="chase"]').check();
  await previewResponse;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Edge Checkout Page', () => {
  // No retries on these tests; failures need to be investigated, not retried.
  // Allow extra time over the default 30s — the cart seed visits a PDP first.
  test.describe.configure({ retries: 0, timeout: 90000 });

  let currentBranch;
  let baseUrl;

  test.beforeAll(async () => {
    currentBranch = await getCurrentBranch();
    baseUrl = getBaseUrl(currentBranch);
    console.log(`Running tests against branch: ${currentBranch}`);
    console.log(`Base URL: ${baseUrl}`);
  });

  // ─── Empty cart ────────────────────────────────────────────────────────────

  test.describe('Empty cart', () => {
    test('renders the empty state when cart is empty', async ({ page }) => {
      // Do NOT seed the cart
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-empty')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.checkout-form')).not.toBeVisible();
      console.log('✓ Empty state renders when cart is empty');
    });
  });

  // ─── Form rendering ───────────────────────────────────────────────────────

  test.describe('Form rendering', () => {
    test('renders contact section fields @cross-browser', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await expect(field(page, 'email')).toBeVisible();
      await expect(field(page, 'email')).toHaveAttribute('type', 'email');
      console.log('✓ Contact section renders email field');
    });

    test('renders all required shipping address fields', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      const fields = [
        'shipping-firstname',
        'shipping-lastname',
        'shipping-street-0',
        'shipping-street-1',
        'shipping-city',
        'shipping-state',
        'shipping-zip',
        'shipping-telephone',
      ];
      await Promise.all(fields.map((name) => expect(
        field(page, name),
      ).toBeVisible({ timeout: 10000 })));
      console.log('✓ All shipping address fields rendered');
    });

    test('billing defaults to "same as shipping"', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });

      const sameRadio = page.locator('.checkout-form [name="billing-choice"][value="same"]');
      await expect(sameRadio).toBeChecked();
      // Billing fields should NOT be visible when "same" is selected
      await expect(field(page, 'billing-firstname')).not.toBeVisible();
      console.log('✓ Billing defaults to "same as shipping"; fields hidden');
    });

    test('renders payment method radios', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      // At minimum the Chase (credit card) option must be present
      await expect(page.locator('.checkout-form [name="paymentMethod"][value="chase"]')).toBeAttached();
      console.log('✓ Credit-card payment method is present');
    });

    test('renders the submit / continue button', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-submit-btn')).toBeVisible({ timeout: 15000 });
      console.log('✓ Submit button rendered');
    });

    test('order-summary block is auto-injected and shows line items', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.order-summary-wrapper')).toBeVisible({ timeout: 15000 });
      const items = page.locator('.order-summary-items .cart-item');
      await expect(items.first()).toBeVisible({ timeout: 5000 });
      console.log('✓ Order summary block rendered with line items');
    });
  });

  // ─── Billing toggle ───────────────────────────────────────────────────────

  test.describe('Billing address toggle', () => {
    test('shows billing fields when "different" is selected', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });

      await page.locator('.checkout-form [name="billing-choice"][value="different"]').check();

      await expect(field(page, 'billing-firstname')).toBeVisible({ timeout: 3000 });
      await expect(field(page, 'billing-street-0')).toBeVisible();
      await expect(field(page, 'billing-zip')).toBeVisible();
      console.log('✓ Billing fields appear when "different" selected');
    });

    test('hides billing fields again when "same" is re-selected', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });

      await page.locator('.checkout-form [name="billing-choice"][value="different"]').check();
      await expect(field(page, 'billing-firstname')).toBeVisible({ timeout: 3000 });

      await page.locator('.checkout-form [name="billing-choice"][value="same"]').check();
      await expect(field(page, 'billing-firstname')).not.toBeVisible({ timeout: 3000 });
      console.log('✓ Billing fields hide again when "same" re-selected');
    });
  });

  // ─── Shipping rates ───────────────────────────────────────────────────────

  test.describe('Shipping rates', () => {
    test('fetches and displays rates after address state is selected', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });

      // Capture the shipping API request body
      let shippingRequestBody = null;
      const shippingReqPromise = page.waitForRequest(
        (req) => req.url().includes('/estimate/shipping') && req.method() === 'POST',
        { timeout: 15000 },
      );

      await fillShipping(page);

      const shippingReq = await shippingReqPromise;
      shippingRequestBody = shippingReq.postDataJSON();
      expect(shippingRequestBody.country).toBe('us');
      expect(shippingRequestBody.shipping?.state).toBe('CA');
      expect(Array.isArray(shippingRequestBody.items)).toBe(true);
      expect(shippingRequestBody.items.length).toBeGreaterThan(0);

      // Rates render in the DOM
      const rateOptions = page.locator('.checkout-form [name="shippingMethod"]');
      await expect(rateOptions.first()).toBeAttached({ timeout: 5000 });
      await expect(page.locator('.shipping-method-label').first()).toContainText(/standard/i);
      console.log('✓ Shipping rates fetched and rendered after state selection');
    });

    test('auto-selects the first shipping rate', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await fillShipping(page);

      const firstRate = page.locator('.checkout-form [name="shippingMethod"]').first();
      await expect(firstRate).toBeChecked({ timeout: 10000 });
      await expect(firstRate).toHaveValue('standard');
      console.log('✓ First shipping rate is auto-selected');
    });

    test('re-estimates shipping and previews with the new method id after quantity changes', async ({ page }) => {
      const shippingRequests = [];
      const previewRequests = [];
      const idByQty = { 2: '797', 3: '798' };

      await seedCart(page);
      await setupCheckoutMocks(page, {
        shipping: async (route) => {
          const body = route.request().postDataJSON();
          shippingRequests.push(body);
          const qty = body.items?.[0]?.quantity ?? 1;
          const standardId = idByQty[qty] || '796';
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              rates: [
                {
                  id: standardId,
                  label: 'Standard Shipping',
                  type: 'standard',
                  rate: '0.00',
                },
                {
                  id: `priority-${qty}`,
                  label: 'Priority Shipping',
                  type: 'priority',
                  rate: '19.99',
                },
              ],
            }),
          });
        },
        preview: async (route) => {
          const body = route.request().postDataJSON();
          previewRequests.push(body);
          const qty = body.items?.[0]?.quantity ?? 1;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ...MOCK_PREVIEW,
              subtotal: qty * 549.99,
              taxAmount: qty * 48.12,
              shippingMethod: {
                id: body.shippingMethod.id,
                label: 'Standard Shipping',
                type: 'standard',
                rate: '0.00',
              },
              total: qty * 598.11,
            }),
          });
        },
      });
      await gotoCheckout(page, baseUrl);
      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await expandOrderSummary(page);

      // Start from quantity 2, then select a shipping address. Shipping alone
      // must not create a signed preview; selecting a payment method should.
      await page.locator('.order-summary-items .qty-inc').first().click();
      await fillShipping(page);
      await expect(page.locator('.checkout-form [name="shippingMethod"][value="797"]')).toBeChecked({ timeout: 10000 });
      expect(previewRequests).toHaveLength(0);
      await selectCreditCardAndWaitForPreview(page);
      expect(previewRequests.some(
        (body) => body.items?.[0]?.quantity === 2 && body.shippingMethod?.id === '797',
      )).toBe(true);

      // Changing quantity invalidates the provider-specific shipping id. The
      // checkout should re-fetch rates, preserve the Standard service by type,
      // and preview with the new qty-3 id — never the stale qty-2 id.
      await page.locator('.order-summary-items .qty-inc').first().click();
      await expect(page.locator('.checkout-form [name="shippingMethod"][value="798"]')).toBeChecked({ timeout: 10000 });
      await expect.poll(() => previewRequests.some(
        (body) => body.items?.[0]?.quantity === 3 && body.shippingMethod?.id === '798',
      )).toBe(true);
      expect(previewRequests.some(
        (body) => body.items?.[0]?.quantity === 3 && body.shippingMethod?.id === '797',
      )).toBe(false);
      expect(shippingRequests.some((body) => body.items?.[0]?.quantity === 3)).toBe(true);
      console.log('✓ Quantity changes re-estimate shipping and preview with the new method id');
    });

    test('shows an error / empty state when no rates are available', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page, {
        shipping: async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ rates: [] }),
          });
        },
      });
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await fillShipping(page);

      await expect(page.locator('.shipping-methods-empty')).toBeVisible({ timeout: 10000 });
      console.log('✓ Empty shipping methods state shown when no rates returned');
    });
  });

  // ─── Order totals ─────────────────────────────────────────────────────────

  test.describe('Order totals', () => {
    test('order summary shows a non-zero subtotal from cart', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      const subtotalEl = page.locator('.order-summary-subtotal');
      await expect(subtotalEl).toBeVisible({ timeout: 15000 });
      // Cart subtotal depends on the real PDP price; just assert it's a
      // currency-formatted value > 0, not a literal amount.
      await expect(subtotalEl).toContainText(/\$\d+(?:,\d{3})*\.\d{2}/);
      console.log('✓ Order summary subtotal rendered as currency');
    });

    test('total updates after a preview response is received', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await fillShipping(page);

      const total = page.locator('.order-summary-grand-total');
      await expect(page.locator('.order-summary-shipping')).toContainText('5.99', { timeout: 10000 });
      await expect(total).toContainText('555.98', { timeout: 10000 });

      await selectCreditCardAndWaitForPreview(page);

      // MOCK_PREVIEW.total = 604.10 — formatted as $604.10
      await expect(total).toContainText('604.10', { timeout: 10000 });
      console.log('✓ Order summary total reflects mocked preview response');
    });
  });

  // ─── Coupon code ──────────────────────────────────────────────────────────

  test.describe('Coupon code', () => {
    test('applying a valid coupon shows a discount line', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page, {
        estimatePrice: async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              subtotal: 549.99,
              discounts: [{ source: 'coupon', name: 'SAVE10', amount: 54.99 }],
              orderDiscountTotal: 54.99,
            }),
          });
        },
      });
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.order-summary-wrapper')).toBeVisible({ timeout: 15000 });
      await expandOrderSummary(page);
      await expect(page.locator('.discount-input')).toBeVisible({ timeout: 5000 });
      await page.locator('.discount-input').fill('SAVE10');
      await page.locator('.discount-apply').click();

      await expect(page.locator('.order-summary-discounts')).toBeVisible({ timeout: 10000 });
      console.log('✓ Coupon discount row appears after valid coupon applied');
    });

    test('shows error for invalid coupon', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page, {
        estimatePrice: async (route) => {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            headers: { 'x-error': 'coupon_not_found' },
            body: JSON.stringify({ message: 'Coupon not found' }),
          });
        },
      });
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.order-summary-wrapper')).toBeVisible({ timeout: 15000 });
      await expandOrderSummary(page);
      await expect(page.locator('.discount-input')).toBeVisible({ timeout: 5000 });
      await page.locator('.discount-input').fill('NOPE');
      await page.locator('.discount-apply').click();

      await expect(page.locator('.order-summary-coupon-error')).toBeVisible({ timeout: 10000 });
      console.log('✓ Coupon error message shown for invalid coupon');
    });
  });

  // ─── Address validation ───────────────────────────────────────────────────

  test.describe('Address validation', () => {
    const SUGGESTED_COMPONENTS = [
      { longText: '124', shortText: '124', types: ['street_number'] },
      { longText: 'Main Street', shortText: 'Main St', types: ['route'] },
      { longText: 'San Francisco', shortText: 'San Francisco', types: ['locality'] },
      { longText: 'California', shortText: 'CA', types: ['administrative_area_level_1'] },
      { longText: '94103', shortText: '94103', types: ['postal_code'] },
    ];

    const BILLING_SUGGESTED_COMPONENTS = [
      { longText: '501', shortText: '501', types: ['street_number'] },
      { longText: 'Market Street', shortText: 'Market St', types: ['route'] },
      { longText: 'San Francisco', shortText: 'San Francisco', types: ['locality'] },
      { longText: 'California', shortText: 'CA', types: ['administrative_area_level_1'] },
      { longText: '94105', shortText: '94105', types: ['postal_code'] },
    ];

    test('blocks payment when address validation returns FIX', async ({ page }) => {
      await seedCart(page);

      let orderCreateCalled = false;
      await setupCheckoutMocks(page, {
        validateAddress: async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ action: 'FIX' }),
          });
        },
        createOrder: async (route) => {
          orderCreateCalled = true;
          await route.continue();
        },
      });
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await fillContact(page);
      await fillShipping(page);
      await selectCreditCardAndWaitForPreview(page);

      await page.locator('.checkout-submit-btn').click();

      await expect(page.locator('.address-validation-error')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.checkout-form > .checkout-error')).toBeHidden();
      expect(orderCreateCalled).toBe(false);
      expect(page.url()).toContain('/order/checkout');
      console.log('✓ FIX address verdict blocks payment');
    });

    test('blocks payment when different billing address validation returns FIX', async ({ page }) => {
      await seedCart(page);

      let orderCreateCalled = false;
      await setupCheckoutMocks(page, {
        validateAddress: async (route) => {
          const body = route.request().postDataJSON();
          const isBilling = body?.address?.addressLines?.[0] === BILLING_ADDRESS.street;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ action: isBilling ? 'FIX' : 'ACCEPT' }),
          });
        },
        createOrder: async (route) => {
          orderCreateCalled = true;
          await route.continue();
        },
      });
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await fillContact(page);
      await fillShipping(page);
      await selectCreditCardAndWaitForPreview(page);
      await page.locator('.checkout-form [name="billing-choice"][value="different"]').check();
      await fillBilling(page, BILLING_ADDRESS);

      await page.locator('.checkout-submit-btn').click();

      await expect(page.locator('.billing-fields-wrapper .address-validation-error'))
        .toBeVisible({ timeout: 10000 });
      expect(orderCreateCalled).toBe(false);
      expect(page.url()).toContain('/order/checkout');
      console.log('✓ FIX billing address verdict blocks payment');
    });

    test('uses suggested different billing address before continuing to payment', async ({ page }) => {
      await seedCart(page);

      const requestLog = [];
      await setupCheckoutMocks(page, {
        validateAddress: async (route) => {
          const body = route.request().postDataJSON();
          const isBilling = body?.address?.addressLines?.[0] === BILLING_ADDRESS.street;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(isBilling ? {
              action: 'CONFIRM',
              formattedAddress: '501 Market Street, San Francisco, CA 94105, USA',
              addressComponents: BILLING_SUGGESTED_COMPONENTS,
            } : { action: 'ACCEPT' }),
          });
        },
        createOrder: async (route) => {
          if (route.request().method() !== 'POST') { await route.continue(); return; }
          requestLog.push({ url: '/orders', body: route.request().postDataJSON() });
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              order: {
                id: MOCK_ORDER_ID,
                customer: {
                  firstName: VALID_ADDRESS.firstName,
                  lastName: VALID_ADDRESS.lastName,
                  email: TEST_EMAIL,
                },
              },
            }),
          });
        },
      });
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await fillContact(page);
      await fillShipping(page);
      await selectCreditCardAndWaitForPreview(page);
      await page.locator('.checkout-form [name="billing-choice"][value="different"]').check();
      await fillBilling(page, BILLING_ADDRESS);

      await page.locator('.checkout-submit-btn').click();
      const dialog = page.locator('.address-validation-dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await dialog.locator('button', { hasText: 'Use this address' }).click();

      await expect.poll(
        () => page.url(),
        { timeout: 15000, message: 'Page did not navigate to /order/complete' },
      ).toMatch(/\/order\/complete\?orderId=/);

      const orderRequest = requestLog.find((r) => r.url === '/orders');
      expect(orderRequest).toBeDefined();
      expect(orderRequest.body.billing.address1).toBe('501 Market Street');
      expect(orderRequest.body.billing.zip).toBe('94105');
      console.log('✓ Suggested billing address is applied before payment');
    });

    test('billing validation does not trigger order preview recalculation', async ({ page }) => {
      await seedCart(page);

      let previewCount = 0;
      await setupCheckoutMocks(page, {
        validateAddress: async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ action: 'ACCEPT' }),
          });
        },
        preview: async (route) => {
          previewCount += 1;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_PREVIEW),
          });
        },
      });
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await fillContact(page);
      await fillShipping(page);
      await selectCreditCardAndWaitForPreview(page);
      previewCount = 0;

      await page.locator('.checkout-form [name="billing-choice"][value="different"]').check();
      await fillBilling(page, BILLING_ADDRESS);
      await field(page, 'billing-telephone').focus();
      const billingValidate = page.waitForResponse(
        (res) => res.url().includes('/places/validate') && res.request().method() === 'POST',
        { timeout: 15000 },
      );
      await page.keyboard.press('Tab');
      await billingValidate;
      await page.waitForTimeout(500);

      expect(previewCount).toBe(0);
      console.log('✓ Billing validation does not recalculate order preview');
    });

    test('does not allow suggestion dialog dismissal to approve the address', async ({ page }) => {
      await seedCart(page);

      let orderCreateCalled = false;
      await setupCheckoutMocks(page, {
        validateAddress: async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              action: 'CONFIRM',
              formattedAddress: '124 Main Street, San Francisco, CA 94103, USA',
              addressComponents: SUGGESTED_COMPONENTS,
            }),
          });
        },
        createOrder: async (route) => {
          orderCreateCalled = true;
          await route.continue();
        },
      });
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await fillContact(page);
      await fillShipping(page);
      await selectCreditCardAndWaitForPreview(page);

      // Selecting payment moves focus out of the address fields and can open
      // the validation dialog before submit. Exercise that existing dialog.
      const dialog = page.locator('.address-validation-dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await expect(dialog.locator('button', { hasText: 'Use this address' })).toBeVisible();
      await expect(dialog.locator('button', { hasText: 'Edit address' })).toBeVisible();
      await expect(dialog.locator('button', { hasText: 'Keep my address' })).toHaveCount(0);
      await expect(dialog.locator('.address-validation-close')).toHaveCount(0);

      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      expect(orderCreateCalled).toBe(false);

      await dialog.locator('button', { hasText: 'Edit address' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.checkout-form > .checkout-error')).toBeHidden();

      // Editing does not approve the address. A submit attempt must validate
      // again and reopen the confirmation dialog instead of creating an order.
      await page.locator('.checkout-submit-btn').click();
      await expect(dialog).toBeVisible({ timeout: 10000 });
      expect(orderCreateCalled).toBe(false);
      expect(page.url()).toContain('/order/checkout');
      console.log('✓ Suggestion dialog only allows approved address or edit');
    });

    test('uses the suggested address before continuing to payment', async ({ page }) => {
      await seedCart(page);

      const requestLog = [];
      await setupCheckoutMocks(page, {
        validateAddress: async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              action: 'CONFIRM',
              formattedAddress: '124 Main Street, San Francisco, CA 94103, USA',
              addressComponents: SUGGESTED_COMPONENTS,
            }),
          });
        },
        createOrder: async (route) => {
          if (route.request().method() !== 'POST') { await route.continue(); return; }
          requestLog.push({ url: '/orders', body: route.request().postDataJSON() });
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              order: {
                id: MOCK_ORDER_ID,
                customer: {
                  firstName: VALID_ADDRESS.firstName,
                  lastName: VALID_ADDRESS.lastName,
                  email: TEST_EMAIL,
                },
              },
            }),
          });
        },
      });
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await fillContact(page);
      await fillShipping(page);
      await selectCreditCardAndWaitForPreview(page);

      // Payment selection can open validation before submit. Approve that
      // suggestion, then submit the validated address to continue checkout.
      const dialog = page.locator('.address-validation-dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await dialog.locator('button', { hasText: 'Use this address' }).click();
      await expect(dialog).toHaveCount(0);
      await page.locator('.checkout-submit-btn').click();

      await expect.poll(
        () => page.url(),
        { timeout: 15000, message: 'Page did not navigate to /order/complete' },
      ).toMatch(/\/order\/complete\?orderId=/);

      const orderRequest = requestLog.find((r) => r.url === '/orders');
      expect(orderRequest).toBeDefined();
      expect(orderRequest.body.shipping.address1).toBe('124 Main Street');
      expect(orderRequest.body.shipping.zip).toBe('94103');
      console.log('✓ Suggested address is applied before payment');
    });
  });

  // ─── Place order (Chase credit card) ───────────────────────────────────────

  test.describe('Place order - Chase credit card', () => {
    test('happy path: validates, previews, creates order, initiates payment, redirects to /order/complete', async ({ page }) => {
      await seedCart(page);

      const requestLog = [];
      await setupCheckoutMocks(page, {
        preview: async (route) => {
          requestLog.push({ url: '/orders/preview', body: route.request().postDataJSON() });
          await route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PREVIEW),
          });
        },
        createOrder: async (route) => {
          if (route.request().method() !== 'POST') { await route.continue(); return; }
          requestLog.push({ url: '/orders', body: route.request().postDataJSON() });
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              order: {
                id: MOCK_ORDER_ID,
                customer: {
                  firstName: VALID_ADDRESS.firstName,
                  lastName: VALID_ADDRESS.lastName,
                  email: TEST_EMAIL,
                },
              },
            }),
          });
        },
        payment: async (route) => {
          requestLog.push({ url: 'payments', body: route.request().postDataJSON() });
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              orderId: MOCK_ORDER_ID, paymentAttemptId: 'pay-abc-123', status: 'completed',
            }),
          });
        },
      });

      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await fillContact(page);
      await fillShipping(page);

      // Shipping rates land first; explicit payment selection creates the preview.
      await selectCreditCardAndWaitForPreview(page);

      // Submit
      await page.locator('.checkout-submit-btn').click();

      // After payment completes, page redirects to /order/complete?orderId=...
      // `cart.clear()` in `onComplete` triggers a checkout-block reload
      // that races with the `location.href` redirect, so Playwright's
      // navigation tracking sees a detached frame. `expect.poll` on
      // `page.url()` reads the URL string directly and ignores nav events.
      await expect.poll(
        () => page.url(),
        { timeout: 15000, message: 'Page did not navigate to /order/complete' },
      ).toMatch(/\/order\/complete\?orderId=/);
      expect(page.url()).toContain(`orderId=${MOCK_ORDER_ID}`);

      // The order creation request had the correct payload
      const orderRequest = requestLog.find((r) => r.url === '/orders');
      expect(orderRequest).toBeDefined();
      expect(orderRequest.body.customer.email).toBe(TEST_EMAIL);
      expect(orderRequest.body.customer.phone).toBe(VALID_ADDRESS.phone);
      expect(orderRequest.body.shipping.city).toBe(VALID_ADDRESS.city);
      expect(orderRequest.body.shipping.state).toBe(VALID_ADDRESS.state);
      expect(orderRequest.body.estimateToken).toBe(MOCK_PREVIEW.estimateToken);
      expect(orderRequest.body.items).toHaveLength(1);
      console.log('✓ Place order happy path: preview → order → payment → /order/complete');
    });

    test('saves checkout session to sessionStorage after order creation', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await fillContact(page);
      await fillShipping(page);
      await selectCreditCardAndWaitForPreview(page);

      await page.locator('.checkout-submit-btn').click();
      await expect.poll(
        () => page.url(),
        { timeout: 15000, message: 'Page did not navigate to /order/complete' },
      ).toMatch(/\/order\/complete/);

      const session = await page.evaluate(() => ({
        email: sessionStorage.getItem('checkout_email'),
        order: sessionStorage.getItem('checkout_order'),
        preview: sessionStorage.getItem('checkout_preview'),
        cartItems: sessionStorage.getItem('checkout_cart_items'),
      }));
      expect(session.email).toBe(TEST_EMAIL);
      expect(session.order).toContain(MOCK_ORDER_ID);
      expect(session.preview).toContain(MOCK_PREVIEW.estimateToken);
      // cartItems is the serialised cart from the time of order creation;
      // assert it has at least one item entry (sku depends on the real PDP)
      expect(JSON.parse(session.cartItems).length).toBeGreaterThan(0);
      console.log('✓ Checkout session saved to sessionStorage');
    });

    test('clears the cart after successful order completion', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await fillContact(page);
      await fillShipping(page);
      await selectCreditCardAndWaitForPreview(page);

      await page.locator('.checkout-submit-btn').click();
      await expect.poll(
        () => page.url(),
        { timeout: 15000, message: 'Page did not navigate to /order/complete' },
      ).toMatch(/\/order\/complete/);

      const cart = await page.evaluate(() => {
        const raw = localStorage.getItem('cart:us');
        return raw ? JSON.parse(raw) : null;
      });
      expect(cart?.items ?? []).toHaveLength(0);
      console.log('✓ Cart cleared after successful order');
    });

    test('redirects to external payment URL when payment requires redirect', async ({ page }) => {
      const redirectUrl = 'https://payments.example.com/secure-form/xyz';
      await seedCart(page);
      await setupCheckoutMocks(page, {
        payment: async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              orderId: MOCK_ORDER_ID,
              paymentAttemptId: 'pay-redirect-1',
              status: 'redirect',
              action: 'redirect',
              redirectUrl,
            }),
          });
        },
      });
      // Stop the test before the external navigation actually completes
      await page.route(redirectUrl, (route) => route.fulfill({
        status: 200, contentType: 'text/html', body: '<html><body>Payment page mock</body></html>',
      }));

      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await fillContact(page);
      await fillShipping(page);
      await selectCreditCardAndWaitForPreview(page);

      await page.locator('.checkout-submit-btn').click();
      await page.waitForURL(redirectUrl, { timeout: 15000 });
      console.log('✓ Page navigates to external payment URL on redirect action');
    });

    test('does not submit when required fields are empty', async ({ page }) => {
      await seedCart(page);

      let orderCreateCalled = false;
      await setupCheckoutMocks(page, {
        createOrder: async (route) => {
          orderCreateCalled = true;
          await route.continue();
        },
      });
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      // Leave the form empty and click submit
      await page.locator('.checkout-submit-btn').click();
      await page.waitForTimeout(1000);

      // Inline validation errors should appear; order endpoint must not be called
      const hasError = await page.locator('.form-field.has-error, .field-error').first().isVisible();
      expect(hasError).toBe(true);
      expect(orderCreateCalled).toBe(false);
      console.log('✓ Submit with empty form shows validation errors and does not create order');
    });
  });

  // ─── Error handling ───────────────────────────────────────────────────────

  test.describe('Error handling', () => {
    test('shows an error if order creation fails', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page, {
        createOrder: async (route) => {
          if (route.request().method() !== 'POST') { await route.continue(); return; }
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Internal server error' }),
          });
        },
      });

      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await fillContact(page);
      await fillShipping(page);
      await selectCreditCardAndWaitForPreview(page);

      await page.locator('.checkout-submit-btn').click();

      await expect(page.locator('.checkout-error')).toBeVisible({ timeout: 10000 });
      // Should not redirect on failure
      await page.waitForTimeout(1000);
      expect(page.url()).toContain('/order/checkout');
      console.log('✓ Checkout error shown when order creation fails');
    });

    test('shows reCAPTCHA error when api returns x-error: recaptcha', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page, {
        createOrder: async (route) => {
          if (route.request().method() !== 'POST') { await route.continue(); return; }
          await route.fulfill({
            status: 403,
            contentType: 'application/json',
            headers: { 'x-error': 'recaptcha' },
            body: JSON.stringify({ message: 'reCAPTCHA validation failed' }),
          });
        },
      });

      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });
      await fillContact(page);
      await fillShipping(page);
      await selectCreditCardAndWaitForPreview(page);

      await page.locator('.checkout-submit-btn').click();

      // Page should still be on checkout (no redirect) and an error shown
      await expect(page.locator('.checkout-error')).toBeVisible({ timeout: 10000 });
      expect(page.url()).toContain('/order/checkout');
      console.log('✓ reCAPTCHA error path handled');
    });

    test('reloads page when cart is cleared mid-checkout', async ({ page }) => {
      await seedCart(page);
      await setupCheckoutMocks(page);
      await gotoCheckout(page, baseUrl);

      await expect(page.locator('.checkout-form')).toBeVisible({ timeout: 15000 });

      // Clear the actual cart singleton — checkout's `cart:change` listener
      // reads `cart.itemCount` from the imported singleton, so dispatching
      // a fake event with a synthetic cart object would not trigger reload.
      await page.evaluate(() => {
        window.cart.clear();
      });

      // After cart empty event, checkout reloads → empty state should render
      await expect(page.locator('.checkout-empty')).toBeVisible({ timeout: 15000 });
      console.log('✓ Checkout shows empty state after cart cleared mid-checkout');
    });
  });
});
