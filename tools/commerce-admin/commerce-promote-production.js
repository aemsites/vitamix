/**
 * Staging-only “Promote to Production” control for commerce detail modals.
 * Requires a separate production OTP session (header → Production → sign in).
 * The prod write is mocked until a real prod endpoint exists.
 */
import { getApiEnvironment, getAuthStateForEnv } from './commerce-otp-api.js';
import { showToast } from './commerce-otp-ui.js';

/**
 * @param {object} opts
 * @param {string} opts.org
 * @param {string} opts.site
 * @param {'coupon'|'cart-rule'|'promotion'} opts.entityKind
 * @param {unknown} opts.payload
 */
export async function promoteEntityToProductionMock({
  org,
  site,
  entityKind,
  payload,
}) {
  await new Promise((r) => {
    setTimeout(r, 350);
  });
  return {
    ok: true,
    message: `[mock] Would PUT ${entityKind} to production for ${org}/${site}. No prod API call yet.`,
    entityKind,
    payloadKeys: payload && typeof payload === 'object' && !Array.isArray(payload)
      ? Object.keys(payload).slice(0, 12)
      : [],
  };
}

/**
 * Adds a high-contrast button to the modal toolbar (left cluster).
 * No-op when API env is not staging.
 *
 * @param {HTMLElement} toolbarMain
 * @param {object} opts
 * @param {string} opts.org
 * @param {string} opts.site
 * @param {'coupon'|'cart-rule'|'promotion'} opts.entityKind
 * @param {() => unknown} opts.getPayload
 */
export function mountPromoteProductionInToolbar(toolbarMain, {
  org,
  site,
  entityKind,
  getPayload,
}) {
  if (!toolbarMain || getApiEnvironment() !== 'stage') return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'commerce-promote-production-btn';
  btn.textContent = 'Promote to Production';
  btn.setAttribute(
    'title',
    'Requires a production sign-in (header environment → Production). Writes to prod are mocked for now.',
  );

  btn.addEventListener('click', async () => {
    const prodAuth = getAuthStateForEnv(org, site, 'prod');
    if (!prodAuth?.token) {
      showToast(
        'Sign in to Production first: set the header API environment to Production, complete OTP, then switch back to Staging and try again.',
        'error',
      );
      return;
    }

    btn.disabled = true;
    try {
      const payload = getPayload();
      const result = await promoteEntityToProductionMock({
        org,
        site,
        entityKind,
        payload,
      });
      showToast(result.message, 'success');
    } catch (err) {
      showToast(err?.message || 'Promote failed', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  toolbarMain.prepend(btn);
}
