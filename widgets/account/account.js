import { loadCSS } from '../../scripts/aem.js';
import { renderAccountAddressList } from './account-api.js';
import { getFormSubmissionUrl, getLocaleAndLanguage } from '../../scripts/scripts.js';
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
 * @param {HTMLElement} widget
 */
export default async function decorate(widget) {
  const base = window.hlx?.codeBasePath || '';
  await Promise.all([
    loadCSS(`${base}/styles/commerce-tokens.css`),
    loadCSS(`${base}/widgets/account/account.css`),
    loadCSS(`${base}/blocks/order-summary/order-summary.css`),
    loadCSS(`${base}/scripts/commerce/cart-item.css`),
  ]);

  const { locale, language } = getLocaleAndLanguage();
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
  }

  const information = widget.querySelector('.account-panel[data-section="information"]');
  if (information) {
    const p = panels.information || {};
    const t = information.querySelector('.account-panel-title');
    if (t) t.textContent = p.title || '';
    const comm = /** @type {Record<string, string>} */ (copy.communications || {});
    const commRoot = information.querySelector('.account-communications');
    const commTitle = information.querySelector('.account-communications-title');
    const commQuestion = information.querySelector('.account-communications-question');
    const commActions = information.querySelector('.account-communications-actions');
    const commSubscribe = information.querySelector('.account-communications-subscribe');
    const commUnsubscribe = information.querySelector('.account-communications-unsubscribe');
    const commSuccess = information.querySelector('.account-communications-success');
    const commError = information.querySelector('.account-communications-error');
    if (commTitle) commTitle.textContent = comm.title || 'Communications';
    if (commQuestion) {
      commQuestion.textContent = comm.question
        || 'Would you like us to send you periodic emails and newsletters from Vitamix?';
    }
    if (commSubscribe) commSubscribe.textContent = comm.subscribe || 'Subscribe';
    if (commUnsubscribe) commUnsubscribe.textContent = comm.unsubscribe || 'Unsubscribe';

    const setCommLoading = (loading) => {
      [commSubscribe, commUnsubscribe].forEach((btn) => {
        if (btn) {
          btn.disabled = loading;
        }
      });
    };

    const showCommSuccess = (message) => {
      if (commActions) commActions.hidden = true;
      if (commError) {
        commError.hidden = true;
        commError.textContent = '';
      }
      if (commSuccess) {
        commSuccess.textContent = message;
        commSuccess.hidden = false;
      }
    };

    const showCommError = (message) => {
      if (!commError) return;
      commError.textContent = message;
      commError.hidden = false;
    };

    const submitNewsletterPreference = async (emailOptIn) => {
      const trimmed = (email || '').trim();
      if (!trimmed) return;
      const country = window.location.pathname.split('/')[1] || 'us';
      const leadSource = `sub-em-account-${country}`;
      const payload = {
        formId: `${locale}/${language}/newsletter`,
        pageUrl: window.location.href,
        email: trimmed,
        mobile: '',
        smsOptIn: false,
        emailOptIn,
        leadSource,
      };
      setCommLoading(true);
      if (commError) {
        commError.hidden = true;
        commError.textContent = '';
      }
      try {
        const url = getFormSubmissionUrl();
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        let apiMessage = '';
        try {
          const body = await resp.json();
          apiMessage = body?.data?.message != null ? String(body.data.message) : '';
        } catch {
          /* non-JSON */
        }
        if (!resp.ok) {
          showCommError(comm.error || 'Something went wrong. Please try again.');
          return;
        }
        const fallback = emailOptIn
          ? (comm.successSubscribe || 'You are subscribed to Vitamix emails.')
          : (comm.successUnsubscribe || 'You are unsubscribed from Vitamix emails.');
        showCommSuccess(apiMessage.trim() || fallback);
      } catch {
        showCommError(comm.error || 'Something went wrong. Please try again.');
      } finally {
        setCommLoading(false);
      }
    };

    if (commRoot && email) {
      commRoot.hidden = false;
      commSubscribe?.addEventListener('click', () => {
        submitNewsletterPreference(true);
      });
      commUnsubscribe?.addEventListener('click', () => {
        submitNewsletterPreference(false);
      });
    }
  }

  const address = widget.querySelector('.account-panel[data-section="address"]');
  if (address) {
    const p = panels.address || {};
    const t = address.querySelector('.account-panel-title');
    const addBtn = address.querySelector('.account-address-add');
    if (t) t.textContent = p.title || '';
    const ab = /** @type {Record<string, string>} */ (copy.addressBook || {});
    if (addBtn) {
      addBtn.textContent = ab.add || 'Add address';
      addBtn.hidden = !email;
      addBtn.disabled = !email;
    }
    await renderAccountAddressList(widget, [], copy);
  }

  const orders = widget.querySelector('.account-panel[data-section="orders"]');
  if (orders) {
    const p = panels.orders || {};
    const t = orders.querySelector('.account-panel-title');
    const emptyEl = orders.querySelector('.account-orders-empty');
    if (t) t.textContent = p.title || '';
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = String(copy.ordersEmpty || '');
    }
  }

  const mq = window.matchMedia('(min-width: 768px)');
  let activeSection = 'overview';

  const syncMobileNavMode = () => {
    if (mq.matches) {
      widget.classList.remove('account-widget-mobile-nav-select');
      return;
    }
    if (activeSection !== 'overview') {
      widget.classList.add('account-widget-mobile-nav-select');
    } else {
      widget.classList.remove('account-widget-mobile-nav-select');
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

  const {
    fetchAccountBundle,
    applyAccountDataToWidget,
    wireOrderDetailInteractions,
  } = await import('./account-api.js');
  const { wireAccountAddressBook } = await import('./account-address-book.js');

  const copyWithLocale = { ...copy, accountLocale: locale || 'us' };

  if (email) {
    try {
      const data = await fetchAccountBundle(email);
      await applyAccountDataToWidget(widget, data, copyWithLocale);
    } catch (err) {
      // eslint-disable-next-line no-console -- integration: copy API bundle errors
      console.log('VITAMIX_ACCOUNT_API_BUNDLE_EXCEPTION');
      // eslint-disable-next-line no-console
      console.log(err instanceof Error ? err.message : String(err));
    }
    wireAccountAddressBook(widget, email, lang, String(locale || 'us').toLowerCase(), copy);
  }

  wireOrderDetailInteractions(widget, copy);
}
