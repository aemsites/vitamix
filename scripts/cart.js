import { getConfig } from './commerce-config.js';

const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

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
   * @param {CartItem} item
   */
  addItem(item) {
    const existing = this.#items.find((i) => i.sku === item.sku);
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
   * Returns cart items in API-compatible format.
   * @returns {Array<{sku: string, path: string, quantity: number, name: string,
   *   price: {final: string, currency: string}, imageUrl?: string, productUrl?: string}>}
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
