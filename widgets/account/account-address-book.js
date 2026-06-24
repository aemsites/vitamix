/* eslint-disable import/prefer-default-export -- module is address-book wiring only */
/* eslint-disable no-alert -- minimal user feedback for address errors */
import getStatesProvincesOptions from '../forms/states-provinces.js';
import {
  createCustomerAddress,
  deleteCustomerAddress,
  getCustomerAddressById,
  getCustomerAddresses,
  renderAccountAddressList,
  unwrapAddressDetail,
  unwrapPayload,
  updateCustomerAddress,
} from './account-api.js';

/**
 * @param {HTMLSelectElement} select
 * @param {{ value: string, label: string }[]} options
 * @param {string} emptyLabel
 */
function fillRegionSelect(select, options, emptyLabel) {
  if (!select) return;
  select.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = emptyLabel;
  select.append(opt0);
  options.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    select.append(opt);
  });
}

/**
 * @param {string} name "John Q Public"
 * @returns {{ first: string, last: string }}
 */
function splitFullName(name) {
  const s = String(name || '').trim();
  if (!s) return { first: '', last: '' };
  const i = s.indexOf(' ');
  if (i === -1) return { first: s, last: '' };
  return { first: s.slice(0, i).trim(), last: s.slice(i + 1).trim() };
}

/**
 * @param {HTMLFormElement} form
 * @param {string} accountEmail
 * @returns {Record<string, unknown>}
 */
function readAddressForm(form, accountEmail) {
  const fd = new FormData(form);
  const first = String(fd.get('firstName') || '').trim();
  const last = String(fd.get('lastName') || '').trim();
  const phone = String(fd.get('phone') || '').replace(/\D/g, '');
  const country = String(fd.get('country') || 'us').toLowerCase();
  const body = {
    name: `${first} ${last}`.trim() || (accountEmail || '').split('@')[0] || '—',
    address1: String(fd.get('address1') || '').trim(),
    address2: String(fd.get('address2') || '').trim(),
    city: String(fd.get('city') || '').trim(),
    state: String(fd.get('state') || '').trim(),
    zip: String(fd.get('zip') || '').trim(),
    country,
    phone,
    email: String(fd.get('email') || '').trim() || accountEmail,
    isDefault: fd.get('isDefault') === 'on',
  };
  return body;
}

/**
 * @param {HTMLFormElement} form
 * @param {Record<string, unknown>} addr
 * @param {string} accountEmail
 */
function fillAddressForm(form, addr, accountEmail) {
  const { first, last } = splitFullName(typeof addr.name === 'string' ? addr.name : '');
  /** @type {HTMLInputElement | null} */
  (form.querySelector('[name="firstName"]')).value = first;
  /** @type {HTMLInputElement | null} */
  (form.querySelector('[name="lastName"]')).value = last;
  /** @type {HTMLInputElement | null} */
  (form.querySelector('[name="address1"]')).value = String(addr.address1 ?? '');
  /** @type {HTMLInputElement | null} */
  (form.querySelector('[name="address2"]')).value = String(addr.address2 ?? '');
  /** @type {HTMLInputElement | null} */
  (form.querySelector('[name="city"]')).value = String(addr.city ?? '');
  /** @type {HTMLInputElement | null} */
  (form.querySelector('[name="zip"]')).value = String(addr.zip ?? '');
  /** @type {HTMLInputElement | null} */
  (form.querySelector('[name="phone"]')).value = String(addr.phone ?? '');
  /** @type {HTMLInputElement | null} */
  (form.querySelector('[name="email"]')).value = String(addr.email ?? accountEmail ?? '');
  /** @type {HTMLInputElement | null} */
  const defCb = form.querySelector('input[name="isDefault"]');
  if (defCb) defCb.checked = addr.isDefault === true;
  const countrySel = form.querySelector('[name="country"]');
  if (countrySel) {
    const c = String(addr.country || 'us').toLowerCase();
    countrySel.value = ['us', 'ca', 'mx'].includes(c) ? c : 'us';
  }
}

/**
 * @param {HTMLElement} widget
 * @param {string} customerEmail
 * @param {string} lang - `en` | `fr` | `es`
 * @param {string} marketLocale - path locale `us` | `ca` | `mx`
 * @param {Record<string, unknown>} copy
 */
export function wireAccountAddressBook(widget, customerEmail, lang, marketLocale, copy) {
  if (widget.dataset.addressBookWired === '1') return;
  widget.dataset.addressBookWired = '1';

  const ab = /** @type {Record<string, string>} */ (copy.addressBook || {});
  const dialog = widget.querySelector('.account-address-dialog');
  const form = widget.querySelector('.account-address-form');
  const addBtn = widget.querySelector('.account-address-add');
  const titleEl = widget.querySelector('.account-address-dialog-title');
  const errEl = widget.querySelector('.account-address-form-error');
  const saveBtn = widget.querySelector('.account-address-save');
  const cancelBtn = widget.querySelector('.account-address-cancel');
  const countrySelect = form?.querySelector('[name="country"]');
  const stateSelect = form?.querySelector('[name="state"]');
  const zipLabel = form?.querySelector('[for="account-addr-zip"] .label-text');
  const stateLabel = form?.querySelector('[for="account-addr-state"] .label-text');

  if (!dialog || !form) return;

  const setFormCopy = () => {
    const countries = /** @type {Record<string, string>} */ (copy.countries || {});
    const setLab = (forId, text) => {
      const lab = form.querySelector(`[for="${forId}"] .label-text`);
      if (lab) lab.textContent = text;
    };
    setLab('account-addr-first', ab.firstName || 'First name');
    setLab('account-addr-last', ab.lastName || 'Last name');
    setLab('account-addr-email', ab.email || 'Email');
    setLab('account-addr-line1', ab.address1 || 'Street address');
    setLab('account-addr-line2', ab.address2 || 'Address line 2');
    setLab('account-addr-city', ab.city || 'City');
    setLab('account-addr-country', ab.country || 'Country');
    setLab('account-addr-phone', ab.phone || 'Phone');
    setLab('account-addr-zip', ab.zipUs || 'ZIP code');
    setLab('account-addr-state', ab.stateUs || 'State');
    const defSpan = form.querySelector('.account-addr-default-label');
    if (defSpan) defSpan.textContent = ab.defaultAddress || 'Default address';
    if (saveBtn) saveBtn.textContent = ab.save || 'Save';
    if (cancelBtn) cancelBtn.textContent = ab.cancel || 'Cancel';
    if (addBtn) addBtn.textContent = ab.add || 'Add address';
    ['us', 'ca', 'mx'].forEach((code) => {
      const opt = countrySelect?.querySelector(`option[value="${code}"]`);
      if (opt) opt.textContent = countries[code] || code.toUpperCase();
    });
  };
  setFormCopy();

  if (!customerEmail) return;

  /** @type {string | null} */
  let editingId = null;

  const defaultCountry = () => {
    const m = String(marketLocale || 'us').toLowerCase();
    return ['us', 'ca', 'mx'].includes(m) ? m : 'us';
  };

  const setZipStateLabels = (country) => {
    const c = country.toLowerCase();
    if (zipLabel) {
      if (c === 'us') zipLabel.textContent = ab.zipUs || 'ZIP code';
      else zipLabel.textContent = ab.postalOther || 'Postal code';
    }
    if (stateLabel) {
      if (c === 'us') stateLabel.textContent = ab.stateUs || 'State';
      else if (c === 'ca') stateLabel.textContent = ab.stateCa || 'Province';
      else stateLabel.textContent = ab.stateMx || 'State';
    }
  };

  const loadRegions = async () => {
    if (!stateSelect || !countrySelect) return;
    const country = String(countrySelect.value || 'us').toUpperCase();
    setZipStateLabels(country.toLowerCase());
    const opts = await getStatesProvincesOptions(country, lang).catch(() => []);
    fillRegionSelect(stateSelect, opts, ab.regionPlaceholder || 'Select…');
  };

  const closeDialog = () => {
    dialog.close();
    editingId = null;
  };

  const showAddDialog = () => {
    editingId = null;
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = '';
    }
    form.reset();
    if (countrySelect) countrySelect.value = defaultCountry();
    const em = /** @type {HTMLInputElement | null} */ (form.querySelector('[name="email"]'));
    if (em) em.value = customerEmail;
    if (titleEl) titleEl.textContent = ab.dialogAddTitle || 'New address';
    loadRegions().then(() => dialog.showModal());
  };

  const showEditDialog = (raw) => {
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = '';
    }
    fillAddressForm(form, raw, customerEmail);
    const pendingState = String(raw.state ?? '');
    if (titleEl) titleEl.textContent = ab.dialogEditTitle || 'Edit address';
    loadRegions().then(() => {
      if (stateSelect && pendingState) {
        stateSelect.value = pendingState;
      }
      dialog.showModal();
    });
  };

  addBtn?.addEventListener('click', () => {
    showAddDialog();
  });

  cancelBtn?.addEventListener('click', () => closeDialog());

  const reloadList = async () => {
    const payload = await getCustomerAddresses(customerEmail);
    const list = unwrapPayload(payload);
    await renderAccountAddressList(widget, list ?? payload, copy);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = '';
    }
    const body = readAddressForm(form, customerEmail);
    if (!body.address1 || !body.city || !body.state || !body.zip) {
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = ab.validationRequired || 'Please fill all required fields.';
      }
      return;
    }
    if (saveBtn) saveBtn.disabled = true;
    try {
      if (editingId) {
        await updateCustomerAddress(customerEmail, editingId, body);
      } else {
        await createCustomerAddress(customerEmail, body);
      }
      closeDialog();
      await reloadList();
    } catch (err) {
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = ab.saveError || (err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  widget.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.account-address-edit');
    const delBtn = e.target.closest('.account-address-delete');
    const li = editBtn?.closest('.account-address-item') || delBtn?.closest('.account-address-item');
    const id = li?.dataset.addressId;
    if (!id || !customerEmail) return;

    if (editBtn) {
      editingId = id;
      const liRaw = /** @type {unknown} */ (li).accountAddressRaw;
      let raw = /** @type {Record<string, unknown> | undefined} */ (liRaw);
      const street = raw && typeof raw.address1 === 'string' ? raw.address1.trim() : '';
      const minimal = !raw || !street;
      if (minimal) {
        try {
          const fetched = await getCustomerAddressById(customerEmail, id);
          raw = /** @type {Record<string, unknown> | undefined} */ (unwrapAddressDetail(fetched));
        } catch {
          raw = undefined;
        }
      }
      if (!raw || typeof raw !== 'object') {
        window.alert(ab.loadDetailError || 'Could not load address.');
        return;
      }
      showEditDialog(raw);
    }

    if (delBtn) {
      const ok = window.confirm(ab.deleteConfirm || 'Remove this address?');
      if (!ok) return;
      try {
        await deleteCustomerAddress(customerEmail, id);
        await reloadList();
      } catch (err) {
        window.alert(ab.deleteError || (err instanceof Error ? err.message : String(err)));
      }
    }
  });
}
