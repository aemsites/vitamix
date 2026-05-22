import {
  createPayPalSession,
  patchPayPalSession,
  getPayPalSession,
} from '../commerce-api.js';
import { getLocaleAndLanguage } from '../scripts.js';

let sdkLoadPromise = null;

const PAY_LATER_LABELS = {
  fr: 'Payer plus tard',
  de: 'Später bezahlen',
  es: 'Pagar después',
  it: 'Paga dopo',
  nl: 'Nu kopen, later betalen',
  pt: 'Pague depois',
  pl: 'Zapłać później',
  zh: '先买后付',
  ja: '後払い',
};

function getPayLaterLabel(language) {
  const lang = (language || 'en').split('_')[0].toLowerCase();
  return PAY_LATER_LABELS[lang] || 'Pay Later';
}

function loadSdk(clientId, currency, locale, intent = 'capture') {
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise((resolve, reject) => {
    if (window.paypal) { resolve(); return; }
    const script = document.createElement('script');
    const [lang, country] = locale.split('_');
    const normalizedLocale = country ? `${lang}_${country.toUpperCase()}` : locale;
    const params = new URLSearchParams({
      'client-id': clientId,
      currency,
      components: 'buttons,messages',
      locale: normalizedLocale,
      intent,
      commit: 'false',
      'enable-funding': 'paylater',
    });
    script.src = `https://www.paypal.com/sdk/js?${params}`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('PayPal SDK failed to load'));
    document.head.appendChild(script);
  });
  return sdkLoadPromise;
}

const PAYPAL_WORDMARK = /* html */`
<span class="pp-wordmark" aria-label="PayPal">
  <b class="pp-pay">Pay</b><b class="pp-pal">Pal</b>
</span>`;

function payLaterWordmark(label) {
  return /* html */`
<span class="pp-wordmark" aria-label="PayPal ${label}">
  <b class="pp-pay">Pay</b><b class="pp-pal">Pal</b>
</span>
<span class="pp-later">${label}</span>`;
}

function createButton(innerHTML, className) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.innerHTML = innerHTML;
  return btn;
}

function showNotConfiguredDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'paypal-not-configured-dialog';
  dialog.innerHTML = /* html */`
    <p>PayPal Express Checkout is not configured yet.</p>
    <button class="button" autofocus>Close</button>
  `;
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);
  dialog.showModal();
}

/** @type {import('./types').PaymentProvider} */
export default {
  id: 'paypal',
  label: 'PayPal',
  supportsExpress: true,
  hidesBilling: true,

  load: async (config) => {
    const clientId = window.CommerceConfig?.paypal?.clientId;
    if (!clientId) return;
    const currency = typeof config.currency === 'function'
      ? config.currency(config.getLocale())
      : (config.currency || 'USD');
    const locale = config.getLanguage().replace('-', '_');
    const intent = (window.CommerceConfig?.paypal?.intent || 'capture').toLowerCase();
    try {
      await loadSdk(clientId, currency, locale, intent);
    } catch { /* fall back to stub buttons */ }
  },

  isAvailable: () => !!window.paypal,

  /**
   * Renders the PayPal Express Checkout button (and Pay Later button if
   * eligible) into the provided container element.
   *
   * 1. Guard: if window.paypal is not loaded, render stub dialog buttons
   * 2. Declare closure state: lastShippingMethods, lastShippingAddress
   * 3. Build buttonConfig with createOrder, onShippingAddressChange,
   *    onShippingOptionsChange, onApprove, onError, onCancel
   * 4. Render primary PayPal button
   * 5. Render Pay Later button only if isEligible()
   *
   * @param {HTMLElement} container
   * @param {object} callbacks
   */
  renderExpressButton(container, callbacks) {
    if (!window.paypal) {
      // No SDK — stub buttons with localized Pay Later label
      const label = getPayLaterLabel(callbacks.getConfig().getLanguage());
      const paypalBtn = createButton(PAYPAL_WORDMARK, 'paypal-express-btn');
      paypalBtn.addEventListener('click', showNotConfiguredDialog);
      container.appendChild(paypalBtn);

      const payLaterWrapper = document.createElement('div');
      payLaterWrapper.className = 'paypal-paylater-wrapper';
      const payLaterStub = createButton(
        payLaterWordmark(label),
        'paypal-express-btn paylater-express-btn',
      );
      payLaterStub.addEventListener('click', showNotConfiguredDialog);
      payLaterWrapper.appendChild(payLaterStub);
      container.appendChild(payLaterWrapper);
      return;
    }

    let lastShippingMethods = [];
    let lastShippingAddress = null;

    const expressConfig = callbacks.getConfig();
    const currency = typeof expressConfig.currency === 'function'
      ? expressConfig.currency(expressConfig.getLocale())
      : (expressConfig.currency || 'USD');

    const buttonConfig = {
      style: {
        layout: 'horizontal',
        color: 'gold',
        shape: 'rect',
        label: 'paypal',
        tagline: false,
        height: 55,
      },

      createOrder: async () => {
        const config = callbacks.getConfig();
        const cart = callbacks.getCart();
        const state = callbacks.getState();
        const { paypalOrderId } = await createPayPalSession(cart.getItemsForAPI(), config);
        state.paypalSessionId = paypalOrderId;
        return paypalOrderId;
      },

      onShippingAddressChange: async (data, actions) => {
        lastShippingAddress = data.shippingAddress;
        const state = callbacks.getState();
        const cart = callbacks.getCart();
        const config = callbacks.getConfig();
        try {
          const result = await patchPayPalSession(state.paypalSessionId, {
            type: 'address',
            country: config.getLocale(),
            locale: getLocaleAndLanguage(false, true).language,
            currency,
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
          lastShippingMethods = result.shippingMethods;
          // Preview with the default (first) method so estimateToken is always set
          // even when the user never changes the shipping option (onShippingOptionsChange
          // only fires on an explicit option change, not on initial address selection).
          const countryCode = data.shippingAddress.countryCode?.toLowerCase();
          const [defaultMethod] = lastShippingMethods;
          const preview = await callbacks.previewOrderDirect({
            items: cart.getItemsForAPI(),
            shippingMethod: { id: String(defaultMethod.id) },
            ...(countryCode ? {
              country: countryCode,
              shipping: {
                country: countryCode,
                state: data.shippingAddress.state,
                zip: data.shippingAddress.postalCode || '',
              },
            } : {}),
          });
          state.currentEstimateToken = preview.estimateToken;
        } catch {
          return actions.reject(data.errors.ADDRESS_ERROR);
        }
        return undefined;
      },

      onShippingOptionsChange: async (data, actions) => {
        const selectedId = data.selectedShippingOption?.id;
        const method = lastShippingMethods.find((m) => m.id === selectedId);
        if (!method) return actions.reject(data.errors.METHOD_UNAVAILABLE);
        const state = callbacks.getState();
        const cart = callbacks.getCart();
        const config = callbacks.getConfig();
        await patchPayPalSession(state.paypalSessionId, {
          type: 'option',
          country: config.getLocale(),
          locale: getLocaleAndLanguage(false, true).language,
          currency,
          selectedOptionId: method.id,
          total: method.total,
          taxAmount: method.taxAmount,
          shippingRate: method.rate,
        });
        const countryCode = lastShippingAddress?.countryCode?.toLowerCase();
        const preview = await callbacks.previewOrderDirect({
          items: cart.getItemsForAPI(),
          shippingMethod: { id: String(method.id) },
          ...(countryCode ? {
            country: countryCode,
            shipping: {
              country: countryCode,
              state: lastShippingAddress.state,
              zip: lastShippingAddress.postalCode || '',
            },
          } : {}),
        });
        state.currentEstimateToken = preview.estimateToken;
        return undefined;
      },

      onApprove: async () => {
        try {
          const state = callbacks.getState();
          const cart = callbacks.getCart();
          const config = callbacks.getConfig();
          const session = await getPayPalSession(
            state.paypalSessionId,
            config.getLocale(),
            getLocaleAndLanguage(false, true).language,
          );
          const orderBody = {
            customer: {
              firstName: session.payer.firstName,
              lastName: session.payer.lastName,
              email: session.payer.email,
              phone: '',
            },
            shipping: { ...session.shippingAddress, email: session.payer.email },
            billing: { ...session.shippingAddress, email: session.payer.email },
            items: cart.getItemsForAPI(),
            shippingMethod: { id: session.selectedOptionId },
            estimateToken: state.currentEstimateToken,
            country: session.shippingAddress.country,
            locale: getLocaleAndLanguage(false, true).language,
          };
          const createdOrder = await callbacks.createOrder(orderBody);
          const fraudToken = (() => {
            try { return sessionStorage.getItem('forter_token') || undefined; } catch { return undefined; }
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
        } catch (err) {
          callbacks.showError(err?.errorHeader?.toLowerCase().includes('recaptcha')
            ? callbacks.strings.errorRecaptcha
            : 'PayPal payment failed. Please try again.');
        }
      },

      onError: () => {
        callbacks.showError('PayPal encountered an error. Please try again.');
      },

      onCancel: () => {
        // User dismissed the PayPal sheet intentionally — no action needed.
      },
    };

    window.paypal.Buttons(buttonConfig).render(container);
  },

  renderCheckoutButton(container, callbacks) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button paypal-redirect-btn';
    btn.textContent = 'Continue with PayPal';
    container.appendChild(btn);

    btn.addEventListener('click', async () => {
      callbacks.clearError();
      btn.disabled = true;

      const state = callbacks.getState();
      if (!state.currentEstimateToken) {
        await callbacks.updatePreview();
        if (!callbacks.getState().currentEstimateToken) {
          callbacks.showError('Unable to calculate totals. Please try again.');
          btn.disabled = false;
          return;
        }
      }

      const formData = callbacks.getFormData();
      const email = formData.get('email') || '';

      let createdOrder;
      try {
        const orderBody = callbacks.buildOrderJSON(formData);
        createdOrder = await callbacks.createOrder(orderBody);
        callbacks.saveCheckoutSession(
          email,
          callbacks.getCart(),
          callbacks.getState().currentPreview,
          createdOrder.order ?? createdOrder,
        );
      } catch (err) {
        callbacks.showError(err?.errorHeader?.toLowerCase().includes('recaptcha')
          ? callbacks.strings.errorRecaptcha
          : (err.body?.message || 'Unable to place order. Please try again.'));
        btn.disabled = false;
        return;
      }

      const idempotencyKey = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      const fraudToken = (() => {
        try { return sessionStorage.getItem('forter_token') || undefined; } catch { return undefined; }
      })();

      try {
        const payment = await callbacks.initiatePayment(
          createdOrder.order?.id ?? createdOrder.id,
          idempotencyKey,
          fraudToken,
          'paypal',
          'paypal',
        );
        if (payment.action === 'redirect' && payment.redirectUrl) {
          window.location.href = payment.redirectUrl;
        } else {
          callbacks.showError('Unexpected payment response. Please try again.');
          btn.disabled = false;
        }
      } catch (err) {
        callbacks.showError(err.body?.message || 'Something went wrong. Please try again.');
        btn.disabled = false;
      }
    });
  },
};
