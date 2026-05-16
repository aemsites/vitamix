import { loadCSS } from '../../scripts/aem.js';
import cart from '../../scripts/cart.js';
import { getConfig } from '../../scripts/commerce-config.js';
import buildCartItem from '../../scripts/commerce/cart-item.js';

const LOCAL_STRINGS = {
  'en-us': {
    cartEmpty: 'Your cart is empty.',
    viewCart: 'View cart',
    checkout: 'Checkout',
  },
  'fr-ca': {
    cartEmpty: 'Votre panier est vide.',
    viewCart: 'Voir le panier',
    checkout: 'Passer à la caisse',
  },
};

function getStrings(config) {
  const lang = config.getLanguage().toLowerCase().replace('_', '-');
  return { ...config.getStrings(), ...(LOCAL_STRINGS[lang] || LOCAL_STRINGS['en-us']) };
}

function buildTemplate(s) {
  return /* html */`
<div class="cart">
    <div class="cart-items">
        <div class="cart-items-list">
        </div>
    </div>
    <div class="cart-empty-message">
        <p>${s.cartEmpty}</p>
        <a href="/" class="button">${s.continueShopping}</a>
    </div>
    <div class="cart-controls">
        <a href="#" class="button cart-view-cart">${s.viewCart}</a>
        <a href="#" class="button emphasis cart-checkout">${s.checkout}</a>
    </div>
</div>`;
}

export default async function decorate(block) {
  await Promise.all([
    loadCSS('/styles/commerce-tokens.css'),
    loadCSS('/blocks/cart/cart.css'),
  ]);
  block.closest('div.section')?.classList.add('cart-section');

  const config = getConfig();
  const s = getStrings(config);
  const currencyCode = typeof config.currency === 'function' ? config.currency(config.getLocale()) : config.currency;

  block.innerHTML = buildTemplate(s);
  block.querySelector('.cart-checkout').href = config.getOrderPath('checkout');

  const viewCartBtn = block.querySelector('.cart-view-cart');
  if (block.closest('.minicart')) {
    viewCartBtn.href = config.getOrderPath('cart');
  } else {
    viewCartBtn.remove();
  }

  const itemList = block.querySelector('.cart-items-list');
  const cartEl = block.querySelector('.cart');

  const heading = block.closest('.section')?.querySelector('.default-content-wrapper h1, .default-content-wrapper h2');
  if (heading) {
    const shopRoot = `/${config.getLocale()}/${config.getLanguage()}/`;
    const link = document.createElement('a');
    link.href = shopRoot;
    link.className = 'cart-continue-shopping';
    link.textContent = s.continueShopping;
    heading.insertAdjacentElement('afterend', link);
  }

  const updateEmptyState = () => {
    cartEl.classList.toggle('cart-is-empty', cart.items.length === 0);
  };

  const populatelist = () => {
    itemList.innerHTML = '';
    updateEmptyState();

    cart.items.forEach((item) => {
      const itemEl = buildCartItem(
        item,
        {
          onQtyChange: (key, qty) => cart.updateItem(key, qty),
          onRemove: (key) => cart.removeItem(key),
          onWarrantyChange: (key, warranty) => cart.updateItemWarranty(key, warranty),
          currencyCode,
        },
        {
          remove: s.remove,
          removeItem: s.removeItem,
          warranty: s.warranty,
          free: s.free,
        },
      );
      itemList.appendChild(itemEl);
    });
  };

  populatelist();
  document.addEventListener('cart:change', populatelist);
}
