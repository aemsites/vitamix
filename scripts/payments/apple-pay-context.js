import { getExpressCheckoutContext } from '../checkout-context.js';

export const APPLE_PAY_CART_CONTEXT = getExpressCheckoutContext('apple-pay', 'cart');

/**
 * Builds Apple Pay express context for the page where the button is rendered.
 * @param {'cart'|'checkout'|'pdp'} entryPoint
 * @returns {Object}
 */
export function getApplePayExpressContext(entryPoint) {
  return getExpressCheckoutContext('apple-pay', entryPoint);
}

/**
 * Builds the Apple Pay express preview payload for a selected shipping method.
 * @param {Object} cart
 * @param {string} shippingMethodId
 * @param {string} locale
 * @param {Object|null} contact
 * @param {Object} checkoutContext
 * @returns {Object}
 */
export function buildApplePayExpressPreviewPayload(
  cart,
  shippingMethodId,
  locale,
  contact,
  checkoutContext,
) {
  if (!checkoutContext) {
    throw new Error('Apple Pay express preview requires checkout context');
  }
  const countryCode = contact?.countryCode?.toLowerCase();
  return {
    ...checkoutContext,
    items: cart.getItemsForAPI(),
    shippingMethod: { id: shippingMethodId },
    locale,
    ...(countryCode ? {
      country: countryCode,
      shipping: {
        country: countryCode,
        state: contact.administrativeArea,
        zip: contact.postalCode || '',
      },
    } : {}),
  };
}

/**
 * Builds the Apple Pay express order payload from the authorized payment contact.
 * @param {Object} params
 * @param {Object} params.payment
 * @param {Object} params.cart
 * @param {string} params.shippingMethodId
 * @param {string} params.estimateToken
 * @param {string} params.country
 * @param {string} params.locale
 * @param {string} params.customerEmail
 * @param {string} [params.customerTimezone]
 * @param {Object} params.checkoutContext
 * @returns {Object}
 */
export function buildApplePayExpressOrderPayload(params) {
  const {
    payment,
    cart,
    shippingMethodId,
    estimateToken,
    country,
    locale,
    customerEmail,
    customerTimezone,
    checkoutContext,
  } = params;
  if (!checkoutContext) {
    throw new Error('Apple Pay express order requires checkout context');
  }
  const contact = payment.shippingContact;
  const shippingAddr = {
    name: `${contact.givenName} ${contact.familyName}`.trim(),
    address1: (contact.addressLines || [])[0] || '',
    address2: (contact.addressLines || [])[1] || '',
    city: contact.locality,
    state: contact.administrativeArea,
    zip: contact.postalCode,
    country: contact.countryCode?.toLowerCase() || country,
    phone: contact.phoneNumber || '',
    email: contact.emailAddress || '',
  };

  return {
    ...checkoutContext,
    customer: {
      firstName: contact.givenName || '',
      lastName: contact.familyName || '',
      email: customerEmail,
      phone: contact.phoneNumber || '',
    },
    shipping: shippingAddr,
    billing: shippingAddr,
    items: cart.getItemsForAPI(),
    shippingMethod: { id: shippingMethodId },
    estimateToken,
    country,
    locale,
    ...(customerTimezone ? { customerTimezone } : {}),
  };
}
