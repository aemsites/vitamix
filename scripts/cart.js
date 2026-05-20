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
    document.cookie = `cart_items_count=${this.itemCount}; expires=${expires}; path=/`;
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

  get subtotal() {
    return this.#items.reduce(
      (acc, item) => acc + item.quantity * (typeof item.price === 'string'
        ? parseFloat(item.price)
        : item.price / 100),
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
   * Add an item to the cart. If an entry with the same SKU already exists,
   * the merge succeeds only when the existing and incoming `custom` payloads
   * are deep-equal; on merge, quantity is incremented by the incoming
   * quantity. A `custom` mismatch throws — defensive guard against UI bugs.
   *
   * @param {CartItem} item
   */
  addItem(item) {
    const existing = this.#items.find((i) => i.sku === item.sku);
    if (existing) {
      if (!deepEqual(existing.custom, item.custom)) {
        throw new Error(`Cannot merge cart item ${item.sku}: incompatible custom payloads`);
      }
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
   */
  removeItem(sku) {
    const index = this.#items.findIndex((i) => i.sku === sku);
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
   * Returns cart items in API-compatible format. `custom` is forwarded
   * verbatim when present. `selectedOptions` is not forwarded — it's
   * cart-local data used by the cart UI; the Commerce API does not accept
   * it on the order body today and will gain support alongside server-side
   * bundle resolution.
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
