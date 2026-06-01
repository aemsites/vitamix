import { loadCSS, createOptimizedPicture } from '../aem.js';
import { formatPrice, getConfig } from '../commerce-config.js';

loadCSS('/scripts/commerce/cart-item.css');

const getQtyLimitAlerts = () => {
  if (!window.cartQtyLimitAlerts) {
    window.cartQtyLimitAlerts = new Set();
  }
  return window.cartQtyLimitAlerts;
};

const TRASH_ICON = /* html */`<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14
    a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/>
</svg>`;

/**
 * Builds a cart row for a generic line item. Site-specific row extensions
 * (e.g. a warranty selector) are passed in via `extraContent` and appended
 * below the row's primary content; this component has no knowledge of
 * what they represent.
 *
 * @param {Object} item              Cart item — sku, name, image, price, quantity, url?, variant?
 * @param {{
 *   onQtyChange: Function,
 *   onRemove: Function,
 *   currencyCode?: string,
 *   extraContent?: HTMLElement|null,
 * }} callbacks
 * @param {{ remove?: string, removeItem?: string, maxQtyMessage?: string }} [strings]
 * @returns {HTMLElement}
 */
export default function buildCartItem(item, {
  onQtyChange,
  onRemove,
  currencyCode = 'USD',
  extraContent = null,
}, strings = {}) {
  const { remove = 'Remove', removeItem = 'Remove item', maxQtyMessage } = strings;

  // Per-item override (custom.maxCartQty) takes precedence over the global
  // commerce-config default.
  const config = getConfig();
  const configMax = config.maxCartQty;
  const itemMax = item.custom?.maxCartQty != null ? +item.custom.maxCartQty : null;
  const maxQty = itemMax || configMax || Infinity;

  const el = document.createElement('div');
  el.className = `cart-item cart-item-${item.sku}`;
  el.innerHTML = /* html */`
    <div class="cart-item-image"></div>
    <div class="cart-item-details">
      <p class="cart-item-name"></p>
      <div class="cart-item-actions">
        <div class="cart-item-qty-group">
          <div class="cart-item-qty-control">
            <button class="qty-dec" aria-label="Decrease quantity">&ndash;</button>
            <input class="qty-input" type="number" value="1" min="1"${Number.isFinite(maxQty) ? ` max="${maxQty}"` : ''}>
            <button class="qty-inc" aria-label="Increase quantity">+</button>
          </div>
          <p class="cart-item-qty-limit-message" aria-live="polite" hidden></p>
        </div>
      </div>
    </div>
    <div class="cart-item-right">
      <div class="cart-item-price"></div>
      <div class="cart-item-per-unit"></div>
      <button class="cart-item-remove" aria-label="${removeItem}">
        ${TRASH_ICON}<span>${remove}</span>
      </button>
    </div>`;

  // Image
  el.querySelector('.cart-item-image').appendChild(
    createOptimizedPicture(item.image, item.name || '', true),
  );

  // Name — link if url provided
  const nameEl = el.querySelector('.cart-item-name');
  if (item.url) {
    const a = document.createElement('a');
    a.textContent = item.name;
    try {
      a.href = new URL(item.url).pathname;
    } catch {
      a.href = item.url;
    }
    nameEl.appendChild(a);
  } else {
    nameEl.textContent = item.name;
  }

  // Variant
  if (item.variant) {
    const variantEl = document.createElement('p');
    variantEl.className = 'cart-item-variant';
    variantEl.textContent = item.variant;
    el.querySelector('.cart-item-actions').before(variantEl);
  }

  // Price
  const price = typeof item.price === 'string' ? parseFloat(item.price) : item.price;
  const priceEl = el.querySelector('.cart-item-price');
  const perUnitEl = el.querySelector('.cart-item-per-unit');

  const updatePrice = (qty) => {
    priceEl.textContent = formatPrice(price * qty, currencyCode);
    perUnitEl.textContent = qty > 1 ? `${formatPrice(price, currencyCode)} each` : '';
  };
  updatePrice(item.quantity);

  // Qty
  const qtyInput = el.querySelector('.qty-input');
  qtyInput.value = item.quantity;
  const incBtn = el.querySelector('.qty-inc');
  const limitMessage = el.querySelector('.cart-item-qty-limit-message');
  const hasMaxQty = Number.isFinite(maxQty);
  const messageTemplate = maxQtyMessage || config.getStrings?.().maxCartQtyMessage;
  limitMessage.textContent = messageTemplate?.replace('{max}', maxQty) || `Maximum ${maxQty} per order.`;

  const showQtyLimit = () => {
    if (!hasMaxQty) return;
    getQtyLimitAlerts().add(item.sku);
    limitMessage.hidden = false;
    incBtn.disabled = true;
  };

  const clearQtyLimit = () => {
    getQtyLimitAlerts().delete(item.sku);
    limitMessage.hidden = true;
    incBtn.disabled = false;
  };

  if (getQtyLimitAlerts().has(item.sku) && item.quantity >= maxQty) {
    showQtyLimit();
  } else {
    clearQtyLimit();
  }

  const handleQtyChange = (newQty) => {
    if (newQty < 1) {
      onRemove(item.sku);
      el.remove();
      return;
    }
    const currentQty = +qtyInput.value;
    const clamped = Math.min(newQty, maxQty);
    const exceededMax = hasMaxQty && newQty > maxQty;
    qtyInput.value = clamped;
    updatePrice(clamped);
    if (exceededMax) {
      showQtyLimit();
    } else {
      clearQtyLimit();
    }
    if (clamped !== currentQty) onQtyChange(item.sku, clamped);
  };

  el.querySelector('.qty-dec').addEventListener('click', () => handleQtyChange(+qtyInput.value - 1));
  incBtn.addEventListener('click', () => handleQtyChange(+qtyInput.value + 1));
  qtyInput.addEventListener('change', (e) => handleQtyChange(+e.target.value));

  el.querySelector('.cart-item-remove').addEventListener('click', (ev) => {
    ev.preventDefault();
    onRemove(item.sku);
    el.remove();
  });

  // Optional caller-provided content appended below the row (e.g. a
  // site-specific add-on selector). Spans the full row width via CSS.
  if (extraContent instanceof HTMLElement) {
    el.appendChild(extraContent);
  }

  return el;
}
