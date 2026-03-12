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
 * Decorates the wellness-program widget: applies copy from JSON and configures form.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.wellness-program-form');
  if (!form) return;

  const { locale, language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadFormCopy(lang);
  const labels = copy.labels || {};
  const inputHints = copy.inputPlaceholders || {};

  const fieldLabels = [
    ['wellness-program-first-name', labels.firstName ?? 'First Name'],
    ['wellness-program-last-name', labels.lastName ?? 'Last Name'],
    ['wellness-program-company-name', labels.companyName ?? 'Company Name'],
    ['wellness-program-job-title', labels.jobTitle ?? 'Job Title'],
    ['wellness-program-phone', labels.phoneNumber ?? 'Phone Number'],
    ['wellness-program-email', labels.emailAddress ?? 'Email Address'],
    ['wellness-program-remarks', labels.otherRemarks ?? 'Other Remarks'],
  ];
  fieldLabels.forEach(([id, text]) => {
    const label = form.querySelector(`[for="${id}"] .label-text`);
    if (label) label.textContent = text;
  });

  const inputs = {
    firstName: form.querySelector('#wellness-program-first-name'),
    lastName: form.querySelector('#wellness-program-last-name'),
    companyName: form.querySelector('#wellness-program-company-name'),
    jobTitle: form.querySelector('#wellness-program-job-title'),
    phone: form.querySelector('#wellness-program-phone'),
    email: form.querySelector('#wellness-program-email'),
    remarks: form.querySelector('#wellness-program-remarks'),
  };
  if (inputs.firstName) inputs.firstName.placeholder = inputHints.firstName ?? '';
  if (inputs.lastName) inputs.lastName.placeholder = inputHints.lastName ?? '';
  if (inputs.companyName) inputs.companyName.placeholder = inputHints.companyName ?? '';
  if (inputs.jobTitle) inputs.jobTitle.placeholder = inputHints.jobTitle ?? '';
  if (inputs.phone) inputs.phone.placeholder = inputHints.phoneNumber ?? '';
  if (inputs.email) inputs.email.placeholder = inputHints.emailAddress ?? '';
  if (inputs.remarks) inputs.remarks.placeholder = inputHints.otherRemarks ?? '';

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.submit ?? 'Submit';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.pageUrl = window.location.href;
    payload.formId = `${locale}/${language}/wellness-program`;

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
      const thankYouPath = `/${locale}/${language}/wellness-program-thankyou`;
      window.location.href = thankYouPath;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Wellness program form submission failed', err);
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitButton) {
        submitButton.textContent = submitButton.dataset.originalLabel || buttonLabel;
      }
    }
  });
}
