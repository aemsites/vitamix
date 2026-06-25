/* eslint-disable import/prefer-default-export -- single mount function */
/**
 * OTP email sign-in (from helix-tools-website productbus-admin/login.js).
 * On success calls onAuthenticated instead of ProductBus in-app routing.
 */

import {
  apiFetch,
  setAuthState,
  getApiEnvironment,
  setApiEnvironment,
} from './commerce-otp-api.js';
import { showToast } from './commerce-otp-ui.js';

const CODE_LENGTH = 6;

async function readError(resp) {
  return resp.headers.get('x-error')
    || (await resp.text().catch(() => '')).trim()
    || `HTTP ${resp.status}`;
}

function getCodeBoxes(form) {
  return Array.from(form.querySelectorAll('.auth-code-box'));
}

function getCodeValue(form) {
  return getCodeBoxes(form).map((box) => box.value).join('');
}

function markCodeBoxesInvalid(form, invalid = true) {
  getCodeBoxes(form).forEach((box) => box.classList.toggle('input-error', invalid));
}

function wireCodeBoxes(form) {
  const boxes = getCodeBoxes(form);
  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g, '').slice(0, 1);
      markCodeBoxesInvalid(form, false);
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
      const paste = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, CODE_LENGTH);
      paste.split('').forEach((ch, j) => {
        if (boxes[j]) boxes[j].value = ch;
      });
      const next = Math.min(paste.length, boxes.length - 1);
      boxes[next].focus();
      markCodeBoxesInvalid(form, false);
    });
  });
}

/**
 * @param {HTMLElement} container
 * @param {{ org: string, site: string, onAuthenticated: (result: object) => void }} ctx
 */
export async function mountCommerceOtpLogin(container, ctx) {
  const { org, site, onAuthenticated } = ctx;
  const env = getApiEnvironment();
  container.dataset.apiEnv = env;

  container.innerHTML = `
    <div class="ca-login-wrap">
      <h1 class="ca-login-title">Commerce sign-in</h1>
      <p class="ca-login-subtitle">Choose staging or production, then enter your email for a verification code. Sign-in is remembered separately for each environment.</p>
      <div class="ca-login-env">
        <span class="ca-login-env-label" id="ca-login-env-label">Sign in to</span>
        <select
          id="commerce-login-api-env"
          class="commerce-admin-api-env-select ca-login-api-env-select"
          aria-labelledby="ca-login-env-label"
        >
          <option value="stage">Staging</option>
          <option value="prod">Production</option>
        </select>
      </div>
      <form id="commerce-login-form" class="ca-login-form">
        <div class="ca-form-field">
          <label for="login-email">Email</label>
          <input type="email" id="login-email" name="email" required autocomplete="email" />
        </div>
        <button type="submit" class="ca-btn ca-btn-primary">Send code</button>
      </form>
    </div>
  `;

  const envSelect = document.getElementById('commerce-login-api-env');
  if (envSelect) {
    envSelect.value = env;
    envSelect.addEventListener('change', async () => {
      const next = envSelect.value === 'prod' ? 'prod' : 'stage';
      if (next === getApiEnvironment()) return;
      setApiEnvironment(next);
      showToast(`Switched to ${next === 'prod' ? 'production' : 'staging'}.`, 'success');
      await mountCommerceOtpLogin(container, ctx);
    });
  }

  const form = document.getElementById('commerce-login-form');
  let loginState = null;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Please wait…';

    const resetSubmit = () => {
      submitBtn.disabled = false;
      submitBtn.textContent = loginState ? 'Verify' : 'Send code';
    };

    try {
      if (!loginState) {
        const email = form.querySelector('#login-email').value;
        const resp = await apiFetch(org, site, 'auth/login', {
          method: 'POST',
          body: JSON.stringify({ email }),
          skipAuthRedirect: true,
        });
        if (!resp.ok) {
          showToast(await readError(resp), 'error');
          resetSubmit();
          return;
        }
        const next = await resp.json();
        loginState = { ...next, email };

        form.closest('.ca-login-wrap').querySelector('.ca-login-title').textContent = 'Check your email';
        form.closest('.ca-login-wrap').querySelector('.ca-login-subtitle').innerHTML = 'We sent a 6-digit code to <strong></strong>';
        form.closest('.ca-login-wrap').querySelector('.ca-login-subtitle strong').textContent = email;
        const boxesHtml = Array.from(
          { length: CODE_LENGTH },
          (_, i) => `<input type="text" class="auth-code-box" inputmode="numeric" maxlength="1" aria-label="Digit ${i + 1}" ${i === 0 ? 'autocomplete="one-time-code"' : ''}>`,
        ).join('');
        form.innerHTML = `
          <div class="auth-code-boxes">${boxesHtml}</div>
          <button type="submit" class="auth-submit">Verify</button>
          <p class="auth-error"></p>
          <button type="button" id="login-back-btn" class="auth-back">Use a different email</button>
        `;

        form.querySelector('#login-back-btn').addEventListener('click', () => {
          loginState = null;
          mountCommerceOtpLogin(container, ctx);
        });
        wireCodeBoxes(form);
        form.querySelector('.auth-code-box').focus();
        return;
      }
      const code = getCodeValue(form);
      const errEl = form.querySelector('.auth-error');
      errEl.textContent = '';

      if (code.length < CODE_LENGTH) {
        markCodeBoxesInvalid(form);
        errEl.textContent = `Please enter all ${CODE_LENGTH} digits.`;
        resetSubmit();
        return;
      }
      const resp = await apiFetch(org, site, 'auth/callback', {
        method: 'POST',
        body: JSON.stringify({
          email: loginState.email,
          code,
          hash: loginState.hash,
          exp: loginState.exp,
        }),
        skipAuthRedirect: true,
      });
      if (resp.status === 401) {
        markCodeBoxesInvalid(form);
        form.querySelector('.auth-code-box').focus();
        errEl.textContent = 'Invalid code';
        showToast('Invalid code', 'error');
        resetSubmit();
        return;
      }
      if (!resp.ok) {
        showToast(await readError(resp), 'error');
        resetSubmit();
        return;
      }
      const result = await resp.json();

      setAuthState(org, site, {
        token: result.token,
        email: result.email,
        roles: result.roles,
        org: result.org,
        site: result.site,
      });

      onAuthenticated(result);
    } catch (error) {
      showToast(error.message || 'Login failed', 'error');
      resetSubmit();
    }
  });
}
