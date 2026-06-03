import { loadCSS } from '../../scripts/aem.js';
import cart from '../../scripts/cart.js';
import { getConfig } from '../../scripts/commerce-config.js';
import buildCartItem, { buildGiftItem } from '../../scripts/commerce/cart-item.js';
import { ensurePriceRulesLoaded, evaluateGWP } from '../../scripts/gift-with-purchase.js';
import { logOperation } from '../../scripts/operations-log.js';

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

async function loadCartItemExtensions(config) {
  const configuredExtensions = config.cartItemExtensions || [];
  const extensionModules = await Promise.all(
    (config.cartItemExtensionModules || []).map((modulePath) => import(modulePath)),
  );
  return [
    ...configuredExtensions,
    ...extensionModules.map((module) => module.default).filter(Boolean),
  ];
}

function buildCartItemExtensions(extensions, context) {
  return extensions
    .map((buildExtension) => buildExtension(context))
    .filter((content) => content instanceof HTMLElement);
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
  const cartItemExtensions = await loadCartItemExtensions(config);

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
      // Free gifts always render last, regardless of insertion order.
      .slice()
      .sort((a, b) => (a.custom?.giftWithPurchase ? 1 : 0) - (b.custom?.giftWithPurchase ? 1 : 0))
      .forEach((item) => {
        if (item.custom?.giftWithPurchase) {
          itemList.appendChild(buildGiftItem(item, {
            currencyCode,
            freeGift: s.freeGift,
            free: s.free,
          }));
          return;
        }

        const extraContent = [
          ...buildCartItemExtensions(cartItemExtensions, {
            item,
            items: cart.items,
            cart,
            isMinicart,
            strings: s,
            currencyCode,
          }),
        ].filter(Boolean);

        const itemEl = buildCartItem(
          item,
          {
            onQtyChange: (sku, qty) => {
              cart.updateItem(sku, qty);
              cart.items
                .filter((i) => i.custom?.linkedTo === sku)
                .forEach((linkedItem) => cart.updateItem(linkedItem.sku, qty));
            },
            onRemove: (sku) => {
              const removed = cart.items.find((i) => i.sku === sku);
              logOperation('removed-from-cart', { sku, quantity: removed?.quantity });
              cart.items
                .filter((i) => i.custom?.linkedTo === sku)
                .forEach((linkedItem) => cart.removeItem(
                  linkedItem.sku,
                  linkedItem.custom?.linkedTo,
                ));
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
  document.addEventListener('cart:limit', populatelist);

  // Log views of the full cart page only (minicart is built once per page load
  // and toggled via UI, so logging it here would not reflect actual opens).
  if (!isMinicart) {
    logOperation('cart-view', {
      itemCount: cart.visibleItemCount,
      subtotal: cart.subtotal,
      skus: cart.items.filter((i) => i.local?.showInCart !== false).map((i) => i.sku),
    });
  }

  // Visiting cart/minicart is always a GWP trigger — populate/refresh rules
  // and reconcile. populatelist re-renders on the resulting cart:change.
  ensurePriceRulesLoaded({ reason: 'cart-block-init' }).then(() => evaluateGWP());
}
