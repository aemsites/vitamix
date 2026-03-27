import { loadCSS, createOptimizedPicture } from '../../scripts/aem.js';
import cart from '../../scripts/cart.js';

const itemTemplate = /* html */`
<div class="cart-item">
    <div class="cart-item-image"></div>
    <div class="cart-item-details">
        <div class="cart-item-name"></div>
        <div class="cart-item-price"></div>
        <div class="cart-item-variant"></div>
        <div class="cart-item-actions">
            <div class="cart-item-quantity"></div>
            <button class="cart-item-remove" aria-label="Remove item">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/>
                </svg>
            </button>
        </div>
    </div>
    <div class="cart-item-total"></div>
</div>`;

const template = /* html */`
<div class="cart">
    <div class="cart-items">
        <div class="cart-items-header">
            <span>PRODUCT</span>
            <span>TOTAL</span>
        </div>
        <div class="cart-items-list">
        </div>
        <div class="cart-items-footer">
            <div class="cart-footer-subtotal">
                <span>Subtotal</span>
                <span class="cart-footer-total"></span>
            </div>
            <p class="cart-footer-note">Taxes and shipping calculated at checkout</p>
        </div>
    </div>
    <div class="cart-controls">
        <a href="/drafts/maxed/checkout/start" class="button emphasis cart-checkout">Checkout</a>
    </div>
</div>`;

/**
 * @param {typeof cart.items[0]} item
 * @param {HTMLElement} container
 * @param {HTMLElement} totalEl
 */
function renderQuantityPicker(item, container, totalEl) {
  // initialize the total
  totalEl.textContent = `$${(item.price * item.quantity).toFixed(2)}`;
  totalEl.setAttribute('data-total', item.price * item.quantity);

  // remove button, to remove the entire line item
  const removeButton = document.createElement('button');
  removeButton.textContent = 'Remove';
  removeButton.classList.add('remove-button');
  removeButton.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    cart.removeItem(item.sku);
    container.closest('span .cart-item').remove();
  });

  // decrement, input, increment are grouped into a single visual element
  // [ - ] [ 1 ] [ + ]
  const qtyControlEl = document.createElement('div');
  qtyControlEl.classList.add('quantity-control');

  // quantity input
  const qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.id = `qty-input-${item.sku}`;
  qtyInput.value = item.quantity;
  qtyInput.classList.add('quantity-input');
  qtyInput.addEventListener('change', (e) => {
    const newQty = e instanceof CustomEvent ? e.detail : +e.target.value;
    if (newQty < 1) {
      removeButton.click();
      return;
    }
    cart.updateItem(item.sku, newQty);
    qtyInput.value = newQty;
    totalEl.textContent = `$${(item.price * newQty).toFixed(2)}`;
    totalEl.setAttribute('data-total', item.price * newQty);
  });
  // decrement
  const decrementButton = document.createElement('button');
  decrementButton.textContent = '-';
  decrementButton.classList.add('quantity-button');
  decrementButton.addEventListener('click', () => {
    const newQty = +qtyInput.value - 1;
    qtyInput.dispatchEvent(new CustomEvent('change', { bubbles: true, cancelable: true, detail: newQty }));
  });
  // increment
  const incrementButton = document.createElement('button');
  incrementButton.textContent = '+';
  incrementButton.classList.add('quantity-button');
  incrementButton.addEventListener('click', () => {
    const newQty = +qtyInput.value + 1;
    qtyInput.dispatchEvent(new CustomEvent('change', { bubbles: true, cancelable: true, detail: newQty }));
  });

  // add the controls to the group
  qtyControlEl.append(decrementButton, qtyInput, incrementButton);
  container.append(qtyControlEl, removeButton);
}

/**
 * Cart page or minicart popover
 * @param {HTMLElement} block
 * @param {HTMLElement} [parent] defined if minicart
 */
export default async function decorate(block, parent) {
  if (parent) {
    // load styles, using minicart
    loadCSS(`${window.hlx.codeBasePath}/blocks/cart/cart.css`);
  } else {
    block.closest('div.section').classList.add('cart-section');
  }

  block.innerHTML = template;
  const itemList = block.querySelector('.cart-items-list');

  const populatelist = () => {
    itemList.innerHTML = '';

    // add each item to the list
    cart.items.forEach((item) => {
      const itemElement = document.createElement('span');
      itemElement.innerHTML = itemTemplate;
      itemList.appendChild(itemElement);
      const cartItem = itemElement.querySelector('.cart-item');
      cartItem.classList.add(`cart-item-${item.sku}`);

      // image
      const imageEl = itemElement.querySelector('.cart-item-image');
      const pictureEl = createOptimizedPicture(item.image, item.name || '', true);
      imageEl.appendChild(pictureEl);

      // name as link
      const nameEl = itemElement.querySelector('.cart-item-name');
      const linkEl = document.createElement('a');
      linkEl.textContent = item.name;
      let path;
      try {
        path = new URL(item.url).pathname;
      } catch (error) {
        path = item.url;
      }
      linkEl.setAttribute('href', path);
      nameEl.appendChild(linkEl);

      // price
      const priceEl = itemElement.querySelector('.cart-item-price');
      priceEl.textContent = `$${item.price}`;

      // variant (e.g., color)
      const variantEl = itemElement.querySelector('.cart-item-variant');
      if (item.variant) {
        variantEl.textContent = `Color: ${item.variant}`;
      } else {
        variantEl.remove();
      }

      // total (qty * unit price)
      const totalElement = itemElement.querySelector('.cart-item-total');
      totalElement.textContent = `$${(item.price * item.quantity).toFixed(2)}`;

      // quantity picker
      const qtyElement = itemElement.querySelector('.cart-item-quantity');
      const qtyControlEl = document.createElement('div');
      qtyControlEl.classList.add('quantity-control');

      const qtyInput = document.createElement('input');
      qtyInput.type = 'number';
      qtyInput.id = `qty-input-${item.sku}`;
      qtyInput.value = item.quantity;
      qtyInput.classList.add('quantity-input');

      const decrementButton = document.createElement('button');
      decrementButton.textContent = '\u2013';
      decrementButton.classList.add('quantity-button');

      const incrementButton = document.createElement('button');
      incrementButton.textContent = '+';
      incrementButton.classList.add('quantity-button');

      qtyControlEl.append(decrementButton, qtyInput, incrementButton);
      qtyElement.appendChild(qtyControlEl);

      // remove button
      const removeBtn = itemElement.querySelector('.cart-item-remove');

      // event handlers
      const updateQty = (newQty) => {
        if (newQty < 1) {
          cart.removeItem(item.sku);
          itemElement.remove();
          return;
        }
        cart.updateItem(item.sku, newQty);
        qtyInput.value = newQty;
        totalElement.textContent = `$${(item.price * newQty).toFixed(2)}`;
      };

      decrementButton.addEventListener('click', () => updateQty(+qtyInput.value - 1));
      incrementButton.addEventListener('click', () => updateQty(+qtyInput.value + 1));
      qtyInput.addEventListener('change', (e) => updateQty(+e.target.value));
      removeBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        cart.removeItem(item.sku);
        itemElement.remove();
      });
    });
  };

  populatelist();
  document.addEventListener('cart:change', populatelist);

  // footer subtotal
  const subtotalEl = block.querySelector('.cart-footer-total');
  subtotalEl.textContent = `$${cart.subtotal.toFixed(2)}`;
  document.addEventListener('cart:change', () => {
    subtotalEl.textContent = `$${cart.subtotal.toFixed(2)}`;
  });
}
