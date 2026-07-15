import { getLocaleAndLanguage } from '../scripts.js';
import { logOperation, getCheckoutId } from '../operations-log.js';

/** @type {import('./types').PaymentProvider} */
export default {
  id: 'affirm',
  label: 'Affirm',
  supportsExpress: false,
  hidesBilling: true,

  // Affirm SDK is bootstrapped after initiatePayment returns env-specific config
  load: async () => {},

  isAvailable: (total, config) => total == null || total >= (config?.affirmMinOrderTotal ?? 50),

  renderExpressButton: () => {},

  renderCheckoutButton(container, callbacks) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button affirm-button';
    btn.textContent = 'Pay with Affirm';
    container.appendChild(btn);

    btn.addEventListener('click', async () => {
      callbacks.clearError();
      btn.disabled = true;

      const { isEstimateExpiringSoon } = await import('../../blocks/checkout/checkout-order.js');
      const state = callbacks.getState();
      if (!state.currentEstimateToken
        || isEstimateExpiringSoon(state.currentEstimateToken)) {
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
        logOperation('checkout-failed', {
          checkoutId: getCheckoutId(), provider: 'affirm', status: err?.status, message: err?.body?.message || err?.message,
        });
        callbacks.showError(err?.errorHeader?.toLowerCase().includes('recaptcha')
          ? callbacks.strings.errorRecaptcha
          : (err.body?.message || 'Unable to place order. Please try again.'));
        btn.disabled = false;
        return;
      }

      const orderId = createdOrder.order?.id ?? createdOrder.id;
      const idempotencyKey = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      let payment;
      try {
        payment = await callbacks.initiatePayment(
          orderId,
          idempotencyKey,
          undefined,
          'affirm',
          'bnpl',
        );
      } catch (err) {
        logOperation('checkout-failed', {
          checkoutId: getCheckoutId(), orderId, provider: 'affirm', status: err?.status, message: err?.body?.message || err?.message,
        });
        const message = err.body?.error === 'ORDER_TOTAL_OUT_OF_RANGE'
          ? 'Affirm is not available for this order total.'
          : err.body?.message || 'Affirm is unavailable. Please try another payment method.';
        callbacks.showError(message);
        btn.disabled = false;
        return;
      }

      if (!payment.checkoutObject) {
        callbacks.showError('Unexpected payment response. Please try again.');
        btn.disabled = false;
        return;
      }

      const { locale, language: affirmLocale } = getLocaleAndLanguage(true, true);
      const affirmCountryCode = locale === 'ca' ? 'CAN' : 'USA';

      // eslint-disable-next-line no-underscore-dangle
      window._affirm_config = {
        public_api_key: payment.checkoutObject.merchant.public_api_key,
        script: payment.affirmJsUrl,
        locale: affirmLocale,
        country_code: affirmCountryCode,
      };

      /* eslint-disable */
      (function(m,g,n,d,a,e,h,c){var b=m[n]||{},k=document.createElement(e),p=document.getElementsByTagName(e)[0],l=function(a,b,c){return function(){a[b]._.push([c,arguments])}};b[d]=l(b,d,"set");var f=b[d];b[a]={};b[a]._=[];f._=[];b._=[];b[a][h]=l(b,a,h);b[c]=function(){b._.push([h,arguments])};a=0;for(c="set add save post open empty reset on off trigger ready setProduct".split(" ");a<c.length;a++)f[c[a]]=l(b,d,c[a]);a=0;for(c=["get","token","url","items"];a<c.length;a++)f[c[a]]=function(){};k.async=!0;k.src=g[e];p.parentNode.insertBefore(k,p);delete g[e];f(g);m[n]=b})(window,_affirm_config,"affirm","checkout","ui","script","ready","jsReady");
      /* eslint-enable */

      /* eslint-disable no-undef */
      affirm.ui.ready(() => {
        affirm.ui.error.on('close', () => {
          btn.disabled = false;
        });
        affirm.checkout(payment.checkoutObject);
        const openOpts = payment.checkoutMode === 'modal' ? {
          onSuccess: ({ checkout_token: checkoutToken }) => {
            logOperation('checkout-redirect-start', {
              checkoutId: getCheckoutId(), orderId, provider: 'affirm',
            });
            const confirmUrl = payment.checkoutObject.merchant.user_confirmation_url;
            window.location.href = `${confirmUrl}&checkout_token=${encodeURIComponent(checkoutToken)}`;
          },
          onFail: () => {
            btn.disabled = false;
          },
        } : {};
        affirm.checkout.open(openOpts);
      });
      /* eslint-enable no-undef */
    });
  },
};
