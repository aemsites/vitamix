import { loadCSS } from '../../scripts/aem.js';
import cart from '../../scripts/cart.js';
import { getConfig, formatPrice } from '../../scripts/commerce-config.js';
import buildCartItem from '../../scripts/commerce/cart-item.js';
import { parsePreview } from '../../scripts/commerce-api.js';

loadCSS('/styles/commerce-tokens.css');

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

/**
 * @param {HTMLDivElement} block
 */
export default function decorate(block) {
  const s = getStrings();
  colocateWithForm(block);
  block.innerHTML = buildTemplate(s);

  const itemsList = block.querySelector('.order-summary-items');
  const subtotalEl = block.querySelector('.order-summary-subtotal');
  const shippingEl = block.querySelector('.order-summary-shipping');
  const taxesEl = block.querySelector('.order-summary-taxes');
  const grandTotalEl = block.querySelector('.order-summary-grand-total');
  const currencyEl = block.querySelector('.currency');
  currencyEl.textContent = getCurrencyCode();

  const renderItems = () => {
    itemsList.innerHTML = '';

    cart.items.forEach((item) => {
      const itemEl = buildCartItem(
        item,
        {
          onQtyChange: (sku, qty) => cart.updateItem(sku, qty),
          onRemove: (sku) => cart.removeItem(sku),
          currencyCode: getCurrencyCode(),
        },
        { remove: s.remove, removeItem: s.removeItem },
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
  };

  renderItems();
  updateTotals();

  const wrapper = block.closest('.order-summary-wrapper');
  const syncVisibility = () => {
    wrapper?.toggleAttribute('hidden', cart.items.length === 0);
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
      subtotal, taxAmount, shippingRate, total,
    } = parsePreview(preview, cart.subtotal);

    const currency = getCurrencyCode();
    subtotalEl.textContent = formatPrice(subtotal, currency);
    shippingEl.textContent = shippingRate === 0
      ? s.free
      : formatPrice(parseFloat(shippingRate), currency);
    taxesEl.textContent = formatPrice(taxAmount, currency);
    grandTotalEl.textContent = formatPrice(total, currency);
  });

  syncVisibility();
}
