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
import { ensurePriceRulesLoaded, evaluateGWP } from '../../scripts/gift-with-purchase.js';
import { validateField } from './checkout-validation.js';
import { formStateKey, saveFormState, restoreFormState } from './checkout-session-state.js';

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
    isThisAGift: 'Is this a gift?',
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
    errorRecaptcha: 'Security verification failed. Please refresh the page and try again.',
    errorGeneric: 'An error occurred. Please try again.',
    processing: 'Processing…',
    addressEyebrow: 'Address verification',
    addressHeading: 'We found a more accurate version',
    addressSubtitle: 'Use the suggested address or edit your address before continuing.',
    addressWhatEntered: 'What you entered',
    addressSuggestedBy: 'Suggested',
    addressRecommended: 'Recommended',
    addressUseSuggested: 'Use this address',
    addressEdit: 'Edit address',
    addressUnitEyebrow: 'One more thing',
    addressUnitHeading: 'Add an apartment or unit number?',
    addressUnitSubtitle: 'Your building has multiple units. Add a unit or edit your address before continuing.',
    addressUnitLabel: 'Apartment, suite, floor, or unit',
    addressUnitPlaceholder: 'Apt 4B, Floor 12, Suite 200…',
    addressUnitContinue: 'Add unit & continue',
    addressInvalid: "We couldn't verify this address. Please check and try again.",
    addressCompleteRequired: 'Please complete and verify your address before continuing.',
    addressValidationUnavailable: 'Unable to verify this address. Please check it and try again.',
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
    isThisAGift: 'Est-ce un cadeau ?',
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
    errorRecaptcha: 'Échec de la vérification de sécurité. Veuillez actualiser la page et réessayer.',
    errorGeneric: 'Une erreur est survenue. Veuillez réessayer.',
    processing: 'Traitement en cours…',
    addressEyebrow: "Vérification d'adresse",
    addressHeading: 'Nous avons trouvé une version plus précise',
    addressSubtitle: "Utilisez l'adresse suggérée ou modifiez votre adresse avant de continuer.",
    addressWhatEntered: 'Ce que vous avez saisi',
    addressSuggestedBy: 'Suggérée',
    addressRecommended: 'Recommandée',
    addressUseSuggested: 'Utiliser cette adresse',
    addressEdit: "Modifier l'adresse",
    addressUnitEyebrow: 'Encore une chose',
    addressUnitHeading: "Ajouter un numéro d'appartement ou de suite ?",
    addressUnitSubtitle: 'Votre immeuble compte plusieurs unités. Ajoutez une unité ou modifiez votre adresse avant de continuer.',
    addressUnitLabel: 'Appartement, suite, étage ou unité',
    addressUnitPlaceholder: 'App. 4B, étage 12, suite 200…',
    addressUnitContinue: 'Ajouter et continuer',
    addressInvalid: "Nous n'avons pas pu vérifier cette adresse. Veuillez vérifier et réessayer.",
    addressCompleteRequired: 'Veuillez compléter et vérifier votre adresse avant de continuer.',
    addressValidationUnavailable: 'Impossible de vérifier cette adresse. Veuillez la vérifier et réessayer.',
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
  const locale = config.getLocale();

  // Reconcile gift-with-purchase before the empty-cart guard — a returning
  // visitor whose cart no longer qualifies needs the stale gift removed,
  // and a visitor who newly qualifies needs the gift added so totals reflect
  // it. Fire-and-forget; the cart:change re-render path picks up the result.
  ensurePriceRulesLoaded({ reason: 'checkout-block-init' }).then(() => evaluateGWP());

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
    shippingAddressValidated: false,
    billingAddressValidated: false,
    ensureValidShippingAddress: null,
    ensureValidBillingAddress: null,
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
      const { preview, error } = e.detail || {};
      if (!preview) {
        if (error?.status === 403 && error?.errorHeader?.toLowerCase().includes('recaptcha')) {
          const errorEl = form.querySelector('.checkout-error');
          if (errorEl) {
            errorEl.textContent = strings.errorRecaptcha;
            errorEl.hidden = false;
            errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
        return;
      }
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
  const {
    validateAndCollapse,
    validateBillingAndCollapse,
  } = initAddress(form, state, config, strings);

  // Restore any previously entered form data (e.g. after browser back from payment page)
  restoreFormState(form, locale);
  form.addEventListener('input', () => saveFormState(form, locale));
  form.addEventListener('change', () => saveFormState(form, locale));
  // pagehide fires reliably before any navigation and covers autofill (which may skip input/change)
  window.addEventListener('pagehide', () => saveFormState(form, locale));

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
      (el) => el.checkValidity() && !validateField(el),
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

  let shippingValidationPromise = null;
  const runShippingValidation = () => {
    if (shippingValidationPromise) return shippingValidationPromise;
    shippingValidationPromise = validateAndCollapse(collapseShipping)
      .finally(() => { shippingValidationPromise = null; });
    return shippingValidationPromise;
  };
  state.ensureValidShippingAddress = runShippingValidation;

  shippingAddrSection.addEventListener('focusout', async (e) => {
    if (!e.relatedTarget) return;
    if (shippingAddrSection.contains(e.relatedTarget)) return;
    if (e.relatedTarget.closest?.('.checkout-submit-btn')) return;
    await runShippingValidation();
  });

  // Re-apply shipping section collapse state from session storage. When the user
  // returns to checkout after navigating away, the address fields are restored by
  // restoreFormState but the section UI starts expanded. If the address was already
  // validated and collapsed when they left, collapse it again so the summary shows.
  (() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(formStateKey(locale)));
      if (saved?.shippingCollapsed) {
        state.shippingAddressValidated = true;
        collapseShipping();
      }
    } catch { /* ignore */ }
  })();

  // Section collapse — billing address
  const billingSection = form.querySelector('.billing-section');
  const { collapse: collapseBilling } = initCollapse(billingSection, {
    getIsValid: () => {
      const useDifferent = form.querySelector('[name="billing-choice"]:checked')?.value === 'different';
      if (!useDifferent) return true;
      const billingFields = billingSection.querySelector('.billing-fields-wrapper');
      return [...billingFields.querySelectorAll('[required]')].every(
        (el) => el.checkValidity() && !validateField(el),
      );
    },
    getSummary: () => {
      const useDifferent = form.querySelector('[name="billing-choice"]:checked')?.value === 'different';
      if (!useDifferent) return strings.billingSame;
      const data = new FormData(form);
      const name = `${data.get('billing-firstname') || ''} ${data.get('billing-lastname') || ''}`.trim();
      const city = data.get('billing-city') || '';
      const stateCode = data.get('billing-state') || '';
      const location = [city, stateCode].filter(Boolean).join(', ');
      return [name, location].filter(Boolean).join(' · ');
    },
    autoCollapse: false,
  }, strings);

  let billingValidationPromise = null;
  const runBillingValidation = () => {
    if (billingValidationPromise) return billingValidationPromise;
    billingValidationPromise = validateBillingAndCollapse(collapseBilling)
      .finally(() => { billingValidationPromise = null; });
    return billingValidationPromise;
  };
  state.ensureValidBillingAddress = runBillingValidation;

  const billingFieldsWrapper = billingSection.querySelector('.billing-fields-wrapper');
  billingFieldsWrapper?.addEventListener('focusout', async (e) => {
    if (!e.relatedTarget) return;
    if (billingFieldsWrapper.contains(e.relatedTarget)) return;
    if (e.relatedTarget.closest?.('.checkout-submit-btn')) return;
    await runBillingValidation();
  });

  // Wire shipping rate fetching and preview
  const shippingContainer = form.querySelector('.shipping-methods');
  const refreshShipping = initShipping(form, shippingContainer, cart, state, config, strings);

  // If the address was restored from sessionStorage on this page load, the
  // state select has a value but no `change` event ever fired — so the
  // estimate/preview chain never ran. Trigger it once now. fetchAndPreview
  // self-guards on missing state or empty cart, so calling it
  // unconditionally is safe.
  if (form.elements['shipping-state']?.value) {
    refreshShipping();
  }

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

  // Re-fetch shipping rates when a coupon is applied or removed so the method
  // list reflects any free-shipping discount. updatePreview is called inside
  // refreshShipping after the rates are rendered.
  document.addEventListener('checkout:coupon-apply', () => {
    refreshShipping();
  });

  // Wire Chase submit and get shared callbacks for providers
  const callbacks = initOrder(form, cart, state, config, strings);

  // Clear saved form state when the order completes so a fresh checkout starts clean
  const { onComplete } = callbacks;
  callbacks.onComplete = (createdOrder) => {
    try { sessionStorage.removeItem(formStateKey(locale)); } catch { /* ignore */ }
    onComplete(createdOrder);
  };

  // Apple Pay must be initiated synchronously from the submit button's trusted click gesture
  callbacks.beginApplePay = () => beginCheckoutSession(config, callbacks);

  // Register providers, check availability, render buttons
  const paymentContainer = form.querySelector('.payment-method-section');
  await initPayment(paymentContainer, ALL_PROVIDERS, callbacks, config, strings, cart.subtotal);

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
      // decorate() doesn't re-run for bfcache hits — restore form data here
      restoreFormState(form, locale);
      // ...and re-trigger the estimate/preview chain for the restored address,
      // matching the initial-load path above.
      if (form.elements['shipping-state']?.value) {
        refreshShipping();
      }
    }
  });
}
