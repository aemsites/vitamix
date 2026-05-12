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

function loadSdk(clientId, currency, locale) {
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise((resolve, reject) => {
    if (window.paypal) { resolve(); return; }
    const script = document.createElement('script');
    const params = new URLSearchParams({
      'client-id': clientId,
      currency,
      components: 'buttons',
      locale,
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

function sdkOnClick(actions) {
  showNotConfiguredDialog();
  return actions.reject();
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
    try {
      await loadSdk(clientId, currency, locale);
    } catch { /* fall back to stub buttons */ }
  },

  isAvailable: () => true,

  renderExpressButton(container, callbacks) {
    if (window.paypal) {
      window.paypal.Buttons({
        style: {
          layout: 'horizontal', color: 'gold', shape: 'rect', label: 'paypal', disableMaxHeight: true,
        },
        onClick: (data, actions) => sdkOnClick(actions),
      }).render(container);

      const payLaterBtn = window.paypal.Buttons({
        fundingSource: window.paypal.FUNDING.PAYLATER,
        style: {
          layout: 'horizontal', color: 'silver', shape: 'rect', label: 'pay_later', disableMaxHeight: true,
        },
        onClick: (data, actions) => sdkOnClick(actions),
      });
      if (payLaterBtn.isEligible()) {
        const payLaterWrapper = document.createElement('div');
        payLaterWrapper.className = 'paypal-paylater-wrapper';
        container.appendChild(payLaterWrapper);
        payLaterBtn.render(payLaterWrapper);
      }
      return;
    }

    // No SDK — stub buttons with localized Pay Later label
    const label = getPayLaterLabel(callbacks.getConfig().getLanguage());
    const paypalBtn = createButton(PAYPAL_WORDMARK, 'paypal-express-btn');
    paypalBtn.addEventListener('click', showNotConfiguredDialog);
    container.appendChild(paypalBtn);

    const payLaterWrapper = document.createElement('div');
    payLaterWrapper.className = 'paypal-paylater-wrapper';
    const payLaterBtn = createButton(payLaterWordmark(label), 'paypal-express-btn paylater-express-btn');
    payLaterBtn.addEventListener('click', showNotConfiguredDialog);
    payLaterWrapper.appendChild(payLaterBtn);
    container.appendChild(payLaterWrapper);
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
        callbacks.showError(err.body?.message || 'Unable to place order. Please try again.');
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
