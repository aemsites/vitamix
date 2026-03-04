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
  const placeholders = copy.placeholders || {};
  const reasonOptions = copy.reasonOptions || [];

  form.querySelector('[for="contact-us-first-name"] .label-text').textContent = labels.firstName ?? 'First Name';
  form.querySelector('[for="contact-us-last-name"] .label-text').textContent = labels.lastName ?? 'Last Name';
  form.querySelector('[for="contact-us-email"] .label-text').textContent = labels.emailAddress ?? 'Email Address';

  const radioLegend = form.querySelector('.contact-us-radio-group .radio-legend');
  if (radioLegend) radioLegend.textContent = labels.typeOfRequest ?? 'Type of request';
  const radioLabels = form.querySelectorAll('.contact-us-radio-group .radio-label');
  if (radioLabels[0]) radioLabels[0].textContent = labels.domestic ?? 'Domestic';
  if (radioLabels[1]) radioLabels[1].textContent = labels.commercial ?? 'Commercial';

  form.querySelector('[for="contact-us-reason"] .label-text').textContent = labels.reasonForCommunication ?? 'Reason for communication';
  const reasonSelect = form.querySelector('#contact-us-reason');
  if (reasonSelect?.firstElementChild) {
    reasonSelect.firstElementChild.textContent = labels.select ?? 'Select';
  }
  setSelectOptions(reasonSelect, reasonOptions);

  const firstInput = form.querySelector('#contact-us-first-name');
  const lastInput = form.querySelector('#contact-us-last-name');
  const emailInput = form.querySelector('#contact-us-email');
  if (firstInput) firstInput.placeholder = placeholders.firstName ?? '';
  if (lastInput) lastInput.placeholder = placeholders.lastName ?? '';
  if (emailInput) emailInput.placeholder = placeholders.emailAddress ?? '';

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.submit ?? 'Submit';

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
      const resp = await fetch(SUBMISSION_URL, {
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
