import { loadCSS } from '../../scripts/aem.js';
import { getConfig, formatPrice } from '../../scripts/commerce-config.js';
import cart from '../../scripts/cart.js';
import {
  previewOrder, createOrder, initiatePayment, estimatePrice,
} from '../../scripts/commerce-api.js';
import applePay from '../../scripts/payments/apple-pay.js';
import googlePay from '../../scripts/payments/google-pay.js';
import paypal from '../../scripts/payments/paypal.js';
import { getActiveProviders } from '../checkout/checkout-payment.js';
import { initIDMe } from '../../scripts/commerce/idme.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

const ALL_PROVIDERS = [applePay, googlePay, paypal];

const LOCAL_STRINGS = {
  'en-us': {
    havePromoCode: 'Have a promo code?',
    shippingPlaceholder: 'Calculated at checkout',
    checkoutSecurely: 'Checkout securely',
    applied: 'Code saved',
    discountPending: 'Applied at checkout',
  },
  'fr-ca': {
    havePromoCode: 'Vous avez un code promo?',
    shippingPlaceholder: 'Calculée à la caisse',
    checkoutSecurely: 'Payer en toute sécurité',
    applied: 'Code sauvegardé',
    discountPending: 'Appliqué à la caisse',
  },
};

const COUPON_ERROR_MESSAGES = {
  'en-us': {
    coupon_invalid_format: 'Please enter a valid coupon code.',
    coupon_not_found: 'This coupon code is not valid.',
    coupon_inactive: 'This coupon code is no longer active.',
    coupon_expired: 'This coupon code has expired.',
    coupon_exhausted: 'This coupon has reached its usage limit.',
    coupon_country_mismatch: 'This coupon is not available in your region.',
    coupon_minimum_not_met: 'Your order total doesn\'t meet the minimum required for this coupon.',
    coupon_product_not_eligible: 'No items in your cart are eligible for this coupon.',
    coupon_manual_entry_rejected: 'This coupon cannot be entered manually.',
    unauthorized: 'Please sign in to use this coupon.',
    default: 'This coupon code could not be applied.',
  },
  'fr-ca': {
    coupon_invalid_format: 'Veuillez entrer un code promo valide.',
    coupon_not_found: 'Ce code promo n\'est pas valide.',
    coupon_inactive: 'Ce code promo n\'est plus actif.',
    coupon_expired: 'Ce code promo a expiré.',
    coupon_exhausted: 'Ce coupon a atteint sa limite d\'utilisation.',
    coupon_country_mismatch: 'Ce coupon n\'est pas disponible dans votre région.',
    coupon_minimum_not_met: 'Le total de votre commande est inférieur au minimum requis pour ce coupon.',
    coupon_product_not_eligible: 'Aucun article de votre panier n\'est éligible à ce coupon.',
    coupon_manual_entry_rejected: 'Ce coupon ne peut pas être saisi manuellement.',
    unauthorized: 'Veuillez vous connecter pour utiliser ce coupon.',
    default: 'Ce code promo n\'a pas pu être appliqué.',
  },
};

const COUPON_ERRORS = new Set([
  'coupon_invalid_format', 'coupon_not_found', 'coupon_inactive', 'coupon_expired',
  'coupon_exhausted', 'coupon_country_mismatch', 'coupon_minimum_not_met',
  'coupon_product_not_eligible', 'coupon_manual_entry_rejected', 'unauthorized',
]);

function getStrings() {
  const config = getConfig();
  const lang = config.getLanguage().toLowerCase().replace('_', '-');
  return { ...config.getStrings(), ...(LOCAL_STRINGS[lang] || LOCAL_STRINGS['en-us']) };
}

function getCouponErrorMessage(errorCode) {
  const config = getConfig();
  const lang = config.getLanguage().toLowerCase().replace('_', '-');
  const msgs = COUPON_ERROR_MESSAGES[lang] || COUPON_ERROR_MESSAGES['en-us'];
  return msgs[errorCode] || msgs.default;
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
    <div class="cart-summary-promo">
      <div class="cart-summary-promo-toggle">${s.havePromoCode}</div>
      <div class="cart-summary-discount">
        <input type="text" placeholder="${s.discountPlaceholder}"
          class="discount-input" autocomplete="off">
        <button class="discount-apply">${s.apply}</button>
        <p class="cart-summary-coupon-error" hidden></p>
      </div>
    </div>
    <div class="cart-summary-totals">
      <div class="cart-summary-row">
        <span>${s.subtotal}</span>
        <span class="cart-summary-subtotal"></span>
      </div>
      <div class="cart-summary-row cart-summary-discount-row" hidden>
        <span class="discount-label-group">
          <span class="cart-summary-discount-label"></span>
          <button class="discount-remove" aria-label="Remove coupon">×</button>
        </span>
        <span class="cart-summary-discount-pending">${s.discountPending}</span>
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

  // Capture any authored link (e.g. Terms and Conditions) before innerHTML is replaced
  const authoredLink = block.querySelector('a');
  const termsLink = authoredLink
    ? { href: authoredLink.href, text: authoredLink.textContent.trim() }
    : null;

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
  const discountRow = block.querySelector('.cart-summary-discount-row');
  const discountRowLabel = block.querySelector('.cart-summary-discount-label');
  const couponErrorEl = block.querySelector('.cart-summary-coupon-error');
  const errorEl = block.querySelector('.cart-summary-error');
  const checkoutBtn = block.querySelector('.cart-summary-checkout-btn');

  // 2. Set checkout href and currency
  checkoutBtn.href = config.getOrderPath('checkout');
  currencyEl.textContent = getCurrencyCode();

  // Render terms link below the checkout button if authored
  if (termsLink) {
    const termsEl = document.createElement('p');
    termsEl.className = 'cart-summary-terms';
    const a = document.createElement('a');
    a.href = termsLink.href;
    a.textContent = termsLink.text;
    termsEl.appendChild(a);
    checkoutBtn.insertAdjacentElement('afterend', termsEl);
  }

  // 3. Bind cart:change to keep totals in sync
  const updateTotals = () => {
    const formatted = formatPrice(cart.subtotal, getCurrencyCode());
    subtotalEl.textContent = formatted;
    grandTotalEl.textContent = formatted;
  };
  updateTotals();
  document.addEventListener('cart:change', updateTotals);

  // 4. Restore saved promo code; persist to sessionStorage on apply
  const showDiscountRow = (code) => {
    discountRowLabel.textContent = `${s.discount} (${code})`;
    discountRow.hidden = false;
  };
  const hideDiscountRow = () => { discountRow.hidden = true; };

  block.querySelector('.discount-remove').addEventListener('click', () => {
    sessionStorage.removeItem('checkout_coupon_code');
    discountInput.value = '';
    couponErrorEl.hidden = true;
    hideDiscountRow();
  });

  const savedCoupon = sessionStorage.getItem('checkout_coupon_code') || '';
  if (savedCoupon) {
    discountInput.value = savedCoupon;
    showDiscountRow(savedCoupon);
  }
  discountApply.addEventListener('click', async () => {
    couponErrorEl.hidden = true;
    const code = discountInput.value.trim();
    if (!code) {
      sessionStorage.removeItem('checkout_coupon_code');
      hideDiscountRow();
      return;
    }

    discountApply.disabled = true;
    try {
      const country = config.getLocale();
      await estimatePrice(country, cart.getItemsForAPI(), code);
      sessionStorage.setItem('checkout_coupon_code', code);
      showDiscountRow(code);
    } catch (err) {
      couponErrorEl.textContent = getCouponErrorMessage(err?.errorHeader);
      couponErrorEl.hidden = false;
    } finally {
      discountApply.disabled = false;
    }
  });

  // 5. Build express-checkout callbacks, load SDKs, render available wallet buttons
  const state = { currentEstimateToken: null, currentPreview: null };

  const callbacks = {
    getCart: () => cart,
    getConfig: () => config,
    getState: () => state,
    strings: getStrings(),
    previewOrderDirect: async (body) => {
      const couponCode = sessionStorage.getItem('checkout_coupon_code') || undefined;
      try {
        const result = await previewOrder({ ...body, ...(couponCode ? { couponCode } : {}) });
        if (result.estimateToken) state.currentEstimateToken = result.estimateToken;
        state.currentPreview = result;
        return result;
      } catch (err) {
        if (COUPON_ERRORS.has(err?.errorHeader)) {
          sessionStorage.removeItem('checkout_coupon_code');
          discountInput.value = '';
          hideDiscountRow();
          couponErrorEl.textContent = getCouponErrorMessage(err.errorHeader);
          couponErrorEl.hidden = false;
        }
        throw err;
      }
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

  if (getLocaleAndLanguage().locale === 'us') {
    const promoEl = block.querySelector('.cart-summary-promo');
    const returnedCoupon = initIDMe(promoEl, discountInput);
    if (returnedCoupon) {
      showDiscountRow(returnedCoupon);
    }
  }
}
