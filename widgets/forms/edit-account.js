import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/** Sheet logger endpoint for edit-account form */
const SHEET_LOGGER_URL = 'https://sheet-logger.david8603.workers.dev/vitamix.com/forms-testing/edit-account';

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
 * Decorates the edit-account widget: applies copy from JSON and configures form.
 * No password section; authentication is via email PIN.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const header = widget.querySelector('.edit-account-header');
  const form = widget.querySelector('.edit-account-form');
  if (!header || !form) return;

  const { locale, language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadFormCopy(lang);
  const labels = copy.labels || {};
  const inputHints = copy.inputPlaceholders || {};

  header.querySelector('.edit-account-title').textContent = labels.accountInformation ?? 'Account Information';
  header.querySelector('.edit-account-instruction').textContent = labels.allFieldsMandatory ?? 'All fields are mandatory unless otherwise indicated (optional).';

  form.querySelector('[for="edit-account-first-name"] .label-text').textContent = labels.firstName ?? 'First Name';
  form.querySelector('[for="edit-account-last-name"] .label-text').textContent = labels.lastName ?? 'Last Name';
  form.querySelector('[for="edit-account-email"] .label-text').textContent = labels.emailAddress ?? 'Email Address';
  form.querySelector('[for="edit-account-postal-code"] .label-text').textContent = labels.postalCodeOptional ?? 'Postal code (optional)';

  const ownLegend = form.querySelector('#edit-account-own-legend');
  if (ownLegend) ownLegend.textContent = labels.ownVitamix ?? 'Do you own a Vitamix?';

  const ownField = form.querySelector('#edit-account-own-legend')?.closest('.edit-account-field');
  const ownRadioLabels = ownField?.querySelectorAll('.radio-label') || [];
  if (ownRadioLabels[0]) ownRadioLabels[0].textContent = labels.yes ?? 'Yes';
  if (ownRadioLabels[1]) ownRadioLabels[1].textContent = labels.no ?? 'No';

  form.querySelector('.edit-account-section-title').textContent = labels.communications ?? 'Communications';

  const newsletterLegend = form.querySelector('#edit-account-newsletter-legend');
  if (newsletterLegend) newsletterLegend.textContent = labels.newsletterQuestion ?? 'Would you like to receive periodic emails and newsletters from Vitamix?';

  const newsletterField = form.querySelector('#edit-account-newsletter-legend')?.closest('.edit-account-field');
  const newsletterRadioLabels = newsletterField?.querySelectorAll('.radio-label') || [];
  if (newsletterRadioLabels[0]) newsletterRadioLabels[0].textContent = labels.newsletterYes ?? 'Yes';
  if (newsletterRadioLabels[1]) newsletterRadioLabels[1].textContent = labels.newsletterNo ?? 'No, do not send me electronic mail';

  const consentEl = form.querySelector('.edit-account-consent');
  if (consentEl && labels.emailConsentDisclaimer) {
    consentEl.textContent = labels.emailConsentDisclaimer;
  }

  const firstNameInput = form.querySelector('#edit-account-first-name');
  const lastNameInput = form.querySelector('#edit-account-last-name');
  const emailInput = form.querySelector('#edit-account-email');
  const postalCodeInput = form.querySelector('#edit-account-postal-code');
  if (firstNameInput && inputHints.firstName) firstNameInput.placeholder = inputHints.firstName;
  if (lastNameInput && inputHints.lastName) lastNameInput.placeholder = inputHints.lastName;
  if (emailInput && inputHints.emailAddress) emailInput.placeholder = inputHints.emailAddress;
  if (postalCodeInput && inputHints.postalCode) {
    postalCodeInput.placeholder = inputHints.postalCode;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.saveChanges ?? 'Save changes';

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
      submitButton.textContent = labels.sending ?? 'Sending...';
    }

    let didNavigate = false;
    try {
      const resp = await fetch(SHEET_LOGGER_URL, {
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
      const thankYouPath = `/${locale}/${language}/edit-account-thankyou`;
      window.location.href = thankYouPath;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Edit account form submission failed', err);
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
