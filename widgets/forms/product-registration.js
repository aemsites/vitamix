import { fetchPlaceholders } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/** Sheet logger endpoint for product registration form */
const SHEET_LOGGER_URL = 'https://sheet-logger.david8603.workers.dev/vitamix.com/forms-testing/product-registration';

const SELECT_OPTION_DEFAULT = 'Select an option';

/** Default "Purchased from" options (Label=value). Overridden by placeholder purchasedFromOptions. */
const DEFAULT_PURCHASED_FROM_OPTIONS = [
  'Amazon=amazon',
  'Best Buy=best-buy',
  'Canadian Tire=canadian-tire',
  'Costco=costco',
  "Hudson's Bay=hudsons-bay",
  'Other=other',
].join(',');

/** Default Province options (Label=value). Overridden by placeholder provinceOptions. */
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
 * Decorates the product-registration widget: applies placeholders and configures form.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.product-registration-form');
  if (!form) return;

  const { locale, language } = getLocaleAndLanguage();
  const p = await fetchPlaceholders(`/${locale}/${language}`);
  const get = (key, fallback = '') => (p[key] != null && p[key] !== '' ? p[key] : fallback);

  const selectOption = get('selectAnOption', SELECT_OPTION_DEFAULT);

  const labels = {
    aboutYourBlender: get('aboutYourBlender', 'About your blender'),
    serialNumber: get('serialNumber', 'Serial number'),
    serialNumberHint: get('18Digits', '(18 digits)'),
    findYourSerialNumber: get('findYourSerialNumber', 'Find your serial number'),
    iPlanToUseIt: get('iPlanToUseIt', 'I plan to use it'),
    atHome: get('atHome', 'At home'),
    inABusiness: get('inABusiness', 'In a business'),
    purchasedFrom: get('purchasedFrom', 'Purchased from'),
    purchasedOn: get('purchasedOn', 'Purchased on'),
    aboutYou: get('aboutYou', 'About you'),
    firstName: get('firstName', 'First Name'),
    lastName: get('lastName', 'Last Name'),
    address: get('address', 'Address'),
    addressLine2: get('addressLine2', 'Address Line 2'),
    city: get('city', 'City'),
    province: get('province', 'Province'),
    postalCode: get('postalCode', 'Postal code'),
    phoneNumber: get('phoneNumber', 'Phone Number'),
    emailAddress: get('emailAddress', 'Email Address'),
    sendNewsPromotionsOptional: get('sendNewsPromotionsOptional',
      'Please send the latest Vitamix news and promotions to my email address. (optional)'),
    emailConsentDisclaimer: get('emailConsentDisclaimer', ''),
    iAcceptTermsPrivacy: get('iAcceptTermsPrivacy',
      'I accept the terms & conditions and Vitamix\'s privacy policy.'),
    clickHereToConsult: get('clickHereToConsult', 'Click here to consult our '),
    privacyPolicyLinkText: get('privacyPolicyLinkText', 'privacy policy'),
    andOur: get('andOur', ' and our '),
    termsOfUseLinkText: get('termsOfUseLinkText', 'terms of use.'),
    register: get('register', 'Register'),
    clearForm: get('clearForm', 'Clear form'),
    sending: get('sending', 'Sending...'),
  };

  const placeholders = {
    serialNumber: get('serialNumberPlaceholder'),
    purchasedFrom: selectOption,
    date: get('datePlaceholder', 'mm/dd/yyyy'),
    firstName: get('firstNamePlaceholder'),
    lastName: get('lastNamePlaceholder'),
    address: get('addressPlaceholder'),
    addressLine2: get('addressLine2Placeholder'),
    city: get('cityPlaceholder'),
    province: get('chooseYourProvince', 'Choose your province'),
    postalCode: get('postalCodePlaceholder'),
    phone: get('phoneNumberPlaceholder'),
    email: get('emailAddressPlaceholder', 'you@example.com'),
  };

  // Section legends
  const sectionLegends = form.querySelectorAll('.product-registration-section-legend .section-legend-text');
  if (sectionLegends[0]) sectionLegends[0].textContent = labels.aboutYourBlender;
  if (sectionLegends[1]) sectionLegends[1].textContent = labels.aboutYou;

  // About your blender
  const serialLabel = form.querySelector('[for="product-registration-serial-number"] .label-text');
  if (serialLabel) serialLabel.textContent = labels.serialNumber;
  const hintEl = form.querySelector('#product-registration-serial-number-hint');
  if (hintEl) hintEl.textContent = labels.serialNumberHint;
  const serialInput = form.querySelector('#product-registration-serial-number');
  if (serialInput && placeholders.serialNumber) serialInput.placeholder = placeholders.serialNumber;

  const findLink = form.querySelector('.find-serial-link');
  if (findLink) findLink.textContent = labels.findYourSerialNumber;

  const radioLegend = form.querySelector('.product-registration-radio-group .radio-legend');
  if (radioLegend) radioLegend.textContent = labels.iPlanToUseIt;
  const radioLabels = form.querySelectorAll('.product-registration-radio-group .radio-label');
  if (radioLabels[0]) radioLabels[0].textContent = labels.atHome;
  if (radioLabels[1]) radioLabels[1].textContent = labels.inABusiness;

  const purchasedFromLabel = form.querySelector('[for="product-registration-purchased-from"] .label-text');
  if (purchasedFromLabel) purchasedFromLabel.textContent = labels.purchasedFrom;
  const purchasedFromSelect = form.querySelector('#product-registration-purchased-from');
  if (purchasedFromSelect?.firstElementChild) {
    purchasedFromSelect.firstElementChild.textContent = placeholders.purchasedFrom;
  }
  const purchasedFromOptions = get('purchasedFromOptions') || DEFAULT_PURCHASED_FROM_OPTIONS;
  setSelectOptions(purchasedFromSelect,
    purchasedFromOptions.split(',').map((s) => s.trim()));

  const purchasedOnLabel = form.querySelector('[for="product-registration-purchased-on"] .label-text');
  if (purchasedOnLabel) purchasedOnLabel.textContent = labels.purchasedOn;

  // About you
  form.querySelector('[for="product-registration-first-name"] .label-text').textContent = labels.firstName;
  form.querySelector('[for="product-registration-last-name"] .label-text').textContent = labels.lastName;
  form.querySelector('[for="product-registration-address"] .label-text').textContent = labels.address;
  form.querySelector('[for="product-registration-address-line-2"] .label-text').textContent = labels.addressLine2;
  form.querySelector('[for="product-registration-city"] .label-text').textContent = labels.city;
  form.querySelector('[for="product-registration-province"] .label-text').textContent = labels.province;
  form.querySelector('[for="product-registration-postal-code"] .label-text').textContent = labels.postalCode;
  form.querySelector('[for="product-registration-phone"] .label-text').textContent = labels.phoneNumber;
  form.querySelector('[for="product-registration-email"] .label-text').textContent = labels.emailAddress;

  const provinceSelect = form.querySelector('#product-registration-province');
  if (provinceSelect?.firstElementChild) {
    provinceSelect.firstElementChild.textContent = placeholders.province;
  }
  const provinceOptions = get('provinceOptions') || DEFAULT_PROVINCE_OPTIONS;
  setSelectOptions(provinceSelect, provinceOptions.split(',').map((s) => s.trim()));

  const inputs = {
    firstName: form.querySelector('#product-registration-first-name'),
    lastName: form.querySelector('#product-registration-last-name'),
    address: form.querySelector('#product-registration-address'),
    addressLine2: form.querySelector('#product-registration-address-line-2'),
    city: form.querySelector('#product-registration-city'),
    postalCode: form.querySelector('#product-registration-postal-code'),
    phone: form.querySelector('#product-registration-phone'),
    email: form.querySelector('#product-registration-email'),
  };
  Object.entries(placeholders).forEach(([key, value]) => {
    if (!value || key === 'purchasedFrom' || key === 'date' || key === 'province') return;
    const el = inputs[key];
    if (el) el.placeholder = value;
  });
  if (placeholders.date && form.querySelector('#product-registration-purchased-on')) {
    form.querySelector('#product-registration-purchased-on').setAttribute('placeholder', placeholders.date);
  }

  // Consent
  const marketingCheckboxText = form.querySelector('.product-registration-consent .checkbox-text');
  if (marketingCheckboxText) marketingCheckboxText.textContent = labels.sendNewsPromotionsOptional;
  const termsCheckboxText = form.querySelector('.terms-text');
  if (termsCheckboxText) termsCheckboxText.textContent = labels.iAcceptTermsPrivacy;
  form.querySelector('.email-consent-disclaimer').textContent = labels.emailConsentDisclaimer;
  form.querySelector('.click-here-prefix').textContent = labels.clickHereToConsult;
  form.querySelector('.privacy-policy-link').textContent = labels.privacyPolicyLinkText;
  form.querySelector('.and-our').textContent = labels.andOur;
  form.querySelector('.terms-link').textContent = labels.termsOfUseLinkText;

  const submitBtn = form.querySelector('button[type="submit"]');
  const clearBtn = form.querySelector('.clear-form-btn');
  if (submitBtn) submitBtn.textContent = labels.register;
  if (clearBtn) clearBtn.textContent = labels.clearForm;

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
      const thankYouPath = `/${locale}/${language}/product-registration-thankyou`;
      window.location.href = thankYouPath;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Product registration form submission failed', err);
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitButton) {
        submitButton.textContent = submitButton.dataset.originalLabel || buttonLabel;
      }
    }
  });
}
