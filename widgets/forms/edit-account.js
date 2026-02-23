import { fetchPlaceholders } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/** Sheet logger endpoint for edit-account form */
const SHEET_LOGGER_URL = 'https://sheet-logger.david8603.workers.dev/vitamix.com/forms-testing/edit-account';

/**
 * Decorates the edit-account widget: applies placeholders and configures form.
 * No password section; authentication is via email PIN.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const header = widget.querySelector('.edit-account-header');
  const form = widget.querySelector('.edit-account-form');
  if (!header || !form) return;

  const { locale, language } = getLocaleAndLanguage();
  const p = await fetchPlaceholders(`/${locale}/${language}`);
  const get = (key, fallback = '') => (p[key] != null && p[key] !== '' ? p[key] : fallback);

  // Lookup keys match toCamelCase(Key) from spreadsheet
  const labels = {
    accountInformation: get('accountInformation', 'Account Information'),
    allFieldsMandatory: get('allFieldsAreMandatoryUnlessOtherwiseIndicatedOptional',
      'All fields are mandatory unless otherwise indicated (optional).'),
    firstName: get('firstName', 'First Name'),
    lastName: get('lastName', 'Last Name'),
    emailAddress: get('emailAddress', 'Email Address'),
    postalCodeOptional: get('postalCodeOptional', 'Postal code (optional)'),
    ownVitamix: get('doYouOwnAVitamix', 'Do you own a Vitamix?'),
    yes: get('yes', 'Yes'),
    no: get('no', 'No'),
    communications: get('communications', 'Communications'),
    newsletterQuestion: get('wouldYouLikeToReceivePeriodicEmailsAndNewslettersFromVitamix',
      'Would you like to receive periodic emails and newsletters from Vitamix?'),
    newsletterYes: get('yes', 'Yes'),
    newsletterNo: get('noDoNotSendMeElectronicMail', 'No, do not send me electronic mail'),
    emailConsentDisclaimer: get('emailConsentDisclaimer', ''),
    saveChanges: get('saveChanges', 'Save changes'),
    sending: get('sending', 'Sending...'),
  };

  const placeholders = {
    firstName: get('firstNamePlaceholder'),
    lastName: get('lastNamePlaceholder'),
    emailAddress: get('emailAddressPlaceholder'),
    postalCode: get('postalCodePlaceholder'),
  };

  header.querySelector('.edit-account-title').textContent = labels.accountInformation;
  header.querySelector('.edit-account-instruction').textContent = labels.allFieldsMandatory;

  form.querySelector('[for="edit-account-first-name"] .label-text').textContent = labels.firstName;
  form.querySelector('[for="edit-account-last-name"] .label-text').textContent = labels.lastName;
  form.querySelector('[for="edit-account-email"] .label-text').textContent = labels.emailAddress;
  form.querySelector('[for="edit-account-postal-code"] .label-text').textContent = labels.postalCodeOptional;

  const ownLegend = form.querySelector('#edit-account-own-legend');
  if (ownLegend) ownLegend.textContent = labels.ownVitamix;

  const ownField = form.querySelector('#edit-account-own-legend')?.closest('.edit-account-field');
  const ownRadioLabels = ownField?.querySelectorAll('.radio-label') || [];
  if (ownRadioLabels[0]) ownRadioLabels[0].textContent = labels.yes;
  if (ownRadioLabels[1]) ownRadioLabels[1].textContent = labels.no;

  form.querySelector('.edit-account-section-title').textContent = labels.communications;

  const newsletterLegend = form.querySelector('#edit-account-newsletter-legend');
  if (newsletterLegend) newsletterLegend.textContent = labels.newsletterQuestion;

  const newsletterField = form.querySelector('#edit-account-newsletter-legend')?.closest('.edit-account-field');
  const newsletterRadioLabels = newsletterField?.querySelectorAll('.radio-label') || [];
  if (newsletterRadioLabels[0]) newsletterRadioLabels[0].textContent = labels.newsletterYes;
  if (newsletterRadioLabels[1]) newsletterRadioLabels[1].textContent = labels.newsletterNo;

  const consentEl = form.querySelector('.edit-account-consent');
  if (consentEl && labels.emailConsentDisclaimer) consentEl.textContent = labels.emailConsentDisclaimer;

  const firstNameInput = form.querySelector('#edit-account-first-name');
  const lastNameInput = form.querySelector('#edit-account-last-name');
  const emailInput = form.querySelector('#edit-account-email');
  const postalCodeInput = form.querySelector('#edit-account-postal-code');
  if (firstNameInput && placeholders.firstName) firstNameInput.placeholder = placeholders.firstName;
  if (lastNameInput && placeholders.lastName) lastNameInput.placeholder = placeholders.lastName;
  if (emailInput && placeholders.emailAddress) emailInput.placeholder = placeholders.emailAddress;
  if (postalCodeInput && placeholders.postalCode) postalCodeInput.placeholder = placeholders.postalCode;

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.saveChanges;

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
      const thankYouPath = `/${locale}/${language}/edit-account-thankyou`;
      window.location.href = thankYouPath;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Edit account form submission failed', err);
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitButton) {
        submitButton.textContent = submitButton.dataset.originalLabel || buttonLabel;
      }
    }
  });
}
