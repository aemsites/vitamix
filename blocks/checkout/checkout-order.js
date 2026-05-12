import { createOrder, initiatePayment, previewOrder } from '../../scripts/commerce-api.js';
import { collectAddress } from './checkout-address.js';
import { updatePreview } from './checkout-shipping.js';

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
      phone: formData.get('shipping-telephone') || '',
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

  order.locale = `${language.split('_')[0]}-${(language.split('_')[1] || locale).toUpperCase()}`;
  order.country = locale;

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
    getFormData: () => new FormData(form),
    getState: () => state,
    updatePreview: () => updatePreview(form, cart, state, config),
    previewOrderDirect: (body) => previewOrder(body),
    buildOrderJSON: (formData) => buildOrderJSON(formData, form, cart, state, config),
    saveCheckoutSession: (email, c, preview, order) => (
      saveCheckoutSession(email, c, preview, order)
    ),
    createOrder: (orderBody) => createOrder(orderBody),
    initiatePayment: (...args) => initiatePayment(...args),
    showError: (msg) => showError(form, msg),
    clearError: () => clearError(form),
    onComplete: () => {
      cart.clear();
      window.location.href = config.getOrderPath('complete');
    },
  };

  // Wire Chase submit button
  const submitBtn = form.querySelector('.checkout-submit-btn');
  const submitTextEl = submitBtn?.querySelector('.submit-btn-text');

  if (submitBtn) {
    submitBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      clearError(form);

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      if (!state.selectedShippingMethodId) {
        showError(form, strings.errorSelectShipping);
        return;
      }

      // Delegate to the selected provider's own button if not credit-card
      const selectedMethod = form.querySelector('[name="paymentMethod"]:checked')?.value || 'credit-card';

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
          callbacks.showError(msg);
        } finally {
          submitBtn.disabled = false;
          submitBtn.classList.remove('is-loading');
          if (submitTextEl) submitTextEl.textContent = strings.continueToPayment;
        }
        return;
      }

      if (selectedMethod !== 'credit-card') {
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

      submitBtn.disabled = true;
      if (submitTextEl) submitTextEl.textContent = strings.processing;

      try {
        const createdOrder = await createOrder(orderBody);
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
        showError(form, err.body?.message || strings.errorGeneric);
        submitBtn.disabled = false;
        if (submitTextEl) submitTextEl.textContent = strings.continueToPayment;
      }
    });
  }

  return callbacks;
}
