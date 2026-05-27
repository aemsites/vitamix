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

function fillAddressFields(section, addressInput, addressComponents) {
  const c = {};
  addressComponents.forEach((comp) => {
    comp.types.forEach((type) => { c[type] = comp; });
  });

  // Only overwrite a field when Google actually returned the corresponding component.
  // Clearing an existing user-typed value can blank a required field and make the
  // section fail validation, which silently prevents collapse() from collapsing.
  const street = [c.street_number?.longText, c.route?.longText].filter(Boolean).join(' ');
  if (street) addressInput.value = street;

  const address2Input = section.querySelector('[autocomplete="address-line2"]');
  if (address2Input && c.subpremise) {
    address2Input.value = c.subpremise.longText;
  }

  const cityInput = section.querySelector('[autocomplete="address-level2"]');
  const cityValue = (c.locality || c.sublocality || c.postal_town)?.longText;
  if (cityInput && cityValue) {
    cityInput.value = cityValue;
  }

  const zipInput = section.querySelector('[autocomplete="postal-code"]');
  if (zipInput && c.postal_code?.longText) {
    const zip = c.postal_code.longText;
    const zipSuffix = c.postal_code_suffix?.longText || '';
    zipInput.value = zipSuffix ? `${zip}-${zipSuffix}` : zip;
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

const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

/**
 * Formats the entered shipping address from the form into display lines.
 * @param {FormData} formData
 * @returns {string[]}
 */
function formatEnteredAddressLines(formData) {
  const line1 = (formData.get('shipping-street-0') || '').toString().trim();
  const line2 = (formData.get('shipping-street-1') || '').toString().trim();
  const city = (formData.get('shipping-city') || '').toString().trim();
  const state = (formData.get('shipping-state') || '').toString().trim();
  const zip = (formData.get('shipping-zip') || '').toString().trim();
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  return [line1, line2, cityStateZip].filter(Boolean);
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

/**
 * Builds the standard dialog shell: close button, icon badge, eyebrow, heading, subtitle.
 * @param {Object} opts
 * @returns {{ dialog: HTMLDialogElement, body: HTMLElement, setChosen: Function }}
 */
function buildDialogShell({
  iconSvg, eyebrow, heading, subtitle, onClose,
}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'address-validation-dialog';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'address-validation-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = ICON_CLOSE;
  closeBtn.addEventListener('click', onClose);

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
  dialog.append(closeBtn, header);

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
 * @returns {Promise<{ choice: 'accept'|'keep' }>}
 */
function showConfirmModal({ addressComponents, formData, strings }) {
  return new Promise((resolve) => {
    let chosen = null;

    const { dialog, body } = buildDialogShell({
      iconSvg: ICON_PIN,
      eyebrow: strings.addressEyebrow || 'Address verification',
      heading: strings.addressHeading || 'We found a more accurate version',
      subtitle: strings.addressSubtitle || 'Choose which address to use for shipping.',
      onClose: () => { chosen = { choice: 'keep' }; dialog.close(); },
    });

    const enteredLines = formatEnteredAddressLines(formData);
    const suggestedLines = addressComponents
      ? formatSuggestedAddressLines(addressComponents)
      : [];

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

    const keepMine = document.createElement('button');
    keepMine.type = 'button';
    keepMine.className = 'button address-validation-secondary';
    keepMine.textContent = strings.addressKeepMine || 'Keep my address';
    keepMine.addEventListener('click', () => {
      chosen = { choice: 'keep' };
      dialog.close();
    });

    actions.append(useSuggested, keepMine);
    body.append(actions);

    // Register close listener before showModal so we never miss a close event.
    dialog.addEventListener('close', () => {
      resolve(chosen ?? { choice: 'keep' });
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
 * @returns {Promise<{ choice: 'add-unit', unit: string } | { choice: 'keep' }>}
 */
function showAddUnitModal({ addressComponents, formData, strings }) {
  return new Promise((resolve) => {
    let chosen = null;

    const { dialog, body } = buildDialogShell({
      iconSvg: ICON_INFO,
      eyebrow: strings.addressUnitEyebrow || 'One more thing',
      heading: strings.addressUnitHeading || 'Add an apartment or unit number?',
      subtitle: strings.addressUnitSubtitle
        || 'Your building has multiple units. Adding one helps couriers reach you on the first try.',
      onClose: () => { chosen = { choice: 'keep' }; dialog.close(); },
    });

    const displayLines = addressComponents
      ? formatSuggestedAddressLines(addressComponents).filter((line) => !line.startsWith('Apt '))
      : formatEnteredAddressLines(formData);

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

    const noUnit = document.createElement('button');
    noUnit.type = 'button';
    noUnit.className = 'button address-validation-secondary';
    noUnit.textContent = strings.addressUnitNoUnit || "I don't have one — continue";
    noUnit.addEventListener('click', () => {
      chosen = { choice: 'keep' };
      dialog.close();
    });

    actions.append(addBtn, noUnit);
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
      resolve(chosen ?? { choice: 'keep' });
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
 * Falls open (collapses without error) on network failures so checkout is never blocked.
 *
 * 1. Clear any existing inline error.
 * 2. Loop (up to MAX_ITERATIONS): build payload, call validate, handle the action.
 *    - ACCEPT / unknown → collapse and return.
 *    - FIX → show inline error and return (section stays expanded).
 *    - CONFIRM → side-by-side modal; 'accept' applies corrections then collapses;
 *      'keep' collapses without changes.
 *    - CONFIRM_ADD_SUBPREMISES → unit-input modal. If the user adds a unit,
 *      write it to street-2 and continue the loop to re-validate with the unit
 *      included — Google explicitly doesn't issue a verdict for this case, so the
 *      corrected zip/city/state only appears on the second pass. If the user
 *      declines, just collapse.
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
  const MAX_ITERATIONS = 3;

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const formData = new FormData(form);
    const payload = buildAddressPayload(formData, regionCode);

    if (!payload.address.addressLines.length) { collapse(); return; }

    let result;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await callValidateAddress(config.apiOrigin, payload, getToken?.() ?? null);
    } catch {
      collapse();
      return;
    }

    const { action, addressComponents } = result;

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

    if (action === 'CONFIRM') {
      // eslint-disable-next-line no-await-in-loop
      const { choice } = await showConfirmModal({ addressComponents, formData, strings });
      if (choice === 'accept' && addressComponents) {
        // Use [name$="street-0"] — the autocomplete attr is rewritten to "off"
        // by initPlacesAutocomplete to suppress Chrome's autofill dropdown.
        const addressInput = section.querySelector('[name$="street-0"]');
        if (addressInput) fillAddressFields(section, addressInput, addressComponents);
      }
      collapse();
      return;
    }

    if (action === 'CONFIRM_ADD_SUBPREMISES') {
      // eslint-disable-next-line no-await-in-loop
      const result2 = await showAddUnitModal({ addressComponents, formData, strings });
      if (result2.choice !== 'add-unit' || !result2.unit) {
        // User declined — accept the address as-is.
        collapse();
        return;
      }
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
      // Unknown action — fail open
      collapse();
      return;
    }
  }

  // Hit max iterations without resolving — just collapse.
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
