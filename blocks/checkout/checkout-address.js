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

  // Invalidate estimate token when estimate-affecting fields change
  form.addEventListener('change', (e) => {
    if (ESTIMATE_FIELDS.has(e.target.name)) {
      state.currentEstimateToken = null;
      state.currentPreview = null;
    }
  });
}
