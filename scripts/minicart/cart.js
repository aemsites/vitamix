/* eslint-disable no-console */
/* eslint-disable import/no-cycle */

import { store } from './api.js';
import {
  getLoggedInFromLocalStorage,
  isCommerceStatePristine,
  updateMagentoCacheSections,
} from '../storage/util.js';
import { getCartFromLocalStorage } from './util.js';
import { getLocaleAndLanguage, openModal } from '../scripts.js';

/* Queries */
const cartQueryFragment = `fragment cartQuery on Cart {
  id
  items {
      prices {
          price {
              currency
              value
          }
          total_item_discount {
            value
          }
      }
      product {
          name
          sku
          url_key
          thumbnail {
              url
          }
      }
      ... on ConfigurableCartItem {
          configurable_options {
              option_label
              value_label
          }
          configured_variant {
              thumbnail {
                  url
              }
          }
      }
      ... on BundleCartItem {
        bundle_options {
            label
            values {
                label
                quantity                    
            }
        }
      }
      quantity
      uid
  }
  prices {
      subtotal_excluding_tax {
          currency
          value
      }
  }
  total_quantity
}`;

const getCartQuery = `query getCart($cartId: String!) {
  cart(cart_id: $cartId) {
      ...cartQuery
  }
}
${cartQueryFragment}`;

const createCartMutation = `mutation createSessionCart {
  cartId: createSessionCart
}`;

const removeItemFromCartMutation = `mutation removeItemFromCart($cartId: String!, $uid: ID!) {
  removeItemFromCart(input: { cart_id: $cartId, cart_item_uid: $uid }) {
      cart {
          ...cartQuery
      }
  }
}
${cartQueryFragment}`;

const updateCartItemsMutation = `mutation updateCartItems($cartId: String!, $items: [CartItemUpdateInput!]!) {
  updateCartItems(input: { cart_id: $cartId, cart_items: $items }) {
      cart {
          ...cartQuery
      }
  }
}
${cartQueryFragment}`;

const addProductsToCartMutation = `mutation addProductsToCart($cartId: String!, $cartItems: [CartItemInput!]!) {
  addProductsToCart(cartId: $cartId, cartItems: $cartItems) {
      cart {
          ...cartQuery
      }
      user_errors {
          code
          message
      }
  }
}
${cartQueryFragment}`;

export {
  getCartQuery,
  createCartMutation,
  removeItemFromCartMutation,
  updateCartItemsMutation,
  addProductsToCartMutation,
};

/* Methods */

export function getSignInToken() {
  return store.getCookie('auth_dropin_user_token');
}

export async function performMonolithGraphQLQuery(query, variables, GET = true, USE_TOKEN = false) {
  const GRAPHQL_ENDPOINT = `${window.location.origin}/graphql`;
  const { language } = getLocaleAndLanguage(true);

  const headers = {
    'Content-Type': 'application/json',
    Store: language,
  };

  if (USE_TOKEN) {
    if (typeof USE_TOKEN === 'string') {
      headers.Authorization = `Bearer ${USE_TOKEN}`;
    } else {
      const token = getSignInToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }
  }

  let response;
  if (!GET) {
    response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: query.replace(/(?:\r\n|\r|\n|\t|[\s]{4})/g, ' ').replace(/\s\s+/g, ' '),
        variables,
      }),
    });
  } else {
    const endpoint = new URL(GRAPHQL_ENDPOINT);
    endpoint.searchParams.set('query', query.replace(/(?:\r\n|\r|\n|\t|[\s]{4})/g, ' ').replace(/\s\s+/g, ' '));
    endpoint.searchParams.set('variables', JSON.stringify(variables));
    response = await fetch(
      endpoint.toString(),
      { headers },
    );
  }

  if (!response.ok) {
    // Return a dummy response for error cases where graphql is not available
    return {
      data: {
        addProductsToCart: {
          cart: {},
          user_errors: [
            {
              code: 'UNABLE_TO_ADD_TO_CART',
              message: 'Unable to add item to cart.',
            },
          ],
        },
      },
    };
  }

  return response.json();
}

const handleCartErrors = (errors) => {
  if (!errors) {
    return;
  }

  // Cart cannot be found
  if (errors.some(({ extensions }) => extensions?.category === 'graphql-no-such-entity')) {
    console.error('Cart does not exist, resetting cart');
    store.resetCart();
    return;
  }

  // No access to cart
  if (errors.some(({ extensions }) => extensions?.category === 'graphql-authorization')) {
    console.error('No access to cart, resetting cart');
    store.resetCart();
    return;
  }

  if (errors.some(({ extensions }) => extensions?.category === 'graphql-input')) {
    console.error('Some items in the cart might not be available anymore');
    return;
  }

  // Throw for everything else
  throw new Error(errors);
};

/**
 * Function called when waiting for the cart to return.
 * TODO: Should be customized with selectors specific to your implementation.
 *
 * @returns void
 */
export function waitForCart() {
  const buttons = document.querySelectorAll('button.nav-cart-button, .minicart-header > .close');
  const wrapper = document.querySelector('.minicart-wrapper');
  wrapper?.classList.add('loading');
  buttons.forEach((button) => { button.disabled = true; });
  return () => {
    wrapper?.classList.remove('loading');
    buttons.forEach((button) => { button.disabled = false; });
  };
}

/**
 * Get the session cart from commerce system and resolve localStorage / sessionStorage state drift.
 *
 * @param {Object | undefined} options session cart options
 * @param {boolean | undefined} options.waitForCart should the "wait for cart" behavior be triggered
 * @param {boolean | undefined} options.force should the "wait for cart" behavior be triggered
 */
export async function resolveSessionCartDrift(options) {
  const sectionsOfInterest = ['cart', 'customer', 'side-by-side'];

  // We will exit and do nothing if there is no sign of a commerce session ever existing.
  if (isCommerceStatePristine() && !options.force) {
    return;
  }

  let done = () => {};
  if (options.waitForCart) {
    done = waitForCart();
  }

  await updateMagentoCacheSections(sectionsOfInterest);

  const loggedIn = getLoggedInFromLocalStorage();

  // This section is for toggling the logged in/out icon/status in your header (if relevant)
  // TODO: update selectors in here to match your account header
  document.querySelectorAll('.account-contact').forEach((item) => {
    item.classList.add(loggedIn ? 'logged-in' : 'logged-out');
    item.classList.remove(loggedIn ? 'logged-out' : 'logged-in');
  });

  localStorage.setItem('loggedIn', loggedIn);

  store.notifySubscribers();

  done();
}

export function updateCartFromLocalStorage(options) {
  let done = () => {};
  if (options.waitForCart) {
    done = waitForCart();
  }

  // Get cart representation from local storage in mage-cache-storage
  const previousLogin = localStorage.getItem('loggedIn') === 'true';

  // Get loggedin status from local storage 'customer'
  const registeredCustomer = getLoggedInFromLocalStorage();

  const storedCart = getCartFromLocalStorage();
  if (!storedCart) {
    // we just return here since we have no cart data, it will display the default empty cart
    return;
  }

  // If the commerce session tells us we are logged in...
  if (registeredCustomer === true) {
    // Update the account section in the header to point to the customer account page
    document.querySelectorAll('.account-contact a').forEach((item) => item.setAttribute('href', '/customer/account'));
    localStorage.setItem('loggedIn', true);
  } else {
    // else we are not logged in so we'll be sure the state reflects this
    if (previousLogin || !storedCart) {
      store.resetCart();
    }
    localStorage.setItem('loggedIn', false);
  }
  store.notifySubscribers();
  done();
}

function hasExtendedWarranty() {
  return window.selectedWarranty?.price && window.selectedWarranty.price !== '0.00';
}

function hasCouponParam() {
  return window.location.search?.toLowerCase().includes('coupon');
}

function shouldUseLegacyAddToCart() {
  return hasExtendedWarranty() || hasCouponParam();
}

let pformKey;
async function getFormKey() {
  if (!pformKey) {
    const { locale, language } = getLocaleAndLanguage();
    const resp = await fetch(`/${locale}/${language}/checkout/cart/`);
    const txt = await resp.text();
    const input = txt.match(/<input name="form_key" type="hidden" value="([^"]+)"/);
    pformKey = input ? input[1] : null;
    // require refetch after 10 mins
    setTimeout(() => {
      pformKey = null;
    }, 600000);
  }
  return pformKey;
}

function getProductID(sku) {
  if (window.jsonLdData.custom.entityId) {
    return window.jsonLdData.custom.entityId;
  }
  return sku; // TODO: lookup productId if necessary
}

/**
 * Add to cart using legacy form.
 *
 * Sample form data:
 * product: 3231
 * selected_configurable_option
 * related_product
 * item: 3231
 * form_key: x
 * magic360gallery: 1
 * movegalleryintotab: 1
 * super_attribute[93]: 15
 * warranty_skus[2646]: sku-warranty-7yr-std
 * warranty_skus[3545]: 001314
 * options[1758]: 3545
 * warranty_sku: 001314
 * index_id: 15
 * qty: 1
 * vitamixProductId: 3231
 *
 * @param {string} sku
 * @param {string[]} options
 * @param {number} quantity
 */
async function addToCartLegacy(sku, options, quantity) {
  const uenc = window.location.href.includes('?')
    ? window.location.href.split('?').map(btoa).join('_')
    : btoa(window.location.href);
  const [productId, formKey] = await Promise.all([getProductID(sku), getFormKey()]);
  const url = `/us/en_us/checkout/cart/add/uenc/${uenc}/product/${productId}/`;

  const formData = new FormData();
  formData.append('product', productId);
  formData.append('item', productId);
  formData.append('form_key', formKey);
  formData.append('qty', quantity);
  formData.append('vitamixProductId', productId);

  const warrantyIdsAdded = new Set();
  options.forEach((option) => {
    const decoded = atob(option);
    const [type, key, value] = decoded.split('/');
    if (type === 'configurable') {
      formData.append(`super_attribute[${key}]`, value);
      formData.append('index_id', value);
    } else if (type === 'custom-option') {
      formData.append(`options[${key}]`, value);
      formData.append(`warranty_skus[${value}]`, window.selectedWarranty.sku);
      formData.append('warranty_sku', window.selectedWarranty.sku);
      warrantyIdsAdded.add(value);
    }
  });

  // add other warranty skus
  window.jsonLdData.custom.options?.forEach((option) => {
    const decoded = atob(option.uid);
    // eslint-disable-next-line no-unused-vars
    const [type, _key, value] = decoded.split('/');
    if (type === 'custom-option' && !warrantyIdsAdded.has(value)) {
      formData.append(`warranty_skus[${value}]`, option.sku);
    }
  });

  const resp = await fetch(url, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });
  if (!resp.ok) {
    console.error('Failed to add item to cart', resp);
    // Generic error modal
    const { locale, language } = getLocaleAndLanguage();
    await openModal(`/${locale}/${language}/products/modals/atc-error`);
    throw new Error('Failed to add item to cart');
  }
  return resp;
}

/**
 * Add to cart.
 *
 * @param {string} sku
 * @param {string[]} options
 * @param {number} quantity
 */
export async function addToCart(sku, options, quantity) {
  const done = waitForCart();
  try {
    if (shouldUseLegacyAddToCart()) {
      await addToCartLegacy(sku, options, quantity);
    } else {
      const variables = {
        cartId: store.getCartId(),
        cartItems: [{
          sku,
          quantity,
          selected_options: options,
        }],
      };

      const { data, errors } = await performMonolithGraphQLQuery(
        addProductsToCartMutation,
        variables,
        false,
        false,
      );
      handleCartErrors(errors);

      const { cart, user_errors: userErrors } = data.addProductsToCart;
      if (userErrors && userErrors.length > 0) {
        const { locale, language } = getLocaleAndLanguage();

        console.error('User errors while adding item to cart', userErrors);
        const { code } = userErrors[0];
        if (code === 'NOT_SALABLE') {
          await openModal(`/${locale}/${language}/products/modals/atc-not-available`);
        } else if (code === 'INSUFFICIENT_STOCK') {
          await openModal(`/${locale}/${language}/products/modals/atc-out-of-stock`);
        } else {
          // Generic error modal
          await openModal(`/${locale}/${language}/products/modals/atc-error`);
        }
        throw new Error('Failed to add item to cart');
      }

      cart.items = cart.items.filter((item) => item);

      // Adding a new line item to the cart incorrectly returns the total
      // quantity so we check that and update if necessary
      if (cart.items.length > 0) {
        const lineItemTotalQuantity = cart.items.flatMap(
          (item) => item.quantity,
        ).reduce((partialSum, a) => partialSum + a, 0);
        if (lineItemTotalQuantity !== cart.total_quantity) {
          console.debug('Incorrect total quantity from AC, updating.');
          cart.total_quantity = lineItemTotalQuantity;
        }
      }
      console.debug('Added items to cart', variables, cart);
    }
    await store.updateCart();
  } finally {
    done();
  }
}
