import { logOperation } from '../../scripts/operations-log.js';
import { clearFieldError, validateField } from './checkout-validation.js';

const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AS', 'American Samoa'], ['AZ', 'Arizona'],
  ['AR', 'Arkansas'], ['AE', 'Armed Forces Africa'], ['AA', 'Armed Forces Americas'],
  ['AE', 'Armed Forces Canada'], ['AE', 'Armed Forces Europe'], ['AE', 'Armed Forces Middle East'],
  ['AP', 'Armed Forces Pacific'], ['CA', 'California'], ['CO', 'Colorado'],
  ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'],
  ['FM', 'Federated States Of Micronesia'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['GU', 'Guam'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'],
  ['LA', 'Louisiana'], ['ME', 'Maine'], ['MH', 'Marshall Islands'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['MP', 'Northern Mariana Islands'],
  ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PW', 'Palau'],
  ['PA', 'Pennsylvania'], ['PR', 'Puerto Rico'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VI', 'Virgin Islands'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
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

export function setAddressFieldValue(input, value) {
  input.value = value;
  clearFieldError(input);
  // Dispatch change, but not input: the Places autocomplete listener is bound
  // to input and should only open for user typing, not programmatic corrections.
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillAddressFields(section, addressInput, addressComponents) {
  const c = {};
  addressComponents.forEach((comp) => {
    comp.types.forEach((type) => { c[type] = comp; });
  });

  // Only overwrite a field when Google actually returned the corresponding component.
  // Clearing an existing user-typed value can blank a required field and make the
  // section fail validation, which silently prevents collapse() from collapsing.
  const street = [c.street_number?.longText, c.route?.longText].filter(Boolean).join(' ');
  if (street) setAddressFieldValue(addressInput, street);

  const address2Input = section.querySelector('[autocomplete="address-line2"]');
  if (address2Input && c.subpremise) {
    setAddressFieldValue(address2Input, c.subpremise.longText);
  }

  const cityInput = section.querySelector('[autocomplete="address-level2"]');
  const cityValue = (c.locality || c.sublocality || c.postal_town)?.longText;
  if (cityInput && cityValue) {
    setAddressFieldValue(cityInput, cityValue);
  }

  const zipInput = section.querySelector('[autocomplete="postal-code"]');
  if (zipInput && c.postal_code?.longText) {
    const zip = c.postal_code.longText;
    const zipSuffix = c.postal_code_suffix?.longText || '';
    setAddressFieldValue(zipInput, zipSuffix ? `${zip}-${zipSuffix}` : zip);
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
export function buildAddressPayload(formData, regionCode, prefix = 'shipping-') {
  const line1 = formData.get(`${prefix}street-0`) || '';
  const line2 = formData.get(`${prefix}street-1`) || '';
  const city = formData.get(`${prefix}city`) || '';
  const state = formData.get(`${prefix}state`) || '';
  const zip = formData.get(`${prefix}zip`) || '';

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
 * Builds a Google Places autocomplete query from the street field plus any
 * locality fields the shopper has already entered. Google receives a single
 * input string, so adding city/state/ZIP here gives the street lookup enough
 * context to rank the intended address.
 *
 * @param {HTMLElement} section
 * @param {string} addressValue
 * @param {string} prefix
 * @returns {string}
 */
export function buildPlacesAutocompleteInput(section, addressValue, prefix = 'shipping-') {
  const line1 = addressValue.trim();
  const city = section.querySelector(`[name="${prefix}city"]`)?.value?.trim() || '';
  const stateSelect = section.querySelector(`[name="${prefix}state"]`);
  const state = stateSelect?.selectedOptions?.[0]?.textContent?.trim()
    || stateSelect?.value?.trim()
    || '';
  const zip = section.querySelector(`[name="${prefix}zip"]`)?.value?.trim() || '';

  const stateZip = [state, zip].filter(Boolean).join(' ');
  const locality = [city, stateZip].filter(Boolean).join(', ');
  return [line1, locality].filter(Boolean).join(', ');
}

function validationOutcome(result) {
  const action = result?.action || null;
  if (action === 'FIX') return 'block';
  if (action === 'CONFIRM_ADD_SUBPREMISES') return 'needs-subpremise';
  if (action === 'ACCEPT' || action === 'CONFIRM') return 'pass';
  return action ? 'review' : 'unknown';
}

export function compareAddressValidationResults(google, addressDoctor) {
  const googleOutcome = validationOutcome(google);
  const addressDoctorOutcome = validationOutcome(addressDoctor);
  const mismatchReasons = [];

  const expectedSubpremiseOverride = googleOutcome === 'needs-subpremise'
    && addressDoctorOutcome === 'pass';

  if (googleOutcome !== addressDoctorOutcome && !expectedSubpremiseOverride) {
    mismatchReasons.push('outcome');
  }

  return {
    mismatch: mismatchReasons.length > 0,
    mismatchReasons,
    googleAction: google?.action || null,
    addressDoctorAction: addressDoctor?.action || null,
    googleOutcome,
    addressDoctorOutcome,
  };
}

export function logAddressValidationMismatch(comparison, country) {
  logOperation('error', {
    kind: 'address-validation-mismatch',
    providerPrimary: 'addressdoctor',
    providerCompared: 'google',
    mismatchReasons: comparison.mismatchReasons,
    googleAction: comparison.googleAction,
    addressDoctorAction: comparison.addressDoctorAction,
    googleOutcome: comparison.googleOutcome,
    addressDoctorOutcome: comparison.addressDoctorOutcome,
    country,
  });
}

function localAddressDoctorFix() {
  return {
    provider: 'addressdoctor',
    action: 'FIX',
    formattedAddress: null,
    addressComponents: null,
    uspsDeliverable: false,
  };
}

export async function callDualValidateAddress(config, payload, sessionToken) {
  const [googleResult, addressDoctorResult] = await Promise.allSettled([
    callValidateAddress(config.apiOrigin, payload, sessionToken),
    callValidateAddress(config.addressDoctorOrigin, payload, null),
  ]);

  const google = googleResult.status === 'fulfilled' ? googleResult.value : null;
  const addressDoctor = addressDoctorResult.status === 'fulfilled' ? addressDoctorResult.value : null;

  if (google && addressDoctor) {
    const comparison = compareAddressValidationResults(google, addressDoctor);
    if (comparison.mismatch) {
      logAddressValidationMismatch(comparison, payload.address?.regionCode || null);
    }

    // Google has the explicit US-only signal for a missing apartment/suite.
    // Keep AddressDoctor primary for normal correction decisions, but preserve
    // this add-unit flow unless AddressDoctor says the address should be fixed.
    if (google.action === 'CONFIRM_ADD_SUBPREMISES' && addressDoctor.action !== 'FIX') {
      return google;
    }
  }

  return addressDoctor || localAddressDoctorFix();
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
  const formGrid = section.querySelector('.form-fields');
  if (formGrid) {
    formGrid.insertAdjacentElement('afterend', error);
  } else {
    section.append(error);
  }
}

const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

/**
 * Formats the entered shipping address from the form into display lines.
 * @param {FormData} formData
 * @returns {string[]}
 */
function formatEnteredAddressLines(formData, prefix = 'shipping-') {
  const line1 = (formData.get(`${prefix}street-0`) || '').toString().trim();
  const line2 = (formData.get(`${prefix}street-1`) || '').toString().trim();
  const city = (formData.get(`${prefix}city`) || '').toString().trim();
  const state = (formData.get(`${prefix}state`) || '').toString().trim();
  const zip = (formData.get(`${prefix}zip`) || '').toString().trim();
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  return [line1, line2, cityStateZip].filter(Boolean);
}

/**
 * Splits a formattedAddress string into two display lines: street on line 1,
 * city/state/zip/country on line 2.
 * @param {string} formattedAddress
 * @returns {string[]}
 */
export function splitFormattedAddress(formattedAddress) {
  const commaIdx = formattedAddress.indexOf(',');
  return commaIdx >= 0
    ? [formattedAddress.slice(0, commaIdx).trim(), formattedAddress.slice(commaIdx + 1).trim()]
    : [formattedAddress];
}

/**
 * Formats Google's addressComponents array into display lines.
 * @param {Array<{ longText: string, shortText: string, types: string[] }>} components
 * @returns {string[]}
 */
function formatSuggestedAddressLines(components) {
  const c = {};
  components.forEach((comp) => {
    comp.types.forEach((type) => { c[type] = comp; });
  });
  const street = [c.street_number?.longText, c.route?.longText].filter(Boolean).join(' ');
  const unit = c.subpremise?.longText ? `Apt ${c.subpremise.longText}` : '';
  const city = (c.locality || c.sublocality || c.postal_town)?.longText || '';
  const state = c.administrative_area_level_1?.shortText || '';
  const zip = c.postal_code?.longText || '';
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  return [street, unit, cityStateZip].filter(Boolean);
}

function normalizeAddressPart(value) {
  return (value || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * @param {FormData} formData
 * @param {string} prefix
 * @returns {{ street: string, unit: string, city: string, state: string, zip: string }}
 */
function getEnteredAddressParts(formData, prefix = 'shipping-') {
  return {
    street: normalizeAddressPart(formData.get(`${prefix}street-0`)),
    unit: normalizeAddressPart(formData.get(`${prefix}street-1`)),
    city: normalizeAddressPart(formData.get(`${prefix}city`)),
    state: normalizeAddressPart(formData.get(`${prefix}state`)),
    zip: normalizeAddressPart(formData.get(`${prefix}zip`)),
  };
}

/**
 * @param {Array<{ longText: string, shortText: string, types: string[] }>} addressComponents
 * @returns {{ street: string, unit: string, city: string, state: string, zip: string }}
 */
function getSuggestedAddressParts(addressComponents) {
  const c = {};
  addressComponents.forEach((comp) => {
    comp.types.forEach((type) => { c[type] = comp; });
  });
  const street = [c.street_number?.longText, c.route?.longText].filter(Boolean).join(' ');
  const zip = c.postal_code?.longText || '';
  const zipSuffix = c.postal_code_suffix?.longText || '';
  return {
    street: normalizeAddressPart(street),
    unit: normalizeAddressPart(c.subpremise?.longText || ''),
    city: normalizeAddressPart((c.locality || c.sublocality || c.postal_town)?.longText || ''),
    state: normalizeAddressPart(c.administrative_area_level_1?.shortText || ''),
    zip: normalizeAddressPart(zipSuffix ? `${zip}-${zipSuffix}` : zip),
  };
}

function addressPartsMatch(left, right) {
  return left.street === right.street
    && left.unit === right.unit
    && left.city === right.city
    && left.state === right.state
    && left.zip === right.zip;
}

/**
 * Returns true when the entered address exactly matches the validated response.
 * When the API returns no comparable suggestion, the address is treated as matching.
 *
 * @param {FormData} formData
 * @param {string} prefix
 * @param {Array|null|undefined} addressComponents
 * @param {string|null|undefined} formattedAddress
 * @returns {boolean}
 */
export function addressesMatchEntered(
  formData,
  prefix,
  addressComponents,
  formattedAddress,
) {
  if (addressComponents?.length) {
    return addressPartsMatch(
      getEnteredAddressParts(formData, prefix),
      getSuggestedAddressParts(addressComponents),
    );
  }

  if (formattedAddress) {
    const entered = formatEnteredAddressLines(formData, prefix).map(normalizeAddressPart);
    const suggested = splitFormattedAddress(formattedAddress)
      .map((line) => normalizeAddressPart(line.replace(/,\s*(USA|Canada)$/i, '')));
    if (entered.length !== suggested.length) return false;
    return entered.every((line, i) => line === suggested[i]);
  }

  return true;
}

/**
 * Builds the standard dialog shell: close button, icon badge, eyebrow, heading, subtitle.
 * @param {Object} opts
 * @returns {{ dialog: HTMLDialogElement, body: HTMLElement, setChosen: Function }}
 */
function buildDialogShell({
  iconSvg, eyebrow, heading, subtitle, onClose, showClose = true, preventDismiss = false,
}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'address-validation-dialog';
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (!preventDismiss) onClose?.();
  });

  if (showClose) {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'address-validation-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = ICON_CLOSE;
    closeBtn.addEventListener('click', onClose);
    dialog.append(closeBtn);
  }

  const header = document.createElement('div');
  header.className = 'address-validation-header';

  const icon = document.createElement('div');
  icon.className = 'address-validation-icon';
  icon.innerHTML = iconSvg;

  const titleGroup = document.createElement('div');
  titleGroup.className = 'address-validation-title-group';

  const eyebrowEl = document.createElement('div');
  eyebrowEl.className = 'address-validation-eyebrow';
  eyebrowEl.textContent = eyebrow;

  const headingEl = document.createElement('h2');
  headingEl.className = 'address-validation-heading';
  headingEl.textContent = heading;

  const subtitleEl = document.createElement('p');
  subtitleEl.className = 'address-validation-subtitle';
  subtitleEl.textContent = subtitle;

  titleGroup.append(eyebrowEl, headingEl, subtitleEl);
  header.append(icon, titleGroup);
  dialog.append(header);

  const body = document.createElement('div');
  body.className = 'address-validation-body';
  dialog.append(body);

  return { dialog, body };
}

/**
 * Builds an address card showing a list of address lines.
 * @param {Object} opts
 * @returns {HTMLElement}
 */
function buildAddressCard({
  label, lines, variant, badge, comparisonLines,
}) {
  const card = document.createElement('div');
  card.className = `address-card address-card-${variant}`;

  if (badge) {
    const badgeEl = document.createElement('span');
    badgeEl.className = 'address-card-badge';
    badgeEl.innerHTML = `<span class="address-card-badge-icon">${ICON_CHECK}</span>${badge}`;
    card.append(badgeEl);
  }

  if (label) {
    const labelEl = document.createElement('div');
    labelEl.className = 'address-card-label';
    labelEl.textContent = label;
    card.append(labelEl);
  }

  const linesEl = document.createElement('div');
  linesEl.className = 'address-card-lines';
  lines.forEach((line, i) => {
    const lineEl = document.createElement('div');
    const other = comparisonLines?.[i] ?? null;
    const changed = other !== null && line.trim().toLowerCase() !== other.trim().toLowerCase();
    lineEl.className = `address-line${changed ? ' address-line-changed' : ''}`;
    lineEl.textContent = line;
    linesEl.append(lineEl);
  });
  card.append(linesEl);

  return card;
}

/**
 * Shows the CONFIRM dialog: side-by-side entered vs. suggested address with diff highlighting.
 *
 * @param {Object} opts
 * @returns {Promise<{ choice: 'accept'|'edit' }>}
 */
function showConfirmModal({
  addressComponents, formattedAddress, formData, strings, prefix = 'shipping-',
}) {
  return new Promise((resolve) => {
    let chosen = null;

    const { dialog, body } = buildDialogShell({
      iconSvg: ICON_PIN,
      eyebrow: strings.addressEyebrow || 'Address verification',
      heading: strings.addressHeading || 'We found a more accurate version',
      subtitle: strings.addressSubtitle || 'Use the suggested address or edit your address before continuing.',
      onClose: () => { chosen = { choice: 'edit' }; dialog.close(); },
      showClose: false,
      preventDismiss: true,
    });

    const enteredLines = formatEnteredAddressLines(formData, prefix);
    let suggestedLines;
    if (formattedAddress) {
      suggestedLines = splitFormattedAddress(formattedAddress);
    } else {
      suggestedLines = addressComponents ? formatSuggestedAddressLines(addressComponents) : [];
    }

    const comparison = document.createElement('div');
    comparison.className = 'address-validation-comparison';

    comparison.append(buildAddressCard({
      label: strings.addressWhatEntered || 'What you entered',
      lines: enteredLines,
      variant: 'entered',
    }));
    comparison.append(buildAddressCard({
      label: strings.addressSuggestedBy || 'Suggested',
      lines: suggestedLines,
      variant: 'suggested',
      badge: strings.addressRecommended || 'Recommended',
      comparisonLines: enteredLines,
    }));
    body.append(comparison);

    const actions = document.createElement('div');
    actions.className = 'address-validation-actions';

    const useSuggested = document.createElement('button');
    useSuggested.type = 'button';
    useSuggested.className = 'button emphasis address-validation-primary';
    useSuggested.innerHTML = `<span class="address-validation-btn-icon">${ICON_CHECK}</span>${strings.addressUseSuggested || 'Use suggested address'}`;
    useSuggested.addEventListener('click', () => {
      chosen = { choice: 'accept' };
      dialog.close();
    });

    const editAddress = document.createElement('button');
    editAddress.type = 'button';
    editAddress.className = 'button address-validation-secondary';
    editAddress.textContent = strings.addressEdit || 'Edit address';
    editAddress.addEventListener('click', () => {
      chosen = { choice: 'edit' };
      dialog.close();
    });

    actions.append(editAddress, useSuggested);
    body.append(actions);

    // Register close listener before showModal so we never miss a close event.
    dialog.addEventListener('close', () => {
      resolve(chosen ?? { choice: 'edit' });
      dialog.remove();
    });
    // Remove any stale dialog (defensive — should never have more than one).
    document.querySelectorAll('.address-validation-dialog').forEach((d) => d.remove());
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * Shows the CONFIRM_ADD_SUBPREMISES dialog: address card plus unit number input.
 *
 * @param {Object} opts
 * @returns {Promise<{ choice: 'add-unit', unit: string } | { choice: 'edit' }>}
 */
function showAddUnitModal({
  addressComponents, formattedAddress, formData, strings, prefix = 'shipping-',
}) {
  return new Promise((resolve) => {
    let chosen = null;

    const { dialog, body } = buildDialogShell({
      iconSvg: ICON_INFO,
      eyebrow: strings.addressUnitEyebrow || 'One more thing',
      heading: strings.addressUnitHeading || 'Add an apartment or unit number?',
      subtitle: strings.addressUnitSubtitle
        || 'Your building has multiple units. Add a unit or edit your address before continuing.',
      onClose: () => { chosen = { choice: 'edit' }; dialog.close(); },
      showClose: false,
      preventDismiss: true,
    });

    let displayLines;
    if (formattedAddress) {
      displayLines = splitFormattedAddress(formattedAddress);
    } else if (addressComponents) {
      displayLines = formatSuggestedAddressLines(addressComponents).filter((line) => !line.startsWith('Apt '));
    } else {
      displayLines = formatEnteredAddressLines(formData, prefix);
    }

    const addressCard = document.createElement('div');
    addressCard.className = 'address-card address-card-display';
    const pinIcon = document.createElement('span');
    pinIcon.className = 'address-card-pin';
    pinIcon.innerHTML = ICON_PIN;
    const linesEl = document.createElement('div');
    linesEl.className = 'address-card-lines';
    displayLines.forEach((line) => {
      const lineEl = document.createElement('div');
      lineEl.className = 'address-line';
      lineEl.textContent = line;
      linesEl.append(lineEl);
    });
    addressCard.append(pinIcon, linesEl);
    body.append(addressCard);

    const inputField = document.createElement('div');
    inputField.className = 'address-unit-input';
    const inputLabel = document.createElement('label');
    inputLabel.className = 'address-unit-label';
    inputLabel.textContent = strings.addressUnitLabel || 'Apartment, suite, floor, or unit';
    const inputWrap = document.createElement('div');
    inputWrap.className = 'address-unit-input-wrap';
    const inputIcon = document.createElement('span');
    inputIcon.className = 'address-unit-input-icon';
    inputIcon.innerHTML = ICON_INFO;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'address-unit-input-field';
    input.placeholder = strings.addressUnitPlaceholder || 'Apt 4B, Floor 12, Suite 200…';
    inputLabel.append(inputWrap);
    inputWrap.append(inputIcon, input);
    inputField.append(inputLabel);
    body.append(inputField);

    const actions = document.createElement('div');
    actions.className = 'address-validation-actions';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'button emphasis address-validation-primary';
    addBtn.innerHTML = `<span class="address-validation-btn-icon">${ICON_CHECK}</span>${strings.addressUnitContinue || 'Add unit & continue'}`;
    addBtn.disabled = true;
    addBtn.addEventListener('click', () => {
      chosen = { choice: 'add-unit', unit: input.value.trim() };
      dialog.close();
    });

    const editAddress = document.createElement('button');
    editAddress.type = 'button';
    editAddress.className = 'button address-validation-secondary';
    editAddress.textContent = strings.addressEdit || 'Edit address';
    editAddress.addEventListener('click', () => {
      chosen = { choice: 'edit' };
      dialog.close();
    });

    actions.append(addBtn, editAddress);
    body.append(actions);

    input.addEventListener('input', () => {
      addBtn.disabled = input.value.trim() === '';
    });

    // Pressing Enter in the input submits when the button is enabled.
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !addBtn.disabled) {
        e.preventDefault();
        chosen = { choice: 'add-unit', unit: input.value.trim() };
        dialog.close();
      }
    });

    // Register close listener before showModal so we never miss a close event.
    dialog.addEventListener('close', () => {
      resolve(chosen ?? { choice: 'edit' });
      dialog.remove();
    });
    // Remove any stale dialog (defensive — should never have more than one).
    document.querySelectorAll('.address-validation-dialog').forEach((d) => d.remove());
    document.body.append(dialog);
    dialog.showModal();
    setTimeout(() => input.focus(), 0);
  });
}

/**
 * Validates the shipping address via the Commerce API and collapses the section on success.
 * Checkout must not advance until this returns true.
 *
 * 1. Clear any existing inline error.
 * 2. Ensure required address fields pass browser and custom field validation.
 * 3. Loop (up to MAX_ITERATIONS): build payload, call validate, handle the action.
 *    - FIX → show inline error and return false (section stays expanded).
 *    - CONFIRM_ADD_SUBPREMISES → unit-input modal. If the user adds a unit,
 *      write it to street-2 and continue the loop to re-validate with the unit
 *      included. If the user chooses edit, return false.
 *    - When the validated address does not exactly match the entered address,
 *      show the side-by-side modal; 'accept' applies corrections and collapses;
 *      'edit' returns false so the customer can correct the address.
 *    - When the validated address matches the entered address, collapse and return true.
 *    - Unknown action / validation failure → show inline error and return false.
 *
 * @param {HTMLElement} section
 * @param {Function} collapse
 * @param {Object} config
 * @param {Object} strings
 * @param {Function} [getToken] - returns the current Places session token string
 * @returns {Promise<boolean>}
 */
export async function validateAndCollapseAddress(
  section,
  collapse,
  config,
  strings,
  getToken,
  prefix = 'shipping-',
) {
  clearAddressError(section);

  const form = section?.closest('form');
  if (!form) return false;

  const requiredFieldsValid = [...section.querySelectorAll('[required]')]
    .every((el) => el.checkValidity() && !validateField(el));
  if (!requiredFieldsValid) {
    showAddressError(
      section,
      strings.addressCompleteRequired || 'Please complete and correct your shipping address before continuing.',
    );
    return false;
  }

  const regionCode = config.getLocale() === 'ca' ? 'CA' : 'US';
  const MAX_ITERATIONS = 3;

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const formData = new FormData(form);
    const payload = buildAddressPayload(formData, regionCode, prefix);

    if (!payload.address.addressLines.length) {
      showAddressError(
        section,
        strings.addressCompleteRequired || 'Please complete and correct your shipping address before continuing.',
      );
      return false;
    }

    let result;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await callDualValidateAddress(config, payload, getToken?.() ?? null);
    } catch {
      showAddressError(
        section,
        strings.addressValidationUnavailable || 'Unable to verify this address. Please check it and try again.',
      );
      return false;
    }

    const { action, addressComponents, formattedAddress } = result;

    if (action === 'FIX') {
      showAddressError(
        section,
        strings.addressInvalid || "We couldn't verify this address. Please check and try again.",
      );
      return false;
    }

    if (action === 'CONFIRM_ADD_SUBPREMISES') {
      // eslint-disable-next-line no-await-in-loop
      const result2 = await showAddUnitModal({
        addressComponents, formattedAddress, formData, strings, prefix,
      });
      if (result2.choice !== 'add-unit' || !result2.unit) return false;
      // Write the unit and let the loop iterate to re-validate. Google explicitly
      // does NOT issue corrections for CONFIRM_ADD_SUBPREMISES (per spec), so any
      // zip or city fixes only appear on the next validate call with the unit
      // included.
      const address2Input = section.querySelector('[autocomplete="address-line2"]');
      if (address2Input) {
        address2Input.value = result2.unit;
        address2Input.dispatchEvent(new Event('input', { bubbles: true }));
        address2Input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      const hasSuggestion = !!(addressComponents?.length || formattedAddress);
      const needsConfirmation = hasSuggestion
        && !addressesMatchEntered(formData, prefix, addressComponents, formattedAddress);

      if (needsConfirmation) {
        // eslint-disable-next-line no-await-in-loop
        const { choice } = await showConfirmModal({
          addressComponents, formattedAddress, formData, strings, prefix,
        });
        if (choice !== 'accept') return false;
        if (!addressComponents) {
          showAddressError(
            section,
            strings.addressInvalid || "We couldn't verify this address. Please check and try again.",
          );
          return false;
        }
        // Use [name$="street-0"] — the autocomplete attr is rewritten to "off"
        // by initPlacesAutocomplete to suppress Chrome's autofill dropdown.
        const addressInput = section.querySelector('[name$="street-0"]');
        if (addressInput) fillAddressFields(section, addressInput, addressComponents);
        collapse();
        return true;
      }

      if (!action || action === 'ACCEPT' || action === 'CONFIRM') {
        collapse();
        return true;
      }

      showAddressError(
        section,
        strings.addressInvalid || "We couldn't verify this address. Please check and try again.",
      );
      return false;
    }
  }

  showAddressError(
    section,
    strings.addressInvalid || "We couldn't verify this address. Please check and try again.",
  );
  return false;
}

export const validateAndCollapseShipping = (...args) => validateAndCollapseAddress(
  ...args,
  'shipping-',
);

function initPlacesAutocomplete(section, config) {
  const addressInput = section.querySelector('[autocomplete="address-line1"]');
  if (!addressInput) return null;

  const regionCode = config.getLocale() === 'ca' ? 'CA' : 'US';
  const prefix = addressInput.name.replace(/street-0$/, '');

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
        const params = new URLSearchParams({
          input: buildPlacesAutocompleteInput(section, value, prefix),
          sessiontoken: sessionToken,
          regioncode: regionCode,
        });
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
 * @returns {{ validateAndCollapse: (collapse: Function) => Promise<boolean>,
 *   validateBillingAndCollapse: (collapse: Function) => Promise<boolean> }}
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
  const billingAutoComplete = billingSection
    ? initPlacesAutocomplete(billingSection, config)
    : null;

  // Clear the section-level address-validation error when the user edits any field.
  // Only fires for trusted (user-initiated) events — programmatic input dispatches
  // (e.g. the unit-number write in CONFIRM_ADD_SUBPREMISES) must not clear it.
  if (shippingSection) {
    shippingSection.addEventListener('input', (e) => {
      state.shippingAddressValidated = false;
      if (e.isTrusted) clearAddressError(shippingSection);
    });
    shippingSection.addEventListener('change', () => {
      state.shippingAddressValidated = false;
    });
  }
  if (billingSection) {
    billingSection.addEventListener('input', (e) => {
      state.billingAddressValidated = false;
      if (e.isTrusted) clearAddressError(billingSection);
    });
    billingSection.addEventListener('change', () => {
      state.billingAddressValidated = false;
    });
  }
  form.querySelectorAll('[name="billing-choice"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      state.billingAddressValidated = false;
    });
  });

  // Invalidate estimate token when estimate-affecting fields change
  form.addEventListener('change', (e) => {
    if (ESTIMATE_FIELDS.has(e.target.name)) {
      state.currentEstimateToken = null;
      state.currentPreview = null;
    }
  });

  return {
    validateAndCollapse: async (collapse) => {
      const isValid = await validateAndCollapseAddress(
        shippingSection,
        collapse,
        config,
        strings,
        shippingAutoComplete?.getSessionToken,
        'shipping-',
      );
      state.shippingAddressValidated = isValid;
      return isValid;
    },
    validateBillingAndCollapse: async (collapse) => {
      const isDifferent = form.querySelector('[name="billing-choice"]:checked')?.value === 'different';
      if (!isDifferent) {
        state.billingAddressValidated = true;
        return true;
      }
      const isValid = await validateAndCollapseAddress(
        billingSection,
        collapse,
        config,
        strings,
        billingAutoComplete?.getSessionToken,
        'billing-',
      );
      state.billingAddressValidated = isValid;
      return isValid;
    },
  };
}
