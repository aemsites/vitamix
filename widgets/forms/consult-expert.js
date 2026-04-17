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
 * Decorates the consult-expert widget: applies copy from JSON, populates
 * dropdowns, configures form.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.consult-expert-form');
  if (!form) return;

  const { locale, language } = getLocaleAndLanguage();
  const vitamixInternationalPath = `/${locale}/${language}/vitamix-international`;
  const countryCode = (locale || 'us').toUpperCase();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadFormCopy(lang).catch(() => ({}));
  const stateOptions = await getStatesProvincesOptions(countryCode, lang).catch(() => []);
  const labels = copy.labels || {};
  const placeholders = copy.placeholders || {};

  const labelMap = [
    ['consult-expert-first-name', labels.firstName ?? 'First Name'],
    ['consult-expert-last-name', labels.lastName ?? 'Last Name'],
    ['consult-expert-business-name', labels.businessName ?? 'Business Name'],
    ['consult-expert-address-line-1', labels.businessAddressLine1 ?? 'Business Address Line 1'],
    ['consult-expert-address-line-2', labels.businessAddressLine2Optional ?? 'Business Address Line 2 (Optional)'],
    ['consult-expert-city', labels.city ?? 'City'],
    ['consult-expert-state', (countryCode === 'CA' ? labels.province : labels.state) ?? (countryCode === 'CA' ? 'Province' : 'State')],
    ['consult-expert-zip', labels.zipCode ?? 'Zip Code'],
    ['consult-expert-email', labels.emailAddress ?? 'Email Address'],
    ['consult-expert-phone', labels.phoneNumber ?? 'Phone Number'],
    ['consult-expert-type-of-business', labels.typeOfBusiness ?? 'Type Of Business'],
    ['consult-expert-number-of-locations', labels.numberOfLocations ?? 'Number Of Locations'],
    ['consult-expert-how-may-we-help', labels.howMayWeHelpOptional ?? 'How may we help you? (optional)'],
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
  const countryLabel = form.querySelector('.consult-expert-country-field .label-text');
  if (countryLabel) countryLabel.textContent = labels.country ?? 'Country';
  const countryDisplay = form.querySelector('.country-display');
  if (countryDisplay) countryDisplay.textContent = countryName;
  const countryInput = form.querySelector('input[name="country"]');
  if (countryInput) countryInput.value = countryName;
  const countryLink = form.querySelector('.country-change-link');
  if (countryLink) {
    countryLink.textContent = labels.notYourCountry ?? 'Not your country?';
    countryLink.href = vitamixInternationalPath;
  }

  setSelectOptions(
    form.querySelector('#consult-expert-state'),
    stateOptions,
    placeholders.state ?? labels.pleaseSelect ?? 'Please Select',
  );
  setSelectOptions(
    form.querySelector('#consult-expert-type-of-business'),
    copy.typeOfBusinessOptions,
    placeholders.typeOfBusiness ?? 'Select an option',
  );
  setSelectOptions(
    form.querySelector('#consult-expert-number-of-locations'),
    copy.numberOfLocationsOptions,
    placeholders.numberOfLocations ?? 'Select an option',
  );

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.submit ?? 'Submit';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.pageUrl = window.location.href;
    payload.formId = `${locale}/${language}/consult-expert`;

    const submitButton = form.querySelector('button[type="submit"]');
    const buttonLabel = submitButton?.textContent;
    [...form.elements].forEach((el) => { el.disabled = true; });
    if (submitButton) {
      submitButton.dataset.originalLabel = buttonLabel;
      submitButton.textContent = labels.sending ?? 'Sending...';
    }

    let didNavigate = false;
    try {
      const resp = await fetch(getFormSubmissionUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const { handleFormSubmitError } = await import('./util.js');
        await handleFormSubmitError(resp, form, labels.submissionFailed ?? 'Something went wrong. Please try again.');
        return;
      }
      didNavigate = true;
      const thankYouPath = `/${locale}/${language}/consult-expert-thankyou`;
      window.location.href = thankYouPath;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Consult expert form submission failed', err);
      const { toast } = await import('./util.js');
      toast(labels.networkError ?? 'Could not reach the server. Please try again.', 'error');
    } finally {
      if (!didNavigate) {
        [...form.elements].forEach((el) => { el.disabled = false; });
        if (submitButton) {
          submitButton.textContent = submitButton.dataset.originalLabel || buttonLabel;
        }
      }
    }
  });
}
