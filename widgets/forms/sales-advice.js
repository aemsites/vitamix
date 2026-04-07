import { getFormSubmissionUrl, getLocaleAndLanguage } from '../../scripts/scripts.js';
import getStatesProvincesOptions from './states-provinces.js';

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
  const copy = data[key];
  const en = data.en || {};
  return {
    ...copy,
    typeOfBusinessOptions: copy.typeOfBusinessOptions ?? en.typeOfBusinessOptions ?? [],
    numberOfLocationsOptions: copy.numberOfLocationsOptions ?? en.numberOfLocationsOptions ?? [],
    reasonForExpertOptions: copy.reasonForExpertOptions ?? en.reasonForExpertOptions ?? [],
  };
}

/**
 * Injects options into a select (keeps first placeholder option).
 * @param {HTMLSelectElement} select - The select element
 * @param {{ label: string, value: string }[]} options - Options array
 * @param {string} [placeholder] - Placeholder text for first option
 */
function setSelectOptions(select, options, placeholder = 'Select an option') {
  if (!select) return;
  const first = select.options[0];
  while (select.options.length > 1) select.remove(1);
  if (first) first.textContent = placeholder;
  options.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  });
}

/**
 * Decorates the sales-advice widget: applies copy from JSON, states/provinces,
 * and configures form submission like contact-us.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.sales-advice-form');
  if (!form) return;

  const { locale, language } = getLocaleAndLanguage();
  const countryCode = (locale || 'us').toUpperCase();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadFormCopy(lang).catch(() => ({}));
  const stateOptions = await getStatesProvincesOptions(countryCode, lang).catch(() => []);
  const labels = copy.labels || {};
  const placeholders = copy.placeholders || {};
  const inputHints = copy.inputPlaceholders || {};

  const regionLabel = countryCode === 'CA' ? (labels.province ?? 'Province') : (labels.state ?? 'State');
  const zipLabel = countryCode === 'CA' ? (labels.postalCode ?? labels.zipCode ?? 'Postal code') : (labels.zipCode ?? 'Zip Code');

  const labelMap = [
    ['sales-advice-first-name', labels.firstName ?? 'First Name'],
    ['sales-advice-last-name', labels.lastName ?? 'Last Name'],
    ['sales-advice-professional-title', labels.professionalTitle ?? 'Professional Title'],
    ['sales-advice-email', labels.emailAddress ?? 'Email Address'],
    ['sales-advice-phone', labels.phoneNumber ?? 'Phone Number'],
    ['sales-advice-business-name', labels.businessName ?? 'Business Name'],
    ['sales-advice-type-of-business', labels.typeOfBusiness ?? 'Type of Business'],
    ['sales-advice-number-of-locations', labels.numberOfLocations ?? 'Number of Locations'],
    ['sales-advice-state', regionLabel],
    ['sales-advice-zip', zipLabel],
    ['sales-advice-reason', labels.reasonForContactingExpert ?? 'Reason for Contacting a Vitamix Expert'],
  ];
  labelMap.forEach(([id, text]) => {
    const label = form.querySelector(`[for="${id}"] .label-text`);
    if (label) label.textContent = text;
  });

  const countryNames = {
    US: labels.unitedStates ?? 'United States',
    CA: labels.canada ?? 'Canada',
    MX: labels.mexico ?? 'Mexico',
  };
  const countryName = countryNames[countryCode] ?? countryNames.US;
  const countryFieldLabel = form.querySelector('.sales-advice-country-field .label-text');
  if (countryFieldLabel) countryFieldLabel.textContent = labels.country ?? 'Country';
  const countryDisplay = form.querySelector('.country-display');
  if (countryDisplay) countryDisplay.textContent = countryName;
  const countryInput = form.querySelector('input[name="country"]');
  if (countryInput) countryInput.value = countryName;
  const countryLink = form.querySelector('.country-change-link');
  if (countryLink) countryLink.textContent = labels.notYourCountry ?? 'Not your country?';

  const marketingCheckbox = form.querySelector('.sales-advice-checkbox-field .checkbox-text');
  if (marketingCheckbox) {
    marketingCheckbox.textContent = labels.marketingOptIn ?? '';
  }

  setSelectOptions(
    form.querySelector('#sales-advice-state'),
    stateOptions,
    placeholders.state ?? labels.pleaseSelect ?? 'Please Select',
  );
  setSelectOptions(
    form.querySelector('#sales-advice-type-of-business'),
    copy.typeOfBusinessOptions,
    placeholders.typeOfBusiness ?? 'Select an option',
  );
  setSelectOptions(
    form.querySelector('#sales-advice-number-of-locations'),
    copy.numberOfLocationsOptions,
    placeholders.numberOfLocations ?? 'Select an option',
  );
  setSelectOptions(
    form.querySelector('#sales-advice-reason'),
    copy.reasonForExpertOptions,
    placeholders.reasonForExpert ?? 'Select an option',
  );

  const inputs = {
    firstName: form.querySelector('#sales-advice-first-name'),
    lastName: form.querySelector('#sales-advice-last-name'),
    professionalTitle: form.querySelector('#sales-advice-professional-title'),
    emailAddress: form.querySelector('#sales-advice-email'),
    phoneNumber: form.querySelector('#sales-advice-phone'),
    businessName: form.querySelector('#sales-advice-business-name'),
    zipCode: form.querySelector('#sales-advice-zip'),
  };
  Object.entries(inputHints).forEach(([key, value]) => {
    const el = inputs[key];
    if (el) el.placeholder = value ?? '';
  });

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.submit ?? 'Submit';

  form.querySelector('.country-change-link')?.addEventListener('click', (e) => {
    e.preventDefault();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.pageUrl = window.location.href;
    payload.formId = `${locale}/${language}/sales-advice`;

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
      const thankYouPath = `/${locale}/${language}/sales-advice-thankyou`;
      window.location.href = thankYouPath;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Sales advice form submission failed', err);
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitButton) {
        submitButton.textContent = submitButton.dataset.originalLabel || buttonLabel;
      }
    }
  });
}
