import { loadCSS } from '../../scripts/aem.js';
import { getConfig, formatPrice, formatPriceAmount } from '../../scripts/commerce-config.js';
import cart from '../../scripts/cart.js';
import {
  previewOrder, createOrder, initiatePayment, estimatePrice,
} from '../../scripts/commerce-api.js';
import applePay from '../../scripts/payments/apple-pay.js';
import googlePay from '../../scripts/payments/google-pay.js';
import paypal from '../../scripts/payments/paypal.js';
import { getActiveProviders } from '../checkout/checkout-payment.js';
import { initIDMe, syncIDMeVisibility } from '../../scripts/commerce/idme.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';
import {
  getCoupons, getManualCoupon, getAutoCoupons, setManualCoupon, removeCoupon,
  getCouponRequestFields, clearCoupons,
} from '../../scripts/commerce/coupon-state.js';
import { renderCouponPills, renderCouponStatus, couponCodeFromDiscount } from '../../scripts/commerce/coupon-ui.js';

const ALL_PROVIDERS = [applePay, googlePay, paypal];

const LOCAL_STRINGS = {
  'en-us': {
    havePromoCode: 'Have a promo code?',
    shippingPlaceholder: 'Calculated at checkout',
    checkoutSecurely: 'Checkout securely',
    applied: 'Code saved',
    discountPending: 'Applied at checkout',
    removeCoupon: 'Remove coupon',
    couponRejectedInvalid: 'isn\'t a valid coupon code.',
    couponRejectedNotCombinable: 'can\'t be combined with your other offers.',
  },
  'fr-ca': {
    havePromoCode: 'Vous avez un code promo?',
    shippingPlaceholder: 'Calculée à la caisse',
    checkoutSecurely: 'Payer en toute sécurité',
    applied: 'Code sauvegardé',
    discountPending: 'Appliqué à la caisse',
    removeCoupon: 'Retirer le coupon',
    couponRejectedInvalid: 'n\'est pas un code promo valide.',
    couponRejectedNotCombinable: 'ne peut pas être combiné avec vos autres offres.',
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
        <div class="coupon-pills" hidden></div>
        <p class="cart-summary-coupon-error" hidden></p>
        <div class="coupon-status" hidden></div>
      </div>
    </div>
    <div class="cart-summary-totals">
      <div class="cart-summary-row">
        <span>${s.subtotal}</span>
        <span class="cart-summary-subtotal"></span>
      </div>
      <div class="cart-summary-discounts" hidden></div>
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
  const discountsEl = block.querySelector('.cart-summary-discounts');
  const pillsEl = block.querySelector('.coupon-pills');
  const statusEl = block.querySelector('.coupon-status');
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
    const currency = getCurrencyCode();
    subtotalEl.textContent = formatPrice(cart.subtotal, currency);
    grandTotalEl.textContent = formatPriceAmount(cart.subtotal, currency);
  };
  updateTotals();
  document.addEventListener('cart:change', updateTotals);

  // 4. Restore saved coupons; persist via the coupon-state store on apply.

  // Clears the manual coupon (keeps auto coupons) and re-syncs every block.
  const removeManualCoupon = () => {
    setManualCoupon('');
    discountInput.value = '';
    couponErrorEl.hidden = true;
    document.dispatchEvent(new CustomEvent('checkout:coupon-apply'));
  };

  // Removable pills for auto/verified coupons; the input only holds the manual one.
  const renderPills = () => renderCouponPills(pillsEl, getAutoCoupons(), (code) => {
    removeCoupon(code);
    document.dispatchEvent(new CustomEvent('checkout:coupon-apply'));
  }, s);

  // A remove button appears only on the manual coupon's row; auto coupons are
  // removed via their pill.
  const makeRemoveBtn = () => {
    const btn = document.createElement('button');
    btn.className = 'discount-remove';
    btn.setAttribute('aria-label', s.removeCoupon || 'Remove coupon');
    btn.textContent = '×';
    btn.addEventListener('click', removeManualCoupon);
    return btn;
  };

  const buildDiscountRow = (labelText, amountText, removable, extraClass = '') => {
    const row = document.createElement('div');
    row.className = `cart-summary-row cart-summary-discount-item${extraClass ? ` ${extraClass}` : ''}`;
    const amount = document.createElement('span');
    amount.textContent = amountText;
    const labelGroup = document.createElement('span');
    labelGroup.className = 'discount-label-group';
    const label = document.createElement('span');
    label.textContent = labelText;
    labelGroup.append(label);
    if (removable) labelGroup.append(makeRemoveBtn());
    row.append(labelGroup, amount);
    return row;
  };

  const renderDiscountRows = (discounts, currency) => {
    discountsEl.innerHTML = '';
    const manualCode = getManualCoupon().toLowerCase();
    const rows = discounts.filter((d) => parseFloat(d.amount) > 0);
    discountsEl.hidden = rows.length === 0;
    rows.forEach((d) => {
      const code = couponCodeFromDiscount(d);
      const removable = !!code && code.toLowerCase() === manualCode;
      const label = code ? `${s.discount} (${code})` : (d.name || s.discount);
      discountsEl.appendChild(buildDiscountRow(
        label,
        `-${formatPrice(parseFloat(d.amount), currency)}`,
        removable,
      ));
    });
  };

  // Placeholder rows (one per stored coupon) shown while an estimate is in flight.
  const showPendingDiscounts = () => {
    const coupons = getCoupons();
    discountsEl.innerHTML = '';
    discountsEl.hidden = coupons.length === 0;
    coupons.forEach(({ code, source }) => {
      discountsEl.appendChild(buildDiscountRow(
        `${s.discount} (${code})`,
        s.discountPending,
        source !== 'auto',
        'cart-summary-discount-pending',
      ));
    });
  };

  // Renders per-code rejection feedback and rolls back an invalid manual code so
  // it is not persisted or left in the input.
  const handleCouponStatus = (couponStatus) => {
    renderCouponStatus(statusEl, couponStatus, s);
    const manual = getManualCoupon();
    if (!manual) return;
    const entry = (couponStatus || []).find(
      (e) => e.code?.toLowerCase() === manual.toLowerCase(),
    );
    if (entry?.status === 'rejected_invalid') {
      setManualCoupon('');
      discountInput.value = '';
    }
  };

  let priceEstimateRequest = 0;
  const renderPriceEstimate = (estimate) => {
    const currency = getCurrencyCode();
    const subtotal = parseFloat(estimate.subtotal) || cart.subtotal;
    const discountTotal = parseFloat(estimate.orderDiscountTotal) || 0;
    const total = Math.max(0, subtotal - discountTotal);
    subtotalEl.textContent = formatPrice(subtotal, currency);
    grandTotalEl.textContent = formatPriceAmount(total, currency);
    renderDiscountRows(estimate.discounts ?? [], currency);
  };

  const updatePriceEstimate = async () => {
    renderPills();
    const { couponCode, couponSource } = getCouponRequestFields();
    if (!couponCode || !cart.itemCount) {
      discountsEl.innerHTML = '';
      discountsEl.hidden = true;
      renderCouponStatus(statusEl, [], s);
      updateTotals();
      return;
    }

    priceEstimateRequest += 1;
    const requestId = priceEstimateRequest;
    showPendingDiscounts();

    try {
      const estimate = await estimatePrice(
        config.getLocale(),
        cart.getItemsForAPI(),
        couponCode,
        couponSource,
      );
      if (requestId !== priceEstimateRequest) return;
      renderPriceEstimate(estimate);
      handleCouponStatus(estimate.couponStatus);
    } catch (err) {
      if (requestId !== priceEstimateRequest) return;
      // Only the single-string (legacy) contract throws a 422 for a bad coupon;
      // array input is tolerant. Drop the lone coupon and surface the error.
      if (getCoupons().length <= 1) {
        clearCoupons();
        discountInput.value = '';
        discountsEl.innerHTML = '';
        discountsEl.hidden = true;
        renderCouponStatus(statusEl, [], s);
        updateTotals();
        couponErrorEl.textContent = getCouponErrorMessage(err?.errorHeader);
        couponErrorEl.hidden = false;
        renderPills();
        document.dispatchEvent(new CustomEvent('checkout:coupon-apply'));
      } else {
        showPendingDiscounts();
      }
    }
  };

  document.addEventListener('cart:change', updatePriceEstimate);
  document.addEventListener('checkout:coupon-apply', () => {
    syncIDMeVisibility();
    renderPills();
    updatePriceEstimate();
  });

  const savedManual = getManualCoupon();
  if (savedManual) discountInput.value = savedManual;
  renderPills();
  if (getCoupons().length) {
    showPendingDiscounts();
    updatePriceEstimate();
  }

  discountApply.addEventListener('click', async () => {
    couponErrorEl.hidden = true;
    const code = discountInput.value.trim();
    if (!code) {
      removeManualCoupon();
      return;
    }

    discountApply.disabled = true;
    discountApply.classList.add('loading');
    try {
      // Validate the typed code on its own so a bad single code returns the
      // usual 422; if valid, store it and let the coupon-apply listener
      // re-estimate the full set (manual + any auto coupons).
      const country = config.getLocale();
      await estimatePrice(country, cart.getItemsForAPI(), code);
      setManualCoupon(code);
      syncIDMeVisibility();
      document.dispatchEvent(new CustomEvent('checkout:coupon-apply'));
    } catch (err) {
      couponErrorEl.textContent = getCouponErrorMessage(err?.errorHeader);
      couponErrorEl.hidden = false;
    } finally {
      discountApply.disabled = false;
      discountApply.classList.remove('loading');
    }
  });

  // 5. Build express-checkout callbacks, load SDKs, render available wallet buttons
  const state = { currentEstimateToken: null, currentEstimatePayload: null, currentPreview: null };

  // A cart or coupon change invalidates the wallet express estimate captured by
  // previewOrderDirect. Clear the token/payload/preview so a wallet approval can
  // never replay a stale snapshot (ordering the wrong items and clearing the
  // newly changed cart on success); the next wallet interaction re-previews.
  const invalidateExpressEstimate = () => {
    state.currentEstimateToken = null;
    state.currentEstimatePayload = null;
    state.currentPreview = null;
  };
  document.addEventListener('cart:change', invalidateExpressEstimate);
  document.addEventListener('checkout:coupon-apply', invalidateExpressEstimate);

  const callbacks = {
    expressEntryPoint: 'cart',
    getCart: () => cart,
    getConfig: () => config,
    getState: () => state,
    strings: getStrings(),
    previewOrderDirect: async (body) => {
      const estimatePayload = {
        ...body,
        ...(body.couponCode ? {} : getCouponRequestFields()),
      };
      try {
        const result = await previewOrder(estimatePayload);
        if (result.estimateToken) {
          // Retain the exact payload that minted this token so the wallet order
          // body can replay it verbatim (see buildExpressOrderPayload). Set as a
          // matched pair with the token so the two can never drift.
          state.currentEstimateToken = result.estimateToken;
          state.currentEstimatePayload = estimatePayload;
        }
        state.currentPreview = result;
        return result;
      } catch (err) {
        // A 422 coupon error only occurs on the single-string (legacy) contract;
        // array input is tolerant. Drop the lone coupon and surface the error.
        if (COUPON_ERRORS.has(err?.errorHeader) && getCoupons().length <= 1) {
          clearCoupons();
          discountInput.value = '';
          discountsEl.innerHTML = '';
          discountsEl.hidden = true;
          renderPills();
          couponErrorEl.textContent = getCouponErrorMessage(err.errorHeader);
          couponErrorEl.hidden = false;
          document.dispatchEvent(new CustomEvent('checkout:coupon-apply'));
        }
        throw err;
      }
    },
    createOrder: (orderBody) => createOrder(orderBody),
    initiatePayment: (...args) => initiatePayment(...args),
    // Persist the checkout session so the order-review page (express review
    // flow) can resolve the order via getOrder + the email proof. The express
    // onApprove handler calls this before routing to the review page; the
    // checkout-page flow provides the same callback from checkout-order.js.
    saveCheckoutSession: (email, c, preview, order) => {
      try {
        if (email) sessionStorage.setItem('checkout_email', email);
        sessionStorage.setItem('checkout_cart_items', JSON.stringify(c.items));
        if (preview) sessionStorage.setItem('checkout_preview', JSON.stringify(preview));
        if (order) sessionStorage.setItem('checkout_order', JSON.stringify(order));
      } catch { /* ignore */ }
    },
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
    const returnedCoupon = initIDMe(promoEl);
    if (returnedCoupon) {
      renderPills();
      updatePriceEstimate();
    }
  }
}
