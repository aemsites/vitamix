import { createOrder, initiatePayment, previewOrder } from '../../scripts/commerce-api.js';
import { collectAddress } from './checkout-address.js';
import { updatePreview } from './checkout-shipping.js';
import { FORMS_ENDPOINT, getLocaleAndLanguage } from '../../scripts/scripts.js';
import { validateLinkIntegrity } from './link-integrity.js';
import { validateForm } from './checkout-validation.js';

export { validateLinkIntegrity };

/**
 * Writes checkout state to sessionStorage before a payment redirect.
 * @param {string} email
 * @param {Object} cart
 * @param {Object|null} preview
 * @param {Object|null} order
 */
export function saveCheckoutSession(email, cart, preview, order) {
  try {
    sessionStorage.setItem('checkout_email', email);
    sessionStorage.setItem('checkout_cart_items', JSON.stringify(cart.items));
    if (preview) sessionStorage.setItem('checkout_preview', JSON.stringify(preview));
    if (order) sessionStorage.setItem('checkout_order', JSON.stringify(order));
  } catch { /* ignore */ }
}

/**
 * Assembles the order JSON payload from form data, cart, and checkout state.
 * @param {FormData} formData
 * @param {HTMLFormElement} form
 * @param {Object} cart
 * @param {Object} state
 * @param {Object} config
 * @returns {Object}
 */
export function buildOrderJSON(formData, form, cart, state, config) {
  const email = formData.get('email') || '';
  const locale = config.getLocale();
  const language = config.getLanguage();
  const country = locale;

  const shippingAddr = collectAddress(form, formData, 'shipping-', email, country);
  const sameAsBilling = form.querySelector('[name="billing-choice"]:checked')?.value !== 'different';
  const billingAddr = sameAsBilling ? null : collectAddress(form, formData, 'billing-', email, country);

  const cleanAddr = (addr) => Object.fromEntries(
    Object.entries(addr).filter(([, v]) => v !== ''),
  );

  const order = {
    customer: {
      firstName: formData.get('shipping-firstname') || '',
      lastName: formData.get('shipping-lastname') || '',
      email,
      phone: (formData.get('shipping-telephone') || '').replace(/\D/g, ''),
    },
    shipping: cleanAddr(shippingAddr),
    billing: cleanAddr(billingAddr ?? shippingAddr),
    items: cart.getItemsForAPI(),
  };

  if (state.selectedShippingMethodId) {
    order.shippingMethod = { id: state.selectedShippingMethodId };
  }
  if (state.currentEstimateToken) {
    order.estimateToken = state.currentEstimateToken;
  }

  const giftMessage = formData.get('gift-message');
  if (giftMessage?.trim()) {
    order.giftMessage = giftMessage.trim();
  }

  const couponCode = sessionStorage.getItem('checkout_coupon_code') || undefined;
  if (couponCode) order.couponCode = couponCode;

  order.locale = `${language.split('_')[0]}-${(language.split('_')[1] || locale).toUpperCase()}`;
  order.country = locale;

  const paymentMethod = formData.get('paymentMethod');
  if (paymentMethod) order.paymentMethod = paymentMethod;

  return order;
}

/**
 * Shows an error message inside the form.
 * @param {HTMLFormElement} form
 * @param {string} message
 */
function showError(form, message) {
  const el = form.querySelector('.checkout-error');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Clears the error message.
 * @param {HTMLFormElement} form
 */
function clearError(form) {
  const el = form.querySelector('.checkout-error');
  if (el) { el.hidden = true; el.textContent = ''; }
}

/**
 * Fire-and-forget newsletter subscription after order creation.
 * Reads the newsletter checkbox from formData; does nothing if unchecked.
 * @param {FormData} formData
 */
function subscribeNewsletter(formData) {
  if (!formData.get('newsletter')) return;

  const { locale, language } = getLocaleAndLanguage();
  const email = formData.get('email') || '';
  const firstName = formData.get('shipping-firstname') || '';
  const lastName = formData.get('shipping-lastname') || '';

  const url = `${FORMS_ENDPOINT}/${locale}/${language}/forms`;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      formId: `${locale}/${language}/newsletter`,
      email,
      emailOptIn: true,
      firstName,
      lastName,
      country: locale,
    }),
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('newsletter subscription failed:', err);
  });
}

/**
 * Wires the Chase (credit card) submit button and provides a shared callbacks object
 * that payment providers can use.
 *
 * @param {HTMLFormElement} form
 * @param {Object} cart
 * @param {Object} state
 * @param {Object} config
 * @param {Object} strings
 * @returns {Object} callbacks
 */
export function initOrder(form, cart, state, config, strings) {
  const callbacks = {
    getCart: () => cart,
    getConfig: () => config,
    strings,
    getFormData: () => new FormData(form),
    getState: () => state,
    updatePreview: () => updatePreview(form, cart, state, config),
    previewOrderDirect: async (body) => {
      const result = await previewOrder(body);
      if (result.estimateToken) state.currentEstimateToken = result.estimateToken;
      state.currentPreview = result;
      return result;
    },
    buildOrderJSON: (formData) => buildOrderJSON(formData, form, cart, state, config),
    saveCheckoutSession: (email, c, preview, order) => (
      saveCheckoutSession(email, c, preview, order)
    ),
    createOrder: async (orderBody) => {
      const integrity = validateLinkIntegrity(orderBody.items || []);
      if (!integrity.valid) {
        // eslint-disable-next-line no-console
        console.error(integrity.error);
        throw new Error(integrity.error);
      }
      const result = await createOrder(orderBody);
      subscribeNewsletter(new FormData(form));
      return result;
    },
    initiatePayment: (...args) => initiatePayment(...args),
    showError: (msg) => showError(form, msg),
    clearError: () => clearError(form),
    onComplete: (createdOrder) => {
      const order = createdOrder?.order ?? createdOrder;
      const orderId = order?.id;
      const email = order?.customer?.email || '';
      saveCheckoutSession(email, cart, state.currentPreview, order);
      cart.clear();
      const path = config.getOrderPath('complete');
      window.location.href = orderId ? `${path}?orderId=${orderId}` : path;
    },
  };

  // Wire Chase submit button
  const submitBtn = form.querySelector('.checkout-submit-btn');
  const submitTextEl = submitBtn?.querySelector('.submit-btn-text');

  if (submitBtn) {
    submitBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      clearError(form);

      if (!validateForm(form)) return;

      if (!state.shippingAddressValidated) {
        const validShippingAddress = await state.ensureValidShippingAddress?.();
        if (!validShippingAddress) {
          showError(
            form,
            strings.addressCompleteRequired || 'Please complete and verify your shipping address before continuing.',
          );
          return;
        }
      }

      if (!state.selectedShippingMethodId) {
        showError(form, strings.errorSelectShipping);
        return;
      }

      // Delegate to the selected provider's own button if not credit-card
      const selectedMethod = form.querySelector('[name="paymentMethod"]:checked')?.value;

      if (selectedMethod === 'apple-pay') {
        submitBtn.disabled = true;
        submitBtn.classList.add('is-loading');
        if (submitTextEl) submitTextEl.textContent = strings.processing;
        try {
          await callbacks.beginApplePay();
        } catch (err) {
          let msg = 'Apple Pay payment failed. Please try again.';
          if (err.message === 'not-available') msg = 'Apple Pay is not available. Please try a different payment method.';
          if (err.message === 'no-preview') msg = 'Please complete your shipping information first.';
          if (err.message === 'recaptcha-blocked') msg = strings.errorRecaptcha;
          callbacks.showError(msg);
        } finally {
          submitBtn.disabled = false;
          submitBtn.classList.remove('is-loading');
          if (submitTextEl) submitTextEl.textContent = strings.continueToPayment;
        }
        return;
      }

      if (selectedMethod !== config.cardProvider) {
        const providerBtn = form.querySelector(`.payment-button-container[data-provider="${selectedMethod}"] button`);
        if (providerBtn) {
          submitBtn.disabled = true;
          submitBtn.classList.add('is-loading');
          if (submitTextEl) submitTextEl.textContent = strings.processing;

          // Restore submit button when the provider re-enables its own button (on fail/close)
          const observer = new MutationObserver(() => {
            if (!providerBtn.disabled) {
              submitBtn.disabled = false;
              submitBtn.classList.remove('is-loading');
              if (submitTextEl) submitTextEl.textContent = strings.continueToPayment;
              observer.disconnect();
            }
          });
          observer.observe(providerBtn, { attributes: true, attributeFilter: ['disabled'] });

          providerBtn.click();
        }
        return;
      }

      if (!state.currentEstimateToken) {
        await callbacks.updatePreview();
        if (!state.currentEstimateToken) {
          showError(form, strings.errorCalculateTotals);
          return;
        }
      }

      const formData = new FormData(form);
      const email = formData.get('email') || '';
      const orderBody = buildOrderJSON(formData, form, cart, state, config);

      const integrity = validateLinkIntegrity(orderBody.items || []);
      if (!integrity.valid) {
        // eslint-disable-next-line no-console
        console.error(integrity.error);
        showError(form, integrity.error);
        return;
      }

      submitBtn.disabled = true;
      if (submitTextEl) submitTextEl.textContent = strings.processing;

      try {
        const createdOrder = await createOrder(orderBody);
        subscribeNewsletter(formData);
        saveCheckoutSession(email, cart, state.currentPreview, createdOrder.order ?? createdOrder);

        const fraudToken = config.getFraudToken?.();
        const idempotencyKey = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        const payment = await initiatePayment(
          createdOrder.order?.id ?? createdOrder.id,
          idempotencyKey,
          fraudToken,
          config.cardProvider || 'chase',
          'card',
        );

        if (payment.action === 'redirect' && payment.redirectUrl) {
          window.location.href = payment.redirectUrl;
        } else if (payment.status === 'completed') {
          callbacks.onComplete(createdOrder);
        } else {
          showError(form, payment.reason || strings.errorGeneric);
          submitBtn.disabled = false;
          if (submitTextEl) submitTextEl.textContent = strings.continueToPayment;
        }
      } catch (err) {
        const msg = err?.errorHeader?.toLowerCase().includes('recaptcha')
          ? strings.errorRecaptcha
          : err.body?.message || strings.errorGeneric;
        showError(form, msg);
        submitBtn.disabled = false;
        if (submitTextEl) submitTextEl.textContent = strings.continueToPayment;
      }
    });
  }

  return callbacks;
}
