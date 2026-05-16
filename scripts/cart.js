import { getConfig } from './commerce-config.js';
import {
  getCartItemKey,
  getItemUnitPrice,
  selectedOptionsWithWarranty,
} from './commerce/warranty.js';

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

  static STORAGE_VERSION = 2;

  /** @type {Record<string, CartItem>} */
  #items = {};

  constructor() {
    this.#restore();
    this.#persistNow();
  }

  #normalizeItem(item) {
    const key = item.key || getCartItemKey(item);
    const unitPrice = getItemUnitPrice(item);
    return {
      ...item,
      key,
      unitPrice,
      selectedOptions: item.selectedOptions
        ?? selectedOptionsWithWarranty([], item.warrantyOptions, item.selectedWarranty),
    };
  }

  #restore() {
    const cart = localStorage.getItem(Cart.STORAGE_KEY);
    if (cart) {
      const parsed = JSON.parse(cart);
      if (parsed.version !== Cart.STORAGE_VERSION && parsed.version !== 1) {
        localStorage.removeItem(Cart.STORAGE_KEY);
        return;
      }
      this.#items = parsed.items.reduce((acc, raw) => {
        const item = this.#normalizeItem(raw);
        acc[item.key] = item;
        return acc;
      }, {});
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
    return Object.values(this.#items);
  }

  get itemCount() {
    return Object.values(this.#items).reduce(
      (acc, item) => acc + item.quantity,
      0,
    );
  }

  get subtotal() {
    return Object.values(this.#items).reduce(
      (acc, item) => acc + item.quantity * getItemUnitPrice(item),
      0,
    );
  }

  clear() {
    this.#items = {};
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
    const normalized = this.#normalizeItem(item);
    const existing = this.#items[normalized.key];
    if (existing) {
      existing.quantity += normalized.quantity;
    } else {
      this.#items[normalized.key] = normalized;
    }
    document.dispatchEvent(
      new CustomEvent('cart:change', {
        detail: {
          cart: this,
          item: this.#items[normalized.key],
          action: 'add',
        },
      }),
    );
    this.#persist();
  }

  /**
   * @param {string} key - Cart line key ({@link getCartItemKey})
   * @param {number} quantity
   */
  updateItem(key, quantity) {
    if (!this.#items[key]) {
      throw new Error(`Item with key ${key} not found`);
    }
    this.#items[key].quantity = quantity;
    document.dispatchEvent(
      new CustomEvent('cart:change', {
        detail: {
          cart: this,
          item: this.#items[key],
          action: 'update',
        },
      }),
    );
    this.#maybeSendEmptyEvent();
    this.#persist();
  }

  /**
   * @param {string} key
   * @param {{ uid: string, name?: string, sku?: string, finalPrice?: string|number }} warranty
   */
  updateItemWarranty(key, warranty) {
    const item = this.#items[key];
    if (!item) {
      throw new Error(`Item with key ${key} not found`);
    }
    const updated = this.#normalizeItem({
      ...item,
      selectedWarranty: warranty,
      selectedOptions: selectedOptionsWithWarranty(
        item.selectedOptions,
        item.warrantyOptions,
        warranty,
      ),
    });
    if (updated.key === key) {
      this.#items[key] = updated;
    } else {
      delete this.#items[key];
      const existing = this.#items[updated.key];
      if (existing) {
        existing.quantity += updated.quantity;
      } else {
        this.#items[updated.key] = updated;
      }
    }
    document.dispatchEvent(
      new CustomEvent('cart:change', {
        detail: {
          cart: this,
          item: this.#items[updated.key],
          action: 'update-warranty',
        },
      }),
    );
    this.#persist();
  }

  /**
   * @param {string} key
   */
  removeItem(key) {
    const item = this.#items[key];
    delete this.#items[key];
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
   *   price: {final: string, currency: string}, selected_options?: string[],
   *   imageUrl?: string, productUrl?: string}>}
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
        final: String(getItemUnitPrice(item)),
        currency: currencyCode,
      },
      ...(item.selectedOptions?.length ? { selected_options: item.selectedOptions } : {}),
      ...(item.image ? { imageUrl: item.image } : {}),
      ...(item.url ? { productUrl: item.url } : {}),
    }));
  }

  toJSON() {
    return {
      version: Cart.STORAGE_VERSION,
      items: Object.values(this.#items),
    };
  }
}

window.cart = new Cart();
export default window.cart;
