import { fetchPlaceholders } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/** Sheet logger endpoint for login form */
const SHEET_LOGGER_URL = 'https://sheet-logger.david8603.workers.dev/vitamix.com/forms-testing/login';

const CODE_LENGTH = 4;

/**
 * Decorates the login widget: applies placeholders and configures form.
 * On success, hides form and shows verification UI (code inputs, resend).
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.login-form');
  const verifyEl = widget.querySelector('.login-verify');
  if (!form || !verifyEl) return;

  const { locale, language } = getLocaleAndLanguage();
  const p = await fetchPlaceholders(`/${locale}/${language}`);
  const get = (key, fallback = '') => (p[key] != null && p[key] !== '' ? p[key] : fallback);

  const labels = {
    emailAddress: get('emailAddress', 'Email Address'),
    submit: get('submit', 'Submit'),
    sending: get('sending', 'Sending...'),
    verifyYourEmail: get('verifyYourEmail', 'Verify Your Email'),
    enterVerificationCodeSent: get(
      'enterVerificationCodeSent',
      'Enter the verification code sent to your email:',
    ),
    didntReceiveCode: get('didntReceiveCode', 'Didn\'t receive the code?'),
    resendCode: get('resendCode', 'Resend code'),
  };

  const placeholders = {
    emailAddress: get('emailAddressPlaceholder'),
  };

  form.querySelector('[for="login-email"] .label-text').textContent = labels.emailAddress;

  const emailInput = form.querySelector('#login-email');
  if (emailInput && placeholders.emailAddress) {
    emailInput.placeholder = placeholders.emailAddress;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.submit;

  // Verification block labels
  verifyEl.querySelector('.login-verify-title').textContent = labels.verifyYourEmail;
  verifyEl.querySelector('.login-verify-instruction').textContent = labels.enterVerificationCodeSent;
  verifyEl.querySelector('.login-verify-didnt-receive').textContent = labels.didntReceiveCode;
  verifyEl.querySelector('.login-verify-resend').textContent = labels.resendCode;

  // Code inputs: single character each, auto-advance, paste support
  const codeInputs = [...verifyEl.querySelectorAll('.login-verify-input')];
  codeInputs.forEach((input, i) => {
    input.addEventListener('input', (e) => {
      const val = (e.target.value || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 1);
      e.target.value = val;
      if (val && i < codeInputs.length - 1) {
        codeInputs[i + 1].focus();
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && i > 0) {
        codeInputs[i - 1].focus();
      }
    });
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData?.getData('text') || '').replace(/[^0-9A-Za-z]/g, '').slice(0, CODE_LENGTH);
      pasted.split('').forEach((ch, j) => {
        if (codeInputs[j]) {
          codeInputs[j].value = ch;
        }
      });
      const next = codeInputs[Math.min(pasted.length, codeInputs.length - 1)];
      if (next) next.focus();
    });
  });

  // Resend: re-submit email to sheet-logger (same payload)
  const resendBtn = verifyEl.querySelector('.login-verify-resend');
  resendBtn.addEventListener('click', async () => {
    const email = form.querySelector('#login-email').value;
    if (!email) return;
    resendBtn.disabled = true;
    const originalText = resendBtn.textContent;
    resendBtn.textContent = labels.sending;
    try {
      const resp = await fetch(SHEET_LOGGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pageUrl: window.location.href, resend: true }),
      });
      if (!resp.ok) throw new Error(`Sheet logger responded with ${resp.status}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Login resend failed', err);
    }
    resendBtn.disabled = false;
    resendBtn.textContent = originalText;
  });

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
      form.setAttribute('hidden', '');
      form.classList.add('is-hidden');
      verifyEl.removeAttribute('hidden');
      verifyEl.hidden = false;
      codeInputs[0].focus();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Login form submission failed', err);
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitButton) {
        submitButton.textContent = submitButton.dataset.originalLabel || buttonLabel;
      }
    }
  });
}
