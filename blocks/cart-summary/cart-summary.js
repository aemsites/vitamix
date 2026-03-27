import cart from '../../scripts/cart.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

function getCurrency() {
  const { locale } = getLocaleAndLanguage();
  return (locale === 'ca' || locale === 'drafts') ? 'CAD' : 'USD';
}

const template = /* html */`
<div class="cart-summary">
  <button class="cart-summary-header" aria-expanded="false">
    <h3>Order summary</h3>
    <div class="cart-summary-header-right">
      <span class="cart-summary-total"></span>
      <svg class="chevron" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
  </button>
  <div class="cart-summary-content">
    <div class="cart-summary-items"></div>
    <div class="cart-summary-discount">
      <input type="text" placeholder="Discount code or gift card" class="discount-input">
      <button class="discount-apply">Apply</button>
    </div>
    <div class="cart-summary-totals">
      <div class="cart-summary-row">
        <span>Subtotal</span>
        <span class="cart-summary-subtotal"></span>
      </div>
      <div class="cart-summary-row">
        <span>Shipping</span>
        <span class="cart-summary-shipping"></span>
      </div>
      <div class="cart-summary-row">
        <span>Estimated taxes</span>
        <span class="cart-summary-taxes"></span>
      </div>
      <div class="cart-summary-row cart-summary-final">
        <strong>Total</strong>
        <div class="cart-summary-final-amount">
          <span class="currency"></span>
          <strong class="cart-summary-grand-total"></strong>
        </div>
      </div>
    </div>
  </div>
</div>
`;

const itemTemplate = /* html */`
<div class="cart-summary-item">
  <div class="cart-summary-item-image-wrapper">
    <img class="cart-summary-item-image" src="" alt="">
  </div>
  <div class="cart-summary-item-details">
    <p class="cart-summary-item-name"></p>
    <p class="cart-summary-item-variant"></p>
    <div class="cart-summary-item-actions">
      <div class="cart-summary-qty-control">
        <button class="qty-dec">&ndash;</button>
        <input class="qty-input" type="number" value="1" min="1">
        <button class="qty-inc">+</button>
      </div>
      <button class="cart-summary-item-remove" aria-label="Remove item">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/>
        </svg>
      </button>
    </div>
  </div>
  <div class="cart-summary-item-price"></div>
</div>
`;

/**
 * @param {HTMLDivElement} block
 */
export default function decorate(block) {
  block.innerHTML = template;

  const header = block.querySelector('.cart-summary-header');
  const itemsList = block.querySelector('.cart-summary-items');
  const subtotalEl = block.querySelector('.cart-summary-subtotal');
  const shippingEl = block.querySelector('.cart-summary-shipping');
  const taxesEl = block.querySelector('.cart-summary-taxes');
  const grandTotalEl = block.querySelector('.cart-summary-grand-total');
  const headerTotalEl = block.querySelector('.cart-summary-total');
  const currencyEl = block.querySelector('.currency');
  currencyEl.textContent = getCurrency();

  // Toggle expansion on mobile
  header.addEventListener('click', () => {
    if (window.innerWidth < 1000) {
      const isExpanded = header.getAttribute('aria-expanded') === 'true';
      header.setAttribute('aria-expanded', !isExpanded);
    }
  });

  // Disable toggle on desktop
  const handleResize = () => {
    if (window.innerWidth >= 1000) {
      header.setAttribute('aria-expanded', 'true');
      header.style.cursor = 'default';
    } else {
      header.style.cursor = 'pointer';
    }
  };

  window.addEventListener('resize', handleResize);
  handleResize();

  const renderItems = () => {
    itemsList.innerHTML = '';

    cart.items.forEach((item) => {
      const itemEl = document.createElement('div');
      itemEl.innerHTML = itemTemplate;

      const img = itemEl.querySelector('.cart-summary-item-image');
      img.src = item.image;
      img.alt = item.name;

      const name = itemEl.querySelector('.cart-summary-item-name');
      name.textContent = item.name;

      const variant = itemEl.querySelector('.cart-summary-item-variant');
      if (item.variant) {
        variant.textContent = item.variant;
      } else {
        variant.remove();
      }

      const price = itemEl.querySelector('.cart-summary-item-price');
      const itemPrice = typeof item.price === 'string'
        ? parseFloat(item.price)
        : item.price;
      price.textContent = `$${(itemPrice * item.quantity).toFixed(2)}`;

      // quantity controls
      const qtyInput = itemEl.querySelector('.qty-input');
      qtyInput.value = item.quantity;

      const updateQty = (newQty) => {
        if (newQty < 1) {
          cart.removeItem(item.sku);
          return;
        }
        cart.updateItem(item.sku, newQty);
      };

      itemEl.querySelector('.qty-dec').addEventListener('click', () => updateQty(+qtyInput.value - 1));
      itemEl.querySelector('.qty-inc').addEventListener('click', () => updateQty(+qtyInput.value + 1));
      qtyInput.addEventListener('change', (e) => updateQty(+e.target.value));

      itemEl.querySelector('.cart-summary-item-remove').addEventListener('click', () => {
        cart.removeItem(item.sku);
      });

      itemsList.appendChild(itemEl.firstElementChild);
    });
  };

  const updateTotals = () => {
    subtotalEl.textContent = `$${cart.subtotal.toFixed(2)}`;
    // show placeholder until real estimates arrive
    shippingEl.textContent = '--';
    taxesEl.textContent = '--';
    grandTotalEl.textContent = `$${cart.subtotal.toFixed(2)}`;
    headerTotalEl.textContent = `$${cart.subtotal.toFixed(2)}`;
  };

  // Initial render
  renderItems();
  updateTotals();

  // Listen for cart changes
  document.addEventListener('cart:change', () => {
    renderItems();
    updateTotals();
  });

  // Listen for real estimates from checkout preview
  document.addEventListener('checkout:preview', (e) => {
    const { preview } = e.detail;
    const subtotal = parseFloat(preview.subtotal) || cart.subtotal;
    const taxAmount = parseFloat(preview.taxAmount) || 0;
    const shippingRate = preview.shippingMethod?.rate ?? 0;
    const total = parseFloat(preview.total) || (subtotal + taxAmount + shippingRate);

    subtotalEl.textContent = `$${subtotal.toFixed(2)}`;
    shippingEl.textContent = shippingRate === 0 ? 'Free' : `$${parseFloat(shippingRate).toFixed(2)}`;
    taxesEl.textContent = `$${taxAmount.toFixed(2)}`;
    grandTotalEl.textContent = `$${total.toFixed(2)}`;
    headerTotalEl.textContent = `$${total.toFixed(2)}`;
  });
}
