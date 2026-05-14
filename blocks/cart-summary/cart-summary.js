import { loadCSS } from '../../scripts/aem.js';
import { getConfig, formatPrice } from '../../scripts/commerce-config.js';
import cart from '../../scripts/cart.js';
import { previewOrder, createOrder, initiatePayment } from '../../scripts/commerce-api.js';
import applePay from '../../scripts/payments/apple-pay.js';
import googlePay from '../../scripts/payments/google-pay.js';
import paypal from '../../scripts/payments/paypal.js';
import { getActiveProviders } from '../checkout/checkout-payment.js';

const ALL_PROVIDERS = [applePay, googlePay, paypal];

const LOCAL_STRINGS = {
  'en-us': {
    havePromoCode: 'Have a promo code?',
    shippingPlaceholder: 'Calculated at checkout',
    checkoutSecurely: 'Checkout securely',
  },
  'fr-ca': {
    havePromoCode: 'Vous avez un code promo?',
    shippingPlaceholder: 'Calculée à la caisse',
    checkoutSecurely: 'Payer en toute sécurité',
  },
};

function getStrings() {
  const config = getConfig();
  const lang = config.getLanguage().toLowerCase().replace('_', '-');
  return { ...config.getStrings(), ...(LOCAL_STRINGS[lang] || LOCAL_STRINGS['en-us']) };
}

function getCurrencyCode() {
  const config = getConfig();
  return typeof config.currency === 'function' ? config.currency(config.getLocale()) : config.currency;
}

/**
 * If cart-summary is authored in its own section, move its wrapper into the
 * adjacent section containing the cart block so the CSS two-column layout fires.
 * @param {HTMLDivElement} block
 */
function colocateWithCart(block) {
  const wrapper = block.closest('.cart-summary-wrapper');
  const mySection = wrapper?.closest('.section');
  if (!wrapper || !mySection) return;
  if (mySection.querySelector('.cart-wrapper')) return;

  const main = mySection.closest('main') || document;
  const target = [...main.querySelectorAll('.section')]
    .find((s) => s !== mySection && s.querySelector('.cart-wrapper'));
  if (!target) return;

  target.appendChild(wrapper);
  if (!mySection.children.length) mySection.remove();
}

function buildTemplate(s) {
  return /* html */`
<div class="cart-summary">
  <div class="cart-summary-header">
    <h3>${s.orderSummary}</h3>
  </div>
  <div class="cart-summary-content">
    <div class="cart-summary-express-section" hidden>
      <div class="cart-summary-express-buttons"></div>
      <div class="cart-summary-express-divider"><span>${s.or}</span></div>
    </div>
    <details class="cart-summary-promo">
      <summary class="cart-summary-promo-toggle">${s.havePromoCode}</summary>
      <div class="cart-summary-discount">
        <input type="text" placeholder="${s.discountPlaceholder}"
          class="discount-input" autocomplete="off">
        <button class="discount-apply">${s.apply}</button>
      </div>
    </details>
    <div class="cart-summary-totals">
      <div class="cart-summary-row">
        <span>${s.subtotal}</span>
        <span class="cart-summary-subtotal"></span>
      </div>
      <div class="cart-summary-row">
        <span>${s.shipping}</span>
        <span class="cart-summary-shipping">${s.shippingPlaceholder}</span>
      </div>
      <div class="cart-summary-row">
        <span>${s.estimatedTaxes}</span>
        <span class="cart-summary-taxes">--</span>
      </div>
      <div class="cart-summary-row cart-summary-final">
        <strong>${s.total}</strong>
        <div class="cart-summary-final-amount">
          <span class="currency"></span>
          <strong class="cart-summary-grand-total"></strong>
        </div>
      </div>
    </div>
    <div class="cart-summary-error" hidden></div>
    <a href="#" class="cart-summary-checkout-btn button emphasis">${s.checkoutSecurely}</a>
  </div>
</div>
`;
}

/**
 * Decorates the cart-summary block.
 *
 * 1. Colocate with the cart section for two-column CSS layout
 * 2. Build template with i18n strings, set checkout href and currency
 * 3. Bind cart:change to keep subtotal and total in sync
 * 4. Restore saved promo code; persist to sessionStorage on apply
 * 5. Build express-checkout callbacks, load SDKs, render available wallet buttons
 *
 * @param {HTMLDivElement} block
 */
export default async function decorate(block) {
  await loadCSS('/styles/commerce-tokens.css');
  const config = getConfig();
  const s = getStrings();

  // 1. Colocate with the cart section for two-column CSS layout
  colocateWithCart(block);
  block.innerHTML = buildTemplate(s);

  const subtotalEl = block.querySelector('.cart-summary-subtotal');
  const grandTotalEl = block.querySelector('.cart-summary-grand-total');
  const currencyEl = block.querySelector('.currency');
  const expressSection = block.querySelector('.cart-summary-express-section');
  const expressContainer = block.querySelector('.cart-summary-express-buttons');
  const discountInput = block.querySelector('.discount-input');
  const discountApply = block.querySelector('.discount-apply');
  const errorEl = block.querySelector('.cart-summary-error');
  const checkoutBtn = block.querySelector('.cart-summary-checkout-btn');

  // 2. Set checkout href and currency
  checkoutBtn.href = config.getOrderPath('checkout');
  currencyEl.textContent = getCurrencyCode();

  // 3. Bind cart:change to keep totals in sync
  const updateTotals = () => {
    const formatted = formatPrice(cart.subtotal, getCurrencyCode());
    subtotalEl.textContent = formatted;
    grandTotalEl.textContent = formatted;
  };
  updateTotals();
  document.addEventListener('cart:change', updateTotals);

  // 4. Restore saved promo code; persist to sessionStorage on apply
  const savedCoupon = sessionStorage.getItem('checkout_coupon_code') || '';
  if (savedCoupon) {
    discountInput.value = savedCoupon;
    block.querySelector('.cart-summary-promo').open = true;
  }
  discountApply.addEventListener('click', () => {
    const code = discountInput.value.trim();
    if (code) {
      sessionStorage.setItem('checkout_coupon_code', code);
    } else {
      sessionStorage.removeItem('checkout_coupon_code');
    }
  });

  // 5. Build express-checkout callbacks, load SDKs, render available wallet buttons
  const state = { currentEstimateToken: null, currentPreview: null };

  const callbacks = {
    getCart: () => cart,
    getConfig: () => config,
    getState: () => state,
    previewOrderDirect: async (body) => {
      const couponCode = sessionStorage.getItem('checkout_coupon_code') || undefined;
      const result = await previewOrder({ ...body, ...(couponCode ? { couponCode } : {}) });
      if (result.estimateToken) state.currentEstimateToken = result.estimateToken;
      state.currentPreview = result;
      return result;
    },
    createOrder: (orderBody) => createOrder(orderBody),
    initiatePayment: (...args) => initiatePayment(...args),
    showError: (msg) => {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    },
    onComplete: (createdOrder) => {
      const order = createdOrder?.order ?? createdOrder;
      const orderId = order?.id;
      try {
        if (order?.customer?.email) sessionStorage.setItem('checkout_email', order.customer.email);
        sessionStorage.setItem('checkout_cart_items', JSON.stringify(cart.items));
        if (state.currentPreview) sessionStorage.setItem('checkout_preview', JSON.stringify(state.currentPreview));
        if (order) sessionStorage.setItem('checkout_order', JSON.stringify(order));
      } catch { /* ignore */ }
      cart.clear();
      const path = config.getOrderPath('complete');
      window.location.href = orderId ? `${path}?orderId=${orderId}` : path;
    },
  };

  const active = getActiveProviders(ALL_PROVIDERS).filter((p) => p.supportsExpress);
  await Promise.all(active.map(async (p) => {
    try { await p.load(config); } catch { /* provider load failure handled by isAvailable check */ }
  }));
  const available = active.filter((p) => {
    try { return p.isAvailable(); } catch { return false; }
  });
  if (available.length) {
    available.forEach((p) => p.renderExpressButton(expressContainer, callbacks));
    expressSection.hidden = false;
  }
}
