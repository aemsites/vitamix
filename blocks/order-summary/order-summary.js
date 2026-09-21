import { loadCSS } from '../../scripts/aem.js';
import cart from '../../scripts/cart.js';
import { getConfig, formatPrice, formatPriceAmount } from '../../scripts/commerce-config.js';
import buildCartItem, { buildGiftItem } from '../../scripts/commerce/cart-item.js';
import buildWarrantySelector from '../cart/warranty-selector.js';
import { parsePreview, estimatePrice } from '../../scripts/commerce-api.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';
import { initIDMe, syncIDMeVisibility } from '../../scripts/commerce/idme.js';
import {
  getCoupons, getManualCoupon, getAutoCoupons, setManualCoupon, removeCoupon,
  getCouponRequestFields, clearCoupons,
} from '../../scripts/commerce/coupon-state.js';
import { renderCouponPills, renderCouponStatus, couponCodeFromDiscount } from '../../scripts/commerce/coupon-ui.js';

const LOCAL_STRINGS = {
  'en-us': {
    removeCoupon: 'Remove coupon',
    couponRejectedInvalid: 'isn\'t a valid coupon code.',
    couponRejectedNotCombinable: 'can\'t be combined with your other offers.',
  },
  'fr-ca': {
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

function getLang() {
  return getLocaleAndLanguage().locale === 'ca' ? 'fr-ca' : 'en-us';
}

function getStrings() {
  return { ...getConfig().getStrings(), ...(LOCAL_STRINGS[getLang()] || LOCAL_STRINGS['en-us']) };
}

function getCouponErrorMessage(errorCode) {
  const msgs = COUPON_ERROR_MESSAGES[getLang()] || COUPON_ERROR_MESSAGES['en-us'];
  return msgs[errorCode] || msgs.default;
}

function getCurrencyCode() {
  const { currency, getLocale } = getConfig();
  return typeof currency === 'function' ? currency(getLocale()) : currency;
}

function buildTemplate(s) {
  return /* html */`
<div class="order-summary">
  <div class="order-summary-header">
    <h3>${s.orderSummary}</h3>
    <span class="order-summary-header-total"></span>
    <button class="order-summary-toggle" aria-expanded="false" aria-label="Toggle order summary">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </button>
  </div>
  <div class="order-summary-content">
    <div class="order-summary-items"></div>
    <div class="order-summary-discount">
      <input type="text" placeholder="${s.discountPlaceholder}" class="discount-input">
      <button class="discount-apply">${s.apply}</button>
      <div class="coupon-pills" hidden></div>
      <p class="order-summary-coupon-error" hidden></p>
      <div class="coupon-status" hidden></div>
    </div>
    <div class="order-summary-totals">
      <div class="order-summary-row">
        <span>${s.subtotal}</span>
        <span class="order-summary-subtotal"></span>
      </div>
      <div class="order-summary-discounts" hidden></div>
      <div class="order-summary-row">
        <span>${s.shipping}</span>
        <span class="order-summary-shipping"></span>
      </div>
      <div class="order-summary-row">
        <span>${s.estimatedTaxes}</span>
        <span class="order-summary-taxes"></span>
      </div>
      <div class="order-summary-row order-summary-final">
        <strong>${s.total}</strong>
        <div class="order-summary-final-amount">
          <span class="currency"></span>
          <strong class="order-summary-grand-total"></strong>
        </div>
      </div>
    </div>
  </div>
</div>
`;
}

/**
 * If the order-summary is authored in its own section (separate from the
 * cart/checkout block), move its wrapper into the adjacent form section so
 * the CSS :has(.order-summary-wrapper) two-column layout rule fires correctly.
 * @param {HTMLDivElement} block
 */
function colocateWithForm(block) {
  const wrapper = block.closest('.order-summary-wrapper');
  const mySection = wrapper?.closest('.section');
  if (!wrapper || !mySection) return;

  // Already co-located — nothing to do
  if (mySection.querySelector('.checkout-wrapper, .cart-wrapper')) return;

  const main = mySection.closest('main') || document;
  const target = [...main.querySelectorAll('.section')]
    .find((s) => s !== mySection && s.querySelector('.checkout-wrapper, .cart-wrapper'));
  if (!target) return;

  target.appendChild(wrapper);
  // Remove the now-empty section to avoid stray margins
  if (!mySection.children.length) mySection.remove();
}

function initMobileCollapse(block) {
  const summary = block.querySelector('.order-summary');
  const toggle = block.querySelector('.order-summary-toggle');
  const content = block.querySelector('.order-summary-content');
  if (!summary || !toggle || !content) return;

  const mq = window.matchMedia('(max-width: 999px)');

  // Measure natural padding once before any inline overrides.
  const cs = window.getComputedStyle(content);
  const naturalPT = parseFloat(cs.paddingTop);
  const naturalPB = parseFloat(cs.paddingBottom);

  const setCollapsed = (instant) => {
    if (instant) content.style.transition = 'none';
    content.style.height = '0';
    content.style.paddingTop = '0';
    content.style.paddingBottom = '0';
    if (instant) {
      content.getBoundingClientRect();
      content.style.transition = '';
    }
  };

  const setExpanded = (instant) => {
    if (instant) content.style.transition = 'none';
    content.style.height = '';
    content.style.paddingTop = '';
    content.style.paddingBottom = '';
    if (instant) {
      content.getBoundingClientRect();
      content.style.transition = '';
    }
  };

  const expand = () => {
    // paddingTop/Bottom are currently '0' inline; scrollHeight is content-only.
    const targetHeight = content.scrollHeight + naturalPT + naturalPB;
    content.style.height = `${targetHeight}px`;
    content.style.paddingTop = `${naturalPT}px`;
    content.style.paddingBottom = `${naturalPB}px`;
    content.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'height') setExpanded(false);
    }, { once: true });
  };

  toggle.addEventListener('click', () => {
    if (summary.classList.contains('is-collapsed')) {
      summary.classList.remove('is-collapsed');
      toggle.setAttribute('aria-expanded', 'true');
      expand();
    } else {
      // Lock current pixel values so the transition has an explicit start point.
      content.style.height = `${content.scrollHeight}px`;
      content.style.paddingTop = `${naturalPT}px`;
      content.style.paddingBottom = `${naturalPB}px`;
      content.getBoundingClientRect();
      summary.classList.add('is-collapsed');
      toggle.setAttribute('aria-expanded', 'false');
      content.getBoundingClientRect();
      setCollapsed(false);
    }
  });

  mq.addEventListener('change', (e) => {
    if (e.matches) {
      summary.classList.add('is-collapsed');
      toggle.setAttribute('aria-expanded', 'false');
      setCollapsed(true);
    } else {
      summary.classList.remove('is-collapsed');
      toggle.setAttribute('aria-expanded', 'true');
      setExpanded(true);
    }
  });

  summary.classList.add('is-collapsed');
  toggle.setAttribute('aria-expanded', 'false');
  setCollapsed(true);
  if (!mq.matches) {
    summary.classList.remove('is-collapsed');
    toggle.setAttribute('aria-expanded', 'true');
    setExpanded(true);
  }
}

/**
 * @param {HTMLDivElement} block
 */
export default async function decorate(block) {
  await loadCSS('/styles/commerce-tokens.css');
  const s = getStrings();
  colocateWithForm(block);
  block.innerHTML = buildTemplate(s);

  const itemsList = block.querySelector('.order-summary-items');
  const subtotalEl = block.querySelector('.order-summary-subtotal');
  const shippingEl = block.querySelector('.order-summary-shipping');
  const taxesEl = block.querySelector('.order-summary-taxes');
  const grandTotalEl = block.querySelector('.order-summary-grand-total');
  const headerTotalEl = block.querySelector('.order-summary-header-total');
  const currencyEl = block.querySelector('.currency');
  const discountInput = block.querySelector('.discount-input');
  const discountApply = block.querySelector('.discount-apply');
  const discountsEl = block.querySelector('.order-summary-discounts');
  const couponErrorEl = block.querySelector('.order-summary-coupon-error');
  const pillsEl = block.querySelector('.coupon-pills');
  const statusEl = block.querySelector('.coupon-status');
  currencyEl.textContent = getCurrencyCode();

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
    row.className = `order-summary-row order-summary-discount-item${extraClass ? ` ${extraClass}` : ''}`;
    const amount = document.createElement('span');
    amount.className = 'order-summary-discount-amount';
    amount.textContent = amountText;
    if (removable) {
      const labelGroup = document.createElement('span');
      labelGroup.className = 'discount-label-group';
      const label = document.createElement('span');
      label.textContent = labelText;
      labelGroup.append(label, makeRemoveBtn());
      row.append(labelGroup, amount);
    } else {
      const label = document.createElement('span');
      label.textContent = labelText;
      row.append(label, amount);
    }
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
      discountsEl.appendChild(buildDiscountRow(
        d.name || s.discount,
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
        '--',
        source !== 'auto',
        'order-summary-discount-pending',
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
  let hasOrderPreview = false;
  let estimatedSubtotal = cart.subtotal;
  let estimatedDiscountTotal = 0;
  let estimatedShippingMethod = null;

  const renderEstimatedTotals = () => {
    if (hasOrderPreview) return;
    const currency = getCurrencyCode();
    const shippingRate = estimatedShippingMethod
      ? parseFloat(estimatedShippingMethod.rate) || 0
      : null;
    const total = Math.max(
      0,
      estimatedSubtotal - estimatedDiscountTotal + (shippingRate ?? 0),
    );

    subtotalEl.textContent = formatPrice(estimatedSubtotal, currency);
    if (shippingRate == null) {
      shippingEl.textContent = '--';
    } else {
      shippingEl.textContent = shippingRate === 0 ? s.free : formatPrice(shippingRate, currency);
    }
    taxesEl.textContent = '--';
    grandTotalEl.textContent = formatPriceAmount(total, currency);
    headerTotalEl.textContent = formatPrice(total, currency);
  };

  const updateTotals = ({ resetShipping = false } = {}) => {
    estimatedSubtotal = cart.subtotal;
    estimatedDiscountTotal = 0;
    if (resetShipping) estimatedShippingMethod = null;
    renderEstimatedTotals();
  };

  const renderPriceEstimate = (estimate) => {
    if (hasOrderPreview) return;
    const currency = getCurrencyCode();
    estimatedSubtotal = parseFloat(estimate.subtotal) || cart.subtotal;
    estimatedDiscountTotal = parseFloat(estimate.orderDiscountTotal) || 0;
    subtotalEl.textContent = formatPrice(estimatedSubtotal, currency);
    renderDiscountRows(estimate.discounts ?? [], currency);
    renderEstimatedTotals();
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
        getLocaleAndLanguage().locale,
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
        couponErrorEl.textContent = getCouponErrorMessage(err?.errorHeader);
        couponErrorEl.hidden = false;
        renderPills();
      } else {
        showPendingDiscounts();
      }
    }
  };

  const savedManual = getManualCoupon();
  if (savedManual) discountInput.value = savedManual;
  renderPills();
  if (getCoupons().length) showPendingDiscounts();

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
      const country = getLocaleAndLanguage().locale;
      await estimatePrice(country, cart.getItemsForAPI(), code);
      setManualCoupon(code);
      document.dispatchEvent(new CustomEvent('checkout:coupon-apply'));
    } catch (err) {
      couponErrorEl.textContent = getCouponErrorMessage(err?.errorHeader);
      couponErrorEl.hidden = false;
    } finally {
      discountApply.disabled = false;
      discountApply.classList.remove('loading');
    }
  });

  const renderItems = () => {
    itemsList.innerHTML = '';
    const currencyCode = getCurrencyCode();

    cart.items
      .filter((item) => item.local?.showInCart !== false)
      // Free gifts always render last, regardless of insertion order.
      .slice()
      .sort((a, b) => (a.custom?.giftWithPurchase ? 1 : 0) - (b.custom?.giftWithPurchase ? 1 : 0))
      .forEach((item) => {
        if (item.custom?.giftWithPurchase) {
          itemsList.appendChild(buildGiftItem(item, {
            currencyCode,
            freeGift: s.freeGift,
            free: s.free,
          }));
          return;
        }

        const linkedWarranty = cart.items
          .find((i) => i.custom?.linkedTo === item.sku) || null;

        const extraContent = buildWarrantySelector(
          item,
          linkedWarranty,
          (tier) => {
            if (linkedWarranty) {
              cart.removeItem(linkedWarranty.sku, linkedWarranty.custom?.linkedTo);
            }
            if (tier && !tier.isDefault && parseFloat(tier.price) > 0) {
              cart.addItem({
                sku: tier.sku,
                path: tier.path,
                quantity: item.quantity,
                price: tier.price,
                name: tier.name,
                custom: {
                  linkedTo: item.sku,
                  ...(tier.coverageYears ? { coverageYears: tier.coverageYears } : {}),
                },
                local: { showInCart: false },
              }, { allowSeparateEntry: true });
            }
          },
          currencyCode,
          { heading: s.warranty, included: s.included },
        );

        const itemEl = buildCartItem(
          item,
          {
            onQtyChange: (sku, qty) => {
              cart.updateItem(sku, qty);
              if (linkedWarranty) cart.updateItem(linkedWarranty.sku, qty);
            },
            onRemove: (sku) => {
              if (linkedWarranty) {
                cart.removeItem(linkedWarranty.sku, linkedWarranty.custom?.linkedTo);
              }
              cart.removeItem(sku);
            },
            currencyCode,
            extraContent,
          },
          { remove: s.remove, removeItem: s.removeItem },
        );
        itemsList.appendChild(itemEl);
      });
  };

  renderItems();
  updateTotals();
  updatePriceEstimate();

  const wrapper = block.closest('.order-summary-wrapper');
  const syncVisibility = () => {
    const visible = cart.items.filter((i) => i.local?.showInCart !== false);
    wrapper?.toggleAttribute('hidden', visible.length === 0);
  };

  const refreshSummary = () => {
    renderItems();
    updateTotals({ resetShipping: true });
    updatePriceEstimate();
    syncVisibility();
  };

  document.addEventListener('cart:change', refreshSummary);
  document.addEventListener('cart:limit', refreshSummary);
  document.addEventListener('checkout:coupon-apply', () => {
    syncIDMeVisibility();
    renderPills();
    updatePriceEstimate();
  });

  document.addEventListener('checkout:shipping-selected', (e) => {
    if (hasOrderPreview) return;
    estimatedShippingMethod = e.detail?.shippingMethod || null;
    renderEstimatedTotals();
  });

  const summaryContent = block.querySelector('.order-summary-content');
  document.addEventListener('checkout:preview-loading', () => {
    hasOrderPreview = true;
    summaryContent?.classList.add('loading');
  });

  document.addEventListener('checkout:preview', (e) => {
    summaryContent?.classList.remove('loading');
    const { preview, couponError } = e.detail || {};
    hasOrderPreview = Boolean(preview);
    if (!preview) renderEstimatedTotals();
    renderPills();

    if (couponError) {
      // checkout-shipping already cleared a lone (single-string) coupon; reflect
      // that here and surface the error.
      discountInput.value = getManualCoupon();
      discountsEl.innerHTML = '';
      discountsEl.hidden = true;
      renderCouponStatus(statusEl, [], s);
      couponErrorEl.textContent = getCouponErrorMessage(couponError);
      couponErrorEl.hidden = false;
      syncIDMeVisibility();
      return;
    }

    couponErrorEl.hidden = true;
    if (!preview) return;

    const {
      subtotal, taxAmount, shippingRate, total, discounts,
    } = parsePreview(preview, cart.subtotal);

    const currency = getCurrencyCode();
    subtotalEl.textContent = formatPrice(subtotal, currency);

    renderDiscountRows(discounts, currency);
    handleCouponStatus(preview.couponStatus);

    shippingEl.textContent = shippingRate === 0
      ? s.free
      : formatPrice(parseFloat(shippingRate), currency);
    taxesEl.textContent = formatPrice(taxAmount, currency);
    grandTotalEl.textContent = formatPriceAmount(total, currency);
    headerTotalEl.textContent = formatPrice(total, currency);
  });

  syncVisibility();
  initMobileCollapse(block);
  if (getLocaleAndLanguage().locale === 'us') {
    initIDMe(block.querySelector('.order-summary-discount'));
  }
}
