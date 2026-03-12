import { getLocaleAndLanguage } from '../../scripts/scripts.js';
import getStatesProvincesOptions from './states-provinces.js';

/** Sheet logger endpoint for manage-address form */
const SHEET_LOGGER_URL = 'https://sheet-logger.david8603.workers.dev/vitamix.com/forms-testing/manage-address';

/**
 * Loads form copy from the widget's local JSON (same name as the script).
 * @param {string} lang - Language key (en, fr, es)
 * @returns {Promise<Object>} Form copy for that language
 */
async function loadFormCopy(lang) {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const url = `${window.hlx?.codeBasePath || ''}${jsonPath}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const key = data[lang] ? lang : 'en';
  return data[key];
}

/**
 * Injects options into a select (keeps first empty option).
 * @param {HTMLSelectElement} select - The select element
 * @param {{ label: string, value: string }[]} options - Options array
 */
function setSelectOptions(select, options) {
  if (!select || !options?.length) return;
  while (select.options.length > 1) select.remove(1);
  options.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  });
}

/**
 * Decorates the manage-address widget: applies copy from JSON and configures form.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const header = widget.querySelector('.manage-address-header');
  const form = widget.querySelector('.manage-address-form');
  if (!header || !form) return;

  const { locale, language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadFormCopy(lang);
  const provinceOptions = await getStatesProvincesOptions('CA', lang).catch(() => []);
  const labels = copy.labels || {};
  const inputHints = copy.inputPlaceholders || {};

  header.querySelector('.manage-address-title').textContent = labels.manageAddress ?? 'Manage address';

  form.querySelector('.manage-address-contact .contact-title').textContent = labels.contactInformation ?? 'Contact Information';
  form.querySelector('.manage-address-address .address-title').textContent = labels.address ?? 'Address';

  form.querySelector('[for="manage-address-first-name"] .label-text').textContent = labels.firstName ?? 'First Name';
  form.querySelector('[for="manage-address-last-name"] .label-text').textContent = labels.lastName ?? 'Last Name';
  form.querySelector('[for="manage-address-company"] .label-text').textContent = labels.company ?? 'Company';
  form.querySelector('[for="manage-address-phone"] .label-text').textContent = labels.phoneNumber ?? 'Phone Number';

  const phoneHelp = form.querySelector('#manage-address-phone-help');
  if (phoneHelp) phoneHelp.textContent = labels.phoneNumberHelp ?? 'Please enter a valid phone number. For example (207)973-7823, (207) 973-7823, 2079737823.';
  form.querySelector('#manage-address-phone')?.setAttribute('aria-describedby', 'manage-address-phone-help');

  form.querySelector('[for="manage-address-address"] .label-text').textContent = labels.address ?? 'Address';
  form.querySelector('[for="manage-address-address-line-2"] .label-text').textContent = labels.addressLine2 ?? 'Address Line 2';
  form.querySelector('[for="manage-address-city"] .label-text').textContent = labels.city ?? 'City';
  form.querySelector('[for="manage-address-province"] .label-text').textContent = labels.province ?? 'Province';
  form.querySelector('[for="manage-address-postal-code"] .label-text').textContent = labels.postalCode ?? 'Postal code';

  const provinceSelect = form.querySelector('#manage-address-province');
  if (provinceSelect?.firstElementChild) {
    provinceSelect.firstElementChild.textContent = labels.provincePlaceholder ?? 'Please select a region, state or province';
  }
  setSelectOptions(provinceSelect, provinceOptions);

  const billingCheckbox = form.querySelector('[name="defaultBilling"]')?.closest('.manage-address-checkbox');
  if (billingCheckbox) billingCheckbox.querySelector('.checkbox-text').textContent = labels.defaultBilling ?? 'Use as default billing address';

  const shippingCheckbox = form.querySelector('[name="defaultShipping"]')?.closest('.manage-address-checkbox');
  if (shippingCheckbox) shippingCheckbox.querySelector('.checkbox-text').textContent = labels.defaultShipping ?? 'Use as default shipping address';

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
  Object.entries(inputHints).forEach(([key, value]) => {
    const el = inputs[key];
    if (el) el.placeholder = value ?? '';
  });

  const submitBtn = form.querySelector('button[type="submit"]');
  const cancelBtn = form.querySelector('.manage-address-cancel');
  if (submitBtn) submitBtn.textContent = labels.saveAddress ?? 'Save address';
  if (cancelBtn) cancelBtn.textContent = labels.cancel ?? 'Cancel';

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
      submitButton.textContent = labels.sending ?? 'Sending...';
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
