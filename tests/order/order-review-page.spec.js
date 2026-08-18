/* eslint-disable no-console */
import { test, expect } from '@playwright/test';
import {
  getCurrentBranch,
  getBaseUrl,
} from '../utils/test-helpers.js';

/**
 * Integration tests for the display-only order-review page at
 * /us/en_us/order/review.
 *
 * The order arrives in state `payment_requires_confirmation` after PayPal
 * authorization. This page renders the order for a final look — with NO edit
 * affordances — and offers "Complete order" (→ confirm endpoint) and
 * "Cancel and return to cart" (→ cancel endpoint).
 *
 * Setup pattern for each test:
 *   1. addInitScript: enable test mode and seed `checkout_email` so the block
 *      resolves the order via the authoritative API lookup.
 *   2. Mock getOrder + payments/confirm + payments/cancel; stub the navigation
 *      targets (order/complete, order/cart) and the operations-log beacon.
 *   3. Navigate to /us/en_us/order/review?orderId=...
 *
 * Full express/redirect flow coverage (SDK routing, abandonment cancel,
 * three-way initiate outcomes) is exercised in the PayPal wiring tests.
 */

const TEST_EMAIL = 'kristen@vitamix.com';
const MOCK_ORDER_ID = 'mock-review-order-123';

// Subtotal from items = 148 + 219 + (62 * 2) = 491.
// Total = 491 - 25 (WELCOME) + 12 (Express) + 33.78 (tax) = 511.78.
const MOCK_ORDER = {
  id: MOCK_ORDER_ID,
  customer: { email: TEST_EMAIL, firstName: 'Kristen', lastName: 'Fregerus' },
  shipping: {
    name: 'Kristen Fregerus',
    address1: '58 W 51st St',
    city: 'New York',
    state: 'NY',
    zip: '10020-1506',
    country: 'us',
  },
  estimates: {
    shippingMethod: {
      id: 'express', label: 'Express', rate: 12, eta: 'Apr 20 – Apr 21',
    },
    discounts: [{ name: 'WELCOME', amount: 25 }],
    tax: { amount: 33.78 },
  },
  items: [
    {
      sku: 'glow-mini',
      name: 'Glow Mini',
      quantity: 1,
      price: { final: 148 },
      selectedOptions: [{ value: 'Sandstone' }, { value: 'Warm light' }],
    },
    {
      sku: 'pebble-earbuds', name: 'Pebble Earbuds', quantity: 1, price: { final: 219 }, variant: 'Cocoa · Gen 2',
    },
    {
      sku: 'loop-charger', name: 'Loop Charger', quantity: 2, price: { final: 62 }, variant: 'Ivory · USB-C',
    },
  ],
};

async function setupReviewMocks(page, overrides = {}) {
  await page.addInitScript((email) => {
    window.IS_TEST_MODE = true;
    localStorage.setItem('vitamix.priceRules.stub', JSON.stringify({ promotions: [] }));
    sessionStorage.setItem('checkout_email', email);
  }, TEST_EMAIL);

  // operations-log beacon → 204 (protects older branch-preview code too).
  await page.route('**/us/en_us/products/operations-log', (route) => route.fulfill({ status: 204, body: '' }));

  // getOrder → authoritative order lookup.
  await page.route('**/customers/**/orders/**', overrides.getOrder || (async (route) => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ order: MOCK_ORDER }),
    });
  }));

  // Confirm (capture) → completed by default.
  await page.route('**/orders/*/payments/confirm', overrides.confirm || (async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'completed', transactionId: 'txn-1', amount: 511.78, currency: 'USD',
      }),
    });
  }));

  // Cancel → cancelled.
  await page.route('**/orders/*/payments/cancel', overrides.cancel || (async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'cancelled' }),
    });
  }));

  // Stub the navigation targets — content is not part of these tests.
  await page.route('**/us/en_us/order/complete*', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><html><body><h1>Order complete (stub)</h1></body></html>',
  }));
  await page.route('**/us/en_us/order/cart*', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><html><body><h1>Cart (stub)</h1></body></html>',
  }));
  await page.route('**/us/en_us/order/cancel*', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><html><body><h1>Order cancelled (stub)</h1></body></html>',
  }));
}

async function gotoReview(page, baseUrl, orderId = MOCK_ORDER_ID) {
  await page.goto(`${baseUrl}/us/en_us/order/review?orderId=${orderId}&martech=off`);
}

test.describe('Order review page (display-only)', () => {
  test.describe.configure({ retries: 0, timeout: 90000 });

  let baseUrl;

  test.beforeAll(async () => {
    const branch = await getCurrentBranch();
    baseUrl = getBaseUrl(branch);
    console.log(`Base URL: ${baseUrl}`);
  });

  test('redirects to the store root when orderId is missing', async ({ page }) => {
    await setupReviewMocks(page);
    await page.goto(`${baseUrl}/us/en_us/order/review?martech=off`);
    await expect.poll(() => page.url(), { timeout: 15000 })
      .toMatch(/\/us\/en_us\/?($|\?)/);
    expect(page.url()).not.toContain('/order/review');
    console.log('✓ Missing orderId redirects to store root');
  });

  test.describe('Rendering', () => {
    test('renders the reassurance banner, heading and secured cue', async ({ page }) => {
      await setupReviewMocks(page);
      await gotoReview(page, baseUrl);

      await expect(page.locator('.order-review-page')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.order-review-banner')).toBeVisible();
      await expect(page.locator('.order-review-banner')).toContainText(/nothing has been charged/i);
      await expect(page.locator('.order-review-title')).toHaveText(/review your order/i);
      await expect(page.locator('.order-review-secured')).toContainText(/secured by paypal/i);
      console.log('✓ Banner, heading, secured cue rendered');
    });

    test('renders static line items with no edit-cart affordance', async ({ page }) => {
      await setupReviewMocks(page);
      await gotoReview(page, baseUrl);

      await expect(page.locator('.order-review-page')).toBeVisible({ timeout: 15000 });
      const items = page.locator('.order-review-item:not(.order-review-item-head)');
      await expect(items).toHaveCount(3);
      await expect(items.nth(0)).toContainText('Glow Mini');
      await expect(items.nth(0)).toContainText('$148.00');
      await expect(items.nth(2)).toContainText('Loop Charger');
      // qty 2 × $62 = $124 subtotal
      await expect(items.nth(2)).toContainText('$124.00');
      // No "Edit cart" affordance anywhere in the block.
      await expect(page.locator('.order-review-page').getByText(/edit cart/i)).toHaveCount(0);
      console.log('✓ Static line items rendered, no edit-cart affordance');
    });

    test('shows the chosen shipping method as static text (no selector)', async ({ page }) => {
      await setupReviewMocks(page);
      await gotoReview(page, baseUrl);

      await expect(page.locator('.order-review-shipping-method')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.order-review-method-label')).toHaveText('Express');
      await expect(page.locator('.order-review-method-price')).toHaveText('$12.00');
      await expect(page.locator('.order-review-method-eta')).toContainText('Apr 20');
      // Display-only: there must be no shipping-method radios or any radios.
      await expect(page.locator('.order-review-page input[type="radio"]')).toHaveCount(0);
      console.log('✓ Chosen shipping method shown statically, no radios');
    });

    test('shows static address + payment with no Edit/Change controls', async ({ page }) => {
      await setupReviewMocks(page);
      await gotoReview(page, baseUrl);

      await expect(page.locator('.order-review-address')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.order-review-address')).toContainText('58 W 51st St');
      await expect(page.locator('.order-review-verified')).toContainText(/verified by paypal/i);
      await expect(page.locator('.order-review-payment')).toContainText(/paypal express/i);
      await expect(page.locator('.order-review-payment')).toContainText(TEST_EMAIL);
      await expect(page.locator('.order-review-authorized')).toContainText(/not yet charged/i);
      // No edit/change affordances.
      await expect(page.locator('.order-review-page').getByRole('button', { name: /edit|change/i })).toHaveCount(0);
      await expect(page.locator('.order-review-page').getByText(/^edit$|^change$/i)).toHaveCount(0);
      console.log('✓ Static address + payment, no Edit/Change controls');
    });

    test('renders the order-total summary and Complete button with the grand total', async ({ page }) => {
      await setupReviewMocks(page);
      await gotoReview(page, baseUrl);

      await expect(page.locator('.order-review-summary')).toBeVisible({ timeout: 15000 });
      const totals = page.locator('.order-review-totals');
      await expect(totals).toContainText('$491.00'); // subtotal
      await expect(totals).toContainText('-$25.00'); // promo
      await expect(totals).toContainText('$12.00'); // shipping
      await expect(totals).toContainText('$33.78'); // tax
      await expect(page.locator('.order-review-grand-value')).toHaveText('$511.78');
      // The button reads just "Complete order" (the total lives in the summary).
      await expect(page.locator('.order-review-complete')).toContainText(/complete order/i);
      await expect(page.locator('.order-review-terms a')).toHaveAttribute('href', /legal-notice$/);
      await expect(page.locator('.order-review-cancel')).toBeVisible();
      console.log('✓ Totals summary + Complete button render with grand total');
    });
  });

  test.describe('Actions', () => {
    test('Complete order → confirm endpoint (with idempotencyKey) → order-complete', async ({ page }) => {
      let confirmBody = null;
      await setupReviewMocks(page, {
        confirm: async (route) => {
          confirmBody = route.request().postDataJSON();
          await route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'completed' }),
          });
        },
      });
      await gotoReview(page, baseUrl);

      await expect(page.locator('.order-review-complete')).toBeVisible({ timeout: 15000 });
      const confirmReq = page.waitForRequest(
        (req) => /\/orders\/[^/]+\/payments\/confirm$/.test(req.url()) && req.method() === 'POST',
        { timeout: 15000 },
      );
      await page.locator('.order-review-complete').click();
      await confirmReq;

      await expect.poll(() => page.url(), { timeout: 15000 })
        .toMatch(/\/order\/complete\?orderId=/);
      expect(page.url()).toContain(`orderId=${MOCK_ORDER_ID}`);
      expect(confirmBody).toHaveProperty('idempotencyKey');
      expect(typeof confirmBody.idempotencyKey).toBe('string');
      expect(confirmBody.idempotencyKey.length).toBeGreaterThan(0);
      console.log('✓ Complete → confirm (idempotencyKey) → /order/complete');
    });

    test('a failed confirm keeps the buyer on the review page and shows an error', async ({ page }) => {
      await setupReviewMocks(page, {
        confirm: async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ status: 'failed', checkoutFailure: 'retry' }),
          });
        },
      });
      await gotoReview(page, baseUrl);

      await expect(page.locator('.order-review-complete')).toBeVisible({ timeout: 15000 });
      await page.locator('.order-review-complete').click();

      await expect(page.locator('.order-review-error')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.order-review-error')).toContainText(/could not complete your order/i);
      await page.waitForTimeout(500);
      expect(page.url()).toContain('/order/review');
      console.log('✓ Soft decline (failed, not cancelled) stays on review with an error');
    });

    test('a failed confirm flagged cancelled routes to the cart (terminal)', async ({ page }) => {
      await setupReviewMocks(page, {
        confirm: async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ status: 'failed', checkoutFailure: 'retry', cancelled: true }),
          });
        },
      });
      await gotoReview(page, baseUrl);

      await expect(page.locator('.order-review-complete')).toBeVisible({ timeout: 15000 });
      await page.locator('.order-review-complete').click();

      await expect(page.locator('.order-review-error')).toContainText(/expired or been cancelled/i, { timeout: 10000 });
      await expect.poll(() => page.url(), { timeout: 15000 }).toMatch(/\/order\/cart/);
      console.log('✓ Failed + cancelled:true → clear message → cart');
    });

    test('a contact_support confirm routes to the order-cancelled page (Customer Care copy)', async ({ page }) => {
      await setupReviewMocks(page, {
        confirm: async (route) => {
          // A terminal failure: the confirm endpoint returns 200 with
          // checkoutFailure=contact_support and cancelled:true (order moved to
          // payment_cancelled server-side).
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ status: 'failed', checkoutFailure: 'contact_support', cancelled: true }),
          });
        },
      });
      await gotoReview(page, baseUrl);

      await expect(page.locator('.order-review-complete')).toBeVisible({ timeout: 15000 });
      await page.locator('.order-review-complete').click();

      // Routed to the order-cancelled page (orderId only; it reads the neutral
      // checkoutFailure bucket off the order) rather than bounced to the cart.
      await expect.poll(() => page.url(), { timeout: 15000 })
        .toMatch(/\/order\/cancel\?.*orderId=/);
      console.log('✓ contact_support → /order/cancel (orderId only)');
    });

    test('a cancelled/expired order shows a clear message and returns to the cart', async ({ page }) => {
      await setupReviewMocks(page, {
        confirm: async (route) => {
          await route.fulfill({
            status: 422,
            contentType: 'application/json',
            body: JSON.stringify({
              code: 'ADOBE_COMMERCE_UNPROCESSABLE',
              message: "item not available in country ''",
              details: { rule: 'order_not_confirmable', state: 'payment_cancelled' },
              retryable: false,
            }),
          });
        },
      });
      await gotoReview(page, baseUrl);

      await expect(page.locator('.order-review-complete')).toBeVisible({ timeout: 15000 });
      await page.locator('.order-review-complete').click();

      // Clear, non-generic message (not the misleading API "item not available").
      await expect(page.locator('.order-review-error')).toContainText(/expired or been cancelled/i, { timeout: 10000 });
      // Then routed back to the cart to start over.
      await expect.poll(() => page.url(), { timeout: 15000 }).toMatch(/\/order\/cart/);
      console.log('✓ Cancelled/expired order → clear message → cart');
    });

    test('Cancel and return to cart → cancel endpoint (with idempotencyKey) → cart', async ({ page }) => {
      let cancelBody = null;
      await setupReviewMocks(page, {
        cancel: async (route) => {
          cancelBody = route.request().postDataJSON();
          await route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'cancelled' }),
          });
        },
      });
      await gotoReview(page, baseUrl);

      await expect(page.locator('.order-review-cancel')).toBeVisible({ timeout: 15000 });
      const cancelReq = page.waitForRequest(
        (req) => /\/orders\/[^/]+\/payments\/cancel$/.test(req.url()) && req.method() === 'POST',
        { timeout: 15000 },
      );
      await page.locator('.order-review-cancel').click();
      await cancelReq;

      await expect.poll(() => page.url(), { timeout: 15000 }).toMatch(/\/order\/cart/);
      expect(cancelBody).toHaveProperty('idempotencyKey');
      expect(typeof cancelBody.idempotencyKey).toBe('string');
      console.log('✓ Cancel → cancel endpoint (idempotencyKey) → /order/cart');
    });
  });

  test.describe('Order resolution', () => {
    test('redirects on a 403 (order not ours) rather than rendering', async ({ page }) => {
      await setupReviewMocks(page, {
        getOrder: async (route) => {
          if (route.request().method() !== 'GET') { await route.continue(); return; }
          await route.fulfill({
            status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Forbidden' }),
          });
        },
      });
      await gotoReview(page, baseUrl);

      await expect.poll(() => page.url(), { timeout: 15000 })
        .toMatch(/\/us\/en_us\/?($|\?)/);
      expect(page.url()).not.toContain('/order/review');
      console.log('✓ 403 lookup redirects instead of rendering a forged order');
    });
  });
});
