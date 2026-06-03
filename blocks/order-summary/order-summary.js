import { loadCSS } from '../../scripts/aem.js';
import cart from '../../scripts/cart.js';
import { getConfig, formatPrice } from '../../scripts/commerce-config.js';
import buildCartItem, { buildGiftItem } from '../../scripts/commerce/cart-item.js';
import buildWarrantySelector from '../cart/warranty-selector.js';
import { parsePreview, estimatePrice } from '../../scripts/commerce-api.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';
import { initIDMe, syncIDMeVisibility } from '../../scripts/commerce/idme.js';

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

function getStrings() {
  return getConfig().getStrings();
}

function getCouponErrorMessage(errorCode) {
  const { locale } = getLocaleAndLanguage();
  const lang = locale === 'ca' ? 'fr-ca' : 'en-us';
  const msgs = COUPON_ERROR_MESSAGES[lang] || COUPON_ERROR_MESSAGES['en-us'];
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
      <p class="order-summary-coupon-error" hidden></p>
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
  currencyEl.textContent = getCurrencyCode();

  const removeCoupon = () => {
    sessionStorage.removeItem('checkout_coupon_code');
    sessionStorage.removeItem('checkout_coupon_source');
    discountInput.value = '';
    discountsEl.innerHTML = '';
    discountsEl.hidden = true;
    couponErrorEl.hidden = true;
    document.dispatchEvent(new CustomEvent('checkout:coupon-apply'));
  };

  const makeRemoveBtn = () => {
    const btn = document.createElement('button');
    btn.className = 'discount-remove';
    btn.setAttribute('aria-label', 'Remove coupon');
    btn.textContent = '×';
    btn.addEventListener('click', removeCoupon);
    return btn;
  };

  const renderDiscountRows = (discounts, currency) => {
    discountsEl.innerHTML = '';
    discountsEl.hidden = true;
    discounts.filter((d) => parseFloat(d.amount) > 0).forEach((d) => {
      discountsEl.hidden = false;
      const row = document.createElement('div');
      row.className = 'order-summary-row order-summary-discount-item';
      const amount = document.createElement('span');
      amount.className = 'order-summary-discount-amount';
      amount.textContent = `-${formatPrice(parseFloat(d.amount), currency)}`;

      if (d.source === 'coupon') {
        const labelGroup = document.createElement('span');
        labelGroup.className = 'discount-label-group';
        const label = document.createElement('span');
        label.textContent = d.name || s.discount;
        labelGroup.append(label, makeRemoveBtn());
        row.append(labelGroup, amount);
      } else {
        const label = document.createElement('span');
        label.textContent = d.name || s.discount;
        row.append(label, amount);
      }
      discountsEl.appendChild(row);
    });
  };

  const showPendingDiscount = (code) => {
    discountsEl.innerHTML = '';
    discountsEl.hidden = false;
    const row = document.createElement('div');
    row.className = 'order-summary-row order-summary-discount-item order-summary-discount-pending';
    const labelGroup = document.createElement('span');
    labelGroup.className = 'discount-label-group';
    const label = document.createElement('span');
    label.textContent = `${s.discount} (${code})`;
    labelGroup.append(label, makeRemoveBtn());
    const amount = document.createElement('span');
    amount.className = 'order-summary-discount-amount';
    amount.textContent = '--';
    row.append(labelGroup, amount);
    discountsEl.appendChild(row);
  };

  const updateTotals = () => {
    const currency = getCurrencyCode();
    const subtotal = formatPrice(cart.subtotal, currency);
    subtotalEl.textContent = subtotal;
    shippingEl.textContent = '--';
    taxesEl.textContent = '--';
    grandTotalEl.textContent = subtotal;
    headerTotalEl.textContent = subtotal;
  };

  let priceEstimateRequest = 0;
  let hasOrderPreview = false;
  const renderPriceEstimate = (estimate) => {
    if (hasOrderPreview) return;
    const currency = getCurrencyCode();
    const subtotal = parseFloat(estimate.subtotal) || cart.subtotal;
    const discountTotal = parseFloat(estimate.orderDiscountTotal) || 0;
    const total = Math.max(0, subtotal - discountTotal);
    subtotalEl.textContent = formatPrice(subtotal, currency);
    renderDiscountRows(estimate.discounts ?? [], currency);
    shippingEl.textContent = '--';
    taxesEl.textContent = '--';
    grandTotalEl.textContent = formatPrice(total, currency);
    headerTotalEl.textContent = formatPrice(total, currency);
  };

  const updatePriceEstimate = async () => {
    const couponCode = sessionStorage.getItem('checkout_coupon_code') || '';
    const couponSource = sessionStorage.getItem('checkout_coupon_source') || undefined;
    if (!couponCode || !cart.itemCount) {
      discountsEl.innerHTML = '';
      discountsEl.hidden = true;
      updateTotals();
      return;
    }

    priceEstimateRequest += 1;
    const requestId = priceEstimateRequest;
    showPendingDiscount(couponCode);

    try {
      const estimate = await estimatePrice(
        getLocaleAndLanguage().locale,
        cart.getItemsForAPI(),
        couponCode,
        couponSource,
      );
      if (requestId !== priceEstimateRequest) return;
      renderPriceEstimate(estimate);
    } catch {
      if (requestId === priceEstimateRequest) showPendingDiscount(couponCode);
    }
  };

  const savedCoupon = sessionStorage.getItem('checkout_coupon_code') || '';
  const savedCouponSource = sessionStorage.getItem('checkout_coupon_source') || '';
  if (savedCoupon) {
    if (savedCouponSource !== 'auto') discountInput.value = savedCoupon;
    showPendingDiscount(savedCoupon);
  }

  discountApply.addEventListener('click', async () => {
    couponErrorEl.hidden = true;
    const code = discountInput.value.trim();
    const existingCouponSource = sessionStorage.getItem('checkout_coupon_source') || '';
    if (!code) {
      if (existingCouponSource !== 'auto') {
        sessionStorage.removeItem('checkout_coupon_code');
        sessionStorage.removeItem('checkout_coupon_source');
        discountsEl.innerHTML = '';
        discountsEl.hidden = true;
      }
      return;
    }

    discountApply.disabled = true;
    try {
      const country = getLocaleAndLanguage().locale;
      const estimate = await estimatePrice(country, cart.getItemsForAPI(), code);
      sessionStorage.setItem('checkout_coupon_code', code);
      sessionStorage.removeItem('checkout_coupon_source');
      renderPriceEstimate(estimate);
      document.dispatchEvent(new CustomEvent('checkout:coupon-apply'));
    } catch (err) {
      couponErrorEl.textContent = getCouponErrorMessage(err?.errorHeader);
      couponErrorEl.hidden = false;
    } finally {
      discountApply.disabled = false;
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
    updateTotals();
    updatePriceEstimate();
    syncVisibility();
  };

  document.addEventListener('cart:change', refreshSummary);
  document.addEventListener('cart:limit', refreshSummary);
  document.addEventListener('checkout:coupon-apply', () => {
    syncIDMeVisibility();
    const couponCode = sessionStorage.getItem('checkout_coupon_code') || '';
    const couponSource = sessionStorage.getItem('checkout_coupon_source') || '';
    if (!couponCode || couponSource === 'auto') updatePriceEstimate();
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

    if (couponError) {
      sessionStorage.removeItem('checkout_coupon_source');
      discountsEl.innerHTML = '';
      discountInput.value = '';
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

    shippingEl.textContent = shippingRate === 0
      ? s.free
      : formatPrice(parseFloat(shippingRate), currency);
    taxesEl.textContent = formatPrice(taxAmount, currency);
    grandTotalEl.textContent = formatPrice(total, currency);
    headerTotalEl.textContent = formatPrice(total, currency);
  });

  syncVisibility();
  initMobileCollapse(block);
  if (getLocaleAndLanguage().locale === 'us') {
    initIDMe(block.querySelector('.order-summary-discount'));
  }
}
