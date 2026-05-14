const { hostname } = window.location;

function resolveApiOrigin(org, site) {
  const isProduction = !hostname.endsWith('.aem.page')
    && !hostname.endsWith('.aem.live')
    && !hostname.endsWith('.aem.network')
    && hostname !== 'localhost'
    && !hostname.startsWith('127.')
    && !hostname.startsWith('integration.');
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
  cardProvider: 'chase',
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
      continueShopping: 'Continue shopping',
      apply: 'Apply',
      subtotal: 'Subtotal',
      shipping: 'Shipping',
      estimatedTaxes: 'Estimated taxes',
      total: 'Total',
      free: 'Free',
      or: 'or',
      orderSummary: 'Order summary',
      discountPlaceholder: 'Discount code or gift card',
    },
    'fr-ca': {
      stepCart: 'Panier',
      stepCheckout: 'Caisse',
      stepConfirmation: 'Confirmation',
      checkoutStepsLabel: 'Étapes de la caisse',
      remove: 'Retirer',
      removeItem: "Retirer l'article",
      continueShopping: 'Continuer vos achats',
      apply: 'Appliquer',
      subtotal: 'Sous-total',
      shipping: 'Livraison',
      estimatedTaxes: 'Taxes estimées',
      total: 'Total',
      free: 'Gratuit',
      or: 'ou',
      orderSummary: 'Récapitulatif de commande',
      discountPlaceholder: 'Code de réduction ou carte-cadeau',
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
