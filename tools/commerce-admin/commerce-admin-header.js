/* eslint-disable import/prefer-default-export -- header boot script mounts via side effect */
/**
 * Top app bar: hub brand or "← Commerce Admin", user trigger + menu (sign out, placeholders).
 * Expects #commerce-admin-app-header. Run after auth-page-boot.js (module order in HTML).
 */
import { getAuthState, getApiEnvironment, setApiEnvironment } from './commerce-otp-api.js';
import { PB_ORG, PB_SITE } from './commerce-pbus-config.js';
import { escapeHtml } from './commerce-otp-ui.js';

function homeHref() {
  const raw = document.body?.getAttribute('data-commerce-admin-home');
  if (raw != null && String(raw).trim() !== '') {
    return String(raw).trim();
  }
  return 'index.html';
}

function headerVariant() {
  const v = document.body?.getAttribute('data-commerce-header');
  return v === 'hub' ? 'hub' : 'subpage';
}

function pageTitleAttr() {
  const t = document.body?.getAttribute('data-commerce-header-page');
  return t != null && String(t).trim() !== '' ? String(t).trim() : '';
}

function applyApiEnvHeaderClass(slot) {
  const env = getApiEnvironment();
  slot.classList.remove('commerce-admin-app-header-api-stage', 'commerce-admin-app-header-api-prod');
  slot.classList.add(env === 'prod' ? 'commerce-admin-app-header-api-prod' : 'commerce-admin-app-header-api-stage');
}

function closeMenu(trigger, menu) {
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  if (menu) menu.classList.remove('is-open');
}

function openMenu(trigger, menu) {
  if (trigger) trigger.setAttribute('aria-expanded', 'true');
  if (menu) menu.classList.add('is-open');
}

export function mountCommerceAdminHeader() {
  const slot = document.getElementById('commerce-admin-app-header');
  if (!slot) return;

  const variant = headerVariant();
  const home = homeHref();
  const pageTitle = pageTitleAttr();
  const auth = getAuthState(PB_ORG, PB_SITE);
  const email = typeof auth?.email === 'string' && auth.email.trim() ? auth.email.trim() : '';
  const triggerLabel = email || 'Signed in';

  let left;
  if (variant === 'hub') {
    left = `<div class="commerce-admin-header-left">
           <a href="${escapeHtml(home)}" class="commerce-admin-header-brand">Vitamix Commerce Admin</a>
         </div>`;
  } else {
    left = `<div class="commerce-admin-header-left">
           <a href="${escapeHtml(home)}" class="commerce-admin-header-back">← Commerce Admin</a>
           ${pageTitle ? `<span class="commerce-admin-header-page">${escapeHtml(pageTitle)}</span>` : ''}
         </div>`;
  }

  slot.classList.add('commerce-admin-app-header');
  applyApiEnvHeaderClass(slot);
  slot.innerHTML = `
    <div class="commerce-admin-header-inner">
      ${left}
      <div class="commerce-admin-header-env">
        <span class="commerce-admin-api-env-label" id="commerce-api-env-label">API</span>
        <select
          id="commerce-api-env-select"
          class="commerce-admin-api-env-select"
          aria-labelledby="commerce-api-env-label"
        >
          <option value="stage">Staging</option>
          <option value="prod">Production</option>
        </select>
      </div>
      <div class="commerce-admin-header-right">
        <div class="commerce-admin-user-wrap">
          <button type="button" class="commerce-admin-user-trigger" id="commerce-admin-user-trigger" aria-expanded="false" aria-haspopup="true" aria-controls="commerce-admin-user-menu">
            <span class="commerce-admin-user-label">
              <span class="commerce-admin-user-name">${escapeHtml(triggerLabel)}</span>
            </span>
            <span class="commerce-admin-user-chevron" aria-hidden="true"></span>
          </button>
          <ul class="commerce-admin-user-menu" id="commerce-admin-user-menu" role="menu" aria-labelledby="commerce-admin-user-trigger" hidden>
            <li class="commerce-admin-user-menu-hint" role="presentation">Account</li>
            <li role="presentation"><button type="button" class="commerce-admin-user-menu-item" role="menuitem" data-commerce-menu="settings" disabled>Account settings (coming soon)</button></li>
            <li role="presentation"><button type="button" class="commerce-admin-user-menu-item" role="menuitem" data-commerce-menu="prefs" disabled>Preferences (coming soon)</button></li>
            <li role="presentation"><button type="button" class="commerce-admin-user-menu-item danger" role="menuitem" id="commerce-header-sign-out">Sign out</button></li>
          </ul>
        </div>
      </div>
    </div>
  `;

  const trigger = document.getElementById('commerce-admin-user-trigger');
  const menu = document.getElementById('commerce-admin-user-menu');
  const signOutBtn = document.getElementById('commerce-header-sign-out');
  const envSelect = document.getElementById('commerce-api-env-select');

  if (envSelect) {
    envSelect.value = getApiEnvironment();
    envSelect.addEventListener('change', () => {
      const next = envSelect.value === 'prod' ? 'prod' : 'stage';
      if (next === getApiEnvironment()) return;
      setApiEnvironment(next);
      window.location.reload();
    });
  }

  const syncMenuHidden = () => {
    if (!menu) return;
    const open = menu.classList.contains('is-open');
    menu.hidden = !open;
  };

  trigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!menu || !trigger) return;
    const open = menu.classList.contains('is-open');
    if (open) closeMenu(trigger, menu);
    else openMenu(trigger, menu);
    syncMenuHidden();
  });

  signOutBtn?.addEventListener('click', () => {
    closeMenu(trigger, menu);
    syncMenuHidden();
    window.dispatchEvent(new CustomEvent('commerce-admin:sign-out'));
  });

  document.addEventListener('click', () => {
    closeMenu(trigger, menu);
    syncMenuHidden();
  });

  menu?.addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMenu(trigger, menu);
      syncMenuHidden();
    }
  });

  syncMenuHidden();
}

mountCommerceAdminHeader();
