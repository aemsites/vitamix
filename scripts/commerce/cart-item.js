import { loadCSS, createOptimizedPicture } from '../aem.js';
import { formatPrice } from '../commerce-config.js';

loadCSS('/scripts/commerce/cart-item.css');

const TRASH_ICON = /* html */`<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14
    a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/>
</svg>`;

/**
 * @param {Object} item              Cart item — sku, name, image, price, quantity, url?, variant?
 * @param {{
 *   onQtyChange: Function,
 *   onRemove: Function,
 *   currencyCode?: string,
 *   linkedWarranty?: Object|null,
 *   onSelectWarranty?: Function,
 * }} callbacks
 * @param {{ remove?: string, removeItem?: string, warranty?: string, included?: string }} [strings]
 * @returns {HTMLElement}
 */
export default function buildCartItem(item, {
  onQtyChange,
  onRemove,
  currencyCode = 'USD',
  linkedWarranty = null,
  onSelectWarranty,
}, strings = {}) {
  const {
    remove = 'Remove',
    removeItem = 'Remove item',
    warranty: warrantyLabel = 'Warranty',
    included = 'included',
  } = strings;

  const el = document.createElement('div');
  el.className = `cart-item cart-item-${item.sku}`;
  el.innerHTML = /* html */`
    <div class="cart-item-image"></div>
    <div class="cart-item-details">
      <p class="cart-item-name"></p>
      <div class="cart-item-actions">
        <div class="cart-item-qty-control">
          <button class="qty-dec" aria-label="Decrease quantity">&ndash;</button>
          <input class="qty-input" type="number" value="1" min="1">
          <button class="qty-inc" aria-label="Increase quantity">+</button>
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

  const handleQtyChange = (newQty) => {
    if (newQty < 1) {
      onRemove(item.sku);
      el.remove();
      return;
    }
    qtyInput.value = newQty;
    updatePrice(newQty);
    onQtyChange(item.sku, newQty);
  };

  el.querySelector('.qty-dec').addEventListener('click', () => handleQtyChange(+qtyInput.value - 1));
  el.querySelector('.qty-inc').addEventListener('click', () => handleQtyChange(+qtyInput.value + 1));
  qtyInput.addEventListener('change', (e) => handleQtyChange(+e.target.value));

  el.querySelector('.cart-item-remove').addEventListener('click', (ev) => {
    ev.preventDefault();
    onRemove(item.sku);
    el.remove();
  });

  // Warranty selector — rendered only when the product entry has available
  // tiers and the caller wired an onSelectWarranty callback.
  const tiers = item.custom?.availableWarranties;
  if (Array.isArray(tiers) && tiers.length > 0 && typeof onSelectWarranty === 'function') {
    const warrantyEl = document.createElement('div');
    warrantyEl.className = 'cart-item-warranty';

    const heading = document.createElement('div');
    heading.className = 'cart-item-warranty-heading';
    heading.textContent = warrantyLabel;
    warrantyEl.appendChild(heading);

    const groupName = `warranty-${item.sku}`;
    tiers.forEach((tier) => {
      const label = document.createElement('label');
      label.className = 'cart-item-warranty-option';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = groupName;
      radio.value = tier.sku;
      radio.checked = linkedWarranty
        ? linkedWarranty.sku === tier.sku
        : Boolean(tier.isDefault);
      radio.addEventListener('change', () => {
        if (radio.checked) onSelectWarranty(tier);
      });

      const text = document.createElement('span');
      const tierPrice = parseFloat(tier.price);
      if (tier.isDefault || tierPrice === 0) {
        text.textContent = `${tier.name} (${included})`;
      } else {
        text.textContent = `${tier.name} +${formatPrice(tierPrice, currencyCode)} ea`;
      }

      label.append(radio, text);
      warrantyEl.appendChild(label);
    });

    el.appendChild(warrantyEl);
  }

  return el;
}
