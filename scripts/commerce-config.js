const { hostname } = window.location;

function resolveApiOrigin(org, site) {
  const isProduction = !hostname.endsWith('.aem.page')
    && !hostname.endsWith('.aem.live')
    && !hostname.endsWith('.aem.network')
    && hostname !== 'localhost'
    && !hostname.startsWith('127.')
    && !hostname.startsWith('integration.')
    && !hostname.startsWith('uat.');
  const base = isProduction
    ? 'https://api.adobecommerce.live'
    : 'https://api-stage.adobecommerce.live';
  return `${base}/${org}/sites/${site}`;
}

const defaults = {
  org: undefined,
  site: undefined,
  getLocale: () => window.location.pathname.split('/').filter(Boolean)[0] || 'us',
  getLanguage: () => window.location.pathname.split('/').filter(Boolean)[1] || 'en_us',
  getOrderPath(page) {
    return `/${this.getLocale()}/${this.getLanguage()}/order/${page}`;
  },
  getAccountPath(page) {
    const base = `/${this.getLocale()}/${this.getLanguage()}/account`;
    return page ? `${base}/${page}` : base;
  },
  currency: (locale) => (locale === 'ca' ? 'CAD' : 'USD'),
  addressDoctorOrigin: 'https://vitamix-address-doctor-proxy-worker.adobeaem.workers.dev',
  cardProvider: 'chase',
  maxCartQty: 3,
  affirmMinOrderTotal: 50,
  getFraudToken() {
    try { return sessionStorage.getItem('forter_token') || undefined; } catch { return undefined; }
  },
  strings: {
    'en-us': {
      stepCart: 'Cart',
      stepCheckout: 'Checkout',
      stepConfirmation: 'Confirmation',
      checkoutStepsLabel: 'Checkout steps',
      remove: 'Remove',
      removeItem: 'Remove item',
      maxCartQtyMessage: 'Maximum {max} per order.',
      continueShopping: 'Continue shopping',
      apply: 'Apply',
      applied: 'Applied',
      discount: 'Discount',
      subtotal: 'Subtotal',
      shipping: 'Shipping',
      estimatedTaxes: 'Estimated taxes',
      total: 'Total',
      free: 'Free',
      freeGift: 'Free gift',
      or: 'or',
      orderSummary: 'Order summary',
      discountPlaceholder: 'Discount code or gift card',
      cancelHeading: 'Payment not completed',
      cancelCustomerCancelled: 'You cancelled the payment.',
      cancelPaymentFailed: 'Your payment could not be processed. Please try again.',
      cancelDeclined: 'Your payment was declined. Please try a different payment method.',
      cancelReturnToCheckout: 'Return to checkout',
      orderPaymentNotCompleted: 'Payment not completed',
      orderPaymentCancelled: 'You cancelled the payment.',
      orderPaymentFailed: 'Payment could not be processed. Please try again.',
      orderReturnToCheckout: 'Return to checkout',
      orderThankYou: 'Thank you for your order!',
      orderIdLabel: 'Order number:',
      orderConfirmationEmail: 'A confirmation will be sent to {email}.',
      orderItemsOrdered: 'Items ordered',
      orderQtyLabel: 'Qty:',
      orderTax: 'Tax',
      orderShippingAddress: 'Shipping address',
      orderContact: 'Contact',
      orderGiftMessage: 'Gift message',
      errorApplePayCountry: 'Shipping is not available to this country.',
      errorApplePayGeneric: 'Unable to process your order. Please try a different address or payment method.',
      errorRecaptcha: 'Unable to complete checkout. Please refresh the page and try again.',
    },
    'fr-ca': {
      stepCart: 'Panier',
      stepCheckout: 'Caisse',
      stepConfirmation: 'Confirmation',
      checkoutStepsLabel: 'Étapes de la caisse',
      remove: 'Retirer',
      removeItem: "Retirer l'article",
      maxCartQtyMessage: 'Maximum {max} par commande.',
      continueShopping: 'Continuer vos achats',
      apply: 'Appliquer',
      applied: 'Appliqué',
      discount: 'Rabais',
      subtotal: 'Sous-total',
      shipping: 'Livraison',
      estimatedTaxes: 'Taxes estimées',
      total: 'Total',
      free: 'Gratuit',
      freeGift: 'Cadeau gratuit',
      or: 'ou',
      orderSummary: 'Récapitulatif de commande',
      discountPlaceholder: 'Code de réduction ou carte-cadeau',
      cancelHeading: 'Paiement non effectué',
      cancelCustomerCancelled: 'Vous avez annulé le paiement.',
      cancelPaymentFailed: "Votre paiement n'a pas pu être traité. Veuillez réessayer.",
      cancelDeclined: 'Votre paiement a été refusé. Veuillez essayer un autre mode de paiement.',
      cancelReturnToCheckout: 'Retourner à la caisse',
      orderPaymentNotCompleted: 'Paiement non complété',
      orderPaymentCancelled: 'Vous avez annulé le paiement.',
      orderPaymentFailed: 'Le paiement n\'a pas pu être traité. Veuillez réessayer.',
      orderReturnToCheckout: 'Retour à la caisse',
      orderThankYou: 'Merci pour votre commande !',
      orderIdLabel: 'Numéro de commande :',
      orderConfirmationEmail: 'Une confirmation sera envoyée à {email}.',
      orderItemsOrdered: 'Articles commandés',
      orderQtyLabel: 'Qté :',
      orderTax: 'Taxe',
      orderShippingAddress: 'Adresse de livraison',
      orderContact: 'Contact',
      orderGiftMessage: 'Message cadeau',
      errorApplePayCountry: 'La livraison n\'est pas disponible dans ce pays.',
      errorApplePayGeneric: 'Impossible de traiter votre commande. Veuillez essayer une autre adresse ou un autre mode de paiement.',
      errorRecaptcha: 'Impossible de finaliser la commande. Veuillez actualiser la page et réessayer.',
    },
  },
  getStrings() {
    const key = this.getLanguage().toLowerCase().replace('_', '-');
    return this.strings[key] || this.strings['en-us'];
  },
};

/**
 * Formats a numeric amount as a localized currency string.
 * @param {number} amount
 * @param {string} currencyCode - ISO 4217 code, e.g. 'USD', 'CAD'
 * @returns {string}
 */
export function formatPrice(amount, currencyCode) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode || 'USD',
  }).format(amount);
}

export function getConfig() {
  const merged = { ...defaults, ...(window.CommerceConfig || {}) };
  merged.apiOrigin = resolveApiOrigin(merged.org, merged.site);
  return merged;
}
