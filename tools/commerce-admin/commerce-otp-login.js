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

async function readError(resp) {
  return resp.headers.get('x-error')
    || (await resp.text().catch(() => '')).trim()
    || `HTTP ${resp.status}`;
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

        form.closest('.ca-login-wrap').querySelector('.ca-login-title').textContent = 'Enter verification code';
        form.closest('.ca-login-wrap').querySelector('.ca-login-subtitle').textContent = `We sent a code to ${email}`;
        form.innerHTML = `
          <div class="ca-form-field">
            <label for="otp-code">Verification code</label>
            <input type="text" id="otp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" required class="ca-input" />
            <p class="ca-field-hint">Enter the code from your email.</p>
          </div>
          <div class="ca-button-row">
            <button type="button" id="login-back-btn" class="ca-btn ca-btn-secondary">Back</button>
            <button type="submit" class="ca-btn ca-btn-primary">Verify</button>
          </div>
        `;

        form.querySelector('#login-back-btn').addEventListener('click', () => {
          loginState = null;
          mountCommerceOtpLogin(container, ctx);
        });
        const otpInput = form.querySelector('#otp-code');
        otpInput.focus();
        otpInput.addEventListener('input', () => {
          otpInput.classList.remove('input-error');
        });
        return;
      }
      const otpInput = form.querySelector('#otp-code');
      const code = otpInput.value;
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
        otpInput.classList.add('input-error');
        otpInput.focus();
        otpInput.select();
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
