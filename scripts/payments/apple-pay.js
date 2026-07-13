import {
  estimateExpressCheckout,
  getCustomerTimezone,
  parsePreview,
  validateApplePayMerchant,
} from '../commerce-api.js';
import { getUser, isLoggedIn } from '../auth-api.js';
import { logOperation, getCheckoutId } from '../operations-log.js';
import {
  buildApplePayExpressOrderPayload,
  buildApplePayExpressPreviewPayload,
  getApplePayExpressContext,
} from './apple-pay-context.js';

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
  btn.addEventListener('click', () => {
    const cart = callbacks.getCart();
    const locale = config.getLocale();
    const language = config.getLanguage();
    const bcp47 = `${language.split('_')[0]}-${(language.split('_')[1] || locale).toUpperCase()}`;
    const checkoutContext = getApplePayExpressContext(callbacks.expressEntryPoint);

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

      if (contact.countryCode && contact.countryCode.toLowerCase() !== locale) {
        session.completeShippingContactSelection({
          errors: [new window.ApplePayError('shippingContactInvalid', 'countryCode', callbacks.strings?.errorApplePayCountry || 'Shipping is not available to this country.')],
          newTotal: { label: config.site || 'Store', amount: cart.subtotal.toFixed(2) },
          newShippingMethods: [],
          newLineItems: [],
        });
        return;
      }

      try {
        const result = await estimateExpressCheckout(
          contact.countryCode,
          contact.administrativeArea,
          contact.postalCode,
          cart.getItemsForAPI(),
          checkoutContext,
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
            identifier: String(m.id),
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
        const previewResult = await callbacks.previewOrderDirect(
          buildApplePayExpressPreviewPayload(
            cart,
            e.shippingMethod.identifier,
            bcp47,
            lastShippingContact,
            checkoutContext,
          ),
        );
        lastShippingMethodId = e.shippingMethod.identifier;
        callbacks.getState().currentEstimateToken = previewResult.estimateToken;
        const { shippingRate } = parsePreview(previewResult, cart.subtotal);
        session.completeShippingMethodSelection({
          newTotal: { label: config.site || 'Store', amount: String(previewResult.total) },
          newLineItems: [
            { label: 'Subtotal', amount: String(previewResult.subtotal) },
            { label: 'Tax', amount: String(previewResult.taxAmount) },
            { label: 'Shipping', amount: String(shippingRate) },
          ],
        });
      } catch {
        session.abort();
        callbacks.showError(callbacks.strings?.errorApplePayGeneric || 'Unable to process your order. Please try a different address or payment method.');
      }
    };

    session.onpaymentauthorized = async (e) => {
      const { payment } = e;
      const contact = payment.shippingContact;
      try {
        // When the user is signed in, use their account email so the order is linked
        // to the right account. The Apple Pay contact email may differ from the
        // commerce account email, which causes assertEmail to reject the request.
        const customerEmail = (isLoggedIn() && getUser()?.email) || contact.emailAddress || '';
        const customerTimezone = getCustomerTimezone();
        const orderBody = buildApplePayExpressOrderPayload({
          payment,
          cart,
          shippingMethodId: lastShippingMethodId || e.payment.shippingMethod?.identifier || '',
          estimateToken: callbacks.getState().currentEstimateToken,
          country: locale,
          locale: bcp47,
          customerEmail,
          customerTimezone,
          checkoutContext,
        });

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
          logOperation('checkout-failed', {
            checkoutId: getCheckoutId(),
            orderId: createdOrder.order?.id ?? createdOrder.id,
            provider: 'apple-pay',
            status: result.status,
            reason: result.reason,
          });
          callbacks.showError(result.reason || 'Apple Pay payment failed.');
        }
      } catch (err) {
        session.completePayment(window.ApplePaySession.STATUS_FAILURE);
        logOperation('checkout-failed', {
          checkoutId: getCheckoutId(),
          provider: 'apple-pay',
          status: err?.status,
          message: err?.body?.message || err?.message,
        });
        const msg = err?.errorHeader?.toLowerCase().includes('recaptcha')
          ? callbacks.strings.errorRecaptcha
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
          logOperation('checkout-failed', {
            checkoutId: getCheckoutId(),
            orderId: createdOrder.order?.id ?? createdOrder.id,
            provider: 'apple-pay',
            status: result.status,
            reason: result.reason,
          });
          reject(new Error(result.reason || 'payment-failed'));
        }
      } catch (err) {
        session.completePayment(window.ApplePaySession.STATUS_FAILURE);
        logOperation('checkout-failed', {
          checkoutId: getCheckoutId(),
          provider: 'apple-pay',
          status: err?.status,
          message: err?.body?.message || err?.message,
        });
        const reason = err?.errorHeader?.toLowerCase().includes('recaptcha') ? 'recaptcha-blocked' : 'payment-failed';
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
    if (!callbacks.expressEntryPoint) {
      throw new Error('Apple Pay express checkout requires an entry point');
    }
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
