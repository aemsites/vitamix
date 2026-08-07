import { test, expect } from '@playwright/test';

const FRAUD_MESSAGE = "We're sorry, but an error occurred while processing your payment. To complete your purchase, please contact our Customer Care team at 1-800-VITAMIX.";
const DIAGNOSTIC_MESSAGE = 'Forter reseller reason FRAUD_001';
const FRAUD_QUERY = `reason=fraud_declined&message=${encodeURIComponent(DIAGNOSTIC_MESSAGE)}`;

function assertNoPaymentDeclineCopy(page) {
  return expect(page.locator('body')).not.toContainText('Your payment was declined');
}

test.describe('Forter fraud decline customer messaging', () => {
  test('order cancel page shows Customer Care copy without diagnostics @cross-browser', async ({ page }) => {
    await page.goto(`/us/en_us/order/cancel?${FRAUD_QUERY}`);

    await expect(page.locator('.order-cancel-reason')).toHaveText(FRAUD_MESSAGE);
    await expect(page.getByRole('link', { name: 'Return to checkout' })).toBeVisible();
    await expect(page.locator('.order-cancel-detail')).toHaveCount(0);
    await assertNoPaymentDeclineCopy(page);
    await expect(page.locator('body')).not.toContainText(DIAGNOSTIC_MESSAGE);
  });

  test('order complete page shows the same copy without diagnostics @cross-browser', async ({ page }) => {
    await page.goto(`/us/en_us/order/complete?${FRAUD_QUERY}`);

    await expect(page.locator('.order-result.order-cancelled')).toContainText(FRAUD_MESSAGE);
    await expect(page.getByRole('link', { name: 'Return to checkout' })).toBeVisible();
    await assertNoPaymentDeclineCopy(page);
    await expect(page.locator('body')).not.toContainText(DIAGNOSTIC_MESSAGE);
  });
});
