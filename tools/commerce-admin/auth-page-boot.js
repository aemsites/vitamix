/* eslint-disable no-console -- temporary auth-order debugging; remove when stable */
/**
 * Blocks the page until ProductBus OTP auth is satisfied (same API as productbus-admin).
 * Org/site are fixed for this Vitamix project (matches Edge Delivery:
 * main--vitamix--aemsites).
 */
import {
  getAuthState,
  verifyCommerceApiAccess,
  logoutCommerceSession,
  scheduleCommerceAuthExpiry,
  PRODUCTBUS_STAGE_SESSION_KEY,
} from './commerce-otp-api.js';
import { mountCommerceOtpLogin } from './commerce-otp-login.js';
import { PB_ORG, PB_SITE } from './commerce-pbus-config.js';
import { setStoredFirstName } from './user-identity.js';

const ACCESS_DENIED_MS = 2200;

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

function showAccessDenied(root) {
  root.style.display = '';
  root.removeAttribute('aria-hidden');
  root.innerHTML = `
    <div class="ca-login-wrap ca-login-denied">
      <h1 class="ca-login-title">Not authorized.</h1>
      <p class="ca-login-subtitle">This account does not have access to Commerce Admin for this site.</p>
    </div>
  `;
}

async function denyAccessAndSignOut(root) {
  console.log('[commerce-admin] auth-page-boot access denied; signing out');
  await logoutCommerceSession(PB_ORG, PB_SITE);
  document.documentElement.classList.remove('commerce-admin-auth-ok');
  showAccessDenied(root);
  await new Promise((resolve) => {
    setTimeout(resolve, ACCESS_DENIED_MS);
  });
}

async function completeAuthIfAllowed(root, collapseAuthRoot) {
  const access = await verifyCommerceApiAccess(PB_ORG, PB_SITE);
  if (!access.ok) {
    console.log(`[commerce-admin] auth-page-boot verifyCommerceApiAccess failed: ${access.message}`);
    await denyAccessAndSignOut(root);
    return false;
  }

  const auth = getAuthState(PB_ORG, PB_SITE);
  const roles = Array.isArray(auth?.roles) ? auth.roles.join(',') : String(auth?.roles ?? '');
  console.log(`[commerce-admin] auth-page-boot access ok; add commerce-admin-auth-ok roles=${roles}`);
  applyProfileFromAuth();
  document.documentElement.classList.add('commerce-admin-auth-ok');
  collapseAuthRoot();
  scheduleCommerceAuthExpiry(PB_ORG, PB_SITE, () => {
    console.log('[commerce-admin] auth-page-boot JWT expired; signing out');
    window.dispatchEvent(new CustomEvent('commerce-admin:sign-out'));
  });
  return true;
}

async function showLogin(root, collapseAuthRoot) {
  root.style.display = '';
  root.removeAttribute('aria-hidden');
  root.innerHTML = '';
  await new Promise((resolve) => {
    mountCommerceOtpLogin(root, {
      org: PB_ORG,
      site: PB_SITE,
      onAuthenticated: async (result) => {
        const roles = Array.isArray(result?.roles) ? result.roles.join(',') : String(result?.roles ?? '');
        console.log(`[commerce-admin] auth-page-boot onAuthenticated email=${String(result?.email ?? '')} roles=${roles}`);
        const granted = await completeAuthIfAllowed(root, collapseAuthRoot);
        if (granted) {
          resolve(result);
          return;
        }
        await showLogin(root, collapseAuthRoot);
        resolve(null);
      },
    }).catch(() => {});
  });
}

async function ensureCommerceAuth() {
  console.log('[commerce-admin] auth-page-boot ensureCommerceAuth start');
  const root = document.getElementById('commerce-admin-auth-root');
  if (!root) {
    document.documentElement.classList.add('commerce-admin-auth-ok');
    console.log('[commerce-admin] auth-page-boot no #commerce-admin-auth-root; added commerce-admin-auth-ok');
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
    const existing = getAuthState(PB_ORG, PB_SITE);
    if (existing?.token) {
      const roles = Array.isArray(existing?.roles) ? existing.roles.join(',') : String(existing?.roles ?? '');
      console.log(`[commerce-admin] auth-page-boot existing session; verify access roles=${roles}`);
      const granted = await completeAuthIfAllowed(root, collapseAuthRoot);
      if (granted) return;
      await showLogin(root, collapseAuthRoot);
      return;
    }
    await showLogin(root, collapseAuthRoot);
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
    logoutCommerceSession(PB_ORG, PB_SITE).then(() => {
      document.documentElement.classList.remove('commerce-admin-auth-ok');
      tryAuth().catch(() => {});
    });
  });

  await tryAuth();
  console.log('[commerce-admin] auth-page-boot ensureCommerceAuth end (next module scripts may run)');
}

await ensureCommerceAuth();
