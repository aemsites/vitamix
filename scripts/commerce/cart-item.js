import { loadCSS, createOptimizedPicture } from '../aem.js';
import { formatPrice } from '../commerce-config.js';
import {
  cartItemDomId,
  formatWarrantyOptionLabel,
  getItemUnitPrice,
} from './warranty.js';

loadCSS('/scripts/commerce/cart-item.css');

const TRASH_ICON = /* html */`<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14
    a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/>
</svg>`;

/**
 * @param {Object} item
 * @param {{ onQtyChange: Function, onRemove: Function,
 *   onWarrantyChange?: Function, currencyCode?: string }} callbacks
 * @param {{ remove?: string, removeItem?: string, warranty?: string, free?: string }} [strings]
 * @returns {HTMLElement}
 */
export default function buildCartItem(
  item,
  {
    onQtyChange, onRemove, onWarrantyChange, currencyCode = 'USD',
  },
  strings = {},
) {
  const {
    remove = 'Remove',
    removeItem = 'Remove item',
    warranty: warrantyLabel = 'Warranty',
    free: freeLabel = 'Free',
  } = strings;

  const lineKey = item.key || item.sku;
  const unitPrice = getItemUnitPrice(item);

  const el = document.createElement('div');
  el.className = `cart-item cart-item-${cartItemDomId(lineKey)}`;
  el.innerHTML = /* html */`
    <div class="cart-item-image"></div>
    <div class="cart-item-details">
      <p class="cart-item-name"></p>
      <div class="cart-item-warranty"></div>
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

  el.querySelector('.cart-item-image').appendChild(
    createOptimizedPicture(item.image, item.name || '', true),
  );

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

  if (item.variant) {
    const variantEl = document.createElement('p');
    variantEl.className = 'cart-item-variant';
    variantEl.textContent = item.variant;
    el.querySelector('.cart-item-warranty').before(variantEl);
  }

  const warrantySlot = el.querySelector('.cart-item-warranty');
  const { warrantyOptions, selectedWarranty } = item;

  if (warrantyOptions?.length) {
    if (warrantyOptions.length > 1 && onWarrantyChange) {
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'cart-item-warranty-options';
      const legend = document.createElement('legend');
      legend.textContent = `${warrantyLabel}:`;
      fieldset.append(legend);

      warrantyOptions.forEach((option) => {
        const label = document.createElement('label');
        label.className = 'cart-item-warranty-option';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `warranty-${cartItemDomId(lineKey)}`;
        radio.value = option.uid || option.name;
        radio.checked = (selectedWarranty?.uid || warrantyOptions[0]?.uid) === option.uid;
        label.append(radio, document.createTextNode(
          formatWarrantyOptionLabel(option, freeLabel, currencyCode),
        ));
        radio.addEventListener('change', () => {
          if (radio.checked) onWarrantyChange(lineKey, option);
        });
        fieldset.append(label);
      });
      warrantySlot.append(fieldset);
    } else {
      const warrantyText = document.createElement('p');
      warrantyText.className = 'cart-item-warranty-text';
      const w = selectedWarranty || warrantyOptions[0];
      warrantyText.textContent = `${warrantyLabel}: ${formatWarrantyOptionLabel(w, freeLabel, currencyCode)}`;
      warrantySlot.append(warrantyText);
    }
  }

  const priceEl = el.querySelector('.cart-item-price');
  const perUnitEl = el.querySelector('.cart-item-per-unit');

  const updatePrice = (qty) => {
    priceEl.textContent = formatPrice(unitPrice * qty, currencyCode);
    perUnitEl.textContent = qty > 1 ? `${formatPrice(unitPrice, currencyCode)} each` : '';
  };
  updatePrice(item.quantity);

  const qtyInput = el.querySelector('.qty-input');
  qtyInput.value = item.quantity;

  const handleQtyChange = (newQty) => {
    if (newQty < 1) {
      onRemove(lineKey);
      el.remove();
      return;
    }
    qtyInput.value = newQty;
    updatePrice(newQty);
    onQtyChange(lineKey, newQty);
  };

  el.querySelector('.qty-dec').addEventListener('click', () => handleQtyChange(+qtyInput.value - 1));
  el.querySelector('.qty-inc').addEventListener('click', () => handleQtyChange(+qtyInput.value + 1));
  qtyInput.addEventListener('change', (e) => handleQtyChange(+e.target.value));

  el.querySelector('.cart-item-remove').addEventListener('click', (ev) => {
    ev.preventDefault();
    onRemove(lineKey);
    el.remove();
  });

  return el;
}
