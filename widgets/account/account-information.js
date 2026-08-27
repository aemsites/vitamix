import {
  updateCustomer, applyCustomerToWidget, unwrapCustomerResponse, formatIsoForUi,
} from './account-api.js';
import { buildProfileUpdate } from '../../scripts/customer-profile.js';
import { isValidPhone } from '../../blocks/checkout/checkout-validation.js';

/**
 * Normalize a customer GET/PATCH payload to a plain record (or null).
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
function unwrap(raw) {
  let c = unwrapCustomerResponse(raw);
  if (Array.isArray(c) && c.length === 1) [c] = c;
  return c && typeof c === 'object' ? /** @type {Record<string, unknown>} */ (c) : null;
}

/**
 * Wires the "Account Information" panel so the customer can edit their first
 * name, last name, phone, and the site-specific custom attributes (planned use,
 * Vitamix ownership). Saves through the self-service customer PATCH endpoint.
 * Addresses are handled separately by the address book.
 *
 * The panel is always editable: the read-only rows are hidden and a pre-filled
 * form is shown directly, so there is no Edit/Cancel toggle — just Save.
 *
 * Flow:
 *   1. Hide the read-only rows and inject a form pre-filled from the customer.
 *   2. On Save, require a name, PATCH the changed fields, and re-fill the form.
 *
 * @param {HTMLElement} widget
 * @param {string} email
 * @param {Record<string, unknown>} copy
 * @param {unknown} rawCustomer - The customer payload already fetched for the panel
 */
export function wireAccountInformation(widget, email, copy, rawCustomer) {
  const information = widget.querySelector('.account-panel[data-section="information"]');
  if (!information || !email) return;
  const rows = information.querySelector('.account-mock-rows');
  if (!rows) return;

  const ie = /** @type {Record<string, string>} */ (copy.informationEdit || {});
  let current = unwrap(rawCustomer) || {};

  const form = document.createElement('form');
  form.className = 'account-info-form';
  form.innerHTML = `
    <label class="account-info-field">
      <span>${ie.firstName || 'First name'}</span>
      <input type="text" name="firstName" autocomplete="given-name">
    </label>
    <label class="account-info-field">
      <span>${ie.lastName || 'Last name'}</span>
      <input type="text" name="lastName" autocomplete="family-name">
    </label>
    <label class="account-info-field">
      <span>${ie.phone || 'Phone'}</span>
      <input type="tel" name="phone" autocomplete="tel">
      <span class="account-info-field-error" role="alert" hidden></span>
    </label>
    <fieldset class="account-info-fieldset">
      <legend>${ie.plannedUseLabel || 'What do you plan on using this account for?'}</legend>
      <label class="account-info-radio">
        <input type="radio" name="plannedUse" value="home"> ${ie.plannedUseHome || 'For home products'}
      </label>
      <label class="account-info-radio">
        <input type="radio" name="plannedUse" value="business"> ${ie.plannedUseBusiness || 'For business products'}
      </label>
    </fieldset>
    <fieldset class="account-info-fieldset">
      <legend>${ie.ownsVitamixLabel || 'Do you currently own a Vitamix?'}</legend>
      <label class="account-info-radio">
        <input type="radio" name="ownsVitamix" value="yes"> ${ie.yes || 'Yes'}
      </label>
      <label class="account-info-radio">
        <input type="radio" name="ownsVitamix" value="no"> ${ie.no || 'No'}
      </label>
    </fieldset>
    <p class="account-info-error" role="alert" hidden></p>
    <p class="account-info-success" role="status" hidden></p>
    <div class="account-info-actions">
      <button type="submit" class="button emphasis account-info-save">${ie.save || 'Save'}</button>
    </div>
  `;

  // The panel is always editable: hide the read-only rows and show the
  // pre-filled form directly (no Edit/Cancel toggle).
  rows.hidden = true;
  rows.after(form);

  // Read-only account metadata (non-editable) shown just above the Save button.
  const meta = document.createElement('div');
  meta.className = 'account-info-meta';
  const infoActions = form.querySelector('.account-info-actions');
  if (infoActions) infoActions.before(meta);
  else form.append(meta);

  const renderMeta = () => {
    const ci = /** @type {Record<string, string>} */ (copy.customerInfo || {});
    /** @type {Array<[string, unknown]>} */
    const entries = [
      [ci.created || 'Member since', current.createdAt],
      [ci.updated || 'Last updated', current.updatedAt],
    ];
    meta.textContent = '';
    const visible = entries.filter(([, v]) => v != null && String(v).length);
    meta.hidden = visible.length === 0;
    visible.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'account-mock-row';
      const lab = document.createElement('span');
      lab.className = 'account-mock-label';
      lab.textContent = label;
      const val = document.createElement('span');
      val.className = 'account-mock-value';
      val.textContent = formatIsoForUi(value);
      row.append(lab, val);
      meta.append(row);
    });
  };

  const errEl = /** @type {HTMLElement} */ (form.querySelector('.account-info-error'));
  const saveBtn = /** @type {HTMLButtonElement} */ (form.querySelector('.account-info-save'));
  const field = (name) => /** @type {HTMLInputElement} */ (form.querySelector(`[name="${name}"]`));
  const checkedValue = (name) => (
    /** @type {HTMLInputElement | null} */ (form.querySelector(`[name="${name}"]:checked`))?.value
  );

  const clearError = () => {
    errEl.hidden = true;
    errEl.textContent = '';
  };

  const successEl = /** @type {HTMLElement} */ (form.querySelector('.account-info-success'));
  /** @type {ReturnType<typeof setTimeout> | null} */
  let successTimer = null;
  const hideSuccess = () => {
    if (successEl) {
      successEl.hidden = true;
      successEl.textContent = '';
    }
    if (successTimer) {
      clearTimeout(successTimer);
      successTimer = null;
    }
  };
  const showSuccess = (message) => {
    if (!successEl) return;
    clearError();
    successEl.textContent = message;
    successEl.hidden = false;
    if (successTimer) clearTimeout(successTimer);
    successTimer = setTimeout(() => {
      successEl.hidden = true;
      successEl.textContent = '';
      successTimer = null;
    }, 5000);
  };

  // Strict phone validation (shared with checkout): only flag a non-empty,
  // invalid value — the phone field itself is optional.
  const phoneInput = field('phone');
  const phoneErrEl = /** @type {HTMLElement | null} */ (form.querySelector('.account-info-field-error'));
  const clearPhoneError = () => {
    if (phoneErrEl) {
      phoneErrEl.hidden = true;
      phoneErrEl.textContent = '';
    }
    phoneInput.removeAttribute('aria-invalid');
  };
  const showPhoneError = () => {
    if (phoneErrEl) {
      phoneErrEl.textContent = ie.phoneInvalid || 'Please enter a valid 10-digit phone number.';
      phoneErrEl.hidden = false;
    }
    phoneInput.setAttribute('aria-invalid', 'true');
  };
  const validatePhoneField = () => {
    const value = phoneInput.value.trim();
    if (value && !isValidPhone(value)) {
      showPhoneError();
      return false;
    }
    clearPhoneError();
    return true;
  };
  phoneInput.addEventListener('blur', validatePhoneField);
  phoneInput.addEventListener('input', () => {
    if (phoneErrEl && !phoneErrEl.hidden) clearPhoneError();
  });

  const prefill = () => {
    const custom = (current && typeof current.custom === 'object' && current.custom)
      ? /** @type {Record<string, string>} */ (current.custom) : {};
    field('firstName').value = String(current.firstName ?? '');
    field('lastName').value = String(current.lastName ?? '');
    field('phone').value = String(current.phone ?? '');
    form.querySelectorAll('[name="plannedUse"]').forEach((r) => {
      /** @type {HTMLInputElement} */ (r).checked = r.value === custom.plannedUse;
    });
    form.querySelectorAll('[name="ownsVitamix"]').forEach((r) => {
      /** @type {HTMLInputElement} */ (r).checked = r.value === custom.ownsVitamix;
    });
  };

  prefill();
  renderMeta();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    hideSuccess();
    const fields = {
      firstName: field('firstName').value,
      lastName: field('lastName').value,
      phone: field('phone').value,
      plannedUse: checkedValue('plannedUse'),
      ownsVitamix: checkedValue('ownsVitamix'),
    };
    if (!fields.firstName.trim() || !fields.lastName.trim()) {
      errEl.textContent = ie.nameRequired || 'Please enter your first and last name.';
      errEl.hidden = false;
      return;
    }
    if (!validatePhoneField()) {
      phoneInput.focus();
      return;
    }
    saveBtn.disabled = true;
    saveBtn.classList.add('is-loading');
    try {
      const updated = unwrap(await updateCustomer(email, buildProfileUpdate(fields)));
      if (updated) current = updated;
      applyCustomerToWidget(widget, current, email, copy);
      prefill();
      renderMeta();
      showSuccess(ie.saved || 'Profile updated.');
    } catch (err) {
      errEl.textContent = (err instanceof Error && err.message)
        || ie.saveError || 'Could not save. Please try again.';
      errEl.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.classList.remove('is-loading');
    }
  });
}

export default wireAccountInformation;
