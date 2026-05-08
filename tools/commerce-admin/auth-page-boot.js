/**
 * Blocks the page until ProductBus OTP auth is satisfied (same API as productbus-admin).
 * Org/site are fixed for this Vitamix project (matches Edge Delivery:
 * main--vitamix--aemsites).
 */
import { getAuthState, clearAuthState, PRODUCTBUS_STAGE_SESSION_KEY } from './commerce-otp-api.js';
import { mountCommerceOtpLogin } from './commerce-otp-login.js';
import { PB_ORG, PB_SITE } from './commerce-pbus-config.js';
import { setStoredFirstName } from './user-identity.js';

function firstNameFromEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const local = email.split('@')[0]?.trim();
  if (!local) return null;
  const segment = local.split(/[._-]/)[0];
  if (!segment || segment.length < 2) return null;
  return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
}

function applyProfileFromAuth() {
  const auth = getAuthState(PB_ORG, PB_SITE);
  const email = auth?.email;
  if (email) {
    const first = firstNameFromEmail(email);
    if (first) setStoredFirstName(first);
  }
}

async function ensureCommerceAuth() {
  const root = document.getElementById('commerce-admin-auth-root');
  if (!root) {
    document.documentElement.classList.add('commerce-admin-auth-ok');
    return;
  }

  root.style.display = '';
  root.removeAttribute('aria-hidden');

  const collapseAuthRoot = () => {
    root.innerHTML = '';
    root.style.display = 'none';
    root.setAttribute('aria-hidden', 'true');
  };

  const proceed = async () => {
    if (getAuthState(PB_ORG, PB_SITE)) {
      applyProfileFromAuth();
      document.documentElement.classList.add('commerce-admin-auth-ok');
      collapseAuthRoot();
      return;
    }
    root.style.display = '';
    root.removeAttribute('aria-hidden');
    root.innerHTML = '';
    await new Promise((resolve) => {
      mountCommerceOtpLogin(root, {
        org: PB_ORG,
        site: PB_SITE,
        onAuthenticated: (result) => {
          applyProfileFromAuth();
          document.documentElement.classList.add('commerce-admin-auth-ok');
          collapseAuthRoot();
          resolve(result);
        },
      }).catch(() => {});
    });
  };

  const tryAuth = async () => {
    root.style.display = '';
    root.removeAttribute('aria-hidden');
    await proceed();
  };

  const stageParam = new URLSearchParams(window.location.search).get('stage');
  if (stageParam === 'true') {
    sessionStorage.removeItem(PRODUCTBUS_STAGE_SESSION_KEY);
  } else if (stageParam === 'false') {
    sessionStorage.setItem(PRODUCTBUS_STAGE_SESSION_KEY, 'false');
  }

  window.addEventListener('commerce-admin:sign-out', () => {
    clearAuthState(PB_ORG, PB_SITE);
    document.documentElement.classList.remove('commerce-admin-auth-ok');
    tryAuth().catch(() => {});
  });

  await tryAuth();
}

await ensureCommerceAuth();
