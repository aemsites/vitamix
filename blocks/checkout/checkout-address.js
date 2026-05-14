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

function initPlacesAutocomplete(section, config) {
  const addressInput = section.querySelector('[autocomplete="address-line1"]');
  if (!addressInput) return;

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
}

/**
 * @param {HTMLFormElement} form
 * @param {Object} state
 * @param {Object} config
 * @param {Object} strings
 */
export function initAddress(form, state, config, strings) {
  const isCanada = config.getLocale() === 'ca';
  populateStateSelect(form, 'shipping-', isCanada, strings);
  populateStateSelect(form, 'billing-', isCanada, strings);
  wireBillingToggle(form);

  const shippingSection = form.querySelector('.shipping-address-section');
  const billingSection = form.querySelector('.billing-fields-wrapper');
  if (shippingSection) initPlacesAutocomplete(shippingSection, config);
  if (billingSection) initPlacesAutocomplete(billingSection, config);

  // Invalidate estimate token when estimate-affecting fields change
  form.addEventListener('change', (e) => {
    if (ESTIMATE_FIELDS.has(e.target.name)) {
      state.currentEstimateToken = null;
      state.currentPreview = null;
    }
  });
}
