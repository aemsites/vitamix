import { loadCSS, createOptimizedPicture } from '../../scripts/aem.js';
import cart from '../../scripts/cart.js';
import { getConfig, formatPrice } from '../../scripts/commerce-config.js';
import buildCartItem from '../../scripts/commerce/cart-item.js';
import buildWarrantySelector from './warranty-selector.js';
import { ensurePriceRulesLoaded, evaluateGWP } from '../../scripts/gift-with-purchase.js';

const LOCAL_STRINGS = {
  'en-us': {
    cartEmpty: 'Your cart is empty.',
    viewCart: 'View cart',
    checkout: 'Checkout',
    freeGift: 'Free gift',
    free: 'Free',
  },
  'fr-ca': {
    cartEmpty: 'Votre panier est vide.',
    viewCart: 'Voir le panier',
    checkout: 'Passer à la caisse',
    freeGift: 'Cadeau gratuit',
    free: 'Gratuit',
  },
};

function buildGiftItem(item, s, currencyCode) {
  const el = document.createElement('div');
  el.className = `cart-item cart-item-gift cart-item-${item.sku}`;
  el.innerHTML = /* html */`
    <div class="cart-item-image"></div>
    <div class="cart-item-details">
      <span class="cart-item-gift-badge">${s.freeGift}</span>
      <p class="cart-item-name"></p>
    </div>
    <div class="cart-item-right">
      <div class="cart-item-price"></div>
    </div>`;
  el.querySelector('.cart-item-image').appendChild(
    createOptimizedPicture(item.image, item.name || '', true),
  );
  const nameEl = el.querySelector('.cart-item-name');
  if (item.url) {
    const a = document.createElement('a');
    a.textContent = item.name;
    try {
      a.href = new URL(item.url, window.location.origin).pathname;
    } catch {
      a.href = item.url;
    }
    nameEl.appendChild(a);
  } else {
    nameEl.textContent = item.name;
  }
  const priceEl = el.querySelector('.cart-item-price');
  const regularPrice = item.custom?.regularPrice;
  if (regularPrice) {
    const original = document.createElement('span');
    original.className = 'cart-item-price-original';
    original.textContent = formatPrice(parseFloat(regularPrice), currencyCode);
    const free = document.createElement('span');
    free.className = 'cart-item-price-free';
    free.textContent = s.free;
    priceEl.append(original, free);
  } else {
    priceEl.textContent = s.free;
  }
  return el;
}

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
    // Empty state ignores GWP lines — a cart with nothing but free gifts is
    // still empty from the customer's perspective.
    const visible = cart.items.filter((i) => i.local?.showInCart !== false
      && !i.custom?.giftWithPurchase);
    cartEl.classList.toggle('cart-is-empty', visible.length === 0);
  };

  const populatelist = () => {
    itemList.innerHTML = '';
    updateEmptyState();

    cart.items
      .filter((item) => item.local?.showInCart !== false)
      .forEach((item) => {
        if (item.custom?.giftWithPurchase) {
          itemList.appendChild(buildGiftItem(item, s, currencyCode));
          return;
        }

        const linkedWarranty = cart.items
          .find((i) => i.custom?.linkedTo === item.sku) || null;

        // The minicart keeps the row compact — the warranty selector renders
        // only in the full cart view.
        const extraContent = isMinicart ? null : buildWarrantySelector(
          item,
          linkedWarranty,
          (tier) => {
            if (linkedWarranty) {
              cart.removeItem(linkedWarranty.sku, linkedWarranty.custom?.linkedTo);
            }
            if (tier && !tier.isDefault && parseFloat(tier.price) > 0) {
              cart.addItem({
                sku: tier.sku,
                path: tier.path,
                quantity: item.quantity,
                price: tier.price,
                name: tier.name,
                custom: {
                  linkedTo: item.sku,
                  ...(tier.coverageYears ? { coverageYears: tier.coverageYears } : {}),
                },
                local: { showInCart: false },
              }, { allowSeparateEntry: true });
            }
          },
          currencyCode,
          { heading: s.warranty, included: s.included },
        );

        const itemEl = buildCartItem(
          item,
          {
            onQtyChange: (sku, qty) => {
              cart.updateItem(sku, qty);
              if (linkedWarranty) cart.updateItem(linkedWarranty.sku, qty);
            },
            onRemove: (sku) => {
              if (linkedWarranty) {
                cart.removeItem(linkedWarranty.sku, linkedWarranty.custom?.linkedTo);
              }
              cart.removeItem(sku);
            },
            currencyCode,
            extraContent,
          },
          { remove: s.remove, removeItem: s.removeItem },
        );
        itemList.appendChild(itemEl);
      });
  };

  populatelist();
  document.addEventListener('cart:change', populatelist);

  // Visiting cart/minicart is always a GWP trigger — populate/refresh rules
  // and reconcile. populatelist re-renders on the resulting cart:change.
  ensurePriceRulesLoaded({ reason: 'cart-block-init' }).then(() => evaluateGWP());
}
