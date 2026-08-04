import createSlidePanel from '../../scripts/slide-panel.js';
import { login, verifyCode } from '../../scripts/auth-api.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';
import { getLoggedInCustomer, unwrapCustomerResponse, updateCustomer } from '../../widgets/account/account-api.js';
import { isValidPostalCode } from '../../scripts/address-validation.js';

/**
 * Localized UI strings for the auth panel, keyed by BCP-47 language tag
 * (lowercased). Mirrors the translation approach used by the commerce checkout
 * block, but kept local to this widget. Unknown languages fall back to en-us.
 */
const AUTH_STRINGS = {
  'en-us': {
    panelTitle: 'Login or Create Account',
    emailHeading: 'Sign in',
    emailDesc: 'Enter your email to receive a one-time code.',
    emailPlaceholder: 'Email address',
    continue: 'Continue',
    sendingCode: 'Sending code\u2026',
    recaptchaNotice: `This site is protected by reCAPTCHA and the Google
      <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> and
      <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> apply.`,
    codeHeading: 'Check your email',
    codeDescPrefix: 'We sent a 6-digit code to ',
    verify: 'Verify',
    verifying: 'Verifying\u2026',
    useDifferentEmail: 'Use a different email',
    digit: 'Digit',
    enterAllDigits: 'Please enter all 6 digits.',
    invalidCode: 'Invalid code',
    sendCodeFailed: 'Failed to send code',
    recaptchaError: 'Security verification failed. Please refresh the page and try again.',
    welcome: 'Welcome',
    profileHeading: 'Complete your profile',
    profileDesc: 'Add a few more details to personalize your account.',
    firstName: 'First name',
    lastName: 'Last name',
    zip: 'ZIP code',
    postalCode: 'Postal code',
    save: 'Save',
    saving: 'Saving\u2026',
    skip: 'Skip for now',
    fillAllFields: 'Please fill out all fields.',
    saveFailed: 'Failed to save your details',
    invalidZip: 'Please enter a valid 5-digit ZIP code.',
    invalidPostalCode: 'Please enter a valid postal code (e.g. A1B 2C3).',
  },
  'fr-ca': {
    panelTitle: 'Se connecter ou créer un compte',
    emailHeading: 'Se connecter',
    emailDesc: 'Entrez votre courriel pour recevoir un code à usage unique.',
    emailPlaceholder: 'Adresse courriel',
    continue: 'Continuer',
    sendingCode: 'Envoi du code\u2026',
    recaptchaNotice: `Ce site est protégé par reCAPTCHA et la
      <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Politique de confidentialité</a> et les
      <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">Conditions d'utilisation</a> de Google s'appliquent.`,
    codeHeading: 'Vérifiez votre courriel',
    codeDescPrefix: 'Nous avons envoyé un code à 6 chiffres à ',
    verify: 'Vérifier',
    verifying: 'Vérification\u2026',
    useDifferentEmail: 'Utiliser un autre courriel',
    digit: 'Chiffre',
    enterAllDigits: 'Veuillez entrer les 6 chiffres.',
    invalidCode: 'Code invalide',
    sendCodeFailed: "Échec de l'envoi du code",
    recaptchaError: 'Échec de la vérification de sécurité. Veuillez actualiser la page et réessayer.',
    welcome: 'Bienvenue',
    profileHeading: 'Complétez votre profil',
    profileDesc: 'Ajoutez quelques détails pour personnaliser votre compte.',
    firstName: 'Prénom',
    lastName: 'Nom de famille',
    zip: 'Code ZIP',
    postalCode: 'Code postal',
    save: 'Enregistrer',
    saving: 'Enregistrement\u2026',
    skip: "Passer pour l'instant",
    fillAllFields: 'Veuillez remplir tous les champs.',
    saveFailed: "Échec de l'enregistrement de vos informations.",
    invalidZip: 'Veuillez entrer un code ZIP à 5 chiffres valide.',
    invalidPostalCode: 'Veuillez entrer un code postal valide (ex. A1B 2C3).',
  },
};

/**
 * Resolves the localized strings and the Canada flag for the current path.
 * Canada uses postal codes (not ZIP codes) and its own validation, while the
 * Canadian English store still uses the en-us copy.
 *
 * @returns {{ strings: Record<string, string>, isCanada: boolean }}
 */
function getAuthContext() {
  const { locale, language } = getLocaleAndLanguage(false, true);
  const strings = AUTH_STRINGS[language.toLowerCase()] || AUTH_STRINGS['en-us'];
  return { strings, isCanada: locale === 'ca' };
}

/**
 * Builds the first step of the auth flow: an email input form.
 * The form has no submit logic attached — that is wired in `showEmailStep`
 * so it has access to the panel's closure state.
 *
 * @param {Record<string, string>} strings - Localized UI strings
 * @returns {HTMLElement}
 */
function buildEmailStep(strings) {
  const step = document.createElement('div');
  step.className = 'auth-step auth-step-email';
  step.innerHTML = `
    <h3>${strings.emailHeading}</h3>
    <p class="auth-step-desc">${strings.emailDesc}</p>
    <form class="auth-form">
      <input type="email" class="auth-input" name="email"
             placeholder="${strings.emailPlaceholder}" autocomplete="email" required>
      <button type="submit" class="auth-submit">${strings.continue}</button>
      <p class="auth-error"></p>
    </form>
    <p class="recaptcha-notice">
      ${strings.recaptchaNotice}
    </p>
  `;
  return step;
}

/**
 * Attaches keyboard and paste behaviour to the 6 individual digit input boxes
 * inside a code step element:
 * - Restricts each box to a single numeric digit
 * - Auto-advances focus to the next box after a digit is entered
 * - Moves focus back on Backspace when the current box is empty
 * - Distributes a pasted string across the boxes and focuses the last filled box
 *
 * @param {HTMLElement} container - The code step element containing `.auth-code-box` inputs
 */
function wireCodeBoxes(container) {
  const boxes = container.querySelectorAll('.auth-code-box');
  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/[^0-9]/g, '').slice(0, 1);
      if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].focus();
        boxes[i - 1].value = '';
      }
    });
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const paste = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      paste.split('').forEach((ch, j) => {
        if (boxes[j]) boxes[j].value = ch;
      });
      const next = Math.min(paste.length, boxes.length - 1);
      boxes[next].focus();
    });
  });
}

/**
 * Reads the current value from all 6 digit boxes and concatenates them
 * into a single string. May be shorter than 6 characters if not all boxes
 * are filled — callers should validate length before submitting.
 *
 * @param {HTMLElement} container - The code step element containing `.auth-code-box` inputs
 * @returns {string} The concatenated digit string (0–6 characters)
 */
function getCodeValue(container) {
  return Array.from(container.querySelectorAll('.auth-code-box'))
    .map((b) => b.value)
    .join('');
}

/**
 * Builds the second step of the auth flow: the 6-digit OTP entry form.
 * Renders the user's email via `textContent` (not innerHTML) to prevent XSS.
 * Code box interaction logic is attached via `wireCodeBoxes`.
 * Submit logic is wired in `showCodeStep` so it has access to closure state.
 *
 * @param {string} email - The email address the OTP was sent to
 * @param {Record<string, string>} strings - Localized UI strings
 * @returns {HTMLElement}
 */
function buildCodeStep(email, strings) {
  const step = document.createElement('div');
  step.className = 'auth-step auth-step-code';

  const boxesHtml = Array.from({ length: 6 }, (_, i) => `<input type="text" class="auth-code-box" inputmode="numeric" maxlength="1" aria-label="${strings.digit} ${i + 1}" ${i === 0 ? 'autocomplete="one-time-code"' : ''}>`).join('');

  step.innerHTML = `
    <h3>${strings.codeHeading}</h3>
    <p class="auth-step-desc">${strings.codeDescPrefix}<strong></strong></p>
    <form class="auth-form">
      <div class="auth-code-boxes">${boxesHtml}</div>
      <button type="submit" class="auth-submit">${strings.verify}</button>
      <p class="auth-error"></p>
    </form>
    <button type="button" class="auth-back">${strings.useDifferentEmail}</button>
  `;
  step.querySelector('.auth-step-desc strong').textContent = email;

  wireCodeBoxes(step);
  return step;
}

/**
 * Builds the final step shown after successful OTP verification.
 * Renders the user's email via `textContent` (not innerHTML) to prevent XSS.
 * The panel auto-closes 1.5s after this step is shown.
 *
 * @param {string} email - The authenticated user's email address
 * @param {Record<string, string>} strings - Localized UI strings
 * @returns {HTMLElement}
 */
function buildSuccessStep(email, strings) {
  const step = document.createElement('div');
  step.className = 'auth-step auth-step-success';
  step.innerHTML = `
    <div class="auth-success-icon">&#10003;</div>
    <h3>${strings.welcome}</h3>
    <p class="auth-step-desc"></p>
  `;
  step.querySelector('.auth-step-desc').textContent = email;
  return step;
}

/**
 * Builds the profile-completion step shown after a successful OTP verification when the
 * customer record is missing a first name, last name, or ZIP code. Pre-fills any fields the
 * customer already has on file.
 *
 * @param {Record<string, unknown>} customer - The customer record fetched after verification
 * @param {Record<string, string>} strings - Localized UI strings
 * @param {boolean} isCanada - Whether the current store uses postal codes
 * @returns {HTMLElement}
 */
function buildProfileStep(customer, strings, isCanada) {
  const step = document.createElement('div');
  step.className = 'auth-step auth-step-profile';
  const zipLabel = isCanada ? strings.postalCode : strings.zip;
  step.innerHTML = `
    <h3>${strings.profileHeading}</h3>
    <p class="auth-step-desc">${strings.profileDesc}</p>
    <form class="auth-form">
      <input type="text" class="auth-input" name="firstName"
             placeholder="${strings.firstName}" autocomplete="given-name">
      <input type="text" class="auth-input" name="lastName"
             placeholder="${strings.lastName}" autocomplete="family-name">
      <input type="text" class="auth-input" name="zipCode"
             placeholder="${zipLabel}" autocomplete="postal-code"${isCanada ? '' : ' inputmode="numeric"'}>
      <button type="submit" class="auth-submit">${strings.save}</button>
      <p class="auth-error"></p>
    </form>
    <button type="button" class="auth-back auth-skip">${strings.skip}</button>
  `;
  step.querySelector('[name="firstName"]').value = String(customer.firstName ?? '');
  step.querySelector('[name="lastName"]').value = String(customer.lastName ?? '');
  step.querySelector('[name="zipCode"]').value = String(customer.zipCode ?? '');
  return step;
}

/**
 * Whether the customer record is missing a first name, last name, or ZIP/postal code.
 *
 * @param {Record<string, unknown>} customer
 * @returns {boolean}
 */
function isProfileIncomplete(customer) {
  return !customer.firstName || !customer.lastName || !customer.zipCode;
}

/**
 * Creates the slide-out authentication panel and returns controls for it.
 *
 * The panel manages a two-step passwordless OTP flow:
 *   1. Email step — user enters their email, triggering an OTP email
 *   2. Code step — user enters the 6-digit code; on success the JWT is stored
 *      and the panel auto-closes after showing a brief success message
 *
 * OTP state (`hash` and `exp` returned by the login API) is held in a closure
 * variable scoped to this panel instance, so it is never accessible outside
 * and is cleared on successful verification.
 *
 * @returns {{ dialog: HTMLDialogElement, open: Function, close: Function,
 *   showEmailStep: Function }}
 */
export default function createAuthPanel() {
  let otpState = null;

  const { strings, isCanada } = getAuthContext();

  const {
    dialog, content, open, close,
  } = createSlidePanel('auth-panel', strings.panelTitle, 'auth-panel');

  /**
   * Replaces the panel's current content with the given step element and
   * moves focus to the first input within it.
   *
   * @param {HTMLElement} stepEl
   */
  function showStep(stepEl) {
    content.innerHTML = '';
    content.append(stepEl);
    const firstInput = stepEl.querySelector('input');
    if (firstInput) setTimeout(() => firstInput.focus(), 100);
  }

  /**
   * Renders the email step and wires its submit handler.
   * On submit, calls the login API and transitions to the code step.
   * Exported so the header can reset the panel to this step on each open.
   */
  function showEmailStep() {
    const step = buildEmailStep(strings);
    step.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = step.querySelector('[name="email"]').value.trim();
      const btn = step.querySelector('.auth-submit');
      const errEl = step.querySelector('.auth-error');
      errEl.textContent = '';
      btn.disabled = true;
      btn.textContent = strings.sendingCode;

      try {
        const { locale: country, language: lang } = getLocaleAndLanguage(false, true);
        otpState = await login(email, country, lang);
        // eslint-disable-next-line no-use-before-define
        showCodeStep(email);
      } catch (err) {
        errEl.textContent = err?.errorHeader?.toLowerCase().includes('recaptcha')
          ? strings.recaptchaError
          : (err.message || strings.sendCodeFailed);
        btn.disabled = false;
        btn.textContent = strings.continue;
      }
    });
    showStep(step);
  }

  /**
   * Shows the success step and auto-closes the panel after a short delay.
   *
   * @param {string} email - The authenticated user's email address
   */
  function finishLogin(email) {
    showStep(buildSuccessStep(email, strings));
    setTimeout(close, 1500);
  }

  /**
   * Renders the profile-completion step and wires its Save/Skip handlers.
   * Saving calls `updateCustomer` with the entered fields; skipping proceeds
   * without saving. Either action finishes the login flow.
   *
   * @param {string} email - The authenticated user's email address
   * @param {Record<string, unknown>} customer - The customer record fetched after verification
   */
  function showProfileStep(email, customer) {
    const step = buildProfileStep(customer, strings, isCanada);
    step.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = step.querySelector('.auth-submit');
      const errEl = step.querySelector('.auth-error');
      errEl.textContent = '';

      const firstName = step.querySelector('[name="firstName"]').value.trim();
      const lastName = step.querySelector('[name="lastName"]').value.trim();
      const zipCode = step.querySelector('[name="zipCode"]').value.trim();
      if (!firstName || !lastName || !zipCode) {
        errEl.textContent = strings.fillAllFields;
        return;
      }
      if (!isValidPostalCode(zipCode, isCanada)) {
        errEl.textContent = isCanada ? strings.invalidPostalCode : strings.invalidZip;
        return;
      }

      btn.disabled = true;
      btn.textContent = strings.saving;
      try {
        await updateCustomer(email, { firstName, lastName, zipCode });
        finishLogin(email);
      } catch (err) {
        errEl.textContent = err.message || strings.saveFailed;
        btn.disabled = false;
        btn.textContent = strings.save;
      }
    });

    step.querySelector('.auth-skip').addEventListener('click', () => finishLogin(email));
    showStep(step);
  }

  /**
   * Fetches the customer record after verification and, when the first name, last name, or
   * ZIP code is missing, shows the profile-completion step instead of finishing immediately.
   * If the customer record can't be fetched, fails open and finishes the login normally rather
   * than blocking sign-in on a flaky profile lookup.
   *
   * @param {string} email - The authenticated user's email address
   */
  async function proceedAfterVerify(email) {
    let customer;
    try {
      customer = unwrapCustomerResponse(await getLoggedInCustomer(email));
      if (Array.isArray(customer) && customer.length === 1) [customer] = customer;
    } catch {
      finishLogin(email);
      return;
    }
    const c = customer && typeof customer === 'object' ? customer : {};
    if (isProfileIncomplete(c)) {
      showProfileStep(email, c);
    } else {
      finishLogin(email);
    }
  }

  /**
   * Renders the code entry step and wires its submit handler.
   * Validates that all 6 digits are filled before calling the API to avoid
   * consuming one of the 3 server-side attempts with an incomplete code.
   * On success, clears OTP state and checks whether the customer's profile
   * needs completing before finishing the login.
   *
   * @param {string} email - The email address the OTP was sent to
   */
  function showCodeStep(email) {
    const step = buildCodeStep(email, strings);
    step.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = getCodeValue(step);
      const btn = step.querySelector('.auth-submit');
      const errEl = step.querySelector('.auth-error');
      errEl.textContent = '';

      if (code.length < 6) {
        errEl.textContent = strings.enterAllDigits;
        return;
      }

      btn.disabled = true;
      btn.textContent = strings.verifying;

      try {
        await verifyCode(email, code, otpState.hash, otpState.exp);
        otpState = null;
        await proceedAfterVerify(email);
      } catch (err) {
        errEl.textContent = err.message || strings.invalidCode;
        btn.disabled = false;
        btn.textContent = strings.verify;
      }
    });

    step.querySelector('.auth-back').addEventListener('click', showEmailStep);
    showStep(step);
  }

  return {
    dialog, open, close, showEmailStep,
  };
}
