import { fetchPlaceholders } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/** Sheet logger endpoint for media contact form */
const SHEET_LOGGER_URL = 'https://sheet-logger.david8603.workers.dev/vitamix.com/forms-testing/media-contact';

/** Default option label for select placeholders when sheet has no value */
const SELECT_OPTION_DEFAULT = 'Select an option';

/**
 * Injects placeholder-driven options into a select (keeps first empty option).
 * @param {HTMLSelectElement} select - The select element
 * @param {string[]} options - Array of "Label" or "Label=value" strings
 */
function setSelectOptions(select, options) {
  if (!options || !options.length) return;
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
 * Decorates the media-contact widget: applies placeholders and configures form.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.media-contact-form');
  if (!form) return;

  const { locale, language } = getLocaleAndLanguage();
  const p = await fetchPlaceholders(`/${locale}/${language}`);

  const get = (key, fallback = '') => (p[key] != null && p[key] !== '' ? p[key] : fallback);

  const selectOption = get('selectAnOption', SELECT_OPTION_DEFAULT);

  // Labels
  const labels = {
    businessLine: get('businessLine', 'Business Line'),
    publicationCompanyOptional: get('publicationCompanyOptional', 'Publication / Company (Optional)'),
    firstName: get('firstName', 'First Name'),
    lastName: get('lastName', 'Last Name'),
    emailAddress: get('emailAddress', 'Email Address'),
    phoneNumber: get('phoneNumber', 'Phone Number'),
    reasonForContact: get('reasonForContact', 'Reason for Contact'),
    additionalCommentsOptional: get('additionalCommentsOptional', 'Additional Comments (Optional)'),
    submit: get('submit', 'Submit'),
  };

  const placeholders = {
    publicationCompany: get('publicationCompanyPlaceholder'),
    firstName: get('firstNamePlaceholder'),
    lastName: get('lastNamePlaceholder'),
    emailAddress: get('emailAddressPlaceholder'),
    phoneNumber: get('phoneNumberPlaceholder'),
    additionalComments: get('additionalCommentsPlaceholder'),
  };

  // Apply label text
  form.querySelector('[for="media-contact-business-line"] .label-text').textContent = labels.businessLine;
  form.querySelector('[for="media-contact-publication-company"] .label-text').textContent = labels.publicationCompanyOptional;
  form.querySelector('[for="media-contact-first-name"] .label-text').textContent = labels.firstName;
  form.querySelector('[for="media-contact-last-name"] .label-text').textContent = labels.lastName;
  form.querySelector('[for="media-contact-email"] .label-text').textContent = labels.emailAddress;
  form.querySelector('[for="media-contact-phone"] .label-text').textContent = labels.phoneNumber;
  form.querySelector('[for="media-contact-reason"] .label-text').textContent = labels.reasonForContact;
  form.querySelector('[for="media-contact-comments"] .label-text').textContent = labels.additionalCommentsOptional;

  // Select first-option placeholder
  const businessLineSelect = form.querySelector('#media-contact-business-line');
  const reasonSelect = form.querySelector('#media-contact-reason');
  const businessFirst = businessLineSelect?.firstElementChild;
  const reasonFirst = reasonSelect?.firstElementChild;
  if (businessFirst) businessFirst.textContent = selectOption;
  if (reasonFirst) reasonFirst.textContent = selectOption;

  // Optional: options from placeholders (comma-separated "Label=value" or "Label")
  const businessLineOptions = get('businessLineOptions');
  const reasonForContactOptions = get('reasonForContactOptions');
  if (businessLineOptions) setSelectOptions(businessLineSelect, businessLineOptions.split(',').map((s) => s.trim()));
  if (reasonForContactOptions) setSelectOptions(reasonSelect, reasonForContactOptions.split(',').map((s) => s.trim()));

  // Input/textarea placeholders
  const pubInput = form.querySelector('#media-contact-publication-company');
  const firstInput = form.querySelector('#media-contact-first-name');
  const lastInput = form.querySelector('#media-contact-last-name');
  const emailInput = form.querySelector('#media-contact-email');
  const phoneInput = form.querySelector('#media-contact-phone');
  const commentsTextarea = form.querySelector('#media-contact-comments');
  if (pubInput) pubInput.placeholder = placeholders.publicationCompany;
  if (firstInput) firstInput.placeholder = placeholders.firstName;
  if (lastInput) lastInput.placeholder = placeholders.lastName;
  if (emailInput) emailInput.placeholder = placeholders.emailAddress;
  if (phoneInput) phoneInput.placeholder = placeholders.phoneNumber;
  if (commentsTextarea) commentsTextarea.placeholder = placeholders.additionalComments;

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.submit;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.pageUrl = window.location.href;

    const submitButton = form.querySelector('button[type="submit"]');
    const buttonLabel = submitButton?.textContent;
    [...form.elements].forEach((el) => { el.disabled = true; });
    if (submitButton) {
      submitButton.dataset.originalLabel = buttonLabel;
      submitButton.textContent = submitButton.dataset.sendingLabel || 'Sending...';
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
      const thankYouPath = `/${locale}/${language}/corporate-information/media-center/media-request-thankyou`;
      window.location.href = thankYouPath;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Media contact form submission failed', err);
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitButton) {
        submitButton.textContent = submitButton.dataset.originalLabel || buttonLabel;
      }
    }
  });
}
