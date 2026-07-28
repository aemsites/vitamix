import { getFormSubmissionUrl, getLocaleAndLanguage } from '../../scripts/scripts.js';

const DISCOUNT_PROGRAM_REASON = 'discount-program';
const OPTIONAL_FIELDS = new Set(['additionalComments']);

/**
 * Loads form copy from the widget's local JSON (same name as the script).
 * @param {string} lang - Language key (en, fr, es)
 * @returns {Promise<Object>} Form copy for that language
 */
async function loadFormCopy(lang) {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const url = `${window.hlx?.codeBasePath || ''}${jsonPath}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const key = data[lang] ? lang : 'en';
  return {
    ...data[key],
    fieldVisibility: data.fieldVisibility || {},
  };
}

/**
 * Injects options into a select (keeps first empty option).
 * @param {HTMLSelectElement} select - The select element
 * @param {{ label: string, value: string }[]} options - Options array
 */
function setSelectOptions(select, options) {
  if (!select || !options?.length) return;
  while (select.options.length > 1) select.remove(1);
  options.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  });
}

/**
 * Returns visible conditional field names for a reason value.
 * @param {string} reason - Selected reason value
 * @param {Object} fieldVisibility - Visibility config from JSON
 * @returns {string[]|null} Field names, or null for discount-program special case
 */
function getVisibleFieldsForReason(reason, fieldVisibility) {
  if (!reason) return [];
  if (reason === DISCOUNT_PROGRAM_REASON) return null;

  const visibleFields = [];
  Object.values(fieldVisibility).forEach((group) => {
    if (group.reasons?.includes(reason)) {
      visibleFields.push(...(group.fields || []));
    }
  });
  return visibleFields;
}

/**
 * Clears values on hidden conditional inputs.
 * @param {HTMLElement} fieldWrapper - Conditional field wrapper
 */
function resetConditionalField(fieldWrapper) {
  fieldWrapper.querySelectorAll('input, textarea').forEach((input) => {
    if (input.type === 'radio' || input.type === 'checkbox') {
      input.checked = false;
    } else {
      input.value = '';
    }
  });
}

/**
 * Toggles required state for inputs inside a conditional field.
 * @param {HTMLElement} fieldWrapper - Conditional field wrapper
 * @param {boolean} visible - Whether the field is visible
 * @param {string} fieldName - Field identifier from data-field
 */
function setConditionalRequired(fieldWrapper, visible, fieldName) {
  const isOptional = OPTIONAL_FIELDS.has(fieldName);
  fieldWrapper.querySelectorAll('input, textarea').forEach((input) => {
    if (visible && !isOptional) {
      input.setAttribute('required', '');
      input.setAttribute('aria-required', 'true');
      return;
    }
    input.removeAttribute('required');
    input.removeAttribute('aria-required');
  });
}

/**
 * Shows or hides conditional fields based on the selected reason.
 * @param {HTMLFormElement} form - Contact form element
 * @param {string} reason - Selected reason value
 * @param {Object} config - Visibility and discount program config
 * @param {string} locale - Site locale
 * @param {string} language - Site language
 */
function updateConditionalFields(form, reason, config, locale, language) {
  const { fieldVisibility, discountProgram } = config;
  const visibleFields = getVisibleFieldsForReason(reason, fieldVisibility);
  const isDiscountProgram = visibleFields === null;
  const visibleSet = new Set(visibleFields || []);

  form.querySelectorAll('.contact-us-conditional[data-field]').forEach((fieldWrapper) => {
    const fieldName = fieldWrapper.dataset.field;
    const visible = visibleSet.has(fieldName);
    fieldWrapper.setAttribute('aria-hidden', !visible);
    setConditionalRequired(fieldWrapper, visible, fieldName);
    if (!visible) resetConditionalField(fieldWrapper);
  });

  const discountInfo = form.querySelector('.contact-us-discount-info');
  const actions = form.querySelector('.contact-us-actions');
  if (discountInfo) {
    if (isDiscountProgram && discountProgram) {
      const href = `/${locale}/${language}${discountProgram.path}`;
      discountInfo.innerHTML = `<p>${discountProgram.message}</p><a class="button emphasis" href="${href}">${discountProgram.buttonLabel}</a>`;
      discountInfo.removeAttribute('hidden');
      discountInfo.setAttribute('aria-hidden', 'false');
    } else {
      discountInfo.innerHTML = '';
      discountInfo.setAttribute('hidden', '');
      discountInfo.setAttribute('aria-hidden', 'true');
    }
  }
  if (actions) {
    actions.hidden = isDiscountProgram;
    actions.setAttribute('aria-hidden', String(isDiscountProgram));
  }
}

/**
 * Decorates the contact-us widget: applies copy from JSON and configures form.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.contact-us-form');
  if (!form) return;

  const { locale, language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadFormCopy(lang);
  const labels = copy.labels || {};
  const inputHints = copy.inputPlaceholders || {};
  const reasonOptions = copy.reasonOptions || [];

  form.querySelector('[for="contact-us-first-name"] .label-text').textContent = labels.firstName ?? 'First Name';
  form.querySelector('[for="contact-us-last-name"] .label-text').textContent = labels.lastName ?? 'Last Name';
  form.querySelector('[for="contact-us-email"] .label-text').textContent = labels.emailAddress ?? 'Email Address';

  const radioLegend = form.querySelector('.contact-us-field.contact-us-radio-group:not(.contact-us-conditional) .radio-legend');
  if (radioLegend) radioLegend.textContent = labels.typeOfRequest ?? 'Type of request';
  const radioLabels = form.querySelectorAll('.contact-us-field.contact-us-radio-group:not(.contact-us-conditional) .radio-label');
  if (radioLabels[0]) radioLabels[0].textContent = labels.domestic ?? 'Domestic';
  if (radioLabels[1]) radioLabels[1].textContent = labels.commercial ?? 'Commercial';

  form.querySelector('[for="contact-us-reason"] .label-text').textContent = labels.reasonForCommunication ?? 'Reason for Contact';
  const reasonSelect = form.querySelector('#contact-us-reason');
  if (reasonSelect?.firstElementChild) {
    reasonSelect.firstElementChild.textContent = labels.select ?? 'Please Select';
  }
  setSelectOptions(reasonSelect, reasonOptions);

  const conditionalLabels = [
    ['contact-us-order-number', 'orderNumber', 'Order Number'],
    ['contact-us-phone-number', 'phoneNumber', 'Phone Number'],
    ['contact-us-serial-number', 'serialNumber', 'Serial Number'],
    ['contact-us-comments', 'additionalComments', 'Comments (optional)'],
  ];
  conditionalLabels.forEach(([id, key, fallback]) => {
    const label = form.querySelector(`[for="${id}"] .label-text`);
    if (label) label.textContent = labels[key] ?? fallback;
  });

  const preferenceLegend = form.querySelector('#contact-us-preference-legend');
  if (preferenceLegend) preferenceLegend.textContent = labels.contactPreference ?? 'Contact Preference';
  const preferenceLabels = form.querySelectorAll('[data-field="contactPreference"] .radio-label');
  if (preferenceLabels[0]) preferenceLabels[0].textContent = labels.contactPreferenceEmail ?? 'Email';
  if (preferenceLabels[1]) preferenceLabels[1].textContent = labels.contactPreferenceTelephone ?? 'Telephone';

  const inputs = {
    firstName: form.querySelector('#contact-us-first-name'),
    lastName: form.querySelector('#contact-us-last-name'),
    emailAddress: form.querySelector('#contact-us-email'),
    orderNumber: form.querySelector('#contact-us-order-number'),
    phoneNumber: form.querySelector('#contact-us-phone-number'),
    serialNumber: form.querySelector('#contact-us-serial-number'),
    additionalComments: form.querySelector('#contact-us-comments'),
  };
  Object.entries(inputHints).forEach(([key, value]) => {
    const el = inputs[key];
    if (el) el.placeholder = value ?? '';
  });

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.submit ?? 'Submit';

  const conditionalConfig = {
    fieldVisibility: copy.fieldVisibility || {},
    discountProgram: copy.discountProgram,
  };

  reasonSelect?.addEventListener('change', () => {
    updateConditionalFields(form, reasonSelect.value, conditionalConfig, locale, language);
  });

  updateConditionalFields(form, reasonSelect?.value || '', conditionalConfig, locale, language);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.pageUrl = window.location.href;
    payload.formId = `${locale}/${language}/contact-us`;

    const submitButton = form.querySelector('button[type="submit"]');
    const buttonLabel = submitButton?.textContent;
    [...form.elements].forEach((el) => { el.disabled = true; });
    if (submitButton) {
      submitButton.dataset.originalLabel = buttonLabel;
      submitButton.textContent = labels.sending ?? 'Sending...';
    }

    try {
      const resp = await fetch(getFormSubmissionUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        throw new Error(`Forms API submission failed with ${resp.status}`);
      }
      const thankYouPath = `/${locale}/${language}/contact-us-thankyou`;
      window.location.href = thankYouPath;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Contact us form submission failed', err);
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitButton) {
        submitButton.textContent = submitButton.dataset.originalLabel || buttonLabel;
      }
    }
  });
}
