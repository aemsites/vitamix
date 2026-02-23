import { fetchPlaceholders } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/** Sheet logger endpoint for create-account form */
const SHEET_LOGGER_URL = 'https://sheet-logger.david8603.workers.dev/vitamix.com/forms-testing/create-account';

/**
 * Decorates the create-account widget: applies placeholders and configures form.
 * No password fields; sign-in will use email confirmation.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.create-account-form');
  if (!form) return;

  const { locale, language } = getLocaleAndLanguage();
  const p = await fetchPlaceholders(`/${locale}/${language}`);
  const get = (key, fallback = '') => (p[key] != null && p[key] !== '' ? p[key] : fallback);

  // Lookup keys must match toCamelCase(Key) from spreadsheet (punctuation → stripped in key)
  const labels = {
    firstName: get('firstName', 'First Name'),
    lastName: get('lastName', 'Last Name'),
    emailAddress: get('emailAddress', 'Email Address'),
    confirmEmailAddress: get('confirmEmailAddress', 'Confirm Email Address'),
    emailsMustMatch: get('emailsMustMatch', 'Emails must match'),
    postalCode: get('postalCode', 'Postal code'),
    accountUseReasons: get('forWhatReasonsWillYouUseThisAccount', 'For what reasons will you use this account?'),
    domesticProducts: get('forDomesticProducts', 'For domestic products'),
    commercialProducts: get('forCommercialProducts', 'For commercial products'),
    ownVitamix: get('doYouCurrentlyOwnAVitamix', 'Do you currently own a Vitamix?'),
    yes: get('yes', 'Yes'),
    no: get('no', 'No'),
    acceptTermsPrefix: get('iAcceptThe', 'I accept the '),
    termsLinkText: get('termsAndConditionsOfVitamix', 'terms and conditions of Vitamix'),
    requiredFieldsLegend: get('requiredFields', '* Required fields'),
    createAccount: get('createAccount', 'Create account'),
    sending: get('sending', 'Sending...'),
  };

  const placeholders = {
    firstName: get('firstNamePlaceholder', 'e.g. Johnny'),
    lastName: get('lastNamePlaceholder', 'e.g. Appleseed'),
    emailAddress: get('emailAddressPlaceholder', 'e.g. email@example.com'),
    confirmEmailAddress: get('confirmEmailAddressPlaceholder', 'Must be the same as the email above'),
    postalCode: get('postalCodePlaceholder'),
  };

  form.querySelector('[for="create-account-first-name"] .label-text').textContent = labels.firstName;
  form.querySelector('[for="create-account-last-name"] .label-text').textContent = labels.lastName;
  form.querySelector('[for="create-account-email"] .label-text').textContent = labels.emailAddress;
  form.querySelector('[for="create-account-confirm-email"] .label-text').textContent = labels.confirmEmailAddress;
  form.querySelector('[for="create-account-postal-code"] .label-text').textContent = labels.postalCode;

  const useLegend = form.querySelector('#create-account-use-legend');
  if (useLegend) useLegend.textContent = labels.accountUseReasons;

  const ownLegend = form.querySelector('#create-account-own-legend');
  if (ownLegend) ownLegend.textContent = labels.ownVitamix;

  const allRadioLabels = form.querySelectorAll('.create-account-radio-group .radio-label');
  if (allRadioLabels[0]) allRadioLabels[0].textContent = labels.domesticProducts;
  if (allRadioLabels[1]) allRadioLabels[1].textContent = labels.commercialProducts;
  if (allRadioLabels[2]) allRadioLabels[2].textContent = labels.yes;
  if (allRadioLabels[3]) allRadioLabels[3].textContent = labels.no;

  form.querySelector('.accept-prefix').textContent = labels.acceptTermsPrefix;
  form.querySelector('.terms-link').textContent = labels.termsLinkText;
  form.querySelector('.create-account-required-legend').textContent = labels.requiredFieldsLegend;

  const firstNameInput = form.querySelector('#create-account-first-name');
  const lastNameInput = form.querySelector('#create-account-last-name');
  const emailInput = form.querySelector('#create-account-email');
  const confirmEmailInput = form.querySelector('#create-account-confirm-email');
  const postalCodeInput = form.querySelector('#create-account-postal-code');
  if (firstNameInput) firstNameInput.placeholder = placeholders.firstName;
  if (lastNameInput) lastNameInput.placeholder = placeholders.lastName;
  if (emailInput) emailInput.placeholder = placeholders.emailAddress;
  if (confirmEmailInput) confirmEmailInput.placeholder = placeholders.confirmEmailAddress;
  if (postalCodeInput && placeholders.postalCode) postalCodeInput.placeholder = placeholders.postalCode;

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.createAccount;

  confirmEmailInput?.addEventListener('input', () => {
    confirmEmailInput.setCustomValidity('');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = emailInput?.value?.trim() || '';
    const confirmEmail = confirmEmailInput?.value?.trim() || '';
    if (email !== confirmEmail) {
      confirmEmailInput.setCustomValidity(labels.emailsMustMatch);
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
