import { fetchPlaceholders } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/** Sheet logger endpoint for contact-us form */
const SHEET_LOGGER_URL = 'https://sheet-logger.david8603.workers.dev/vitamix.com/forms-testing/contact-us';

const SELECT_OPTION_DEFAULT = 'Select';

/** Default "Reason for communication" options (Label=value). Overridden by placeholder. */
const DEFAULT_REASON_OPTIONS = [
  'Check the status of my order=order-status',
  'Where to get a Vitamix product=where-to-buy',
  'Get help with warranty registration=warranty-registration',
  'Get help choosing the Vitamix product that best suits my business=business-product-help',
  'Request a brochure=request-brochure',
  'Get help with recipes=recipe-help',
  'Know when my order will be shipped=shipment-date',
  'Request my order tracking number=tracking-number',
  'Learn more about the exchange program=exchange-program',
  'Ask a technical question=technical-question',
  'Find a store or live demonstration=find-store-demo',
  'Resolve a product-related issue=product-issue',
  'Get help comparing Vitamix appliances and sets=compare-products',
  'Become a retailer=become-retailer',
  'Request help to buy directly from Vitamix=buy-direct',
  'Product discount program=discount-program',
  'General inquiry=general-inquiry',
].join(',');

/**
 * Injects placeholder-driven options into a select (keeps first empty option).
 * @param {HTMLSelectElement} select - The select element
 * @param {string[]} options - Array of "Label" or "Label=value" strings
 */
function setSelectOptions(select, options) {
  if (!select || !options || !options.length) return;
  while (select.options.length > 1) select.remove(1);
  options.forEach((opt) => {
    const [label, value] = opt.includes('=') ? opt.split('=').map((s) => s.trim()) : [opt, opt];
    const option = document.createElement('option');
    option.value = value || label;
    option.textContent = label;
    select.appendChild(option);
  });
}

/**
 * Decorates the contact-us widget: applies placeholders and configures form.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.contact-us-form');
  if (!form) return;

  const { locale, language } = getLocaleAndLanguage();
  const p = await fetchPlaceholders(`/${locale}/${language}`);
  const get = (key, fallback = '') => (p[key] != null && p[key] !== '' ? p[key] : fallback);

  const selectOption = get('select', SELECT_OPTION_DEFAULT);

  const labels = {
    firstName: get('firstName', 'First Name'),
    lastName: get('lastName', 'Last Name'),
    emailAddress: get('emailAddress', 'Email Address'),
    typeOfRequest: get('typeOfRequest', 'Type of request'),
    domestic: get('domestic', 'Domestic'),
    commercial: get('commercial', 'Commercial'),
    reasonForCommunication: get('reasonForCommunication', 'Reason for communication'),
    submit: get('submit', 'Submit'),
    sending: get('sending', 'Sending...'),
  };

  const placeholders = {
    firstName: get('firstNamePlaceholder'),
    lastName: get('lastNamePlaceholder'),
    emailAddress: get('emailAddressPlaceholder'),
  };

  form.querySelector('[for="contact-us-first-name"] .label-text').textContent = labels.firstName;
  form.querySelector('[for="contact-us-last-name"] .label-text').textContent = labels.lastName;
  form.querySelector('[for="contact-us-email"] .label-text').textContent = labels.emailAddress;

  const radioLegend = form.querySelector('.contact-us-radio-group .radio-legend');
  if (radioLegend) radioLegend.textContent = labels.typeOfRequest;
  const radioLabels = form.querySelectorAll('.contact-us-radio-group .radio-label');
  if (radioLabels[0]) radioLabels[0].textContent = labels.domestic;
  if (radioLabels[1]) radioLabels[1].textContent = labels.commercial;

  form.querySelector('[for="contact-us-reason"] .label-text').textContent = labels.reasonForCommunication;
  const reasonSelect = form.querySelector('#contact-us-reason');
  if (reasonSelect?.firstElementChild) {
    reasonSelect.firstElementChild.textContent = selectOption;
  }
  const reasonOptions = get('reasonForCommunicationOptions') || DEFAULT_REASON_OPTIONS;
  setSelectOptions(reasonSelect, reasonOptions.split(',').map((s) => s.trim()));

  const firstInput = form.querySelector('#contact-us-first-name');
  const lastInput = form.querySelector('#contact-us-last-name');
  const emailInput = form.querySelector('#contact-us-email');
  if (firstInput) firstInput.placeholder = placeholders.firstName;
  if (lastInput) lastInput.placeholder = placeholders.lastName;
  if (emailInput) emailInput.placeholder = placeholders.emailAddress;

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.submit;

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
      submitButton.textContent = labels.sending;
    }

    try {
      const resp = await fetch(SHEET_LOGGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        throw new Error(`Sheet logger responded with ${resp.status}`);
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
