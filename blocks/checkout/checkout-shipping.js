import { estimateShipping, previewOrder } from '../../scripts/commerce-api.js';
import { formatPrice } from '../../scripts/commerce-config.js';
import { wireRadioTabNav } from './checkout-form.js';

/**
 * Renders shipping method radio buttons into the container.
 * @param {HTMLFieldSetElement} container
 * @param {Array<{id: string, label: string, rate: number, eta?: string}>} rates
 * @param {Object} strings
 */
export function renderShippingMethods(container, rates, strings, currencyCode = 'USD') {
  [...container.children].forEach((child) => {
    if (child.tagName !== 'LEGEND') child.remove();
  });

  if (!rates?.length) {
    const empty = document.createElement('p');
    empty.className = 'shipping-methods-empty';
    empty.textContent = strings.noShippingMethods;
    container.appendChild(empty);
    return;
  }

  rates.forEach((rate, i) => {
    const label = document.createElement('label');
    label.className = 'shipping-method-option';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'shippingMethod';
    radio.value = rate.id;
    if (rate.type) radio.dataset.shippingType = rate.type;
    if (rate.label) radio.dataset.shippingLabel = rate.label;
    if (i === 0) radio.checked = true;

    const body = document.createElement('div');
    body.className = 'shipping-method-body';

    const labelText = document.createElement('span');
    labelText.className = 'shipping-method-label';
    labelText.textContent = rate.label;

    const isFree = parseFloat(rate.rate) === 0;
    const price = document.createElement('span');
    price.className = isFree ? 'shipping-method-price shipping-method-price-free' : 'shipping-method-price';
    price.textContent = isFree ? strings.free : formatPrice(parseFloat(rate.rate), currencyCode);

    body.append(labelText, price);

    if (rate.eta) {
      const eta = document.createElement('span');
      eta.className = 'shipping-method-eta';
      eta.textContent = rate.eta;
      body.appendChild(eta);
    }

    label.append(radio, body);

    container.appendChild(label);
  });
}

/**
 * Finds the best shipping radio after rates have been re-rendered.
 * Prefer the exact provider id, then the stable method type/label. Some
 * providers issue quantity/weight-specific ids for the same shipping service.
 *
 * @param {HTMLFieldSetElement} container
 * @param {{id?: string, type?: string, label?: string}} previousSelection
 * @returns {HTMLInputElement|null}
 */
export function findShippingMethodRadio(container, previousSelection = {}) {
  const { id, type, label } = previousSelection;
  const radios = [...container.querySelectorAll('input[type="radio"]')];
  return radios.find((radio) => id && radio.value === id)
    || radios.find((radio) => type && radio.dataset.shippingType === type)
    || radios.find((radio) => label && radio.dataset.shippingLabel === label)
    || radios[0]
    || null;
}

/**
 * Fetches a preview and dispatches checkout:preview event.
 * @param {HTMLFormElement} form
 * @param {Object} cart
 * @param {Object} state
 * @param {Object} config
 */
export async function updatePreview(form, cart, state, config) {
  if (!state.selectedShippingMethodId) return;

  const data = new FormData(form);
  const email = data.get('email') || '';
  const firstName = data.get('shipping-firstname') || '';
  const lastName = data.get('shipping-lastname') || '';
  const locale = config.getLocale();
  const language = config.getLanguage();

  const shippingAddr = {
    name: `${firstName} ${lastName}`.trim(),
    company: data.get('shipping-company') || '',
    address1: data.get('shipping-street-0') || '',
    address2: data.get('shipping-street-1') || '',
    city: data.get('shipping-city') || '',
    state: data.get('shipping-state') || '',
    zip: data.get('shipping-zip') || '',
    country: locale,
    phone: data.get('shipping-telephone') || '',
    email,
  };

  const orderBody = {
    shipping: Object.fromEntries(Object.entries(shippingAddr).filter(([, v]) => v !== '')),
    items: cart.getItemsForAPI(),
    shippingMethod: { id: state.selectedShippingMethodId },
    locale: `${language.split('_')[0]}-${(language.split('_')[1] || locale).toUpperCase()}`,
    country: locale,
    paymentMethod: data.get('paymentMethod') || null,
  };

  const couponCode = sessionStorage.getItem('checkout_coupon_code') || undefined;
  const couponSource = sessionStorage.getItem('checkout_coupon_source') || undefined;
  if (couponCode) {
    orderBody.couponCode = couponCode;
    if (couponSource) orderBody.couponSource = couponSource;
  }

  if (email && firstName && lastName) {
    orderBody.customer = {
      firstName,
      lastName,
      email,
      phone: data.get('shipping-telephone') || '',
    };
  }

  document.dispatchEvent(new CustomEvent('checkout:preview-loading'));

  try {
    const preview = await previewOrder(orderBody);
    state.currentEstimateToken = preview.estimateToken;
    state.currentPreview = preview;
    document.dispatchEvent(new CustomEvent('checkout:preview', { detail: { preview } }));
  } catch (err) {
    const COUPON_ERRORS = new Set([
      'coupon_invalid_format', 'coupon_not_found', 'coupon_inactive', 'coupon_expired',
      'coupon_exhausted', 'coupon_country_mismatch', 'coupon_minimum_not_met',
      'coupon_product_not_eligible', 'coupon_manual_entry_rejected', 'unauthorized',
    ]);
    const couponError = COUPON_ERRORS.has(err?.errorHeader) ? err.errorHeader : null;
    if (couponError) {
      sessionStorage.removeItem('checkout_coupon_code');
      sessionStorage.removeItem('checkout_coupon_source');
    }
    document.dispatchEvent(new CustomEvent('checkout:preview', { detail: { preview: null, couponError } }));
  }
}

/**
 * Clears the currently signed preview state after order-affecting changes.
 * @param {Object} state
 */
export function clearPreviewState(state) {
  state.currentEstimateToken = null;
  state.currentPreview = null;
}

/**
 * Returns whether the shopper has explicitly selected a payment method.
 * @param {Object} state
 * @returns {boolean}
 */
export function hasExplicitPaymentSelection(state) {
  return state.paymentMethodSelected === true;
}

/**
 * Returns whether a preview should run after order-affecting changes.
 * @param {Object} state
 * @returns {boolean}
 */
export function shouldUpdatePreviewAfterPaymentSelection(state) {
  return hasExplicitPaymentSelection(state) && Boolean(state.selectedShippingMethodId);
}

/**
 * Refreshes the order preview only after explicit payment selection.
 * @param {HTMLFormElement} form
 * @param {Object} cart
 * @param {Object} state
 * @param {Object} config
 * @returns {Promise<void>}
 */
export async function updatePreviewAfterPaymentSelection(form, cart, state, config) {
  if (shouldUpdatePreviewAfterPaymentSelection(state)) {
    await updatePreview(form, cart, state, config);
  }
}

/**
 * Fetches shipping rates then triggers a preview.
 * @param {HTMLFormElement} form
 * @param {HTMLFieldSetElement} shippingContainer
 * @param {Object} cart
 * @param {Object} state
 * @param {Object} config
 * @param {Object} strings
 */
// eslint-disable-next-line max-len
async function fetchAndPreview(form, shippingContainer, cart, state, config, strings, currencyCode) {
  const data = new FormData(form);
  const stateCode = data.get('shipping-state');
  if (!stateCode || !cart.itemCount) return;

  const locale = config.getLocale();
  const country = locale === 'ca' ? 'ca' : 'us';

  const couponCode = sessionStorage.getItem('checkout_coupon_code') || undefined;
  const couponSource = sessionStorage.getItem('checkout_coupon_source') || undefined;

  try {
    const previousRadio = shippingContainer.querySelector('input[name="shippingMethod"]:checked');
    const previousSelection = {
      id: state.selectedShippingMethodId,
      type: previousRadio?.dataset.shippingType,
      label: previousRadio?.dataset.shippingLabel,
    };

    const result = await estimateShipping(
      country,
      stateCode,
      cart.getItemsForAPI(),
      couponCode,
      couponSource,
    );
    renderShippingMethods(shippingContainer, result.rates || [], strings, currencyCode);

    // Preserve the user's previous selection; fall back to the first method.
    const targetRadio = findShippingMethodRadio(shippingContainer, previousSelection);
    if (targetRadio) {
      targetRadio.checked = true;
      state.selectedShippingMethodId = targetRadio.value;
      clearPreviewState(state);
      shippingContainer.dispatchEvent(new CustomEvent('checkout:shipping-selected', { bubbles: true }));
      await updatePreviewAfterPaymentSelection(form, cart, state, config);
    }
  } catch {
    renderShippingMethods(shippingContainer, [], strings, currencyCode);
  }
}

/**
 * @param {HTMLFormElement} form
 * @param {HTMLFieldSetElement} shippingContainer
 * @param {Object} cart
 * @param {Object} state
 * @param {Object} config
 * @param {Object} strings
 */
export function initShipping(form, shippingContainer, cart, state, config, strings) {
  const currencyCode = typeof config.currency === 'function' ? config.currency(config.getLocale()) : config.currency;

  // Show placeholder until an address is entered
  const placeholder = document.createElement('p');
  placeholder.className = 'shipping-methods-placeholder';
  placeholder.textContent = strings.shippingPlaceholder;
  shippingContainer.appendChild(placeholder);

  wireRadioTabNav(shippingContainer, 'shippingMethod');

  // Fetch rates when state/province changes
  const stateSelect = form.querySelector('[name="shipping-state"]');
  if (stateSelect) {
    stateSelect.addEventListener('change', () => {
      state.selectedShippingMethodId = null;
      fetchAndPreview(form, shippingContainer, cart, state, config, strings, currencyCode);
    });
  }

  // Update preview when shipping method is selected
  shippingContainer.addEventListener('change', (e) => {
    if (e.target.name === 'shippingMethod') {
      state.selectedShippingMethodId = e.target.value;
      clearPreviewState(state);
      shippingContainer.dispatchEvent(new CustomEvent('checkout:shipping-selected', { bubbles: true }));
      updatePreviewAfterPaymentSelection(form, cart, state, config);
    }
  });

  return () => fetchAndPreview(form, shippingContainer, cart, state, config, strings, currencyCode);
}
