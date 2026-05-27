const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['AS', 'American Samoa'], ['GU', 'Guam'], ['MP', 'Northern Mariana Islands'],
  ['PR', 'Puerto Rico'], ['VI', 'U.S. Virgin Islands'],
];

const CA_PROVINCES = [
  ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'],
  ['NB', 'New Brunswick'], ['NL', 'Newfoundland and Labrador'],
  ['NS', 'Nova Scotia'], ['NT', 'Northwest Territories'], ['NU', 'Nunavut'],
  ['ON', 'Ontario'], ['PE', 'Prince Edward Island'], ['QC', 'Quebec'],
  ['SK', 'Saskatchewan'], ['YT', 'Yukon'],
];

const ESTIMATE_FIELDS = new Set([
  'shipping-street-0', 'shipping-street-1', 'shipping-city', 'shipping-state', 'shipping-zip',
]);

/**
 * Builds an address object from form data for the given prefix ('shipping-' or 'billing-').
 * @param {HTMLFormElement} form
 * @param {FormData} formData
 * @param {string} prefix
 * @param {string} email
 * @param {string} country
 * @returns {Object}
 */
export function collectAddress(form, formData, prefix, email, country) {
  const get = (name) => formData.get(`${prefix}${name}`) || '';
  return {
    name: `${get('firstname')} ${get('lastname')}`.trim(),
    company: get('company'),
    address1: get('street-0'),
    address2: get('street-1'),
    city: get('city'),
    state: get('state'),
    zip: get('zip'),
    country,
    phone: get('telephone').replace(/\D/g, ''),
    email,
  };
}

/**
 * Populates the state/province select for the given prefix.
 * @param {HTMLFormElement} form
 * @param {string} prefix
 * @param {boolean} isCanada
 * @param {Object} strings
 */
function populateStateSelect(form, prefix, isCanada, strings) {
  const select = form.querySelector(`[name="${prefix}state"]`);
  if (!select) return;

  const regions = isCanada ? CA_PROVINCES : US_STATES;
  const label = select.closest('.form-field')?.querySelector('label');
  if (label) label.textContent = isCanada ? strings.province : strings.state;

  select.innerHTML = '<option value=""></option>';
  regions.forEach(([code, name]) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    select.appendChild(option);
  });

  select.addEventListener('change', () => {
    select.classList.toggle('has-value', !!select.value);
  });
}

/**
 * Wires the billing address radio cards and keeps the shipping summary in sync.
 * @param {HTMLFormElement} form
 */
function wireBillingToggle(form) {
  const billingFieldsWrapper = form.querySelector('.billing-fields-wrapper');
  const sameDetail = form.querySelector('.billing-option-detail');
  if (!billingFieldsWrapper) return;

  const getShippingSummary = () => {
    const data = new FormData(form);
    const street = data.get('shipping-street-0') || '';
    const city = data.get('shipping-city') || '';
    const stateCode = data.get('shipping-state') || '';
    const zip = data.get('shipping-zip') || '';
    const cityStateZip = [city, [stateCode, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return [street, cityStateZip].filter(Boolean).join(', ');
  };

  const updateBillingVisibility = () => {
    const useDifferent = form.querySelector('[name="billing-choice"]:checked')?.value === 'different';
    billingFieldsWrapper.hidden = !useDifferent;
    billingFieldsWrapper.querySelectorAll('input, select').forEach((el) => {
      el.disabled = !useDifferent;
    });
    if (!useDifferent && sameDetail) {
      sameDetail.textContent = getShippingSummary();
    }
  };

  form.querySelectorAll('[name="billing-choice"]').forEach((radio) => {
    radio.addEventListener('change', updateBillingVisibility);
  });

  const syncSummary = (e) => {
    if (!e.target.name?.startsWith('shipping-')) return;
    const isSame = form.querySelector('[name="billing-choice"]:checked')?.value !== 'different';
    if (isSame && sameDetail) sameDetail.textContent = getShippingSummary();
  };

  form.addEventListener('input', syncSummary);
  form.addEventListener('change', syncSummary);
  updateBillingVisibility();
}

function fillAddressFields(section, addressInput, addressComponents) {
  const c = {};
  addressComponents.forEach((comp) => {
    comp.types.forEach((type) => { c[type] = comp; });
  });

  const street = [c.street_number?.longText, c.route?.longText].filter(Boolean).join(' ');
  addressInput.value = street;

  const address2Input = section.querySelector('[autocomplete="address-line2"]');
  if (address2Input && c.subpremise) {
    address2Input.value = c.subpremise.longText;
  }

  const cityInput = section.querySelector('[autocomplete="address-level2"]');
  if (cityInput) {
    cityInput.value = (c.locality || c.sublocality || c.postal_town)?.longText || '';
  }

  const zipInput = section.querySelector('[autocomplete="postal-code"]');
  if (zipInput) {
    zipInput.value = c.postal_code?.longText || '';
  }

  // Set state last so FormData is complete when the change event triggers fetchAndPreview.
  // Always dispatch even if the component is absent — the state may already be set from
  // a prior interaction, and we still need to re-trigger the shipping/tax estimate.
  const stateSelect = section.querySelector('select[name$="-state"]');
  if (stateSelect) {
    if (c.administrative_area_level_1) {
      stateSelect.value = c.administrative_area_level_1.shortText;
      stateSelect.classList.toggle('has-value', !!stateSelect.value);
    }
    stateSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/**
 * Builds a validate-address request payload from form data.
 *
 * @param {FormData} formData
 * @param {string} [regionCode] - ISO 3166-1 alpha-2 country code, e.g. 'US' or 'CA'
 * @returns {{ address: { addressLines: string[], regionCode?: string } }}
 */
export function buildAddressPayload(formData, regionCode) {
  const line1 = formData.get('shipping-street-0') || '';
  const line2 = formData.get('shipping-street-1') || '';
  const city = formData.get('shipping-city') || '';
  const state = formData.get('shipping-state') || '';
  const zip = formData.get('shipping-zip') || '';

  const streetLines = [line1, line2].filter(Boolean);
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const addressLines = [...streetLines, cityStateZip].filter(Boolean);

  const payload = { address: { addressLines } };
  if (regionCode) payload.address.regionCode = regionCode;
  return payload;
}

/**
 * Calls the Commerce API address validation endpoint.
 *
 * @param {string} apiOrigin - e.g. 'https://api.adobecommerce.live/org/sites/site'
 * @param {{ address: object }} payload
 * @param {string|null} [sessionToken]
 * @returns {Promise<{ action: string, formattedAddress: string|null,
 *   addressComponents: Array|null, uspsDeliverable: boolean|null }>}
 */
export async function callValidateAddress(apiOrigin, payload, sessionToken) {
  const url = new URL(`${apiOrigin}/places/validate`);
  if (sessionToken) url.searchParams.set('sessiontoken', sessionToken);

  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) throw new Error(`address validation failed: ${resp.status}`);
  return resp.json();
}

/**
 * Removes any existing inline address validation error from the section.
 * @param {HTMLElement} section
 */
function clearAddressError(section) {
  section.querySelector('.address-validation-error')?.remove();
}

/**
 * Inserts an inline error message below the address form grid.
 * @param {HTMLElement} section
 * @param {string} message
 */
function showAddressError(section, message) {
  clearAddressError(section);
  const error = document.createElement('p');
  error.className = 'address-validation-error checkout-error';
  error.textContent = message;
  const formGrid = section.querySelector('.form-grid');
  if (formGrid) {
    formGrid.insertAdjacentElement('afterend', error);
  } else {
    section.append(error);
  }
}

/**
 * Shows a native <dialog> asking the customer to accept a Google-suggested address
 * or to add a missing subpremise (unit number).
 *
 * @param {'CONFIRM'|'CONFIRM_ADD_SUBPREMISES'} action
 * @param {string|null} formattedAddress
 * @param {Object} strings
 * @returns {Promise<'accept'|'keep'|'add-unit'>}
 */
function showCorrectionModal(action, formattedAddress, strings) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'address-validation-dialog';

    const message = document.createElement('p');
    message.className = 'address-validation-message';

    if (action === 'CONFIRM') {
      message.textContent = strings.addressSuggested || 'We found a more accurate address:';
      const suggested = document.createElement('p');
      suggested.className = 'address-validation-suggested';
      suggested.textContent = formattedAddress || '';
      dialog.append(message, suggested);
    } else {
      message.textContent = strings.addressMissingUnit
        || 'Your address may be missing a unit or apartment number.';
      dialog.append(message);
    }

    const actions = document.createElement('div');
    actions.className = 'address-validation-actions';

    if (action === 'CONFIRM') {
      const useSuggested = document.createElement('button');
      useSuggested.type = 'button';
      useSuggested.className = 'button';
      useSuggested.textContent = strings.addressUseSuggested || 'Use suggested address';
      useSuggested.addEventListener('click', () => { dialog.close(); resolve('accept'); });

      const keepMine = document.createElement('button');
      keepMine.type = 'button';
      keepMine.className = 'button secondary';
      keepMine.textContent = strings.addressKeepMine || 'Keep my address';
      keepMine.addEventListener('click', () => { dialog.close(); resolve('keep'); });

      actions.append(useSuggested, keepMine);
    } else {
      const addUnit = document.createElement('button');
      addUnit.type = 'button';
      addUnit.className = 'button';
      addUnit.textContent = strings.addressAddUnit || 'Add unit number';
      addUnit.addEventListener('click', () => { dialog.close(); resolve('add-unit'); });

      const continueWithout = document.createElement('button');
      continueWithout.type = 'button';
      continueWithout.className = 'button secondary';
      continueWithout.textContent = strings.addressContinueWithout || 'Continue without';
      continueWithout.addEventListener('click', () => { dialog.close(); resolve('keep'); });

      actions.append(addUnit, continueWithout);
    }

    dialog.append(actions);
    document.body.append(dialog);
    dialog.showModal();
    dialog.addEventListener('close', () => dialog.remove());
  });
}

/**
 * Validates the shipping address via the Commerce API and collapses the section on success.
 * Falls open (collapses without error) on network failures so checkout is never blocked.
 *
 * 1. Clear any existing inline error.
 * 2. Build the address payload from the form.
 * 3. Call the validate endpoint; fail open on network/API error.
 * 4. ACCEPT or unknown action → collapse.
 * 5. FIX → show inline error, stay open.
 * 6. CONFIRM/CONFIRM_ADD_SUBPREMISES → show modal; on 'accept' fill corrected fields
 *    then collapse; on 'add-unit' focus street-2 and stay open; on 'keep' collapse.
 *
 * @param {HTMLElement} section
 * @param {Function} collapse
 * @param {Object} config
 * @param {Object} strings
 * @param {Function} [getToken] - returns the current Places session token string
 * @returns {Promise<void>}
 */
export async function validateAndCollapseShipping(section, collapse, config, strings, getToken) {
  clearAddressError(section);

  const form = section.closest('form');
  if (!form) { collapse(); return; }

  const regionCode = config.getLocale() === 'ca' ? 'CA' : 'US';
  const formData = new FormData(form);
  const payload = buildAddressPayload(formData, regionCode);

  if (!payload.address.addressLines.length) { collapse(); return; }

  let result;
  try {
    result = await callValidateAddress(config.apiOrigin, payload, getToken?.() ?? null);
  } catch {
    collapse();
    return;
  }

  const { action, formattedAddress, addressComponents } = result;

  if (!action || action === 'ACCEPT') {
    collapse();
    return;
  }

  if (action === 'FIX') {
    showAddressError(
      section,
      strings.addressInvalid || "We couldn't verify this address. Please check and try again.",
    );
    return;
  }

  if (action === 'CONFIRM' || action === 'CONFIRM_ADD_SUBPREMISES') {
    const choice = await showCorrectionModal(action, formattedAddress, strings);

    if (choice === 'accept' && addressComponents) {
      const addressInput = section.querySelector('[autocomplete="address-line1"]');
      if (addressInput) fillAddressFields(section, addressInput, addressComponents);
    } else if (choice === 'add-unit') {
      section.querySelector('[autocomplete="address-line2"]')?.focus();
      return;
    }
    collapse();
    return;
  }

  // Unknown action — fail open
  collapse();
}

function initPlacesAutocomplete(section, config) {
  const addressInput = section.querySelector('[autocomplete="address-line1"]');
  if (!addressInput) return null;

  const wrapper = document.createElement('div');
  wrapper.className = 'places-autocomplete-wrapper';
  addressInput.parentElement.insertBefore(wrapper, addressInput);
  wrapper.append(addressInput);

  // type="search" + autocomplete="off" is the reliable way to suppress Chrome's
  // address autofill dropdown — Chrome ignores autocomplete="off" on text inputs
  // it heuristically classifies as address fields, but respects it on search inputs.
  addressInput.type = 'search';
  addressInput.setAttribute('autocomplete', 'off');

  let sessionToken = crypto.randomUUID();
  let debounceTimer;
  let dropdown;

  function removeDropdown() {
    if (dropdown) { dropdown.remove(); dropdown = null; }
  }

  function showDropdown(suggestions) {
    removeDropdown();
    if (!suggestions.length) return;

    dropdown = document.createElement('ul');
    dropdown.className = 'places-autocomplete-dropdown';

    suggestions.forEach(({ placePrediction: p }) => {
      const li = document.createElement('li');
      const main = document.createElement('span');
      main.className = 'places-main';
      main.textContent = p.structuredFormat.mainText.text;
      const secondary = document.createElement('span');
      secondary.className = 'places-secondary';
      secondary.textContent = p.structuredFormat.secondaryText.text;
      li.append(main, secondary);

      li.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        addressInput.value = p.structuredFormat.mainText.text;
        removeDropdown();

        try {
          const params = new URLSearchParams({ place_id: p.placeId, sessiontoken: sessionToken });
          const resp = await fetch(`${config.apiOrigin}/places/details?${params}`);
          if (resp.ok) {
            const data = await resp.json();
            if (data.addressComponents) {
              fillAddressFields(section, addressInput, data.addressComponents);
            }
          }
        } catch { /* silent */ }

        sessionToken = crypto.randomUUID();
      });

      dropdown.append(li);
    });

    wrapper.append(dropdown);
  }

  addressInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const { value } = addressInput;
    if (value.length < 3) { removeDropdown(); return; }

    debounceTimer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ input: value, sessiontoken: sessionToken });
        const resp = await fetch(`${config.apiOrigin}/places/autocomplete?${params}`);
        if (!resp.ok) return;
        const data = await resp.json();
        showDropdown(data.suggestions || []);
      } catch { /* silent */ }
    }, 300);
  });

  addressInput.addEventListener('blur', () => {
    setTimeout(removeDropdown, 200);
  });

  return { getSessionToken: () => sessionToken };
}

/**
 * @param {HTMLFormElement} form
 * @param {Object} state
 * @param {Object} config
 * @param {Object} strings
 * @returns {{ validateAndCollapse: (collapse: Function) => Promise<void> }}
 */
export function initAddress(form, state, config, strings) {
  const isCanada = config.getLocale() === 'ca';
  populateStateSelect(form, 'shipping-', isCanada, strings);
  populateStateSelect(form, 'billing-', isCanada, strings);
  wireBillingToggle(form);

  const shippingSection = form.querySelector('.shipping-address-section');
  const billingSection = form.querySelector('.billing-fields-wrapper');
  const shippingAutoComplete = shippingSection
    ? initPlacesAutocomplete(shippingSection, config)
    : null;
  if (billingSection) initPlacesAutocomplete(billingSection, config);

  // Invalidate estimate token when estimate-affecting fields change
  form.addEventListener('change', (e) => {
    if (ESTIMATE_FIELDS.has(e.target.name)) {
      state.currentEstimateToken = null;
      state.currentPreview = null;
    }
  });

  return {
    validateAndCollapse: (collapse) => validateAndCollapseShipping(
      shippingSection,
      collapse,
      config,
      strings,
      shippingAutoComplete?.getSessionToken,
    ),
  };
}
