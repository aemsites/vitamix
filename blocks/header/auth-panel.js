import createSlidePanel from '../../scripts/slide-panel.js';
import { login, verifyCode } from '../../scripts/auth-api.js';

/**
 * Builds the first step of the auth flow: an email input form.
 * The form has no submit logic attached — that is wired in `showEmailStep`
 * so it has access to the panel's closure state.
 *
 * @returns {HTMLElement}
 */
function buildEmailStep() {
  const step = document.createElement('div');
  step.className = 'auth-step auth-step-email';
  step.innerHTML = `
    <h3>Sign in</h3>
    <p class="auth-step-desc">Enter your email to receive a one-time code.</p>
    <form class="auth-form">
      <input type="email" class="auth-input" name="email"
             placeholder="Email address" autocomplete="email" required>
      <button type="submit" class="auth-submit">Continue</button>
      <p class="auth-error"></p>
    </form>
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
 * @returns {HTMLElement}
 */
function buildCodeStep(email) {
  const step = document.createElement('div');
  step.className = 'auth-step auth-step-code';

  const boxesHtml = Array.from({ length: 6 }, (_, i) => `<input type="text" class="auth-code-box" inputmode="numeric" maxlength="1" aria-label="Digit ${i + 1}" ${i === 0 ? 'autocomplete="one-time-code"' : ''}>`).join('');

  step.innerHTML = `
    <h3>Check your email</h3>
    <p class="auth-step-desc">We sent a 6-digit code to <strong></strong></p>
    <form class="auth-form">
      <div class="auth-code-boxes">${boxesHtml}</div>
      <button type="submit" class="auth-submit">Verify</button>
      <p class="auth-error"></p>
    </form>
    <button type="button" class="auth-back">Use a different email</button>
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
 * @returns {HTMLElement}
 */
function buildSuccessStep(email) {
  const step = document.createElement('div');
  step.className = 'auth-step auth-step-success';
  step.innerHTML = `
    <div class="auth-success-icon">&#10003;</div>
    <h3>Welcome</h3>
    <p class="auth-step-desc"></p>
  `;
  step.querySelector('.auth-step-desc').textContent = email;
  return step;
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

  const {
    dialog, content, open, close,
  } = createSlidePanel('auth-panel', 'Account', 'auth-panel');

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
    const step = buildEmailStep();
    step.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = step.querySelector('[name="email"]').value.trim();
      const btn = step.querySelector('.auth-submit');
      const errEl = step.querySelector('.auth-error');
      errEl.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Sending code\u2026';

      try {
        otpState = await login(email);
        // eslint-disable-next-line no-use-before-define
        showCodeStep(email);
      } catch (err) {
        errEl.textContent = err.message || 'Failed to send code';
        btn.disabled = false;
        btn.textContent = 'Continue';
      }
    });
    showStep(step);
  }

  /**
   * Renders the code entry step and wires its submit handler.
   * Validates that all 6 digits are filled before calling the API to avoid
   * consuming one of the 3 server-side attempts with an incomplete code.
   * On success, clears OTP state, shows the success step, and auto-closes.
   *
   * @param {string} email - The email address the OTP was sent to
   */
  function showCodeStep(email) {
    const step = buildCodeStep(email);
    step.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = getCodeValue(step);
      const btn = step.querySelector('.auth-submit');
      const errEl = step.querySelector('.auth-error');
      errEl.textContent = '';

      if (code.length < 6) {
        errEl.textContent = 'Please enter all 6 digits.';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Verifying\u2026';

      try {
        await verifyCode(email, code, otpState.hash, otpState.exp);
        otpState = null;
        showStep(buildSuccessStep(email));
        setTimeout(close, 1500);
      } catch (err) {
        errEl.textContent = err.message || 'Invalid code';
        btn.disabled = false;
        btn.textContent = 'Verify';
      }
    });

    step.querySelector('.auth-back').addEventListener('click', showEmailStep);
    showStep(step);
  }

  return {
    dialog, open, close, showEmailStep,
  };
}
