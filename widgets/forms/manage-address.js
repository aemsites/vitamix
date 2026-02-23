import { fetchPlaceholders } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/** Sheet logger endpoint for manage-address form */
const SHEET_LOGGER_URL = 'https://sheet-logger.david8603.workers.dev/vitamix.com/forms-testing/manage-address';

/** Default Province/region options (Label=value). Overridden by placeholder provinceOptions. */
const DEFAULT_PROVINCE_OPTIONS = [
  'Alberta=AB',
  'British Columbia=BC',
  'Manitoba=MB',
  'New Brunswick=NB',
  'Newfoundland and Labrador=NL',
  'Northwest Territories=NT',
  'Nova Scotia=NS',
  'Nunavut=NU',
  'Ontario=ON',
  'Prince Edward Island=PE',
  'Quebec=QC',
  'Saskatchewan=SK',
  'Yukon=YT',
].join(',');

/**
 * Injects placeholder-driven options into a select (keeps first empty option).
 * @param {HTMLSelectElement} select - The select element
 * @param {string[]} options - Array of "Label" or "Label=value" strings
 */
function setSelectOptions(select, options) {
  if (!select || !options || !options.length) return;
  while (select.options.length > 1) select.remove(1);
  options.forEach((opt) => {
    const [label, value] = opt.includes('=') ? opt.split('=').map((s) => s.trim()) : [opt, opt];
    const option = document.createElement('option');
    option.value = value || label;
    option.textContent = label;
    select.appendChild(option);
  });
}

/**
 * Decorates the manage-address widget: applies placeholders and configures form.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const header = widget.querySelector('.manage-address-header');
  const form = widget.querySelector('.manage-address-form');
  if (!header || !form) return;

  const { locale, language } = getLocaleAndLanguage();
  const p = await fetchPlaceholders(`/${locale}/${language}`);
  const get = (key, fallback = '') => (p[key] != null && p[key] !== '' ? p[key] : fallback);

  // Lookup keys match toCamelCase(Key) from spreadsheet; fallbacks for alternate Key phrasing
  const labels = {
    manageAddress: get('manageAddress', 'Manage address'),
    contactInformation: get('contactInformation')
      || get('contactInfo')
      || get('coordonnEs', 'Contact Information'),
    address: get('address', 'Address'),
    firstName: get('firstName', 'First Name'),
    lastName: get('lastName', 'Last Name'),
    company: get('company', 'Company'),
    phoneNumber: get('phoneNumber', 'Phone Number'),
    phoneNumberHelp: get('phoneNumberHelp')
      || get('pleaseEnterAValidPhoneNumber')
      || get(
        'pleaseEnterAValidPhoneNumberForExample207973782320797378232079737823',
        'Please enter a valid phone number. For example (207)973-7823, (207) 973-7823, 2079737823.',
      ),
    addressLabel: get('address', 'Address'),
    addressLine2: get('addressLine2', 'Address Line 2'),
    city: get('city', 'City'),
    province: get('province', 'Province'),
    postalCode: get('postalCode', 'Postal code'),
    provincePlaceholder: get('pleaseSelectAProvince')
      || get('pleaseSelectRegionStateOrProvince', 'Please select a region, state or province'),
    defaultBilling: get('useAsDefaultBillingAddress', 'Use as default billing address'),
    defaultShipping: get('useAsDefaultShippingAddress', 'Use as default shipping address'),
    saveAddress: get('saveAddress', 'Save address'),
    cancel: get('cancel', 'Cancel'),
    sending: get('sending', 'Sending...'),
  };

  const placeholders = {
    firstName: get('firstNamePlaceholder'),
    lastName: get('lastNamePlaceholder'),
    company: get('companyPlaceholder'),
    phone: get('phoneNumberPlaceholder'),
    address: get('addressPlaceholder'),
    addressLine2: get('addressLine2Placeholder'),
    city: get('cityPlaceholder'),
    postalCode: get('postalCodePlaceholder'),
  };

  header.querySelector('.manage-address-title').textContent = labels.manageAddress;

  form.querySelector('.manage-address-contact .contact-title').textContent = labels.contactInformation;
  form.querySelector('.manage-address-address .address-title').textContent = labels.address;

  form.querySelector('[for="manage-address-first-name"] .label-text').textContent = labels.firstName;
  form.querySelector('[for="manage-address-last-name"] .label-text').textContent = labels.lastName;
  form.querySelector('[for="manage-address-company"] .label-text').textContent = labels.company;
  form.querySelector('[for="manage-address-phone"] .label-text').textContent = labels.phoneNumber;

  const phoneHelp = form.querySelector('#manage-address-phone-help');
  if (phoneHelp) phoneHelp.textContent = labels.phoneNumberHelp;
  form.querySelector('#manage-address-phone')?.setAttribute('aria-describedby', 'manage-address-phone-help');

  form.querySelector('[for="manage-address-address"] .label-text').textContent = labels.addressLabel;
  form.querySelector('[for="manage-address-address-line-2"] .label-text').textContent = labels.addressLine2;
  form.querySelector('[for="manage-address-city"] .label-text').textContent = labels.city;
  form.querySelector('[for="manage-address-province"] .label-text').textContent = labels.province;
  form.querySelector('[for="manage-address-postal-code"] .label-text').textContent = labels.postalCode;

  const provinceSelect = form.querySelector('#manage-address-province');
  if (provinceSelect?.firstElementChild) {
    provinceSelect.firstElementChild.textContent = labels.provincePlaceholder;
  }
  const provinceOptions = get('provinceOptions') || DEFAULT_PROVINCE_OPTIONS;
  setSelectOptions(provinceSelect, provinceOptions.split(',').map((s) => s.trim()));

  const billingCheckbox = form.querySelector('[name="defaultBilling"]')?.closest('.manage-address-checkbox');
  if (billingCheckbox) billingCheckbox.querySelector('.checkbox-text').textContent = labels.defaultBilling;

  const shippingCheckbox = form.querySelector('[name="defaultShipping"]')?.closest('.manage-address-checkbox');
  if (shippingCheckbox) shippingCheckbox.querySelector('.checkbox-text').textContent = labels.defaultShipping;

  const inputs = {
    firstName: form.querySelector('#manage-address-first-name'),
    lastName: form.querySelector('#manage-address-last-name'),
    company: form.querySelector('#manage-address-company'),
    phone: form.querySelector('#manage-address-phone'),
    address: form.querySelector('#manage-address-address'),
    addressLine2: form.querySelector('#manage-address-address-line-2'),
    city: form.querySelector('#manage-address-city'),
    postalCode: form.querySelector('#manage-address-postal-code'),
  };
  Object.entries(placeholders).forEach(([key, value]) => {
    const el = inputs[key];
    if (el && value) el.placeholder = value;
  });

  const submitBtn = form.querySelector('button[type="submit"]');
  const cancelBtn = form.querySelector('.manage-address-cancel');
  if (submitBtn) submitBtn.textContent = labels.saveAddress;
  if (cancelBtn) cancelBtn.textContent = labels.cancel;

  cancelBtn?.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      form.reset();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.pageUrl = window.location.href;

    const submitButton = form.querySelector('button[type="submit"]');
    const buttonLabel = submitButton?.textContent;
    [...form.elements].forEach((el) => { el.disabled = true; });
    if (submitButton) {
      submitButton.dataset.originalLabel = buttonLabel;
      submitButton.textContent = labels.sending;
    }

    try {
      const resp = await fetch(SHEET_LOGGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        throw new Error(`Sheet logger responded with ${resp.status}`);
      }
      const thankYouPath = `/${locale}/${language}/manage-address-thankyou`;
      window.location.href = thankYouPath;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Manage address form submission failed', err);
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitButton) {
        submitButton.textContent = submitButton.dataset.originalLabel || buttonLabel;
      }
    }
  });
}
