import { loadCSS } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';
import { getUser, logout } from '../../scripts/auth-api.js';

/** Select option value for sign out (not a content section). */
const LOGOUT_SELECT_VALUE = '__logout__';

/**
 * @param {string} lang
 * @returns {Promise<Record<string, unknown>>}
 */
async function loadCopy(lang) {
  const jsonPath = new URL('./account.json', import.meta.url).pathname;
  const url = `${window.hlx?.codeBasePath || ''}${jsonPath}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const key = data[lang] ? lang : 'en';
  return data[key];
}

/**
 * @param {HTMLElement} section
 * @param {Array<{ label?: string, value?: string, valueKey?: string }>} rows
 * @param {string} [email]
 */
function fillMockRows(section, rows, email) {
  if (!section || !rows?.length) return;
  const rowEls = section.querySelectorAll('.account-mock-row');
  rows.forEach((row, i) => {
    const el = rowEls[i];
    if (!el) return;
    const label = el.querySelector('.account-mock-label');
    const value = el.querySelector('.account-mock-value');
    if (label) label.textContent = row.label ?? '';
    if (value) {
      const v = row.valueKey === 'email' ? (email || '—') : (row.value ?? '—');
      value.textContent = v;
    }
  });
}

/**
 * @param {HTMLElement} listEl
 * @param {Array<{ badge?: string, lines?: string[] }>} addresses
 */
function fillAddressList(listEl, addresses) {
  if (!listEl || !addresses?.length) return;
  listEl.innerHTML = '';
  addresses.forEach((addr) => {
    const li = document.createElement('li');
    li.className = 'account-address-item';
    const badge = document.createElement('div');
    badge.className = 'account-address-badge';
    badge.textContent = addr.badge || '';
    const lines = document.createElement('p');
    lines.className = 'account-address-lines';
    lines.textContent = (addr.lines || []).join('\n');
    li.append(badge, lines);
    listEl.append(li);
  });
}

/**
 * @param {HTMLElement} widget
 */
export default async function decorate(widget) {
  const base = window.hlx?.codeBasePath || '';
  await Promise.all([
    loadCSS(`${base}/styles/commerce-tokens.css`),
    loadCSS(`${base}/widgets/account/account.css`),
  ]);

  const { language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadCopy(lang);
  const email = getUser()?.email || '';
  const dialog = widget.closest('dialog');
  const titleEl = dialog?.querySelector('.slide-panel-header h2');
  if (titleEl && copy.modalTitle) titleEl.textContent = copy.modalTitle;

  const nav = copy.nav || {};
  const navButtons = widget.querySelectorAll('.account-nav-item');
  const panelEls = widget.querySelectorAll('.account-panel');
  const navSelect = widget.querySelector('.account-nav-select');

  navButtons.forEach((btn) => {
    const key = btn.dataset.section;
    if (key && nav[key]) btn.textContent = nav[key];
  });

  const buildNavSelectOptions = () => {
    if (!navSelect) return;
    navSelect.setAttribute('aria-label', copy.sectionSelectAria || 'Choose section');
    navSelect.innerHTML = '';
    navButtons.forEach((btn) => {
      const { section } = btn.dataset;
      if (!section) return;
      const opt = document.createElement('option');
      opt.value = section;
      opt.textContent = btn.textContent || section;
      navSelect.append(opt);
    });
    const logoutOpt = document.createElement('option');
    logoutOpt.value = LOGOUT_SELECT_VALUE;
    logoutOpt.textContent = copy.logout || 'Log out';
    navSelect.append(logoutOpt);
  };
  buildNavSelectOptions();

  const greetingEl = widget.querySelector('.account-greeting');
  const emailEl = widget.querySelector('.account-email-muted');
  if (greetingEl) {
    const local = email ? email.split('@')[0] : '';
    greetingEl.textContent = local ? `${copy.greeting}, ${local}` : copy.greeting;
  }
  if (emailEl) emailEl.textContent = email || '';

  const panels = copy.panels || {};
  const overview = widget.querySelector('.account-panel[data-section="overview"]');
  if (overview) {
    const p = panels.overview || {};
    const t = overview.querySelector('.account-panel-title');
    const intro = overview.querySelector('.account-panel-intro');
    if (t) t.textContent = p.title || '';
    if (intro) intro.textContent = p.intro || '';
    fillMockRows(overview, p.rows, email);
  }

  const information = widget.querySelector('.account-panel[data-section="information"]');
  if (information) {
    const p = panels.information || {};
    const t = information.querySelector('.account-panel-title');
    if (t) t.textContent = p.title || '';
    fillMockRows(information, p.rows, email);
  }

  const address = widget.querySelector('.account-panel[data-section="address"]');
  if (address) {
    const p = panels.address || {};
    const t = address.querySelector('.account-panel-title');
    const listEl = address.querySelector('.account-address-list');
    if (t) t.textContent = p.title || '';
    fillAddressList(listEl, p.mockAddresses);
  }

  const orders = widget.querySelector('.account-panel[data-section="orders"]');
  if (orders) {
    const p = panels.orders || {};
    const t = orders.querySelector('.account-panel-title');
    const list = orders.querySelector('.account-order-mock-list');
    if (t) t.textContent = p.title || '';
    if (list && Array.isArray(p.mockOrders)) {
      const om = copy.orderMock || {};
      list.innerHTML = p.mockOrders.map((o) => `
        <li class="account-order-mock-item">
          <span class="account-order-mock-id">${o.id || ''}</span>
          <div class="account-order-mock-meta">
            <span>${om.placed || ''}: ${o.date || '—'}</span>
            <span>${om.total || ''}: ${o.total || '—'}</span>
          </div>
        </li>
      `).join('');
    }
  }

  const mq = window.matchMedia('(min-width: 768px)');
  let activeSection = 'overview';

  const syncMobileNavMode = () => {
    if (mq.matches) {
      widget.classList.remove('account-widget--mobile-nav-select');
      return;
    }
    if (activeSection !== 'overview') {
      widget.classList.add('account-widget--mobile-nav-select');
    } else {
      widget.classList.remove('account-widget--mobile-nav-select');
    }
  };

  const logoutBtn = widget.querySelector('.account-logout');
  const doLogout = async () => {
    if (!logoutBtn) return;
    logoutBtn.disabled = true;
    try {
      await logout();
    } catch {
      /* best-effort */
    } finally {
      logoutBtn.disabled = false;
    }
    if (dialog?.closeModal) dialog.closeModal();
    else dialog?.close();
  };

  const selectSection = (section) => {
    if (!section || section === LOGOUT_SELECT_VALUE) return;
    activeSection = section;
    navButtons.forEach((b) => {
      const on = b.dataset.section === section;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (navSelect) navSelect.value = section;
    panelEls.forEach((panel) => {
      const show = panel.dataset.section === section;
      panel.classList.toggle('is-visible', show);
      panel.hidden = !show;
    });
    syncMobileNavMode();
  };

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => selectSection(btn.dataset.section));
  });
  if (navSelect) {
    navSelect.addEventListener('change', async () => {
      if (navSelect.value === LOGOUT_SELECT_VALUE) {
        navSelect.value = activeSection;
        await doLogout();
        return;
      }
      selectSection(navSelect.value);
    });
  }
  mq.addEventListener('change', syncMobileNavMode);
  syncMobileNavMode();

  if (logoutBtn) {
    logoutBtn.textContent = copy.logout || 'Log out';
    logoutBtn.addEventListener('click', async () => {
      await doLogout();
    });
  }

  if (email) {
    try {
      const { fetchAccountBundle, applyAccountDataToWidget } = await import('../../scripts/account-api.js');
      const data = await fetchAccountBundle(email);
      applyAccountDataToWidget(widget, data, copy);
    } catch (err) {
      // eslint-disable-next-line no-console -- integration: copy API bundle errors
      console.log('VITAMIX_ACCOUNT_API_BUNDLE_EXCEPTION');
      // eslint-disable-next-line no-console
      console.log(err instanceof Error ? err.message : String(err));
    }
  }
}
