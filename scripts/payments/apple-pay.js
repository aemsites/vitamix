import { validateApplePayMerchant, estimateExpressCheckout } from '../commerce-api.js';

const APPLE_PAY_SDK_URL = 'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js';

async function loadSdk() {
  if (document.querySelector(`script[src="${APPLE_PAY_SDK_URL}"]`)) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = APPLE_PAY_SDK_URL;
    script.crossOrigin = 'anonymous';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function createApplePayButton(locale) {
  const btn = document.createElement('apple-pay-button');
  btn.setAttribute('buttonstyle', 'black');
  btn.setAttribute('type', 'buy');
  btn.setAttribute('locale', locale || 'en-US');
  return btn;
}

function startExpressSession(btn, config, callbacks) {
  btn.addEventListener('click', async () => {
    const cart = callbacks.getCart();
    const locale = config.getLocale();
    const language = config.getLanguage();
    const bcp47 = `${language.split('_')[0]}-${(language.split('_')[1] || locale).toUpperCase()}`;

    let lastShippingContact = null;
    let lastShippingMethodId = null;

    const request = {
      countryCode: locale.toUpperCase(),
      currencyCode: typeof config.currency === 'function' ? config.currency(locale) : config.currency,
      supportedNetworks: ['visa', 'masterCard', 'amex', 'discover'],
      merchantCapabilities: ['supports3DS'],
      requiredShippingContactFields: ['name', 'email', 'phone', 'postalAddress'],
      total: { label: config.site || 'Store', amount: cart.subtotal.toFixed(2) },
    };

    const session = new window.ApplePaySession(3, request);

    session.onvalidatemerchant = async (e) => {
      try {
        const { merchantSession } = await validateApplePayMerchant(e.validationURL, locale, bcp47);
        session.completeMerchantValidation(merchantSession);
      } catch {
        session.abort();
      }
    };

    session.onshippingcontactselected = async (e) => {
      lastShippingContact = e.shippingContact;
      const contact = e.shippingContact;
      try {
        const result = await estimateExpressCheckout(
          contact.countryCode,
          contact.administrativeArea,
          contact.postalCode,
          cart.getItemsForAPI(),
        );
        const methods = result.shippingMethods || [];
        if (!methods.length) {
          session.completeShippingContactSelection({
            errors: [new window.ApplePayError('addressUnserviceable')],
            newTotal: { label: config.site || 'Store', amount: '0.00' },
            newShippingMethods: [],
            newLineItems: [],
          });
          return;
        }
        const defaultMethod = methods[0];
        session.completeShippingContactSelection({
          newShippingMethods: methods.map((m) => ({
            identifier: m.id,
            label: m.label,
            detail: m.eta || '',
            amount: String(m.rate),
          })),
          newTotal: { label: config.site || 'Store', amount: String(defaultMethod.total) },
          newLineItems: [
            { label: 'Subtotal', amount: String(result.subtotal) },
            { label: 'Tax', amount: String(defaultMethod.taxAmount) },
            { label: 'Shipping', amount: String(defaultMethod.rate) },
          ],
        });
      } catch {
        session.completeShippingContactSelection({
          errors: [new window.ApplePayError('addressUnserviceable')],
          newTotal: { label: config.site || 'Store', amount: '0.00' },
          newShippingMethods: [],
          newLineItems: [],
        });
      }
    };

    session.onshippingmethodselected = async (e) => {
      try {
        const contact = lastShippingContact;
        const countryCode = contact?.countryCode?.toLowerCase();
        const previewResult = await callbacks.previewOrderDirect({
          items: cart.getItemsForAPI(),
          shippingMethod: { id: e.shippingMethod.identifier },
          ...(countryCode ? {
            country: countryCode,
            shipping: {
              country: countryCode,
              state: contact.administrativeArea,
              zip: contact.postalCode || '',
            },
          } : {}),
        });
        lastShippingMethodId = e.shippingMethod.identifier;
        callbacks.getState().currentEstimateToken = previewResult.estimateToken;
        session.completeShippingMethodSelection({
          newTotal: { label: config.site || 'Store', amount: String(previewResult.total) },
          newLineItems: [
            { label: 'Subtotal', amount: String(previewResult.subtotal) },
            { label: 'Tax', amount: String(previewResult.taxAmount) },
            { label: 'Shipping', amount: String(previewResult.shippingMethod?.rate ?? 0) },
          ],
        });
      } catch {
        session.abort();
      }
    };

    session.onpaymentauthorized = async (e) => {
      const { payment } = e;
      const contact = payment.shippingContact;
      try {
        const shippingAddr = {
          name: `${contact.givenName} ${contact.familyName}`.trim(),
          address1: (contact.addressLines || [])[0] || '',
          address2: (contact.addressLines || [])[1] || '',
          city: contact.locality,
          state: contact.administrativeArea,
          zip: contact.postalCode,
          country: contact.countryCode?.toLowerCase() || locale,
          phone: contact.phoneNumber || '',
          email: contact.emailAddress || '',
        };

        const orderBody = {
          customer: {
            firstName: contact.givenName || '',
            lastName: contact.familyName || '',
            email: contact.emailAddress || '',
            phone: contact.phoneNumber || '',
          },
          shipping: shippingAddr,
          billing: shippingAddr,
          items: cart.getItemsForAPI(),
          shippingMethod: { id: lastShippingMethodId || e.payment.shippingMethod?.identifier || '' },
          estimateToken: callbacks.getState().currentEstimateToken,
          country: locale,
          locale: bcp47,
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
          'chase-wallet',
          'apple-pay',
          { token: payment.token, billingContact: payment.billingContact },
        );

        if (result.status === 'completed') {
          session.completePayment(window.ApplePaySession.STATUS_SUCCESS);
          callbacks.onComplete(createdOrder);
        } else {
          session.completePayment(window.ApplePaySession.STATUS_FAILURE);
          callbacks.showError(result.reason || 'Apple Pay payment failed.');
        }
      } catch (err) {
        session.completePayment(window.ApplePaySession.STATUS_FAILURE);
        const msg = err?.errorHeader === 'recaptcha score too low'
          ? 'Payment was declined for security reasons. Please refresh the page and try again.'
          : 'Apple Pay payment failed. Please try again.';
        callbacks.showError(msg);
      }
    };

    session.begin();
  });
}

/**
 * Begins an Apple Pay checkout session synchronously within a user gesture,
 * then returns a Promise that resolves/rejects when the session completes.
 *
 * IMPORTANT: This must be called synchronously from a trusted click handler.
 * session.begin() fires inside the Promise executor (which is synchronous),
 * preserving the user gesture required by Apple Pay.
 *
 * @param {Object} config
 * @param {Object} callbacks
 * @returns {Promise<string>} Resolves with 'success' or 'cancel'
 */
export function beginCheckoutSession(config, callbacks) {
  return new Promise((resolve, reject) => {
    const state = callbacks.getState();

    if (!window.ApplePaySession) {
      reject(new Error('not-available'));
      return;
    }

    if (!state.currentPreview) {
      reject(new Error('no-preview'));
      return;
    }

    const locale = config.getLocale();
    const language = config.getLanguage();
    const bcp47 = `${language.split('_')[0]}-${(language.split('_')[1] || locale).toUpperCase()}`;

    const request = {
      countryCode: locale.toUpperCase(),
      currencyCode: typeof config.currency === 'function' ? config.currency(locale) : config.currency,
      supportedNetworks: ['visa', 'masterCard', 'amex', 'discover'],
      merchantCapabilities: ['supports3DS'],
      requiredShippingContactFields: [],
      total: {
        label: config.site || 'Store',
        amount: parseFloat(state.currentPreview.total).toFixed(2),
      },
    };

    let session;
    try {
      session = new window.ApplePaySession(3, request);
    } catch {
      reject(new Error('not-available'));
      return;
    }

    session.onvalidatemerchant = async (e) => {
      try {
        const { merchantSession } = await validateApplePayMerchant(e.validationURL, locale, bcp47);
        session.completeMerchantValidation(merchantSession);
      } catch {
        session.abort();
        reject(new Error('merchant-validation-failed'));
      }
    };

    session.oncancel = () => resolve('cancel');

    session.onpaymentauthorized = async (e) => {
      const formData = callbacks.getFormData();
      try {
        const orderBody = callbacks.buildOrderJSON(formData);
        const createdOrder = await callbacks.createOrder(orderBody);

        const fraudToken = (() => {
          try { return sessionStorage.getItem('forter_token') || undefined; } catch { return undefined; }
        })();
        const idempotencyKey = crypto.randomUUID?.() || `${Date.now()}`;
        const result = await callbacks.initiatePayment(
          createdOrder.order?.id ?? createdOrder.id,
          idempotencyKey,
          fraudToken,
          'chase-wallet',
          'apple-pay',
          { token: e.payment.token, billingContact: e.payment.billingContact },
        );

        if (result.status === 'completed') {
          session.completePayment(window.ApplePaySession.STATUS_SUCCESS);
          const email = formData.get('email') || '';
          const cart = callbacks.getCart();
          const preview = callbacks.getState().currentPreview;
          callbacks.saveCheckoutSession?.(email, cart, preview, createdOrder.order ?? createdOrder);
          callbacks.onComplete(createdOrder);
          resolve('success');
        } else {
          session.completePayment(window.ApplePaySession.STATUS_FAILURE);
          reject(new Error(result.reason || 'payment-failed'));
        }
      } catch (err) {
        session.completePayment(window.ApplePaySession.STATUS_FAILURE);
        const reason = err?.errorHeader === 'recaptcha score too low' ? 'recaptcha-blocked' : 'payment-failed';
        reject(new Error(reason));
      }
    };

    try {
      session.begin(); // synchronous — user gesture still active here
    } catch {
      reject(new Error('not-available'));
    }
  });
}

/** @type {import('./types').PaymentProvider} */
export default {
  id: 'apple-pay',
  label: 'Apple Pay',
  supportsExpress: true,
  hidesBilling: true,

  load: async () => loadSdk(),

  isAvailable: () => Boolean(window.ApplePaySession),

  renderExpressButton(container, callbacks) {
    const config = callbacks.getConfig();
    const locale = config.getLocale();
    const language = config.getLanguage();
    const bcp47 = `${language.split('_')[0]}-${(language.split('_')[1] || locale).toUpperCase()}`;
    const btn = createApplePayButton(bcp47);
    startExpressSession(btn, config, callbacks);
    container.appendChild(btn);
  },

  renderCheckoutButton() {
    // Apple Pay is initiated directly from the form's submit button gesture
    // via callbacks.beginApplePay — no button rendered here.
  },
};
