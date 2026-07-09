import { loadCSS } from '../../scripts/aem.js';
import {
  fetchFormsProfile,
  getCustomerAddresses,
  getCustomerOrders,
  renderAccountAddressList,
  renderAccountOrderList,
  unwrapPayload,
} from './account-api.js';
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
    const commQuestionCopy = information.querySelector('.account-communications-question-copy');
    const commQuestionShimmer = information.querySelector('.account-communications-question-shimmer');
    const commBtnShimmer = information.querySelector('.account-communications-btn-shimmer');
    const commSubscribe = information.querySelector('.account-communications-subscribe');
    const commUnsubscribe = information.querySelector('.account-communications-unsubscribe');
    const commError = information.querySelector('.account-communications-error');
    const commSmsRoot = information.querySelector('.account-communications-sms');
    const commSmsPhoneLabel = information.querySelector('.account-communications-sms-phone-label');
    const commSmsPhoneValue = information.querySelector('.account-communications-sms-phone-value');
    const commSmsStatusLabel = information.querySelector('.account-communications-sms-status-label');
    const commSmsStatusValue = information.querySelector('.account-communications-sms-status-value');
    const commSmsOptShimmer = information.querySelector('.account-communications-sms-opt-shimmer');
    const commSmsCheckbox = /** @type {HTMLInputElement | null} */ (
      information.querySelector('.account-communications-sms-checkbox')
    );
    const commSmsOptCopy = information.querySelector('.account-communications-sms-opt-copy');
    if (commTitle) commTitle.textContent = comm.title || 'Communications';
    if (commSubscribe) commSubscribe.textContent = comm.subscribe || 'Subscribe';
    if (commUnsubscribe) commUnsubscribe.textContent = comm.unsubscribe || 'Unsubscribe';
    if (commSmsPhoneLabel) commSmsPhoneLabel.textContent = comm.smsPhone || 'Mobile number';
    if (commSmsStatusLabel) commSmsStatusLabel.textContent = comm.smsStatus || 'Text messages';
    if (commSmsOptCopy) commSmsOptCopy.textContent = comm.smsOptInLabel || 'Receive text notifications';

    /** @type {boolean} */
    let emailOptInStatus = false;
    /** @type {boolean} */
    let smsOptInStatus = false;
    /** @type {string} */
    let profileMobile = '';

    /**
     * Buttons use a class for visibility — site `button.button { display: inline-block }`
     * overrides `[hidden]`.
     */
    const COMM_VISIBLE = 'is-visible';

    const applyCommCopy = () => {
      if (!commQuestionCopy) return;
      const subscribed = emailOptInStatus === true;
      commQuestionCopy.textContent = subscribed
        ? (comm.questionSubscribed
          || 'You are currently subscribed to periodic emails and newsletters from Vitamix.')
        : (comm.question
          || 'Would you like us to send you periodic emails and newsletters from Vitamix?');
    };

    const setCommBusy = (busy) => {
      commQuestionShimmer?.classList.toggle(COMM_VISIBLE, busy);
      commBtnShimmer?.classList.toggle(COMM_VISIBLE, busy);
      commQuestionCopy?.classList.toggle(COMM_VISIBLE, !busy);
      commSmsOptShimmer?.classList.toggle(COMM_VISIBLE, busy);
      commSmsCheckbox?.closest('.account-communications-sms-opt-label')
        ?.classList.toggle(COMM_VISIBLE, !busy);
      if (busy) {
        commSubscribe?.classList.remove(COMM_VISIBLE);
        commUnsubscribe?.classList.remove(COMM_VISIBLE);
      }
      if (commSmsCheckbox) commSmsCheckbox.disabled = busy;
    };

    const hideCommError = () => {
      if (commError) {
        commError.hidden = true;
        commError.textContent = '';
      }
    };

    const showCommError = (message) => {
      if (!commError) return;
      commError.textContent = message;
      commError.hidden = false;
    };

    const applyCommOptInUi = () => {
      applyCommCopy();
      const subscribed = emailOptInStatus === true;
      commSubscribe?.classList.toggle(COMM_VISIBLE, !subscribed);
      commUnsubscribe?.classList.toggle(COMM_VISIBLE, subscribed);
      if (commSubscribe) commSubscribe.disabled = false;
      if (commUnsubscribe) commUnsubscribe.disabled = false;
    };

    const applySmsCommUi = () => {
      const mobile = profileMobile.trim();
      const showSms = Boolean(mobile) || smsOptInStatus === true;
      if (commSmsRoot) commSmsRoot.hidden = !showSms;
      if (commSmsPhoneValue) commSmsPhoneValue.textContent = mobile || '—';
      if (commSmsStatusValue) {
        commSmsStatusValue.textContent = smsOptInStatus === true
          ? (comm.smsStatusOptedIn || 'Subscribed')
          : (comm.smsStatusOptedOut || 'Not subscribed');
      }
      if (commSmsCheckbox) {
        commSmsCheckbox.checked = smsOptInStatus === true;
        commSmsCheckbox.disabled = !mobile;
      }
    };

    /**
     * @param {{ emailOptIn?: boolean, smsOptIn?: boolean }} [next]
     */
    const submitCommunicationsPreference = async (next = {}) => {
      const trimmed = (email || '').trim();
      if (!trimmed) return;
      const nextEmail = next.emailOptIn !== undefined ? next.emailOptIn : emailOptInStatus;
      const nextSms = next.smsOptIn !== undefined ? next.smsOptIn : smsOptInStatus;
      const country = window.location.pathname.split('/')[1] || 'us';
      const leadSource = `sub-em-account-${country}`;
      const payload = {
        formId: `${locale}/${language}/newsletter`,
        pageUrl: window.location.href,
        email: trimmed,
        mobile: profileMobile.trim(),
        smsOptIn: nextSms,
        emailOptIn: nextEmail,
        leadSource,
      };
      hideCommError();
      setCommBusy(true);
      try {
        const url = getFormSubmissionUrl();
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          showCommError(comm.error || 'Something went wrong. Please try again.');
          setCommBusy(false);
          applyCommOptInUi();
          applySmsCommUi();
          return;
        }
        emailOptInStatus = nextEmail;
        smsOptInStatus = nextSms;
        setCommBusy(false);
        applyCommOptInUi();
        applySmsCommUi();
      } catch {
        showCommError(comm.error || 'Something went wrong. Please try again.');
        setCommBusy(false);
        applyCommOptInUi();
        applySmsCommUi();
      }
    };

    const loadCommunicationsProfile = async () => {
      setCommBusy(true);
      try {
        const { profile } = await fetchFormsProfile();
        if (profile && typeof profile.emailOptInStatus === 'boolean') {
          emailOptInStatus = profile.emailOptInStatus;
        }
        if (profile && typeof profile.smsOptInStatus === 'boolean') {
          smsOptInStatus = profile.smsOptInStatus;
        }
        if (profile && profile.mobile != null) {
          profileMobile = String(profile.mobile).trim();
        }
      } catch {
        /* keep defaults */
      } finally {
        setCommBusy(false);
        applyCommOptInUi();
        applySmsCommUi();
      }
    };

    if (commRoot && email) {
      commRoot.hidden = false;
      commSubscribe?.addEventListener('click', () => {
        submitCommunicationsPreference({ emailOptIn: true });
      });
      commUnsubscribe?.addEventListener('click', () => {
        submitCommunicationsPreference({ emailOptIn: false });
      });
      commSmsCheckbox?.addEventListener('change', () => {
        if (!profileMobile.trim()) {
          applySmsCommUi();
          return;
        }
        submitCommunicationsPreference({ smsOptIn: commSmsCheckbox.checked });
      });
      loadCommunicationsProfile();
    }
  }

  const address = widget.querySelector('.account-panel[data-section="address"]');
  const addressLoadingEl = widget.querySelector('.account-address-loading');
  const addressEmptyEl = widget.querySelector('.account-address-empty');
  const addressListEl = widget.querySelector('.account-address-list');
  let addressListLoaded = false;
  let addressListPromise = null;
  const setAddressLoading = (loading) => {
    if (addressLoadingEl) addressLoadingEl.hidden = !loading;
    if (addressListEl) addressListEl.hidden = loading;
    if (addressEmptyEl && loading) addressEmptyEl.hidden = true;
  };
  const loadAccountAddresses = async () => {
    if (!email || addressListLoaded) return;
    if (addressListPromise) {
      await addressListPromise;
      return;
    }
    setAddressLoading(true);
    addressListPromise = (async () => {
      try {
        const payload = await getCustomerAddresses(email);
        await renderAccountAddressList(widget, unwrapPayload(payload) ?? payload, copy);
        addressListLoaded = true;
      } catch {
        if (addressEmptyEl) {
          const ab = /** @type {Record<string, string>} */ (copy.addressBook || {});
          addressEmptyEl.hidden = false;
          addressEmptyEl.textContent = ab.loadListError || 'Could not load addresses. Please try again.';
        }
      } finally {
        setAddressLoading(false);
        addressListPromise = null;
      }
    })();
    await addressListPromise;
  };
  if (address) {
    const p = panels.address || {};
    const t = address.querySelector('.account-panel-title');
    const addBtn = address.querySelector('.account-address-add');
    if (t) t.textContent = p.title || '';
    const ab = /** @type {Record<string, string>} */ (copy.addressBook || {});
    if (addressLoadingEl) addressLoadingEl.textContent = ab.loading || 'Loading addresses…';
    if (addBtn) {
      addBtn.textContent = ab.add || 'Add address';
      addBtn.hidden = !email;
      addBtn.disabled = !email;
    }
  }

  const orders = widget.querySelector('.account-panel[data-section="orders"]');
  const ordersLoadingEl = widget.querySelector('.account-orders-loading');
  const ordersEmptyEl = widget.querySelector('.account-orders-empty');
  const ordersListEl = widget.querySelector('.account-order-mock-list');
  let ordersLoaded = false;
  let ordersPromise = null;
  const setOrdersLoading = (loading) => {
    if (ordersLoadingEl) ordersLoadingEl.hidden = !loading;
    if (ordersListEl) ordersListEl.hidden = loading;
    if (ordersEmptyEl && loading) ordersEmptyEl.hidden = true;
  };
  const loadAccountOrders = async () => {
    if (!email || ordersLoaded) return;
    if (ordersPromise) {
      await ordersPromise;
      return;
    }
    setOrdersLoading(true);
    ordersPromise = (async () => {
      try {
        const payload = await getCustomerOrders(email);
        await renderAccountOrderList(widget, unwrapPayload(payload) ?? payload, copy);
        ordersLoaded = true;
      } catch {
        if (ordersEmptyEl) {
          ordersEmptyEl.hidden = false;
          ordersEmptyEl.textContent = String(copy.ordersLoadError || copy.ordersEmpty || 'Could not load orders. Please try again.');
        }
      } finally {
        setOrdersLoading(false);
        ordersPromise = null;
      }
    })();
    await ordersPromise;
  };
  if (orders) {
    const p = panels.orders || {};
    const t = orders.querySelector('.account-panel-title');
    if (t) t.textContent = p.title || '';
    if (ordersLoadingEl) ordersLoadingEl.textContent = String(copy.ordersLoading || 'Loading orders…');
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
    if (section === 'address') {
      loadAccountAddresses();
    }
    if (section === 'orders') {
      loadAccountOrders();
    }
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
    } catch {
      /* best-effort: overview/orders still render empty state */
    }
    wireAccountAddressBook(widget, email, lang, String(locale || 'us').toLowerCase(), copy);
  }

  wireOrderDetailInteractions(widget, copy);
}
