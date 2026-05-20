import { loadCSS } from '../../scripts/aem.js';
import cart from '../../scripts/cart.js';
import { getConfig, formatPrice } from '../../scripts/commerce-config.js';
import buildCartItem from '../../scripts/commerce/cart-item.js';
import { parsePreview } from '../../scripts/commerce-api.js';

function getStrings() {
  return getConfig().getStrings();
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
    </div>
    <div class="order-summary-totals">
      <div class="order-summary-row">
        <span>${s.subtotal}</span>
        <span class="order-summary-subtotal"></span>
      </div>
      <div class="order-summary-discounts"></div>
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
  currencyEl.textContent = getCurrencyCode();

  const showPendingDiscount = (code) => {
    discountsEl.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'order-summary-row order-summary-discount-item order-summary-discount-pending';
    const label = document.createElement('span');
    label.textContent = `${s.discount} (${code})`;
    const amount = document.createElement('span');
    amount.className = 'order-summary-discount-amount';
    amount.textContent = '--';
    row.append(label, amount);
    discountsEl.appendChild(row);
  };

  const savedCoupon = sessionStorage.getItem('checkout_coupon_code') || '';
  if (savedCoupon) {
    discountInput.value = savedCoupon;
    showPendingDiscount(savedCoupon);
  }

  discountApply.addEventListener('click', () => {
    const code = discountInput.value.trim();
    if (code) {
      sessionStorage.setItem('checkout_coupon_code', code);
      showPendingDiscount(code);
      discountApply.textContent = s.applied;
      discountApply.disabled = true;
      setTimeout(() => {
        discountApply.textContent = s.apply;
        discountApply.disabled = false;
      }, 2000);
    } else {
      sessionStorage.removeItem('checkout_coupon_code');
      discountsEl.innerHTML = '';
    }
    document.dispatchEvent(new CustomEvent('checkout:coupon-apply'));
  });

  const renderItems = () => {
    itemsList.innerHTML = '';
    const currencyCode = getCurrencyCode();

    cart.items
      .filter((item) => item.custom?.showInCart !== false)
      .forEach((item) => {
        const linkedWarranty = cart.items
          .find((i) => i.custom?.linkedTo === item.sku) || null;

        const itemEl = buildCartItem(
          item,
          {
            onQtyChange: (sku, qty) => {
              cart.updateItem(sku, qty);
              if (linkedWarranty) cart.updateItem(linkedWarranty.sku, qty);
            },
            onRemove: (sku) => {
              if (linkedWarranty) cart.removeItem(linkedWarranty.sku);
              cart.removeItem(sku);
            },
            currencyCode,
            linkedWarranty,
            onSelectWarranty: (tier) => {
              if (linkedWarranty) cart.removeItem(linkedWarranty.sku);
              if (tier && !tier.isDefault && parseFloat(tier.price) > 0) {
                cart.addItem({
                  sku: tier.sku,
                  quantity: item.quantity,
                  price: tier.price,
                  name: tier.name,
                  custom: { linkedTo: item.sku, showInCart: false },
                });
              }
            },
          },
          {
            remove: s.remove,
            removeItem: s.removeItem,
            warranty: s.warranty,
            included: s.included,
          },
        );
        itemsList.appendChild(itemEl);
      });
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

  renderItems();
  updateTotals();

  const wrapper = block.closest('.order-summary-wrapper');
  const syncVisibility = () => {
    const visible = cart.items.filter((i) => i.custom?.showInCart !== false);
    wrapper?.toggleAttribute('hidden', visible.length === 0);
  };

  document.addEventListener('cart:change', () => {
    renderItems();
    updateTotals();
    syncVisibility();
  });

  const summaryContent = block.querySelector('.order-summary-content');
  document.addEventListener('checkout:preview-loading', () => {
    summaryContent?.classList.add('loading');
  });

  document.addEventListener('checkout:preview', (e) => {
    summaryContent?.classList.remove('loading');
    const { preview } = e.detail || {};
    if (!preview) return;

    const {
      subtotal, taxAmount, shippingRate, total, discounts,
    } = parsePreview(preview, cart.subtotal);

    const currency = getCurrencyCode();
    subtotalEl.textContent = formatPrice(subtotal, currency);

    discountsEl.innerHTML = '';
    discounts.filter((d) => !d.freeShipping && d.amount > 0).forEach((d) => {
      const row = document.createElement('div');
      row.className = 'order-summary-row order-summary-discount-item';
      const label = document.createElement('span');
      label.textContent = d.name || s.discount;
      const amount = document.createElement('span');
      amount.className = 'order-summary-discount-amount';
      amount.textContent = `-${formatPrice(d.amount, currency)}`;
      row.append(label, amount);
      discountsEl.appendChild(row);
    });

    shippingEl.textContent = shippingRate === 0
      ? s.free
      : formatPrice(parseFloat(shippingRate), currency);
    taxesEl.textContent = formatPrice(taxAmount, currency);
    grandTotalEl.textContent = formatPrice(total, currency);
    headerTotalEl.textContent = formatPrice(total, currency);
  });

  syncVisibility();
  initMobileCollapse(block);
}
