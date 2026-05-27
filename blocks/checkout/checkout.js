import { loadCSS, loadBlock } from '../../scripts/aem.js';
import { getConfig, formatPrice } from '../../scripts/commerce-config.js';
import cart from '../../scripts/cart.js';
import applePay, { beginCheckoutSession } from '../../scripts/payments/apple-pay.js';
import paypal from '../../scripts/payments/paypal.js';
import affirm from '../../scripts/payments/affirm.js';
import chase from '../../scripts/payments/chase.js';
import buildForm, { initCollapse } from './checkout-form.js';
import { initAddress } from './checkout-address.js';
import { initShipping, updatePreview } from './checkout-shipping.js';
import { initOrder } from './checkout-order.js';
import { initPayment } from './checkout-payment.js';
import { parsePreview } from '../../scripts/commerce-api.js';

const ALL_PROVIDERS = [chase, applePay, paypal, affirm];

const LOCAL_STRINGS = {
  'en-us': {
    signIn: 'Sign in for faster checkout',
    expressCheckout: 'Express checkout',
    expressTagline: 'Skip the form — pay in seconds',
    expressOr: 'or continue manually',
    contact: 'Contact',
    email: 'Email',
    newsletter: 'Email me with news and offers',
    shippingAddress: 'Shipping address',
    firstName: 'First name',
    lastName: 'Last name',
    address: 'Address',
    addressLine2: 'Apt, suite, etc. (optional)',
    city: 'City',
    state: 'State',
    province: 'Province',
    zip: 'ZIP code',
    postalCode: 'Postal code',
    phone: 'Phone (optional)',
    giftMessage: 'Gift message',
    giftMessagePlaceholder: 'Add a gift message (optional)',
    billingAddress: 'Billing address',
    billingSubtitle: "Needed for the card you'll use on the secure payment page.",
    billingSame: 'Same as shipping address',
    billingDifferent: 'Use a different billing address',
    paymentMethod: 'Payment method',
    paymentSecureTitle: 'Payment happens on our secure, PCI-compliant page',
    paymentSecureSub: "Review your order here, then we'll redirect you to finish paying. No card details are ever stored on our servers.",
    paymentHow: "How you'd like to pay",
    creditCard: 'Credit or debit card',
    creditCardSub: "You'll enter your card on the next secure page",
    paypalLabel: 'PayPal',
    paypalSub: 'Continue on paypal.com',
    applePayLabel: 'Apple Pay',
    applePaySub: 'Continue with Apple Pay',
    affirmLabel: 'Affirm',
    affirmSub: 'Pay over time with Affirm',
    orderTotal: 'Order total',
    tnc: 'By placing this order you agree to our Terms & Privacy Policy.',
    continueToPayment: 'Continue to payment',
    edit: 'Edit',
    cartEmpty: 'Your cart is empty.',
    noShippingMethods: 'No shipping methods available for this address.',
    shippingPlaceholder: 'Enter your shipping address to see available methods.',
    errorSelectShipping: 'Please select a shipping method.',
    errorCalculateTotals: 'Unable to calculate totals. Please try again.',
    errorGeneric: 'An error occurred. Please try again.',
    processing: 'Processing…',
    addressEyebrow: 'Address verification',
    addressHeading: 'We found a more accurate version',
    addressSubtitle: 'Choose which address to use for shipping.',
    addressWhatEntered: 'What you entered',
    addressSuggestedBy: 'Suggested',
    addressRecommended: 'Recommended',
    addressUseSuggested: 'Use suggested address',
    addressKeepMine: 'Keep my address',
    addressUnitEyebrow: 'One more thing',
    addressUnitHeading: 'Add an apartment or unit number?',
    addressUnitSubtitle: 'Your building has multiple units. Adding one helps couriers reach you on the first try.',
    addressUnitLabel: 'Apartment, suite, floor, or unit',
    addressUnitPlaceholder: 'Apt 4B, Floor 12, Suite 200…',
    addressUnitContinue: 'Add unit & continue',
    addressUnitNoUnit: "I don't have one — continue",
    addressInvalid: "We couldn't verify this address. Please check and try again.",
  },
  'fr-ca': {
    signIn: 'Se connecter pour un paiement plus rapide',
    expressCheckout: 'Paiement express',
    expressTagline: 'Évitez le formulaire — payez en quelques secondes',
    expressOr: 'ou continuer manuellement',
    contact: 'Contact',
    email: 'Courriel',
    newsletter: "M'envoyer des nouvelles et des offres par courriel",
    shippingAddress: 'Adresse de livraison',
    firstName: 'Prénom',
    lastName: 'Nom de famille',
    address: 'Adresse',
    addressLine2: 'App., suite, etc. (facultatif)',
    city: 'Ville',
    state: 'État',
    province: 'Province',
    zip: 'Code ZIP',
    postalCode: 'Code postal',
    phone: 'Téléphone (facultatif)',
    giftMessage: 'Message cadeau',
    giftMessagePlaceholder: 'Ajouter un message cadeau (facultatif)',
    billingAddress: 'Adresse de facturation',
    billingSubtitle: 'Nécessaire pour la carte que vous utiliserez sur la page de paiement sécurisée.',
    billingSame: "Même que l'adresse de livraison",
    billingDifferent: 'Utiliser une adresse de facturation différente',
    paymentMethod: 'Mode de paiement',
    paymentSecureTitle: "Le paiement s'effectue sur notre page sécurisée et conforme PCI",
    paymentSecureSub: "Vérifiez votre commande ici, puis nous vous redirigerons pour finaliser le paiement. Aucune donnée de carte n'est jamais stockée sur nos serveurs.",
    paymentHow: 'Comment souhaitez-vous payer',
    creditCard: 'Carte de crédit ou de débit',
    creditCardSub: 'Vous saisirez votre carte sur la prochaine page sécurisée',
    paypalLabel: 'PayPal',
    paypalSub: 'Continuer sur paypal.com',
    applePayLabel: 'Apple Pay',
    applePaySub: 'Continuer avec Apple Pay',
    affirmLabel: 'Affirm',
    affirmSub: 'Payer en plusieurs fois avec Affirm',
    orderTotal: 'Total de la commande',
    tnc: 'En passant cette commande, vous acceptez nos Conditions générales et notre Politique de confidentialité.',
    continueToPayment: 'Continuer vers le paiement',
    edit: 'Modifier',
    cartEmpty: 'Votre panier est vide.',
    noShippingMethods: 'Aucune méthode de livraison disponible pour cette adresse.',
    shippingPlaceholder: 'Entrez votre adresse de livraison pour voir les méthodes disponibles.',
    errorSelectShipping: 'Veuillez sélectionner une méthode de livraison.',
    errorCalculateTotals: 'Impossible de calculer les totaux. Veuillez réessayer.',
    errorGeneric: 'Une erreur est survenue. Veuillez réessayer.',
    processing: 'Traitement en cours…',
    addressEyebrow: "Vérification d'adresse",
    addressHeading: 'Nous avons trouvé une version plus précise',
    addressSubtitle: 'Choisissez quelle adresse utiliser pour la livraison.',
    addressWhatEntered: 'Ce que vous avez saisi',
    addressSuggestedBy: 'Suggérée',
    addressRecommended: 'Recommandée',
    addressUseSuggested: "Utiliser l'adresse suggérée",
    addressKeepMine: 'Garder mon adresse',
    addressUnitEyebrow: 'Encore une chose',
    addressUnitHeading: "Ajouter un numéro d'appartement ou de suite ?",
    addressUnitSubtitle: 'Votre immeuble compte plusieurs unités. En ajouter une aide les livreurs à vous trouver du premier coup.',
    addressUnitLabel: 'Appartement, suite, étage ou unité',
    addressUnitPlaceholder: 'App. 4B, étage 12, suite 200…',
    addressUnitContinue: 'Ajouter et continuer',
    addressUnitNoUnit: "Je n'en ai pas — continuer",
    addressInvalid: "Nous n'avons pas pu vérifier cette adresse. Veuillez vérifier et réessayer.",
  },
};

function getStrings(config) {
  const lang = config.getLanguage().toLowerCase().replace('_', '-');
  return { ...config.getStrings(), ...(LOCAL_STRINGS[lang] || LOCAL_STRINGS['en-us']) };
}

export default async function decorate(block) {
  await loadCSS('/styles/commerce-tokens.css');
  const config = getConfig();
  const strings = getStrings(config);

  // Empty cart guard
  if (cart.itemCount === 0) {
    block.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'checkout-empty';
    const p = document.createElement('p');
    p.textContent = strings.cartEmpty;
    const link = document.createElement('a');
    link.href = '/';
    link.className = 'button';
    link.textContent = strings.continueShopping;
    empty.append(p, link);
    block.appendChild(empty);
    return;
  }

  block.innerHTML = '';

  // If cart is emptied during checkout, reload to show the empty state
  document.addEventListener('cart:change', () => {
    if (cart.itemCount === 0) window.location.reload();
  });

  // Shared mutable state passed by reference to all modules
  const state = {
    selectedShippingMethodId: null,
    currentEstimateToken: null,
    currentPreview: null,
  };

  // Build form
  const form = buildForm(block, config, strings);

  // Seed and update order total amount + mobile breakdown
  const orderTotalAmountEl = form.querySelector('.order-total-amount');
  if (orderTotalAmountEl) {
    const currencyCode = typeof config.currency === 'function' ? config.currency(config.getLocale()) : config.currency;
    const breakdownEl = form.querySelector('.order-total-breakdown');
    const breakdownSubtotalEl = form.querySelector('.order-breakdown-subtotal');
    const breakdownShippingEl = form.querySelector('.order-breakdown-shipping');
    const breakdownTaxesEl = form.querySelector('.order-breakdown-taxes');

    const updateBreakdown = (subtotal, shipping, taxes) => {
      // eslint-disable-next-line max-len
      if (breakdownSubtotalEl) breakdownSubtotalEl.textContent = formatPrice(subtotal, currencyCode);
      if (breakdownShippingEl) breakdownShippingEl.textContent = shipping;
      if (breakdownTaxesEl) breakdownTaxesEl.textContent = taxes;
    };

    const seedInitial = () => {
      orderTotalAmountEl.textContent = formatPrice(cart.subtotal, currencyCode);
      updateBreakdown(cart.subtotal, '--', '--');
    };
    seedInitial();

    document.addEventListener('cart:change', () => { if (cart.itemCount > 0) seedInitial(); });

    document.addEventListener('checkout:preview-loading', () => {
      breakdownEl?.classList.add('loading');
    });

    document.addEventListener('checkout:preview', (e) => {
      breakdownEl?.classList.remove('loading');
      const { preview } = e.detail || {};
      if (!preview) return;
      const {
        subtotal, taxAmount, shippingRate, total,
      } = parsePreview(preview, cart.subtotal);
      orderTotalAmountEl.textContent = formatPrice(total, currencyCode);
      const shippingDisplay = shippingRate === 0
        ? strings.free
        : formatPrice(parseFloat(shippingRate), currencyCode);
      updateBreakdown(subtotal, shippingDisplay, formatPrice(taxAmount, currencyCode));
    });
  }

  // Wire address fields and billing toggle
  const { validateAndCollapse } = initAddress(form, state, config, strings);

  // Section collapse — contact
  const contactSection = form.querySelector('.contact-section');
  initCollapse(contactSection, {
    getIsValid: () => {
      const email = form.querySelector('[name="email"]');
      return !!email?.checkValidity() && email.value.trim() !== '';
    },
    getSummary: () => form.querySelector('[name="email"]')?.value || '',
  }, strings);

  // Section collapse — shipping address
  // autoCollapse is disabled so focusout triggers address validation before collapsing.
  const shippingAddrSection = form.querySelector('.shipping-address-section');
  const { collapse: collapseShipping } = initCollapse(shippingAddrSection, {
    getIsValid: () => [...shippingAddrSection.querySelectorAll('[required]')].every(
      (el) => el.checkValidity(),
    ),
    getSummary: () => {
      const data = new FormData(form);
      // eslint-disable-next-line max-len
      const name = `${data.get('shipping-firstname') || ''} ${data.get('shipping-lastname') || ''}`.trim();
      const city = data.get('shipping-city') || '';
      const stateCode = data.get('shipping-state') || '';
      const location = [city, stateCode].filter(Boolean).join(', ');
      return [name, location].filter(Boolean).join(' · ');
    },
    autoCollapse: false,
  }, strings);

  let validatingShipping = false;
  shippingAddrSection.addEventListener('focusout', async (e) => {
    if (shippingAddrSection.contains(e.relatedTarget)) return;
    if (validatingShipping) return;
    validatingShipping = true;
    try {
      await validateAndCollapse(collapseShipping);
    } finally {
      validatingShipping = false;
    }
  });

  // Wire shipping rate fetching and preview
  const shippingContainer = form.querySelector('.shipping-methods');
  initShipping(form, shippingContainer, cart, state, config, strings);

  // When the cart changes mid-checkout, invalidate the stale estimate and
  // re-run the preview so totals stay accurate. The empty-cart listener above
  // handles the zero-items case via reload; this handles qty changes and
  // partial removes while items remain.
  document.addEventListener('cart:change', () => {
    if (cart.itemCount === 0) return;
    state.currentEstimateToken = null;
    state.currentPreview = null;
    if (state.selectedShippingMethodId) {
      updatePreview(form, cart, state, config);
    }
  });

  // Retry preview when customer identity fields are filled after shipping is already selected.
  // This handles the case where state/province is chosen before email or name is entered,
  // causing the first updatePreview call to bail out on the missing-fields guard.
  ['email', 'shipping-firstname', 'shipping-lastname'].forEach((name) => {
    const input = form.querySelector(`[name="${name}"]`);
    if (!input) return;
    input.addEventListener('blur', () => {
      if (input.value && state.selectedShippingMethodId && !state.currentPreview) {
        updatePreview(form, cart, state, config);
      }
    });
  });

  // Re-run preview when a coupon code is applied from the order summary sidebar.
  document.addEventListener('checkout:coupon-apply', () => {
    if (state.selectedShippingMethodId) updatePreview(form, cart, state, config);
  });

  // Wire Chase submit and get shared callbacks for providers
  const callbacks = initOrder(form, cart, state, config, strings);

  // Apple Pay must be initiated synchronously from the submit button's trusted click gesture
  callbacks.beginApplePay = () => beginCheckoutSession(config, callbacks);

  // Register providers, check availability, render buttons
  const paymentContainer = form.querySelector('.payment-method-section');
  await initPayment(paymentContainer, ALL_PROVIDERS, callbacks, config, strings);

  // Re-run preview on payment method change — tax may vary by type (e.g. Avalara surcharge)
  paymentContainer.addEventListener('change', (e) => {
    if (e.target.name === 'paymentMethod') updatePreview(form, cart, state, config);
  });

  // Inject order-summary block into this section if the author didn't add one
  const section = block.closest('.section');
  if (section && !section.querySelector('.order-summary-wrapper')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'order-summary-wrapper';
    const orderSummaryBlock = document.createElement('div');
    orderSummaryBlock.className = 'order-summary block';
    orderSummaryBlock.dataset.blockName = 'order-summary';
    wrapper.appendChild(orderSummaryBlock);
    section.appendChild(wrapper);
    loadBlock(orderSummaryBlock);
  }

  // Restore page from bfcache after payment provider redirect
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      const submitBtn = form.querySelector('.checkout-submit-btn');
      if (submitBtn) {
        submitBtn.disabled = false;
        const submitTextEl = submitBtn.querySelector('.submit-btn-text');
        if (submitTextEl) submitTextEl.textContent = strings.continueToPayment;
      }
    }
  });
}
