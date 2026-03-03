import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/** Sheet logger endpoint for create-account form */
const SHEET_LOGGER_URL = 'https://sheet-logger.david8603.workers.dev/vitamix.com/forms-testing/create-account';

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
 * Decorates the create-account widget: applies copy from JSON and configures form.
 * No password fields; sign-in will use email confirmation.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.create-account-form');
  if (!form) return;

  const { locale, language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadFormCopy(lang);
  const labels = copy.labels || {};
  const placeholders = copy.placeholders || {};

  form.querySelector('[for="create-account-first-name"] .label-text').textContent = labels.firstName ?? 'First Name';
  form.querySelector('[for="create-account-last-name"] .label-text').textContent = labels.lastName ?? 'Last Name';
  form.querySelector('[for="create-account-email"] .label-text').textContent = labels.emailAddress ?? 'Email Address';
  form.querySelector('[for="create-account-confirm-email"] .label-text').textContent = labels.confirmEmailAddress ?? 'Confirm Email Address';
  form.querySelector('[for="create-account-postal-code"] .label-text').textContent = labels.postalCode ?? 'Postal code';

  const useLegend = form.querySelector('#create-account-use-legend');
  if (useLegend) useLegend.textContent = labels.accountUseReasons ?? 'For what reasons will you use this account?';

  const ownLegend = form.querySelector('#create-account-own-legend');
  if (ownLegend) ownLegend.textContent = labels.ownVitamix ?? 'Do you currently own a Vitamix?';

  const allRadioLabels = form.querySelectorAll('.create-account-radio-group .radio-label');
  if (allRadioLabels[0]) allRadioLabels[0].textContent = labels.domesticProducts ?? 'For domestic products';
  if (allRadioLabels[1]) allRadioLabels[1].textContent = labels.commercialProducts ?? 'For commercial products';
  if (allRadioLabels[2]) allRadioLabels[2].textContent = labels.yes ?? 'Yes';
  if (allRadioLabels[3]) allRadioLabels[3].textContent = labels.no ?? 'No';

  form.querySelector('.accept-prefix').textContent = labels.acceptTermsPrefix ?? 'I accept the ';
  form.querySelector('.terms-link').textContent = labels.termsLinkText ?? 'terms and conditions of Vitamix';
  form.querySelector('.create-account-required-legend').textContent = labels.requiredFieldsLegend ?? '* Required fields';

  const firstNameInput = form.querySelector('#create-account-first-name');
  const lastNameInput = form.querySelector('#create-account-last-name');
  const emailInput = form.querySelector('#create-account-email');
  const confirmEmailInput = form.querySelector('#create-account-confirm-email');
  const postalCodeInput = form.querySelector('#create-account-postal-code');
  if (firstNameInput) firstNameInput.placeholder = placeholders.firstName ?? '';
  if (lastNameInput) lastNameInput.placeholder = placeholders.lastName ?? '';
  if (emailInput) emailInput.placeholder = placeholders.emailAddress ?? '';
  if (confirmEmailInput) confirmEmailInput.placeholder = placeholders.confirmEmailAddress ?? '';
  if (postalCodeInput && placeholders.postalCode) postalCodeInput.placeholder = placeholders.postalCode;

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.createAccount ?? 'Create account';

  confirmEmailInput?.addEventListener('input', () => {
    confirmEmailInput.setCustomValidity('');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = emailInput?.value?.trim() || '';
    const confirmEmail = confirmEmailInput?.value?.trim() || '';
    if (email !== confirmEmail) {
      confirmEmailInput.setCustomValidity(labels.emailsMustMatch ?? 'Emails must match');
      confirmEmailInput.reportValidity();
      return;
    }
    confirmEmailInput.setCustomValidity('');

    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.pageUrl = window.location.href;

    const submitButton = form.querySelector('button[type="submit"]');
    const buttonLabel = submitButton?.textContent;
    [...form.elements].forEach((el) => { el.disabled = true; });
    if (submitButton) {
      submitButton.dataset.originalLabel = buttonLabel;
      submitButton.textContent = labels.sending ?? 'Sending...';
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
      const thankYouPath = `/${locale}/${language}/create-account-thankyou`;
      window.location.href = thankYouPath;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Create account form submission failed', err);
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitButton) {
        submitButton.textContent = submitButton.dataset.originalLabel || buttonLabel;
      }
    }
  });
}
