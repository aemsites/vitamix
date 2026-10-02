import { test, expect } from '@playwright/test';
import { buildProductUrl, getCurrentBranch } from '../utils/test-helpers.js';

async function renderTestPdp(page, branch, useEdgeCheckout = false) {
  await page.addInitScript(() => {
    window.IS_TEST_MODE = true;
  });
  await page.route('**/us/en_us/products/operations-log', (route) => route.fulfill({
    status: 204,
    body: '',
  }));
  await page.route('**/us/en_us/customer/section/load/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      cart: { items: [], summary_count: 0, data_id: 12345 },
      customer: { data_id: 12345 },
      'side-by-side': { cart_id: 'test-cart-id', data_id: 12345 },
    }),
  }));
  await page.goto(buildProductUrl(
    '/us/en_us/products/ascent-x2',
    branch,
    { cart: 'magento' },
  ));
  await page.evaluate(async (edgeCheckout) => {
    window.useEdgeCheckout = edgeCheckout;
    window.jsonLdData = { custom: { entityId: 'test-product-id', options: [] } };
    window.selectedVariant = undefined;
    window.selectedWarranty = undefined;

    const skuMetadata = document.createElement('meta');
    skuMetadata.name = 'sku';
    skuMetadata.content = 'test-sku';
    document.head.append(skuMetadata);

    // eslint-disable-next-line import/no-unresolved, import/no-absolute-path
    const { default: renderAddToCart } = await import('/blocks/pdp/add-to-cart.js');
    const main = document.createElement('main');
    document.body.style.display = 'block';
    document.body.replaceChildren(main);
    const host = document.createElement('div');
    host.classList.add('pdp');
    const product = {
      name: 'Test product',
      offers: [{
        sku: 'test-sku',
        price: '100.00',
        url: 'https://www.vitamix.com/us/en_us/products/test-product',
        custom: { managedStock: '0', addToCart: 'Yes', comingSoon: 'No' },
      }],
      custom: {
        type: 'simple',
        findLocally: 'No',
        findDealer: 'No',
        comingSoon: 'No',
        options: [],
      },
    };
    host.append(renderAddToCart({
      addToCart: 'Add to Cart',
      adding: 'Adding...',
      quantity: 'Quantity',
    }, host, product));
    main.append(host);

    const button = host.querySelector('.quantity-container button');
    window.addEventListener('beforeunload', () => {
      localStorage.setItem('pdp-add-to-cart-disabled-on-unload', String(button.disabled));
    });
  }, useEdgeCheckout);
  return page.locator('.quantity-container button');
}

test.describe('PDP add-to-cart submission guard', () => {
  let currentBranch;

  test.beforeAll(async () => {
    currentBranch = await getCurrentBranch();
  });

  test('keeps Magento add-to-cart disabled while adding and redirecting @desktop', async ({ page }, testInfo) => {
    const addToCartButton = await renderTestPdp(page, currentBranch);
    let addRequestCount = 0;
    let notifyAddRequestStarted;
    const addRequestStarted = new Promise((resolve) => {
      notifyAddRequestStarted = resolve;
    });
    let releaseAddResponse;
    const addResponseGate = new Promise((resolve) => {
      releaseAddResponse = resolve;
    });

    await page.route('**/graphql', async (route) => {
      const requestBody = route.request().postDataJSON();
      if (requestBody.query?.includes('addProductsToCart')) {
        addRequestCount += 1;
        notifyAddRequestStarted();
        await addResponseGate;
        await route.fulfill({
          status: 200,
          json: {
            data: {
              addProductsToCart: {
                cart: {
                  id: 'test-cart-id',
                  items: [{
                    uid: 'test-item-uid',
                    quantity: 1,
                    product: { name: 'Test product', sku: 'test-sku' },
                  }],
                  prices: {
                    subtotal_excluding_tax: { currency: 'USD', value: 100 },
                  },
                  total_quantity: 1,
                },
                user_errors: [],
              },
            },
          },
        });
        return;
      }
      await route.fulfill({ status: 200, json: { data: {} } });
    });
    await page.route('**/us/en_us/checkout/cart/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><head><title>Cart</title></head><body>Cart</body></html>',
    }));
    await addToCartButton.evaluate((button) => {
      window.addToCartClickCount = 0;
      button.addEventListener('click', () => {
        window.addToCartClickCount += 1;
      });
    });

    try {
      await addToCartButton.click();
      await addRequestStarted;
      await expect.soft(addToCartButton).toHaveJSProperty('disabled', true);
      await addToCartButton.evaluate((button) => button.click());
      const clickCount = await page.evaluate(() => window.addToCartClickCount);
      expect(clickCount).toBe(1);
      await page.screenshot({
        path: testInfo.outputPath('add-to-cart-pending.png'),
        fullPage: true,
      });

      releaseAddResponse();
      await page.waitForURL('**/checkout/cart/**');
      const disabledOnUnload = await page.evaluate(
        () => localStorage.getItem('pdp-add-to-cart-disabled-on-unload'),
      );
      expect(disabledOnUnload).toBe('true');
      expect(addRequestCount).toBe(1);
    } finally {
      releaseAddResponse();
    }
  });

  test('re-enables Edge desktop add-to-cart after success @desktop', async ({ page }) => {
    const addToCartButton = await renderTestPdp(page, currentBranch, true);

    await addToCartButton.click();
    await expect(addToCartButton).toHaveText('Add to Cart');
    await expect(addToCartButton).toHaveJSProperty('disabled', false);

    const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('cart:us')));
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].sku).toBe('test-sku');
  });

  test('keeps Edge mobile add-to-cart disabled until the cart redirect @desktop', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const addToCartButton = await renderTestPdp(page, currentBranch, true);
    await page.route('**/us/en_us/order/cart**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><head><title>Cart</title></head><body>Cart</body></html>',
    }));

    await addToCartButton.click();
    await page.waitForURL('**/order/cart**');
    const disabledOnUnload = await page.evaluate(
      () => localStorage.getItem('pdp-add-to-cart-disabled-on-unload'),
    );
    expect(disabledOnUnload).toBe('true');
  });

  test('re-enables Magento add-to-cart after a failed request @desktop', async ({ page }) => {
    const addToCartButton = await renderTestPdp(page, currentBranch);
    let notifyAddRequestStarted;
    const addRequestStarted = new Promise((resolve) => {
      notifyAddRequestStarted = resolve;
    });
    let releaseAddResponse;
    const addResponseGate = new Promise((resolve) => {
      releaseAddResponse = resolve;
    });

    await page.route('**/graphql', async (route) => {
      const requestBody = route.request().postDataJSON();
      if (requestBody.query?.includes('addProductsToCart')) {
        notifyAddRequestStarted();
        await addResponseGate;
        await route.abort();
        return;
      }
      await route.fulfill({ status: 200, json: { data: {} } });
    });

    try {
      await addToCartButton.click();
      await addRequestStarted;
      await expect.soft(addToCartButton).toHaveJSProperty('disabled', true);

      releaseAddResponse();
      await expect(addToCartButton).toHaveJSProperty('disabled', false);
      await expect(addToCartButton).toHaveText('Add to Cart');
      await expect(addToCartButton).not.toHaveAttribute('aria-disabled', 'true');
    } finally {
      releaseAddResponse();
    }
  });
});
