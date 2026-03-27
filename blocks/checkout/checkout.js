import {
  buildBlock,
  decorateBlock,
  loadBlock,
  loadScript,
} from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';
import {
  estimateShipping,
  previewOrder,
  createOrder,
  initiatePayment,
} from '../../scripts/commerce-api.js';

const ADDRESS_FORM = 'https://main--vitamix--aemsites.aem.page/drafts/maxed/checkout/address-form.json';

let currentEstimateToken = null;
let currentPreview = null;
let selectedShippingMethodId = null;

/**
 * Derive country code from the current locale.
 * TODO: Remove drafts fallback before merging
 */
function getCountry() {
  const { locale } = getLocaleAndLanguage();
  if (locale === 'drafts') return 'ca';
  return locale;
}

/**
 * Get the locale string for the API.
 * TODO: Remove drafts fallback before merging
 */
function getLocale() {
  const { locale, language } = getLocaleAndLanguage();
  if (locale === 'drafts') return 'ca/fr_ca';
  return `${locale}/${language}`;
}

/**
 * Collect address fields from the form by prefix (shipping- or billing-).
 */
function collectAddress(form, formData, prefix, email) {
  const firstName = formData[`${prefix}firstname`] || '';
  const lastName = formData[`${prefix}lastname`] || '';
  // Use the state/province code (e.g., "QC") — the API matches against codes, not names
  const stateValue = formData[`${prefix}state`] || '';

  return {
    name: `${firstName} ${lastName}`.trim(),
    company: formData[`${prefix}company`] || '',
    address1: formData[`${prefix}street-0`] || '',
    address2: formData[`${prefix}street-1`] || '',
    city: formData[`${prefix}city`] || '',
    state: stateValue,
    zip: formData[`${prefix}zip`] || '',
    country: getCountry(),
    phone: formData[`${prefix}telephone`] || '',
    email,
  };
}

/**
 * Show an error message in the checkout form.
 */
function showError(formColumn, message) {
  let errorEl = formColumn.querySelector('.checkout-error');
  if (!errorEl) {
    errorEl = document.createElement('div');
    errorEl.className = 'checkout-error';
    formColumn.querySelector('form')?.prepend(errorEl);
  }
  errorEl.textContent = message;
  errorEl.removeAttribute('aria-hidden');
}

function clearError(formColumn) {
  const errorEl = formColumn.querySelector('.checkout-error');
  if (errorEl) {
    errorEl.setAttribute('aria-hidden', 'true');
  }
}

/**
 * Render shipping method radio buttons from API rates.
 */
function renderShippingMethods(container, rates) {
  container.innerHTML = '';
  const heading = document.createElement('h3');
  heading.textContent = 'Shipping Method';
  container.appendChild(heading);

  if (!rates || rates.length === 0) {
    const noRates = document.createElement('p');
    noRates.textContent = 'No shipping methods available for this address.';
    noRates.className = 'shipping-methods-empty';
    container.appendChild(noRates);
    return;
  }

  rates.forEach((rate, index) => {
    const label = document.createElement('label');
    label.className = 'shipping-method-option';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'shippingMethod';
    radio.value = rate.id;
    radio.required = true;
    if (index === 0) radio.checked = true;

    const text = document.createElement('span');
    text.className = 'shipping-method-label';
    text.textContent = rate.label;

    const price = document.createElement('span');
    price.className = 'shipping-method-price';
    price.textContent = rate.rate === 0 ? 'Free' : `$${parseFloat(rate.rate).toFixed(2)}`;

    label.append(radio, text, price);
    container.appendChild(label);
  });
}

/**
 * Fetch shipping rates and preview the order, dispatching an event with the results.
 */
async function fetchAndPreview(form, formData, shippingMethodsContainer) {
  const country = getCountry();
  // Use the select value (province code like "QC") for API calls,
  // not the display text ("Quebec") — the shipping sheet matches on codes
  const stateValue = formData['shipping-state'] || '';

  if (!stateValue) return;

  const { default: cart } = await import('../../scripts/cart.js');
  const items = cart.getItemsForAPI();
  if (items.length === 0) return;

  // fetch shipping rates
  shippingMethodsContainer.classList.add('loading');
  try {
    const { rates } = await estimateShipping(country, stateValue, items);
    renderShippingMethods(shippingMethodsContainer, rates);

    // auto-select first rate and preview
    const firstRate = shippingMethodsContainer.querySelector('input[name="shippingMethod"]:checked');
    if (firstRate) {
      selectedShippingMethodId = firstRate.value;
      await updatePreview(form, formData, cart);
    }

    // listen for rate changes
    shippingMethodsContainer.addEventListener('change', async (e) => {
      if (e.target.name === 'shippingMethod') {
        selectedShippingMethodId = e.target.value;
        const currentFormData = Object.fromEntries(new FormData(form).entries());
        await updatePreview(form, currentFormData, cart);
      }
    });
  } catch (err) {
    console.error('Failed to fetch shipping rates', err);
    renderShippingMethods(shippingMethodsContainer, []);
  } finally {
    shippingMethodsContainer.classList.remove('loading');
  }
}

/**
 * Call the order preview API to lock in estimates.
 */
async function updatePreview(form, formData, cart) {
  if (!selectedShippingMethodId) return;

  const email = formData.email || '';
  const shipping = collectAddress(form, formData, 'shipping-', email);

  const previewBody = {
    customer: {
      firstName: formData['shipping-firstname'] || '',
      lastName: formData['shipping-lastname'] || '',
      email,
    },
    shipping,
    items: cart.getItemsForAPI(),
    shippingMethod: { id: selectedShippingMethodId },
    country: getCountry(),
    locale: getLocale(),
  };

  try {
    console.debug('updatePreview: calling previewOrder with', previewBody);
    const preview = await previewOrder(previewBody);
    console.debug('updatePreview: got preview', preview);
    currentPreview = preview;
    currentEstimateToken = preview.estimateToken;

    document.dispatchEvent(new CustomEvent('checkout:preview', {
      detail: { preview },
    }));
  } catch (err) {
    console.error('Failed to preview order', err);
    currentPreview = null;
    currentEstimateToken = null;
  }
}

/**
 * Creates and decorates the checkout page with form and cart summary
 * @param {HTMLElement} block
 */
function showEmptyCart(block) {
  block.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'checkout-empty';
  empty.innerHTML = `
    <h2>Your cart is empty</h2>
    <p>Add some products to your cart to continue.</p>
    <a href="/" class="button emphasis">Continue shopping</a>
  `;
  block.appendChild(empty);
}

export default async function decorate(block) {
  // Check if cart has items
  const { default: cartCheck } = await import('../../scripts/cart.js');
  if (cartCheck.itemCount === 0) {
    showEmptyCart(block);
    return;
  }

  // Create the checkout layout
  const checkoutContainer = document.createElement('div');
  checkoutContainer.className = 'checkout-container';

  // Create left column (form)
  const formColumn = document.createElement('div');
  formColumn.className = 'checkout-form-column';

  // Create right column (cart summary)
  const summaryColumn = document.createElement('div');
  summaryColumn.className = 'checkout-summary-column';

  // Build the form block
  const formContent = [[`<a href="${ADDRESS_FORM}"></a>`]];
  const formBlock = buildBlock('form', formContent);
  formColumn.appendChild(formBlock);
  decorateBlock(formBlock);

  // Build the cart summary block
  const summaryBlock = buildBlock('cart-summary', []);
  summaryColumn.appendChild(summaryBlock);
  decorateBlock(summaryBlock);

  // Add columns to container
  checkoutContainer.appendChild(formColumn);
  checkoutContainer.appendChild(summaryColumn);

  // Replace block content
  block.replaceChildren(checkoutContainer);

  // Load both blocks
  await Promise.all([
    loadBlock(formBlock),
    loadBlock(summaryBlock),
  ]);

  // The form JSON has two sections both named "shipping":
  // 1. Shipping Address (address fields)
  // 2. Payment Method (billingEquals checkbox + payment radios)
  // Fix: identify them by heading, rename the payment one, and restructure
  const allShippingSections = formColumn.querySelectorAll('fieldset.form-section.section-shipping');
  const shippingAddressSection = allShippingSections[0]; // "Shipping Address"
  const paymentSection = allShippingSections[1]; // "Payment Method" (misnamed section-shipping)

  // Rename payment section to have its own class
  if (paymentSection) {
    paymentSection.classList.remove('section-shipping');
    paymentSection.classList.add('section-payment');
  }

  // Extract billingEqualsShipping checkbox from payment section → make it a form-level element
  const sameShipBillCheckbox = formColumn.querySelector('fieldset[data-name="billingEqualsShipping"] input[type="checkbox"]');
  const billingEqualsField = sameShipBillCheckbox?.closest('.form-field');
  if (billingEqualsField) {
    // Move it out of the payment section, right after shipping address
    shippingAddressSection.after(billingEqualsField);
  }

  // duplicate the shipping address form section to create billing address form
  const billingAddressSection = shippingAddressSection.cloneNode(true);
  billingAddressSection.classList.add('form-section', 'section-billing');
  billingAddressSection.querySelector('h3').textContent = 'Billing Address';
  billingAddressSection.dataset.name = 'billingAddress';

  // add shipping- and billing- prefix to all input id, names, and labels
  shippingAddressSection.querySelectorAll('input, select').forEach((input) => {
    input.id = `shipping-${input.id}`;
    input.name = `shipping-${input.name}`;
    if (input.previousElementSibling?.tagName === 'LABEL') {
      input.previousElementSibling.setAttribute('for', input.id);
    }
  });
  billingAddressSection.querySelectorAll('input, select').forEach((input) => {
    input.id = `billing-${input.id}`;
    input.name = `billing-${input.name}`;
    if (input.previousElementSibling?.tagName === 'LABEL') {
      input.previousElementSibling.setAttribute('for', input.id);
    }
  });

  // Insert billing address after the checkbox
  billingEqualsField.after(billingAddressSection);

  // hide billing address section by default
  billingAddressSection.setAttribute('aria-hidden', true);
  billingAddressSection.setAttribute('disabled', true);

  // show billing address section when sameShipBill is unchecked
  sameShipBillCheckbox.addEventListener('change', () => {
    billingAddressSection.setAttribute('aria-hidden', sameShipBillCheckbox.checked);
    billingAddressSection.setAttribute('disabled', sameShipBillCheckbox.checked);
  });

  // -- Shipping methods section --
  const shippingMethodsContainer = document.createElement('fieldset');
  shippingMethodsContainer.className = 'form-section shipping-methods';
  // insert before the payment method section wrapper
  // The payment checkboxes are inside a section like fieldset.section-paymentMethod
  const paymentMethodInner = formColumn.querySelector('fieldset[data-name="paymentMethod"]');
  const paymentMethodSection = paymentMethodInner?.closest('fieldset.form-section') || paymentMethodInner;
  if (paymentMethodSection) {
    paymentMethodSection.before(shippingMethodsContainer);
  } else {
    billingAddressSection.after(shippingMethodsContainer);
  }

  // Invalidate estimates when address fields change
  const form = formColumn.querySelector('form');
  const shippingInputs = shippingAddressSection.querySelectorAll('input, select');
  shippingInputs.forEach((input) => {
    input.addEventListener('change', () => {
      currentEstimateToken = null;
      currentPreview = null;
    });
  });

  // Override state dropdown with Canadian provinces for CA locale
  const stateSelect = form.querySelector('select#shipping-state');
  if (stateSelect && getCountry() === 'ca') {
    const provinces = [
      ['', 'Select province...'],
      ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'],
      ['NB', 'New Brunswick'], ['NL', 'Newfoundland and Labrador'],
      ['NS', 'Nova Scotia'], ['NT', 'Northwest Territories'], ['NU', 'Nunavut'],
      ['ON', 'Ontario'], ['PE', 'Prince Edward Island'], ['QC', 'Quebec'],
      ['SK', 'Saskatchewan'], ['YT', 'Yukon'],
    ];
    stateSelect.innerHTML = '';
    stateSelect.dataset.optionsOverridden = 'true';
    provinces.forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (!value) opt.disabled = true;
      stateSelect.appendChild(opt);
    });
    // Update label
    const stateLabel = stateSelect.previousElementSibling;
    if (stateLabel?.tagName === 'LABEL') {
      stateLabel.textContent = 'Province';
    }
  }

  // Fetch shipping rates when state is selected
  if (stateSelect) {
    stateSelect.addEventListener('change', () => {
      console.debug('checkout: state changed to', stateSelect.value);
      const formData = Object.fromEntries(new FormData(form).entries());
      fetchAndPreview(form, formData, shippingMethodsContainer);
    });
  } else {
    console.warn('checkout: select#shipping-state not found in form');
  }

  // Re-preview when cart items change (quantity update or item removed)
  document.addEventListener('cart:change', async (e) => {
    if (['update', 'remove'].includes(e.detail?.action)) {
      // Show empty cart if all items removed
      if (e.detail.cart.itemCount === 0) {
        showEmptyCart(block);
        return;
      }
      currentEstimateToken = null;
      currentPreview = null;
      if (selectedShippingMethodId) {
        const formData = Object.fromEntries(new FormData(form).entries());
        fetchAndPreview(form, formData, shippingMethodsContainer);
      }
    }
  });

  // TODO: Remove test prefill before merging
  const prefill = {
    email: 'test@example.com',
    'shipping-firstname': 'Jean',
    'shipping-lastname': 'Tremblay',
    'shipping-telephone': '514-555-1234',
    'shipping-street-0': '1234 Rue Sainte-Catherine',
    'shipping-street-1': '',
    'shipping-city': 'Montréal',
    'shipping-zip': 'H3B 1A7',
    'shipping-company': '',
  };
  Object.entries(prefill).forEach(([name, value]) => {
    const input = form.querySelector(`[name="${name}"]`);
    if (input) input.value = value;
  });
  // Prefill province — options are already loaded synchronously for CA
  if (stateSelect) {
    stateSelect.value = 'QC';
    stateSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // -- Pay buttons --
  const submitButtons = [...formColumn.querySelectorAll('form .button-wrapper button[type="submit"]')];
  submitButtons.forEach((button) => {
    let paymentMethod = 'Credit Card';
    if (button.textContent.toLowerCase().includes('paypal')) {
      paymentMethod = 'PayPal';
      button.textContent = button.textContent.replace('PayPal', '');
      const icon = document.createElement('img');
      icon.src = `${window.hlx.codeBasePath}/icons/paypal.svg`;
      icon.classList.add('icon', 'icon-paypal');
      button.appendChild(icon);
    } else if (button.textContent.toLowerCase().includes('apple')) {
      paymentMethod = 'Apple Pay';
    }

    const span = document.createElement('span');
    span.classList.add('payment-button');
    span.dataset.paymentMethod = paymentMethod;
    button.replaceWith(span);

    if (paymentMethod === 'PayPal') {
      span.classList.add('paypal');
      span.appendChild(button);
    } else if (paymentMethod === 'Apple Pay') {
      span.classList.add('apple-pay');
      loadScript('https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js');
      span.innerHTML = '<apple-pay-button buttonstyle="black" type="buy" locale="en-US"></apple-pay-button>';
    } else {
      span.classList.add('credit-card');
      span.appendChild(button);
      button.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        // validate form
        const isValid = form.checkValidity();
        if (!isValid) {
          form.reportValidity();
          return;
        }

        // must have a shipping method selected
        if (!selectedShippingMethodId) {
          showError(formColumn, 'Please select a shipping method.');
          return;
        }

        clearError(formColumn);

        button.classList.add('loading');
        button.textContent = 'Processing...';
        button.disabled = true;

        const reenableButton = () => {
          button.classList.remove('loading');
          button.textContent = 'Pay Now';
          button.disabled = false;
        };

        try {
          const formData = Object.fromEntries(new FormData(form).entries());
          const {
            email,
            'shipping-firstname': firstName,
            'shipping-lastname': lastName,
            'shipping-telephone': phone,
          } = formData;

          const shipping = collectAddress(form, formData, 'shipping-', email);
          const country = getCountry();

          // collect billing address if different from shipping
          let billingAddr;
          if (!sameShipBillCheckbox.checked) {
            billingAddr = collectAddress(form, formData, 'billing-', email);
          }

          // if we don't have a fresh preview, try to get one now
          if (!currentEstimateToken) {
            const { default: cartForPreview } = await import('../../scripts/cart.js');
            await updatePreview(form, formData, cartForPreview);
          }

          // block checkout if preview/estimates failed
          if (!currentEstimateToken || !currentPreview) {
            showError(formColumn, 'Unable to calculate shipping and taxes. Please try again.');
            reenableButton();
            return;
          }

          const { default: cart } = await import('../../scripts/cart.js');
          const order = cart.getOrderJSON(email, firstName, lastName, phone, shipping, {
            billingAddr,
            shippingMethod: selectedShippingMethodId,
            estimateToken: currentEstimateToken,
            locale: getLocale(),
            country,
          });

          console.debug('creating order', order);

          // save checkout context for confirmation page
          sessionStorage.setItem('checkout_email', email);
          sessionStorage.setItem('checkout_cart_items', JSON.stringify(cart.items));
          if (currentPreview) {
            sessionStorage.setItem('checkout_preview', JSON.stringify(currentPreview));
          }

          // create order
          const { order: createdOrder } = await createOrder(order);
          console.debug('order created', createdOrder);
          sessionStorage.setItem('checkout_order', JSON.stringify(createdOrder));

          // initiate payment
          const idempotencyKey = crypto.randomUUID();
          const payment = await initiatePayment(createdOrder.id, idempotencyKey);
          console.debug('payment initiated', payment);

          if (payment.action === 'redirect' && payment.redirectUrl) {
            // redirect to Chase hosted payment page
            window.location.href = payment.redirectUrl;
          } else {
            showError(formColumn, 'Unexpected payment response. Please try again.');
            reenableButton();
          }
        } catch (error) {
          console.error('Checkout failed', error);
          const message = error.body?.message || error.message || 'Something went wrong. Please try again.';
          showError(formColumn, message);
          reenableButton();
        }
      });
    }

    // default to credit card
    if (paymentMethod !== 'Credit Card') {
      span.setAttribute('aria-hidden', true);
    }
  });

  // handle payment method change
  const paymentMethodGroup = formColumn.querySelector('fieldset[data-name="paymentMethod"]');
  const payButtons = [...formColumn.querySelectorAll('form .button-wrapper span.payment-button')];
  paymentMethodGroup.addEventListener('change', () => {
    const paymentMethod = paymentMethodGroup.querySelector('input:checked').value;

    if (sameShipBillCheckbox.checked || paymentMethod !== 'Credit Card') {
      billingAddressSection.setAttribute('aria-hidden', true);
    } else {
      billingAddressSection.removeAttribute('aria-hidden');
    }

    payButtons.forEach((btn) => {
      if (paymentMethod !== btn.dataset.paymentMethod) {
        btn.setAttribute('aria-hidden', true);
      } else {
        btn.removeAttribute('aria-hidden');
        if (paymentMethod === 'Apple Pay') {
          const applePayButton = btn.querySelector('apple-pay-button');
          applePayButton.removeAttribute('hidden');
          applePayButton.removeAttribute('aria-hidden');
        }
      }
    });
  });
}
