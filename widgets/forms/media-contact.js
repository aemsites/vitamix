import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/** Endpoint for submissions */
const SUBMISSION_URL = 'https://60038-161ivoryjackal-stage.adobeioruntime.net/api/v1/web/forms/submit';

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
  return data[key];
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
 * Decorates the media-contact widget: applies copy from JSON and configures form.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.media-contact-form');
  if (!form) return;

  const { locale, language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadFormCopy(lang);
  const labels = copy.labels || {};
  const placeholders = copy.placeholders || {};
  const selectOption = copy.selectOption ?? 'Select an option';
  const businessLineOptions = copy.businessLineOptions || [];
  const reasonForContactOptions = copy.reasonForContactOptions || [];

  form.querySelector('[for="media-contact-business-line"] .label-text').textContent = labels.businessLine ?? 'Business Line';
  form.querySelector('[for="media-contact-publication-company"] .label-text').textContent = labels.publicationCompanyOptional ?? 'Publication / Company (Optional)';
  form.querySelector('[for="media-contact-first-name"] .label-text').textContent = labels.firstName ?? 'First Name';
  form.querySelector('[for="media-contact-last-name"] .label-text').textContent = labels.lastName ?? 'Last Name';
  form.querySelector('[for="media-contact-email"] .label-text').textContent = labels.emailAddress ?? 'Email Address';
  form.querySelector('[for="media-contact-phone"] .label-text').textContent = labels.phoneNumber ?? 'Phone Number';
  form.querySelector('[for="media-contact-reason"] .label-text').textContent = labels.reasonForContact ?? 'Reason for Contact';
  form.querySelector('[for="media-contact-comments"] .label-text').textContent = labels.additionalCommentsOptional ?? 'Additional Comments (Optional)';

  const businessLineSelect = form.querySelector('#media-contact-business-line');
  const reasonSelect = form.querySelector('#media-contact-reason');
  if (businessLineSelect?.firstElementChild) {
    businessLineSelect.firstElementChild.textContent = selectOption;
  }
  if (reasonSelect?.firstElementChild) {
    reasonSelect.firstElementChild.textContent = selectOption;
  }
  setSelectOptions(businessLineSelect, businessLineOptions);
  setSelectOptions(reasonSelect, reasonForContactOptions);

  const pubInput = form.querySelector('#media-contact-publication-company');
  const firstInput = form.querySelector('#media-contact-first-name');
  const lastInput = form.querySelector('#media-contact-last-name');
  const emailInput = form.querySelector('#media-contact-email');
  const phoneInput = form.querySelector('#media-contact-phone');
  const commentsTextarea = form.querySelector('#media-contact-comments');
  if (pubInput) pubInput.placeholder = placeholders.publicationCompany ?? '';
  if (firstInput) firstInput.placeholder = placeholders.firstName ?? '';
  if (lastInput) lastInput.placeholder = placeholders.lastName ?? '';
  if (emailInput) emailInput.placeholder = placeholders.emailAddress ?? '';
  if (phoneInput) phoneInput.placeholder = placeholders.phoneNumber ?? '';
  if (commentsTextarea) commentsTextarea.placeholder = placeholders.additionalComments ?? '';

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.submit ?? 'Submit';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.pageUrl = window.location.href;
    payload.formId = `${locale}/${language}/media-contact`;

    const submitButton = form.querySelector('button[type="submit"]');
    const buttonLabel = submitButton?.textContent;
    [...form.elements].forEach((el) => { el.disabled = true; });
    if (submitButton) {
      submitButton.dataset.originalLabel = buttonLabel;
      submitButton.textContent = labels.sending ?? 'Sending...';
    }

    try {
      const resp = await fetch(SUBMISSION_URL, {
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
