import { updateCustomer, applyCustomerToWidget, unwrapCustomerResponse } from './account-api.js';
import { buildProfileUpdate } from '../../scripts/customer-profile.js';

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
 * Vitamix ownership). Saves through the self-service customer PATCH endpoint and
 * re-renders the read-only rows on success. Addresses are handled separately by
 * the address book.
 *
 * Flow:
 *   1. Inject an Edit button and a hidden edit form after the info rows.
 *   2. On Edit, pre-fill the form from the current customer and show it.
 *   3. On Save, require a name, PATCH the changed fields, re-render, and hide.
 *   4. On Cancel, restore the read-only view without saving.
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

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'button account-info-edit';
  editBtn.textContent = ie.edit || 'Edit';

  const form = document.createElement('form');
  form.className = 'account-info-form';
  form.hidden = true;
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
    <div class="account-info-actions">
      <button type="submit" class="button emphasis account-info-save">${ie.save || 'Save'}</button>
      <button type="button" class="button link-style account-info-cancel">${ie.cancel || 'Cancel'}</button>
    </div>
  `;

  rows.after(editBtn, form);

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

  const showForm = (show) => {
    form.hidden = !show;
    editBtn.hidden = show;
    rows.hidden = show;
    clearError();
  };

  editBtn.addEventListener('click', () => {
    prefill();
    showForm(true);
  });
  form.querySelector('.account-info-cancel').addEventListener('click', () => showForm(false));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
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
    saveBtn.disabled = true;
    const prevLabel = saveBtn.textContent;
    saveBtn.textContent = ie.saving || 'Saving\u2026';
    try {
      const updated = unwrap(await updateCustomer(email, buildProfileUpdate(fields)));
      if (updated) current = updated;
      applyCustomerToWidget(widget, current, email, copy);
      showForm(false);
    } catch (err) {
      errEl.textContent = (err instanceof Error && err.message)
        || ie.saveError || 'Could not save. Please try again.';
      errEl.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = prevLabel;
    }
  });

  editBtn.hidden = false;
}

export default wireAccountInformation;
