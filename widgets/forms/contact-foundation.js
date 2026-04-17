import { getFormSubmissionUrl, getLocaleAndLanguage } from '../../scripts/scripts.js';

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
 * Decorates the contact-foundation widget: applies copy from JSON and configures form.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.contact-foundation-form');
  if (!form) return;

  const { locale, language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadFormCopy(lang);
  const labels = copy.labels || {};
  const inputHints = copy.inputPlaceholders || {};
  const selectOption = copy.selectOption ?? 'Select an option';
  const focusAreaOptions = copy.focusAreaOptions || [];

  form.querySelector('[for="contact-foundation-first-name"] .label-text').textContent = labels.firstName ?? 'First Name';
  form.querySelector('[for="contact-foundation-last-name"] .label-text').textContent = labels.lastName ?? 'Last Name';
  form.querySelector('[for="contact-foundation-title"] .label-text').textContent = labels.title ?? 'Title';
  form.querySelector('[for="contact-foundation-organization"] .label-text').textContent = labels.organization ?? 'Organization';
  form.querySelector('[for="contact-foundation-email"] .label-text').textContent = labels.emailAddress ?? 'Email Address';
  form.querySelector('[for="contact-foundation-focus-area"] .label-text').textContent = labels.focusArea ?? 'Focus Area';
  form.querySelector('[for="contact-foundation-message"] .label-text').textContent = labels.message ?? 'Message';

  const focusAreaSelect = form.querySelector('#contact-foundation-focus-area');
  if (focusAreaSelect?.firstElementChild) {
    focusAreaSelect.firstElementChild.textContent = selectOption;
  }
  setSelectOptions(focusAreaSelect, focusAreaOptions);

  const firstInput = form.querySelector('#contact-foundation-first-name');
  const lastInput = form.querySelector('#contact-foundation-last-name');
  const titleInput = form.querySelector('#contact-foundation-title');
  const orgInput = form.querySelector('#contact-foundation-organization');
  const emailInput = form.querySelector('#contact-foundation-email');
  const messageTextarea = form.querySelector('#contact-foundation-message');
  if (firstInput) firstInput.placeholder = inputHints.firstName ?? '';
  if (lastInput) lastInput.placeholder = inputHints.lastName ?? '';
  if (titleInput) titleInput.placeholder = inputHints.title ?? '';
  if (orgInput) orgInput.placeholder = inputHints.organization ?? '';
  if (emailInput) emailInput.placeholder = inputHints.emailAddress ?? '';
  if (messageTextarea) messageTextarea.placeholder = inputHints.message ?? '';

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.submit ?? 'SUBMIT';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.pageUrl = window.location.href;
    payload.formId = `${locale}/${language}/contact-foundation`;

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
        throw new Error(`Sheet logger responded with ${resp.status}`);
      }
      const thankYouPath = `/${locale}/${language}/contact-foundation-thankyou`;
      window.location.href = thankYouPath;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Contact foundation form submission failed', err);
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitButton) {
        submitButton.textContent = submitButton.dataset.originalLabel || buttonLabel;
      }
    }
  });
}
