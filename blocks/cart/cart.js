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

  const isMinicart = Boolean(block.closest('.minicart'));

  const viewCartBtn = block.querySelector('.cart-view-cart');
  if (isMinicart) {
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
    const visible = cart.items.filter((i) => i.custom?.showInCart !== false);
    cartEl.classList.toggle('cart-is-empty', visible.length === 0);
  };

  const populatelist = () => {
    itemList.innerHTML = '';
    updateEmptyState();

    cart.items
      .filter((item) => item.custom?.showInCart !== false)
      .forEach((item) => {
        const linkedWarranty = cart.items
          .find((i) => i.custom?.linkedTo === item.sku) || null;

        const callbacks = {
          onQtyChange: (sku, qty) => {
            cart.updateItem(sku, qty);
            if (linkedWarranty) cart.updateItem(linkedWarranty.sku, qty);
          },
          onRemove: (sku) => {
            if (linkedWarranty) cart.removeItem(linkedWarranty.sku);
            cart.removeItem(sku);
          },
          currencyCode,
        };

        // The minicart keeps the row compact — the warranty selector renders
        // only in the full cart view.
        if (!isMinicart) {
          callbacks.linkedWarranty = linkedWarranty;
          callbacks.onSelectWarranty = (tier) => {
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
          };
        }

        const itemEl = buildCartItem(
          item,
          callbacks,
          {
            remove: s.remove,
            removeItem: s.removeItem,
            warranty: s.warranty,
            included: s.included,
          },
        );
        itemList.appendChild(itemEl);
      });
  };

  populatelist();
  document.addEventListener('cart:change', populatelist);
}
