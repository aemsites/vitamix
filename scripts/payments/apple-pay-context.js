export const APPLE_PAY_CART_CONTEXT = {
  paymentMethod: 'apple-pay',
  checkoutFlow: 'express',
  entryPoint: 'cart',
};

/**
 * Builds the Apple Pay cart preview payload for a selected shipping method.
 * @param {Object} cart
 * @param {string} shippingMethodId
 * @param {string} locale
 * @param {Object|null} contact
 * @returns {Object}
 */
export function buildApplePayCartPreviewPayload(cart, shippingMethodId, locale, contact) {
  const countryCode = contact?.countryCode?.toLowerCase();
  return {
    ...APPLE_PAY_CART_CONTEXT,
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
 * Builds the Apple Pay cart order payload from the authorized payment contact.
 * @param {Object} params
 * @param {Object} params.payment
 * @param {Object} params.cart
 * @param {string} params.shippingMethodId
 * @param {string} params.estimateToken
 * @param {string} params.country
 * @param {string} params.locale
 * @param {string} params.customerEmail
 * @param {string} [params.customerTimezone]
 * @returns {Object}
 */
export function buildApplePayCartOrderPayload(params) {
  const {
    payment,
    cart,
    shippingMethodId,
    estimateToken,
    country,
    locale,
    customerEmail,
    customerTimezone,
  } = params;
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
    ...APPLE_PAY_CART_CONTEXT,
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
