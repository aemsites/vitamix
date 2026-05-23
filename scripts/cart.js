import { getConfig } from './commerce-config.js';

const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => k in b && deepEqual(a[k], b[k]));
}

export class Cart {
  static get STORAGE_KEY() {
    return `cart:${getConfig().getLocale()}`;
  }

  static STORAGE_VERSION = 1;

  /** @type {CartItem[]} */
  #items = [];

  constructor() {
    this.#restore();
    this.#persistNow();
  }

  #restore() {
    const cart = localStorage.getItem(Cart.STORAGE_KEY);
    if (cart) {
      const parsed = JSON.parse(cart);
      if (parsed.version !== Cart.STORAGE_VERSION) {
        localStorage.removeItem(Cart.STORAGE_KEY);
        return;
      }
      this.#items = parsed.items;
      document.dispatchEvent(
        new CustomEvent('cart:change', {
          detail: {
            cart: this,
            action: 'restore',
          },
        }),
      );
    }
  }

  #persistNow() {
    const expires = new Date(Date.now() + 30 * 864e5).toUTCString();
    document.cookie = `cart_items_count=${this.visibleItemCount}; expires=${expires}; path=/`;
    localStorage.setItem(Cart.STORAGE_KEY, JSON.stringify(this));
  }

  #persist = debounce(() => {
    this.#persistNow();
  }, 300);

  #maybeSendEmptyEvent() {
    if (this.itemCount === 0) {
      document.dispatchEvent(
        new CustomEvent('cart:change', {
          detail: {
            cart: this,
            action: 'empty',
          },
        }),
      );
    }
  }

  get items() {
    return this.#items;
  }

  get itemCount() {
    return this.#items.reduce(
      (acc, item) => acc + item.quantity,
      0,
    );
  }

  /**
   * Quantity sum excluding entries flagged invisible via `local.showInCart`.
   * Display surfaces (header badge, cart-page empty state, etc.) should prefer
   * this over `itemCount` so hidden line items (e.g. linked add-ons) don't
   * inflate the user-facing count.
   */
  get visibleItemCount() {
    return this.#items.reduce(
      (acc, item) => (item.local?.showInCart === false ? acc : acc + item.quantity),
      0,
    );
  }

  get subtotal() {
    return this.#items.reduce(
      (acc, item) => acc + item.quantity * parseFloat(item.price),
      0,
    );
  }

  clear() {
    this.#items = [];
    this.#persistNow();
    document.dispatchEvent(
      new CustomEvent('cart:change', {
        detail: {
          cart: this,
          action: 'clear',
        },
      }),
    );
    this.#maybeSendEmptyEvent();
  }

  /**
   * Add an item to the cart. Merges quantity into an existing entry only when
   * both SKU and `custom` payload match exactly. Items with the same SKU but
   * different `custom` payloads (e.g. the same warranty SKU linked to two
   * different parent products) are kept as separate entries.
   *
   * @param {CartItem} item
   */
  addItem(item) {
    const existing = this.#items.find(
      (i) => i.sku === item.sku && deepEqual(i.custom, item.custom),
    );
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      this.#items.push(item);
    }
    document.dispatchEvent(
      new CustomEvent('cart:change', {
        detail: {
          cart: this,
          item,
          action: 'add',
        },
      }),
    );
    this.#persist();
  }

  /**
   * @param {string} sku
   * @param {number} quantity
   */
  updateItem(sku, quantity) {
    const existing = this.#items.find((i) => i.sku === sku);
    if (!existing) {
      throw new Error(`Item with sku ${sku} not found`);
    }
    existing.quantity = quantity;
    document.dispatchEvent(
      new CustomEvent('cart:change', {
        detail: {
          cart: this,
          item: existing,
          action: 'update',
        },
      }),
    );
    this.#maybeSendEmptyEvent();
    this.#persist();
  }

  /**
   * @param {string} sku
   * @param {string} [linkedTo] When provided, removes only the entry whose
   *   `custom.linkedTo` matches — needed when the same warranty SKU appears
   *   multiple times linked to different parent products.
   */
  removeItem(sku, linkedTo = undefined) {
    const index = this.#items.findIndex(
      (i) => i.sku === sku && (linkedTo === undefined || i.custom?.linkedTo === linkedTo),
    );
    const item = index === -1 ? undefined : this.#items[index];
    if (index !== -1) {
      this.#items.splice(index, 1);
    }
    document.dispatchEvent(
      new CustomEvent('cart:change', {
        detail: {
          cart: this,
          item,
          action: 'remove',
        },
      }),
    );
    this.#maybeSendEmptyEvent();
    this.#persist();
  }

  /**
   * Returns cart items in API-compatible format.
   *
   * Fields forwarded to the order body:
   *   - the projected scalar fields (`sku`, `path`, `quantity`, `name`,
   *     `price`, optional `imageUrl` / `productUrl`)
   *   - `custom` (verbatim) — site-defined fields the server reads
   *
   * Fields kept cart-local and not forwarded:
   *   - `local` — site-defined data used by the cart UI only
   *   - `selectedOptions` — cart-UI data today; gains a passthrough
   *     alongside the bundle work's Commerce API change
   *
   * @returns {Array<object>}
   */
  getItemsForAPI() {
    const { currency, getLocale } = getConfig();
    const currencyCode = typeof currency === 'function' ? currency(getLocale()) : currency;
    return this.items.map((item) => ({
      sku: item.sku,
      path: item.path || new URL(item.url, window.location.origin).pathname,
      quantity: item.quantity,
      name: item.name,
      price: {
        final: String(item.price),
        currency: currencyCode,
      },
      ...(item.image ? { imageUrl: item.image } : {}),
      ...(item.url ? { productUrl: item.url } : {}),
      ...(item.custom ? { custom: item.custom } : {}),
    }));
  }

  toJSON() {
    return {
      version: Cart.STORAGE_VERSION,
      items: this.#items,
    };
  }
}

window.cart = new Cart();
export default window.cart;
