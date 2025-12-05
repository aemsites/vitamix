import cart from '../../scripts/cart.js';

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
        <span class="cart-summary-taxes">$1.00</span>
      </div>
      <div class="cart-summary-row cart-summary-final">
        <strong>Total</strong>
        <div class="cart-summary-final-amount">
          <span class="currency">USD</span>
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
    <span class="cart-summary-item-quantity"></span>
  </div>
  <div class="cart-summary-item-details">
    <p class="cart-summary-item-name"></p>
    <p class="cart-summary-item-variant"></p>
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
  const grandTotalEl = block.querySelector('.cart-summary-grand-total');
  const headerTotalEl = block.querySelector('.cart-summary-total');

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
  handleResize(); // Initial check

  const renderItems = () => {
    itemsList.innerHTML = '';

    cart.items.forEach((item) => {
      const itemEl = document.createElement('div');
      itemEl.innerHTML = itemTemplate;

      const img = itemEl.querySelector('.cart-summary-item-image');
      img.src = item.image;
      img.alt = item.name;

      const quantity = itemEl.querySelector('.cart-summary-item-quantity');
      quantity.textContent = item.quantity;

      const name = itemEl.querySelector('.cart-summary-item-name');
      name.textContent = item.name;

      const variant = itemEl.querySelector('.cart-summary-item-variant');
      // Extract variant from item if available
      if (item.variant) {
        variant.textContent = item.variant;
      } else {
        variant.remove();
      }

      const price = itemEl.querySelector('.cart-summary-item-price');
      const itemPrice = typeof item.price === 'string'
        ? parseFloat(item.price)
        : item.price / 100;
      price.textContent = `$${(itemPrice * item.quantity).toFixed(2)}`;

      itemsList.appendChild(itemEl.firstElementChild);
    });
  };

  const updateTotals = () => {
    const { subtotal, shipping } = cart;
    const taxes = 1.00; // Placeholder
    const total = subtotal + shipping + taxes;

    subtotalEl.textContent = `$${subtotal.toFixed(2)}`;
    shippingEl.textContent = shipping === 0 ? 'Free' : `$${shipping.toFixed(2)}`;
    grandTotalEl.textContent = `$${total.toFixed(2)}`;
    headerTotalEl.textContent = `$${total.toFixed(2)}`;
  };

  // Initial render
  renderItems();
  updateTotals();

  // Listen for cart changes
  document.addEventListener('cart:change', () => {
    renderItems();
    updateTotals();
  });
}
