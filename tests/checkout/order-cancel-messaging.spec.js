/* eslint-disable no-console */
import { test, expect } from '@playwright/test';

// The storefront never receives the raw decline reason. A failed order carries a
// neutral bucket on order.payment.checkoutFailure ('contact_support' | 'retry'),
// which the order-cancel page reads via the authoritative order lookup and maps to
// customer-facing copy. A genuine buyer cancellation arrives as
// reason=customer_cancelled in the URL and needs no lookup.

const CONTACT_SUPPORT_COPY = "We're sorry, but an error occurred while processing your payment. To complete your purchase, please contact our Customer Care team at 1-800-VITAMIX.";
const RETRY_COPY = 'Something went wrong, please try again later.';
const BUYER_CANCELLED_COPY = 'You cancelled the payment.';
const TEST_EMAIL = 'kristen@vitamix.com';
const ORDER_ID = 'order-cancel-msg-123';

async function setupCancelMocks(page, checkoutFailure) {
  await page.addInitScript((email) => {
    window.IS_TEST_MODE = true;
    sessionStorage.setItem('checkout_email', email);
  }, TEST_EMAIL);

  // operations-log beacon → 204.
  await page.route('**/us/en_us/products/operations-log', (route) => route.fulfill({ status: 204, body: '' }));

  // getOrder → authoritative order lookup carrying only the neutral bucket.
  await page.route('**/customers/**/orders/**', async (route) => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        order: {
          id: ORDER_ID,
          state: 'payment_cancelled',
          customer: { email: TEST_EMAIL },
          items: [{ sku: 'glow-mini', quantity: 1, price: { final: 148 } }],
          payment: { provider: 'chase', ...(checkoutFailure ? { checkoutFailure } : {}) },
        },
      }),
    });
  });
}

test.describe('order-cancel customer messaging', () => {
  test('a contact_support failure shows the Customer Care copy without a decline reason @cross-browser', async ({ page }) => {
    await setupCancelMocks(page, 'contact_support');
    await page.goto(`/us/en_us/order/cancel?orderId=${ORDER_ID}`);

    await expect(page.locator('.order-cancel-reason')).toHaveText(CONTACT_SUPPORT_COPY);
    await expect(page.getByRole('link', { name: 'Return to checkout' })).toBeVisible();
    // Nothing tells the buyer why the payment failed: no decline language on the
    // page and no reason in the URL.
    await expect(page.locator('body')).not.toContainText('Your payment was declined');
    await expect(page.locator('body')).not.toContainText('declined');
    expect(page.url()).not.toContain('reason=');
    console.log('✓ contact_support → Customer Care copy, no reason leaked');
  });

  test('a retry failure shows the retry copy @cross-browser', async ({ page }) => {
    await setupCancelMocks(page, 'retry');
    await page.goto(`/us/en_us/order/cancel?orderId=${ORDER_ID}`);

    await expect(page.locator('.order-cancel-reason')).toHaveText(RETRY_COPY);
    await expect(page.locator('body')).not.toContainText('Your payment was declined');
    console.log('✓ retry → retry copy');
  });

  test('a buyer cancellation shows the cancelled copy without an order lookup @cross-browser', async ({ page }) => {
    // reason=customer_cancelled is trusted directly; no getOrder call is needed.
    await setupCancelMocks(page, 'contact_support');
    await page.goto(`/us/en_us/order/cancel?orderId=${ORDER_ID}&reason=customer_cancelled`);

    await expect(page.locator('.order-cancel-reason')).toHaveText(BUYER_CANCELLED_COPY);
    console.log('✓ customer_cancelled → buyer-cancelled copy');
  });
});
