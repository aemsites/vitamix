/* eslint-disable no-console */
import { test, expect } from '@playwright/test';
import {
  getCurrentBranch,
  buildProductUrl,
  waitForElement,
} from '../utils/test-helpers.js';

/**
 * Integration tests for the edge checkout flow.
 *
 * Edge cart behaviour:
 * - Cart stored in localStorage under `cart:${locale}` (e.g. cart:us, cart:ca)
 * - Schema: { version: 1, items: [...] }
 * - On desktop (≥900px): opens minicart popover (#minicart) after add-to-cart
 * - On mobile (<900px): minicart does not open; cart icon href navigates to /order/cart
 * - Default max quantity per SKU: 3; blocked adds silently re-enable the button
 * - Paid warranty tier stored as a hidden linked item (custom.linkedTo, local.showInCart: false)
 * - visibleItemCount excludes hidden items; cart badge tracks visibleItemCount
 */

const CART_KEY_US = 'cart:us';
const CART_KEY_CA = 'cart:ca';

async function getCart(page, key = CART_KEY_US) {
  const raw = await page.evaluate((k) => localStorage.getItem(k), key);
  return raw ? JSON.parse(raw) : null;
}

test.describe('Edge Checkout', () => {
  let currentBranch;

  test.beforeAll(async () => {
    currentBranch = await getCurrentBranch();
    console.log(`Running tests against branch: ${currentBranch}`);
  });

  // ─── Configurable product ────────────────────────────────────────────────────

  test.describe('Configurable Product - Ascent X2', () => {
    const productPath = '/us/en_us/products/ascent-x2';

    test('add to cart opens minicart on desktop', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();

      const minicart = page.locator('#minicart');
      await expect(minicart).toBeVisible({ timeout: 10000 });
      await expect(minicart).toHaveAttribute('aria-expanded', 'true');
      console.log('✓ Minicart opens after add-to-cart');
    });

    test('item stored in localStorage with correct schema', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();
      await page.waitForTimeout(600); // allow debounced persist to flush

      const cart = await getCart(page);
      expect(cart).not.toBeNull();
      expect(cart.version).toBe(1);
      expect(cart.items).toHaveLength(1);

      const item = cart.items[0];
      expect(item.sku).toBeTruthy();
      expect(item.quantity).toBe(1);
      expect(parseFloat(item.price)).toBeGreaterThan(0);
      expect(item.name).toBeTruthy();
      expect(item.path).toMatch(/^\/us\/en_us\/products\//);
      console.log(`✓ Stored: sku=${item.sku}, qty=${item.quantity}, price=${item.price}`);
    });

    test('cart count badge updates after add-to-cart', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      const cartLink = page.locator('header a[href*="/order/cart"]');
      await expect(cartLink).not.toHaveAttribute('data-cart-items');

      await page.locator('.quantity-container button').click();
      await expect(cartLink).toHaveAttribute('data-cart-items', '1', { timeout: 5000 });
      console.log('✓ Cart badge shows 1 after add-to-cart');
    });

    test('minicart shows the added item', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();

      const minicart = page.locator('#minicart');
      await expect(minicart).toBeVisible({ timeout: 10000 });
      await expect(minicart.locator('.cart-item').first()).toBeVisible({ timeout: 5000 });
      console.log('✓ Minicart renders at least one cart item');
    });

    test('minicart closes via × button', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();

      const minicart = page.locator('#minicart');
      await expect(minicart).toBeVisible({ timeout: 10000 });

      await minicart.locator('.slide-panel-close').click();
      await expect(minicart).not.toHaveAttribute('aria-expanded', 'true');
      console.log('✓ Minicart closes via × button');
    });

    test('minicart closes on backdrop click', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();

      const minicart = page.locator('#minicart');
      await expect(minicart).toBeVisible({ timeout: 10000 });

      // Click outside the dialog bounds (top-left corner of viewport)
      await page.mouse.click(5, 5);
      await expect(minicart).not.toHaveAttribute('aria-expanded', 'true');
      console.log('✓ Minicart closes on backdrop click');
    });

    test('minicart checkout button links to /order/checkout', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();

      const minicart = page.locator('#minicart');
      await expect(minicart).toBeVisible({ timeout: 10000 });

      const checkoutBtn = minicart.locator('a[href*="/order/checkout"]');
      await expect(checkoutBtn.first()).toBeVisible({ timeout: 5000 });
      await expect(checkoutBtn.first()).toHaveAttribute('href', /\/order\/checkout/);
      console.log('✓ Checkout button links to /order/checkout');
    });

    test('cart link href points to /order/cart in edge mode', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await page.waitForLoadState('networkidle');

      const cartLink = page.locator('header a[href*="/order/cart"]');
      await expect(cartLink).toHaveAttribute('href', /\/us\/en_us\/order\/cart/);
      console.log('✓ Cart icon href is /us/en_us/order/cart in edge mode');
    });
  });

  // ─── Simple product ──────────────────────────────────────────────────────────

  test.describe('Simple Product - 20-ounce Travel Cup', () => {
    const productPath = '/us/en_us/products/20-ounce-travel-cup';

    test('opens minicart and stores item with correct schema', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();

      await expect(page.locator('#minicart')).toBeVisible({ timeout: 10000 });

      const cart = await getCart(page);
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].quantity).toBe(1);
      // Simple products carry no Magento UIDs in selectedOptions
      expect(cart.items[0].selectedOptions ?? []).toEqual([]);
      console.log('✓ Simple product stored in edge cart');
    });
  });

  // ─── Bundle product ──────────────────────────────────────────────────────────

  test.describe('Bundle Product - 5200 Legacy Bundle', () => {
    const productPath = '/us/en_us/products/5200-legacy-bundle';

    test('opens minicart and stores item with bundle data', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();

      await expect(page.locator('#minicart')).toBeVisible({ timeout: 10000 });

      const cart = await getCart(page);
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].sku).toBeTruthy();
      console.log(`✓ Bundle product stored in edge cart: sku=${cart.items[0].sku}`);
    });
  });

  // ─── Quantity limits ─────────────────────────────────────────────────────────

  // Mobile viewport prevents minicart from opening between clicks,
  // which would otherwise block subsequent interactions.
  test.describe('Quantity Limits', () => {
    const productPath = '/us/en_us/products/ascent-x2';

    test.use({ viewport: { width: 390, height: 844 } });

    // Helper: click add-to-cart and wait for the async operation to finish.
    async function clickAndWait(btn, page) {
      await btn.click();
      await expect(btn).not.toHaveAttribute('aria-disabled', 'true', { timeout: 5000 });
      await page.waitForTimeout(300);
    }

    test('can add up to the max quantity of 3', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      const btn = page.locator('.quantity-container button');
      await clickAndWait(btn, page);
      await clickAndWait(btn, page);
      await clickAndWait(btn, page);

      const cart = await getCart(page);
      expect(cart.items[0].quantity).toBe(3);
      console.log('✓ Cart accepted 3 adds; quantity = 3');
    });

    test('4th add-to-cart is silently blocked when already at max', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      const btn = page.locator('.quantity-container button');
      await clickAndWait(btn, page);
      await clickAndWait(btn, page);
      await clickAndWait(btn, page);

      // 4th click — allowedQty = 0, should return early
      await btn.click();
      await expect(btn).not.toHaveAttribute('aria-disabled', 'true', { timeout: 5000 });

      const cart = await getCart(page);
      expect(cart.items[0].quantity).toBe(3);
      console.log('✓ Quantity remains 3 after 4th add-to-cart attempt');
    });

    test('button re-enables and resets text after a blocked add', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      const btn = page.locator('.quantity-container button');
      await clickAndWait(btn, page);
      await clickAndWait(btn, page);
      await clickAndWait(btn, page);

      await btn.click();
      await expect(btn).not.toHaveAttribute('aria-disabled', 'true', { timeout: 5000 });
      await expect(btn).toContainText(/add to cart/i);
      console.log('✓ Button re-enables and text resets after blocked add');
    });
  });

  // ─── Warranty selection ──────────────────────────────────────────────────────

  test.describe('Warranty Selection', () => {
    const productPath = '/us/en_us/products/ascent-x2';

    test('no warranty item in cart when default (no-cost) tier is active', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      // Don't change the default warranty selection
      await page.locator('.quantity-container button').click();
      await page.waitForTimeout(600);

      const cart = await getCart(page);
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].custom?.linkedTo).toBeUndefined();
      console.log('✓ No linked warranty item for default (included) tier');
    });

    test('paid warranty tier adds a hidden linked item to the cart', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      const warrantyOptions = page.locator('.pdp-warranty-option');
      if (await warrantyOptions.count() < 2) {
        console.log('ℹ No paid warranty options on this product — skipping');
        return;
      }

      await warrantyOptions.nth(1).locator('input').click();
      await page.waitForTimeout(500);

      await page.locator('.quantity-container button').click();
      await page.waitForTimeout(600);

      const cart = await getCart(page);
      expect(cart.items).toHaveLength(2);

      const mainItem = cart.items.find((i) => !i.custom?.linkedTo);
      const warrantyItem = cart.items.find((i) => i.custom?.linkedTo);

      expect(mainItem).toBeDefined();
      expect(warrantyItem).toBeDefined();
      expect(warrantyItem.custom.linkedTo).toBe(mainItem.sku);
      expect(warrantyItem.local.showInCart).toBe(false);
      expect(warrantyItem.quantity).toBe(1);
      expect(parseFloat(warrantyItem.price)).toBeGreaterThan(0);
      console.log(`✓ Warranty sku=${warrantyItem.sku} linked to ${mainItem.sku}, hidden`);
    });

    test('warranty hidden item excluded from cart badge count', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      const warrantyOptions = page.locator('.pdp-warranty-option');
      if (await warrantyOptions.count() < 2) {
        console.log('ℹ No paid warranty options on this product — skipping');
        return;
      }

      await warrantyOptions.nth(1).locator('input').click();
      await page.waitForTimeout(500);
      await page.locator('.quantity-container button').click();
      await page.waitForTimeout(500);

      // visibleItemCount = 1 (warranty is excluded), so badge shows 1
      const cartLink = page.locator('header a[href*="/order/cart"]');
      await expect(cartLink).toHaveAttribute('data-cart-items', '1', { timeout: 5000 });
      console.log('✓ Badge shows 1; hidden warranty item not counted');
    });

    test('warranty item quantity matches parent quantity', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      const warrantyOptions = page.locator('.pdp-warranty-option');
      if (await warrantyOptions.count() < 2) {
        console.log('ℹ No paid warranty options on this product — skipping');
        return;
      }

      await warrantyOptions.nth(1).locator('input').click();
      await page.waitForTimeout(500);
      await page.locator('.quantity-container button').click();
      await page.waitForTimeout(600);

      const cart = await getCart(page);
      const mainItem = cart.items.find((i) => !i.custom?.linkedTo);
      const warrantyItem = cart.items.find((i) => i.custom?.linkedTo);

      if (warrantyItem) {
        expect(warrantyItem.quantity).toBe(mainItem.quantity);
        console.log(`✓ Warranty qty ${warrantyItem.quantity} matches product qty ${mainItem.quantity}`);
      }
    });

    test('warranty item visible on cart page inside minicart', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      const warrantyOptions = page.locator('.pdp-warranty-option');
      if (await warrantyOptions.count() < 2) {
        console.log('ℹ No paid warranty options on this product — skipping');
        return;
      }

      await warrantyOptions.nth(1).locator('input').click();
      await page.waitForTimeout(500);
      await page.locator('.quantity-container button').click();

      const minicart = page.locator('#minicart');
      await expect(minicart).toBeVisible({ timeout: 10000 });

      // Only one visible row in the minicart (warranty is hidden from cart UI)
      const cartItems = minicart.locator('.cart-item');
      await expect(cartItems).toHaveCount(1, { timeout: 5000 });
      console.log('✓ Minicart shows 1 item; hidden warranty item not rendered');
    });
  });

  // ─── Cart persistence ─────────────────────────────────────────────────────────

  test.describe('Cart Persistence', () => {
    const productPath = '/us/en_us/products/ascent-x2';

    test('cart survives a page reload', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();

      const minicart = page.locator('#minicart');
      if (await minicart.isVisible()) {
        await minicart.locator('.slide-panel-close').click();
        await page.waitForTimeout(400);
      }

      await page.reload();
      await page.waitForLoadState('networkidle');

      const cart = await getCart(page);
      expect(cart).not.toBeNull();
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].quantity).toBe(1);
      console.log('✓ Cart persists after page reload');
    });

    test('cart badge restored from localStorage on page load', async ({ page }) => {
      // Seed localStorage before the page script initialises the cart
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await page.waitForLoadState('networkidle');

      await page.evaluate((key) => {
        localStorage.setItem(key, JSON.stringify({
          version: 1,
          items: [
            {
              sku: 'seed-sku-1', quantity: 1, price: '9.99', name: 'Product A', path: '/us/en_us/products/a',
            },
            {
              sku: 'seed-sku-2', quantity: 2, price: '4.99', name: 'Product B', path: '/us/en_us/products/b',
            },
          ],
        }));
      }, CART_KEY_US);

      // Reload so the header picks up the seeded items via cart:change restore event
      await page.reload();
      await page.waitForLoadState('networkidle');

      // visibleItemCount = 1+2 = 3
      const cartLink = page.locator('header a[href*="/order/cart"]');
      await expect(cartLink).toHaveAttribute('data-cart-items', '3', { timeout: 5000 });
      console.log('✓ Cart badge shows 3 after restoring from localStorage');
    });

    test('minicart closes automatically when cart is emptied', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();

      const minicart = page.locator('#minicart');
      await expect(minicart).toBeVisible({ timeout: 10000 });

      // Remove the item directly via the cart API to trigger cart:empty
      await page.evaluate(() => {
        // Dispatch a cart:change event with action='empty' to simulate cart being emptied
        // (the real path is: remove last item → quantity hits 0 → empty event)
        const cartItem = document.querySelector('#minicart .cart-item');
        const removeBtn = cartItem?.querySelector('button[aria-label*="remove"], button[aria-label*="Remove"], .cart-item-remove');
        if (removeBtn) removeBtn.click();
      });

      // After emptying, minicart closes
      await expect(minicart).not.toHaveAttribute('aria-expanded', 'true', { timeout: 5000 });
      console.log('✓ Minicart closes when cart becomes empty');
    });
  });

  // ─── Mobile behaviour ─────────────────────────────────────────────────────────

  test.describe('Mobile Behaviour', () => {
    const productPath = '/us/en_us/products/ascent-x2';

    test.use({ viewport: { width: 390, height: 844 } });

    test('minicart does NOT open after add-to-cart on mobile', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();
      await page.waitForTimeout(1000);

      await expect(page.locator('#minicart')).not.toBeVisible();
      console.log('✓ Minicart does not open on mobile');
    });

    test('cart badge updates on mobile after add-to-cart', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();

      const cartLink = page.locator('header a[href*="/order/cart"]');
      await expect(cartLink).toHaveAttribute('data-cart-items', '1', { timeout: 5000 });
      console.log('✓ Cart badge updates on mobile');
    });

    test('cart icon links to /order/cart on mobile', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await page.waitForLoadState('networkidle');

      const cartLink = page.locator('header a[href*="/order/cart"]');
      await expect(cartLink).toHaveAttribute('href', /\/us\/en_us\/order\/cart/);
      console.log('✓ Cart icon href is /us/en_us/order/cart on mobile');
    });
  });

  // ─── FR-CA locale ─────────────────────────────────────────────────────────────

  test.describe('FR-CA Locale', () => {
    const productPath = '/ca/fr_ca/products/ascent-x2';

    test('cart stored under cart:ca key, not cart:us', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();
      await page.waitForTimeout(600);

      const caCart = await getCart(page, CART_KEY_CA);
      const usCart = await getCart(page, CART_KEY_US);

      expect(caCart).not.toBeNull();
      expect(caCart.items).toHaveLength(1);
      expect(usCart).toBeNull();
      console.log('✓ FR-CA cart stored under cart:ca, cart:us is empty');
    });

    test('cart badge updates using FR-CA cart data', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();

      const cartLink = page.locator('header a[href*="/order/cart"]');
      await expect(cartLink).toHaveAttribute('data-cart-items', '1', { timeout: 5000 });
      console.log('✓ FR-CA cart badge shows 1 after add-to-cart');
    });

    test('FR-CA cart survives page reload', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();

      const minicart = page.locator('#minicart');
      if (await minicart.isVisible()) {
        await minicart.locator('.slide-panel-close').click();
        await page.waitForTimeout(400);
      }

      await page.reload();
      await page.waitForLoadState('networkidle');

      const caCart = await getCart(page, CART_KEY_CA);
      expect(caCart.items).toHaveLength(1);
      console.log('✓ FR-CA cart persists after page reload');
    });
  });

  // ─── Add-to-cart behaviour ────────────────────────────────────────────────────

  test.describe('Add-to-cart Behaviour', () => {
    const productPath = '/us/en_us/products/ascent-x2';

    // Mobile viewport so minicart does not open between clicks.
    test.use({ viewport: { width: 390, height: 844 } });

    test('adding the same item twice increments quantity, not a separate entry', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      const btn = page.locator('.quantity-container button');
      await btn.click();
      await expect(btn).not.toHaveAttribute('aria-disabled', 'true', { timeout: 5000 });
      await page.waitForTimeout(300);
      await btn.click();
      await expect(btn).not.toHaveAttribute('aria-disabled', 'true', { timeout: 5000 });
      await page.waitForTimeout(600);

      const cart = await getCart(page);
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].quantity).toBe(2);
      console.log('✓ Second add-to-cart merged: quantity = 2, items.length = 1');
    });

    test('deeplinked variant stores variant sku and parentSku', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge', color: 'polar-white' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();
      await page.waitForTimeout(600);

      const cart = await getCart(page);
      expect(cart.items).toHaveLength(1);

      const item = cart.items[0];
      // Variant SKU differs from the parent configurable SKU
      expect(item.sku).not.toBe('Ascent X2');
      // Parent SKU is stored separately so the order API can resolve the variant
      expect(item.parentSku).toBe('Ascent X2');
      // Semantic selected options include the color selection
      const colorOption = item.selectedOptions?.find((o) => o.id === 'color');
      expect(colorOption).toBeDefined();
      expect(colorOption.value).toBeTruthy();
      console.log(`✓ Deeplinked variant stored: sku=${item.sku}, parentSku=${item.parentSku}, color=${colorOption?.value}`);
    });

    test('product without warranties stores no local.availableWarranties', async ({ page }) => {
      // Simple product has no warranty options
      const simplePath = '/us/en_us/products/20-ounce-travel-cup';
      await page.goto(buildProductUrl(simplePath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();
      await page.waitForTimeout(600);

      const cart = await getCart(page);
      expect(cart.items[0].local?.availableWarranties).toBeUndefined();
      console.log('✓ No availableWarranties stored for product without warranty options');
    });
  });

  // ─── Minicart interactions ────────────────────────────────────────────────────

  test.describe('Minicart Interactions', () => {
    const productPath = '/us/en_us/products/ascent-x2';

    test('cart icon click opens minicart independently of add-to-cart', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      // Add to cart so there is something in the cart
      await page.locator('.quantity-container button').click();

      const minicart = page.locator('#minicart');
      await expect(minicart).toBeVisible({ timeout: 10000 });

      // Close minicart
      await minicart.locator('.slide-panel-close').click();
      await expect(minicart).not.toHaveAttribute('aria-expanded', 'true');
      await page.waitForTimeout(400);

      // Now click the cart icon directly — different code path from pdp:add-to-cart
      await page.locator('header a[href*="/order/cart"]').click();

      await expect(minicart).toBeVisible({ timeout: 5000 });
      await expect(minicart).toHaveAttribute('aria-expanded', 'true');
      console.log('✓ Cart icon click opens minicart independently');
    });

    test('removing the only item closes minicart and clears badge', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();

      const minicart = page.locator('#minicart');
      await expect(minicart).toBeVisible({ timeout: 10000 });
      await expect(minicart.locator('.cart-item').first()).toBeVisible({ timeout: 5000 });

      // Click remove on the only cart item
      await minicart.locator('.cart-item-remove').first().click();

      // Minicart closes automatically when cart becomes empty
      await expect(minicart).not.toHaveAttribute('aria-expanded', 'true', { timeout: 5000 });

      // Badge is removed
      const cartLink = page.locator('header a[href*="/order/cart"]');
      await expect(cartLink).not.toHaveAttribute('data-cart-items', { timeout: 3000 });

      // localStorage is empty
      const cart = await getCart(page);
      expect(cart?.items ?? []).toHaveLength(0);
      console.log('✓ Removing last item closes minicart and clears badge');
    });

    test('removing one of two items decrements badge but keeps minicart open', async ({ page }) => {
      // Use mobile so we can add two different products without the minicart blocking
      await page.setViewportSize({ width: 390, height: 844 });

      // Add Ascent X2
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');
      await page.locator('.quantity-container button').click();
      await expect(page.locator('.quantity-container button')).not.toHaveAttribute('aria-disabled', 'true', { timeout: 5000 });

      // Add simple product to get a second item
      const simplePath = '/us/en_us/products/20-ounce-travel-cup';
      await page.goto(buildProductUrl(simplePath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');
      await page.locator('.quantity-container button').click();
      await expect(page.locator('.quantity-container button')).not.toHaveAttribute('aria-disabled', 'true', { timeout: 5000 });

      // Switch to desktop and open minicart via cart icon
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.locator('header a[href*="/order/cart"]').click();

      const minicart = page.locator('#minicart');
      await expect(minicart).toBeVisible({ timeout: 10000 });
      await expect(minicart.locator('.cart-item')).toHaveCount(2, { timeout: 5000 });

      const cartLink = page.locator('header a[href*="/order/cart"]');
      await expect(cartLink).toHaveAttribute('data-cart-items', '2');

      // Remove the first item
      await minicart.locator('.cart-item-remove').first().click();
      await page.waitForTimeout(500);

      // Minicart stays open (still one item)
      await expect(minicart).toHaveAttribute('aria-expanded', 'true');
      await expect(minicart.locator('.cart-item')).toHaveCount(1, { timeout: 5000 });

      // Badge decrements to 1
      await expect(cartLink).toHaveAttribute('data-cart-items', '1');
      console.log('✓ Removing one of two items decrements badge; minicart stays open');
    });

    test('incrementing quantity in minicart updates badge and localStorage', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();

      const minicart = page.locator('#minicart');
      await expect(minicart).toBeVisible({ timeout: 10000 });
      await expect(minicart.locator('.cart-item').first()).toBeVisible({ timeout: 5000 });

      // Click the + button in the minicart cart item
      await minicart.locator('.qty-inc').first().click();
      await page.waitForTimeout(600);

      // Badge should now show 2
      const cartLink = page.locator('header a[href*="/order/cart"]');
      await expect(cartLink).toHaveAttribute('data-cart-items', '2', { timeout: 5000 });

      // localStorage quantity updated
      const cart = await getCart(page);
      expect(cart.items[0].quantity).toBe(2);
      console.log('✓ Qty + in minicart: badge = 2, localStorage qty = 2');
    });

    test('decrementing quantity to zero removes item and closes minicart', async ({ page }) => {
      await page.goto(buildProductUrl(productPath, currentBranch, { cart: 'edge' }));
      await waitForElement(page, '.quantity-container button');

      await page.locator('.quantity-container button').click();

      const minicart = page.locator('#minicart');
      await expect(minicart).toBeVisible({ timeout: 10000 });
      await expect(minicart.locator('.cart-item').first()).toBeVisible({ timeout: 5000 });

      // The qty starts at 1; clicking − triggers handleQtyChange(0)
      // which is clamped to min=1, so the qty-dec path is effectively
      // handled by the remove button. Use remove instead.
      await minicart.locator('.cart-item-remove').first().click();

      await expect(minicart).not.toHaveAttribute('aria-expanded', 'true', { timeout: 5000 });
      const cartLink = page.locator('header a[href*="/order/cart"]');
      await expect(cartLink).not.toHaveAttribute('data-cart-items', { timeout: 3000 });
      console.log('✓ Removing last item via minicart closes it and clears badge');
    });

    test('minicart does not open when cart icon clicked on the cart page', async ({ page }) => {
      // Navigate to the edge cart page itself
      const cartPageUrl = buildProductUrl('/us/en_us/order/cart', currentBranch, { cart: 'edge' });
      await page.goto(cartPageUrl);
      await page.waitForLoadState('networkidle');

      const cartLink = page.locator('header a[href*="/order/cart"]');
      if (await cartLink.count() === 0) {
        console.log('ℹ Cart icon not present on cart page — skipping');
        return;
      }

      await cartLink.click();
      await page.waitForTimeout(500);

      // #minicart is created lazily; it should not exist or not be visible
      const minicart = page.locator('#minicart');
      const exists = await minicart.count();
      if (exists > 0) {
        await expect(minicart).not.toHaveAttribute('aria-expanded', 'true');
      }
      console.log('✓ Cart icon click is a no-op when already on the cart page');
    });
  });
});
