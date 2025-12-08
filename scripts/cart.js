const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
};

export class Cart {
  static STORAGE_KEY = 'cart';

  static STORAGE_VERSION = 1;

  static SHIPPING_THRESHOLD = 150;

  /** @type {Record<string, CartItem>} */
  #items = {};

  constructor() {
    this.#restore();
  }

  #restore() {
    const cart = localStorage.getItem(Cart.STORAGE_KEY);
    if (cart) {
      const parsed = JSON.parse(cart);
      if (parsed.version !== Cart.STORAGE_VERSION) {
        localStorage.removeItem(Cart.STORAGE_KEY);
        return;
      }
      this.#items = parsed.items.reduce((acc, item) => {
        acc[item.sku] = item;
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
      (acc, item) => acc + item.quantity * (typeof item.price === 'string'
        ? parseFloat(item.price)
        : item.price / 100),
      0,
    );
  }

  get shipping() {
    return this.subtotal < Cart.SHIPPING_THRESHOLD ? 10 : 0;
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
    const existing = this.#items[item.sku];
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      this.#items[item.sku] = item;
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
    if (!this.#items[sku]) {
      throw new Error(`Item with sku ${sku} not found`);
    }
    this.#items[sku].quantity = quantity;
    document.dispatchEvent(
      new CustomEvent('cart:change', {
        detail: {
          cart: this,
          item: this.#items[sku],
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
    delete this.#items[sku];
    document.dispatchEvent(
      new CustomEvent('cart:change', {
        detail: {
          cart: this,
          item: this.#items[sku],
          action: 'remove',
        },
      }),
    );
    this.#maybeSendEmptyEvent();
    this.#persist();
  }

  /**
   * @param {string} firstName
   * @param {string} lastName
   * @param {string} email
   * @param {string} phone
   * @param {{
   *   name: string;
   *   company: string;
   *   address1: string;
   *   address2: string;
   *   city: string;
   *   state: string;
   *   zip: string;
   *   country: string;
   *   phone: string;
   *   email: string;
   * }} shipping
   * @returns {Object}
   */
  getOrderJSON(email, firstName, lastName, phone, shippingAddr) {
    // remove empty string values
    const shipping = Object.fromEntries(
      // eslint-disable-next-line no-unused-vars
      Object.entries(shippingAddr).filter(([_, value]) => value !== ''),
    );
    const order = {
      storeCode: 'main',
      storeViewCode: 'default',
      customer: {
        firstName,
        lastName,
        email,
        phone,
      },
      shipping,
      items: this.items.map((item) => ({
        sku: item.sku,
        urlKey: (item.url || '').split('/').pop() || '',
        name: item.name,
        quantity: item.quantity,
        price: {
          currency: 'USD',
          final: item.price,
        },
      })),
    };
    return order;
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
