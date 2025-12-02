import { loadCSS } from '../../scripts/aem.js';
import cart from '../../scripts/cart.js';

const itemTemplate = /* html */`
<div class="cart-item">
    <div class="cart-item-product"></div>
    <div class="cart-item-quantity"></div>
    <div class="cart-item-total"></div>
</div>`;

const template = /* html */`
<div class="cart">
    <div class="cart-items">
        <div class="cart-items-header">
            <h6 class="title-product">Product</h6>
            <h6 class="title-quantity">Quantity</h6>
            <h6 class="title-total">Total</h6>
        </div>
        <div class="cart-items-list">
        </div>
        <div class="cart-items-footer">
            <div class="cart-footer-subtotal">
                <h4>Subtotal</h4>
                <p class="cart-footer-total"></p>
            </div>
        </div>
    </div>
    <div class="cart-controls">
        <button class="button emphasis cart-checkout">Checkout</button>
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
  removeButton.addEventListener('click', () => {
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

      // product element
      const productEl = itemElement.querySelector('.cart-item-product');
      const productImgEl = document.createElement('img');
      productImgEl.src = item.image;
      productImgEl.alt = item.name;
      const productImgWrapper = document.createElement('span');
      productImgWrapper.appendChild(productImgEl);
      productImgWrapper.classList.add('image');

      const productLinkEl = document.createElement('a');
      productLinkEl.textContent = item.name;
      productLinkEl.setAttribute('href', new URL(item.url).pathname);

      const productPriceEl = document.createElement('span');
      productPriceEl.classList.add('price');
      productPriceEl.textContent = `$${item.price}`;
      productPriceEl.setAttribute('data-price', item.price);
      productEl.append(productImgWrapper, productLinkEl, productPriceEl);

      // total (qty*unit price)
      const totalElement = itemElement.querySelector('.cart-item-total');

      // quantity picker
      const qtyElement = itemElement.querySelector('.cart-item-quantity');
      renderQuantityPicker(item, qtyElement, totalElement);
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
