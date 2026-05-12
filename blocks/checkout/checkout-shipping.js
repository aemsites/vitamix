import { estimateShipping, previewOrder } from '../../scripts/commerce-api.js';
import { formatPrice } from '../../scripts/commerce-config.js';

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
    if (i === 0) radio.checked = true;

    const body = document.createElement('div');
    body.className = 'shipping-method-body';

    const labelText = document.createElement('span');
    labelText.className = 'shipping-method-label';
    labelText.textContent = rate.label;

    const isFree = rate.rate === 0;
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

    label.append(body, radio);

    container.appendChild(label);
  });
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

  // Preview requires customer identity — skip if not yet filled
  if (!email || !firstName || !lastName) return;
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
    customer: {
      firstName,
      lastName,
      email,
      phone: data.get('shipping-telephone') || '',
    },
    shipping: Object.fromEntries(Object.entries(shippingAddr).filter(([, v]) => v !== '')),
    billing: Object.fromEntries(Object.entries(shippingAddr).filter(([, v]) => v !== '')),
    items: cart.getItemsForAPI(),
    shippingMethod: { id: state.selectedShippingMethodId },
    locale: `${language.split('_')[0]}-${(language.split('_')[1] || locale).toUpperCase()}`,
    country: locale,
    paymentMethod: data.get('paymentMethod') || null,
  };

  document.dispatchEvent(new CustomEvent('checkout:preview-loading'));

  try {
    const preview = await previewOrder(orderBody);
    state.currentEstimateToken = preview.estimateToken;
    state.currentPreview = preview;
    document.dispatchEvent(new CustomEvent('checkout:preview', { detail: { preview } }));
  } catch {
    document.dispatchEvent(new CustomEvent('checkout:preview', { detail: { preview: null } }));
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

  try {
    const result = await estimateShipping(country, stateCode, cart.getItemsForAPI());
    renderShippingMethods(shippingContainer, result.rates || [], strings, currencyCode);

    const firstRadio = shippingContainer.querySelector('input[type="radio"]');
    if (firstRadio) {
      state.selectedShippingMethodId = firstRadio.value;
      shippingContainer.dispatchEvent(new CustomEvent('checkout:shipping-selected', { bubbles: true }));
      await updatePreview(form, cart, state, config);
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
      shippingContainer.dispatchEvent(new CustomEvent('checkout:shipping-selected', { bubbles: true }));
      updatePreview(form, cart, state, config);
    }
  });

  // Re-run preview when cart changes
  document.addEventListener('cart:change', () => {
    if (state.selectedShippingMethodId) {
      updatePreview(form, cart, state, config);
    }
  });
}
