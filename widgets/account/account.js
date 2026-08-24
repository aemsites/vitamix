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
import { getLeadSource } from '../../scripts/lead-source.js';
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
    const commBtnShimmer = information.querySelector('.account-communications-btn-shimmer');
    const commError = information.querySelector('.account-communications-error');
    const commSuccess = information.querySelector('.account-communications-success');
    const commSave = /** @type {HTMLButtonElement | null} */ (
      information.querySelector('.account-communications-save')
    );
    const commEmailOptShimmer = information.querySelector('.account-communications-email-opt-shimmer');
    const commEmailCheckbox = /** @type {HTMLInputElement | null} */ (
      information.querySelector('.account-communications-email-checkbox')
    );
    const commEmailOptCopy = information.querySelector('.account-communications-email-opt-copy');
    const commSmsPhoneLabel = information.querySelector('.account-communications-sms-phone-label');
    const commSmsPhoneInput = /** @type {HTMLInputElement | null} */ (
      information.querySelector('.account-communications-sms-phone-input')
    );
    const commSmsOptShimmer = information.querySelector('.account-communications-sms-opt-shimmer');
    const commSmsCheckbox = /** @type {HTMLInputElement | null} */ (
      information.querySelector('.account-communications-sms-checkbox')
    );
    const commSmsOptCopy = information.querySelector('.account-communications-sms-opt-copy');
    const commSmsMasterShimmer = information.querySelector('.account-communications-sms-master-shimmer');
    const commSmsMasterCheckbox = /** @type {HTMLInputElement | null} */ (
      information.querySelector('.account-communications-sms-master-checkbox')
    );
    const commSmsMasterCopy = information.querySelector('.account-communications-sms-master-copy');
    const commSmsLegalPrefix = information.querySelector('.account-communications-sms-legal-prefix');
    const commSmsPrivacyLink = /** @type {HTMLAnchorElement | null} */ (
      information.querySelector('.account-communications-sms-privacy-link')
    );
    const commSmsLegalAnd = information.querySelector('.account-communications-sms-legal-and');
    const commSmsTermsLink = /** @type {HTMLAnchorElement | null} */ (
      information.querySelector('.account-communications-sms-terms-link')
    );
    if (commTitle) commTitle.textContent = comm.title || 'Communications';
    if (commSave) commSave.textContent = comm.updatePreferences || 'Update preferences';
    if (commEmailOptCopy) {
      commEmailOptCopy.textContent = comm.emailOptInLabel
        || 'Send me periodic emails and newsletters from Vitamix';
    }
    if (commSmsPhoneLabel) commSmsPhoneLabel.textContent = comm.smsPhone || 'Mobile number';
    if (commSmsMasterCopy) {
      commSmsMasterCopy.textContent = comm.smsMasterLabel || 'Send me text messages from Vitamix';
    }
    if (commSmsOptCopy) {
      commSmsOptCopy.textContent = comm.smsConsent
        || 'By checking this box, I am opting in to receive promotional SMS messages from Vitamix.';
    }
    if (commSmsLegalPrefix) commSmsLegalPrefix.textContent = comm.smsLegalPrefix || 'Click to view our ';
    if (commSmsPrivacyLink) {
      commSmsPrivacyLink.textContent = comm.smsPrivacyLinkText || 'privacy policy';
      commSmsPrivacyLink.href = `/${locale}/${language}/privacy-statement`;
    }
    if (commSmsLegalAnd) commSmsLegalAnd.textContent = comm.smsLegalAnd || ' and ';
    if (commSmsTermsLink) {
      commSmsTermsLink.textContent = comm.smsTermsLinkText || 'terms';
      commSmsTermsLink.href = `/${locale}/${language}/legal-notice`;
    }

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

    const setCommBusy = (busy, { shimmer = true } = {}) => {
      // Initial load swaps in shimmer placeholders; saving just disables the
      // controls in place so nothing disappears mid-submit.
      if (shimmer) {
        commBtnShimmer?.classList.toggle(COMM_VISIBLE, busy);
        commEmailOptShimmer?.classList.toggle(COMM_VISIBLE, busy);
        commEmailCheckbox?.closest('.account-communications-email-opt-label')
          ?.classList.toggle(COMM_VISIBLE, !busy);
        commSmsMasterShimmer?.classList.toggle(COMM_VISIBLE, busy);
        commSmsMasterCheckbox?.closest('.account-communications-sms-master-label')
          ?.classList.toggle(COMM_VISIBLE, !busy);
        commSmsOptShimmer?.classList.toggle(COMM_VISIBLE, busy);
        commSmsCheckbox?.closest('.account-communications-sms-opt-label')
          ?.classList.toggle(COMM_VISIBLE, !busy);
        commSave?.classList.toggle(COMM_VISIBLE, !busy);
      }
      if (commEmailCheckbox) commEmailCheckbox.disabled = busy;
      if (commSmsMasterCheckbox) commSmsMasterCheckbox.disabled = busy;
      if (commSmsCheckbox) commSmsCheckbox.disabled = busy;
      if (commSmsPhoneInput) commSmsPhoneInput.disabled = busy;
      if (commSave) {
        commSave.disabled = busy;
        commSave.classList.toggle('is-loading', busy);
      }
    };

    let commSuccessTimer = null;
    const hideCommSuccess = () => {
      if (commSuccess) {
        commSuccess.hidden = true;
        commSuccess.textContent = '';
      }
      if (commSuccessTimer) {
        clearTimeout(commSuccessTimer);
        commSuccessTimer = null;
      }
    };

    const hideCommError = () => {
      if (commError) {
        commError.hidden = true;
        commError.textContent = '';
      }
      hideCommSuccess();
    };

    const showCommError = (message) => {
      if (!commError) return;
      commError.textContent = message;
      commError.hidden = false;
    };

    const showCommSuccess = (message) => {
      if (!commSuccess) return;
      commSuccess.textContent = message;
      commSuccess.hidden = false;
      if (commSuccessTimer) clearTimeout(commSuccessTimer);
      commSuccessTimer = setTimeout(() => {
        commSuccess.hidden = true;
        commSuccess.textContent = '';
        commSuccessTimer = null;
      }, 5000);
    };

    const applyCommOptInUi = () => {
      if (commEmailCheckbox) commEmailCheckbox.checked = emailOptInStatus === true;
    };

    const SMS_REQUIRED_DIGITS = 10;
    const smsDigits = () => (commSmsPhoneInput?.value || '').replace(/\D/g, '');
    const hasValidMobile = () => smsDigits().length === SMS_REQUIRED_DIGITS;

    /**
     * The master toggle gates the SMS fields: when it is off, the mobile input
     * and the consent checkbox are disabled (and visually dimmed).
     */
    const applySmsEnabledState = () => {
      const on = commSmsMasterCheckbox?.checked === true;
      if (commSmsPhoneInput) commSmsPhoneInput.disabled = !on;
      if (commSmsCheckbox) commSmsCheckbox.disabled = !on;
      commSmsPhoneInput?.closest('.account-communications-sms-phone-field')
        ?.classList.toggle('is-disabled', !on);
      commSmsCheckbox?.closest('.account-communications-sms-opt-label')
        ?.classList.toggle('is-disabled', !on);
    };

    const applySmsCommUi = () => {
      if (commSmsMasterCheckbox) commSmsMasterCheckbox.checked = smsOptInStatus === true;
      if (commSmsCheckbox) commSmsCheckbox.checked = smsOptInStatus === true;
      if (commSmsPhoneInput && document.activeElement !== commSmsPhoneInput) {
        commSmsPhoneInput.value = profileMobile.trim();
      }
      applySmsEnabledState();
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
      const leadSource = getLeadSource('acc', country, { emailOptIn: nextEmail, smsOptIn: nextSms });
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
      // Disable in place (no shimmer swap) while saving.
      setCommBusy(true, { shimmer: false });
      try {
        const url = getFormSubmissionUrl();
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          showCommError(comm.error || 'Something went wrong. Please try again.');
          setCommBusy(false, { shimmer: false });
          applyCommOptInUi();
          applySmsCommUi();
          return;
        }
        emailOptInStatus = nextEmail;
        smsOptInStatus = nextSms;
        setCommBusy(false, { shimmer: false });
        applyCommOptInUi();
        applySmsCommUi();
        showCommSuccess(comm.saved || 'Your preferences have been updated.');
      } catch {
        showCommError(comm.error || 'Something went wrong. Please try again.');
        setCommBusy(false, { shimmer: false });
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

    // One button saves both email and SMS preferences. SMS opt-in still
    // requires a valid mobile number; an email-only change is never blocked.
    const updatePreferences = () => {
      hideCommError();
      const emailOptIn = commEmailCheckbox?.checked === true;
      // Master toggle off => opt out of SMS. On => require a valid number AND
      // an explicit consent checkbox tick before we can opt in.
      const smsMaster = commSmsMasterCheckbox?.checked === true;
      let smsOptIn = false;
      if (smsMaster) {
        if (!hasValidMobile()) {
          showCommError(comm.smsPhoneInvalid || 'Enter a valid 10 digit mobile number');
          return;
        }
        if (commSmsCheckbox?.checked !== true) {
          showCommError(comm.smsConsentRequired
            || 'Please check the box to confirm you agree to receive text messages.');
          return;
        }
        smsOptIn = true;
        profileMobile = smsDigits();
      }
      submitCommunicationsPreference({ emailOptIn, smsOptIn });
    };

    if (commRoot && email) {
      commRoot.hidden = false;
      commEmailCheckbox?.addEventListener('change', hideCommError);
      commSmsMasterCheckbox?.addEventListener('change', () => {
        hideCommError();
        // Turning the master toggle off clears the consent tick so re-enabling
        // always requires a fresh, explicit opt-in.
        if (commSmsMasterCheckbox.checked !== true && commSmsCheckbox) {
          commSmsCheckbox.checked = false;
        }
        applySmsEnabledState();
      });
      commSmsCheckbox?.addEventListener('change', hideCommError);
      commSmsPhoneInput?.addEventListener('input', () => {
        commSmsPhoneInput.value = commSmsPhoneInput.value.replace(/[^0-9()\-\s]/g, '');
        hideCommError();
      });
      commSave?.addEventListener('click', updatePreferences);
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
  const { wireAccountInformation } = await import('./account-information.js');

  const copyWithLocale = { ...copy, accountLocale: locale || 'us' };

  if (email) {
    let bundle;
    try {
      bundle = await fetchAccountBundle(email);
      await applyAccountDataToWidget(widget, bundle, copyWithLocale);
    } catch {
      /* best-effort: overview/orders still render empty state */
    }
    wireAccountAddressBook(widget, email, lang, String(locale || 'us').toLowerCase(), copy);
    wireAccountInformation(widget, email, copyWithLocale, bundle?.customer);
  }

  wireOrderDetailInteractions(widget, copy);
}
