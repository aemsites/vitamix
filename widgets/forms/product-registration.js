import { getFormSubmissionUrl, getLocaleAndLanguage } from '../../scripts/scripts.js';
import getStatesProvincesOptions from './states-provinces.js';

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
 * Decorates the product-registration widget: applies copy from JSON and configures form.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.product-registration-form');
  if (!form) return;

  const { locale, language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const countryCode = (locale || 'us').toUpperCase();
  const copy = await loadFormCopy(lang);
  const provinceOptions = await getStatesProvincesOptions(countryCode, lang).catch(() => []);
  const labels = copy.labels || {};
  const inputHints = copy.inputPlaceholders || {};
  const localeKey = (locale || 'us').toLowerCase();
  const byCountry = copy.purchasedFromOptionsByCountry;
  const purchasedFromOptions = byCountry?.[localeKey]
    ?? byCountry?.us
    ?? copy.purchasedFromOptions
    ?? [];

  const sectionLegends = form.querySelectorAll('.product-registration-section-legend .section-legend-text');
  if (sectionLegends[0]) sectionLegends[0].textContent = labels.aboutYourBlender ?? 'About your blender';
  if (sectionLegends[1]) sectionLegends[1].textContent = labels.aboutYou ?? 'About you';

  const serialLabel = form.querySelector('[for="product-registration-serial-number"] .label-text');
  if (serialLabel) serialLabel.textContent = labels.serialNumber ?? 'Serial number';
  const hintEl = form.querySelector('#product-registration-serial-number-hint');
  if (hintEl) hintEl.textContent = labels.serialNumberHint ?? '(18 digits)';
  const serialInput = form.querySelector('#product-registration-serial-number');
  if (serialInput) serialInput.placeholder = inputHints.serialNumber ?? '';

  const findLink = form.querySelector('.find-serial-link');
  if (findLink) findLink.textContent = labels.findYourSerialNumber ?? 'Find your serial number';

  const radioLegend = form.querySelector('.product-registration-radio-group .radio-legend');
  if (radioLegend) radioLegend.textContent = labels.iPlanToUseIt ?? 'I plan to use it';
  const radioLabels = form.querySelectorAll('.product-registration-radio-group .radio-label');
  if (radioLabels[0]) radioLabels[0].textContent = labels.atHome ?? 'At home';
  if (radioLabels[1]) radioLabels[1].textContent = labels.inABusiness ?? 'In a business';

  const purchasedFromLabel = form.querySelector('[for="product-registration-purchased-from"] .label-text');
  if (purchasedFromLabel) purchasedFromLabel.textContent = labels.purchasedFrom ?? 'Purchased from';
  const purchasedFromSelect = form.querySelector('#product-registration-purchased-from');
  if (purchasedFromSelect?.firstElementChild) {
    purchasedFromSelect.firstElementChild.textContent = inputHints.selectOption ?? 'Select an option';
  }
  setSelectOptions(purchasedFromSelect, purchasedFromOptions);

  const purchasedOnLabel = form.querySelector('[for="product-registration-purchased-on"] .label-text');
  if (purchasedOnLabel) purchasedOnLabel.textContent = labels.purchasedOn ?? 'Purchased on';

  form.querySelector('[for="product-registration-first-name"] .label-text').textContent = labels.firstName ?? 'First Name';
  form.querySelector('[for="product-registration-last-name"] .label-text').textContent = labels.lastName ?? 'Last Name';
  form.querySelector('[for="product-registration-address"] .label-text').textContent = labels.address ?? 'Address';
  form.querySelector('[for="product-registration-address-line-2"] .label-text').textContent = labels.addressLine2 ?? 'Address Line 2';
  form.querySelector('[for="product-registration-city"] .label-text').textContent = labels.city ?? 'City';
  const regionLabel = countryCode === 'CA' ? (labels.province ?? 'Province') : (labels.state ?? 'State');
  form.querySelector('[for="product-registration-province"] .label-text').textContent = regionLabel;
  form.querySelector('[for="product-registration-postal-code"] .label-text').textContent = labels.postalCode ?? 'Postal code';
  form.querySelector('[for="product-registration-phone"] .label-text').textContent = labels.phoneNumber ?? 'Phone Number';
  form.querySelector('[for="product-registration-email"] .label-text').textContent = labels.emailAddress ?? 'Email Address';

  const provinceSelect = form.querySelector('#product-registration-province');
  const regionPlaceholder = countryCode === 'CA' ? (inputHints.province ?? 'Choose your province') : (inputHints.state ?? 'Choose your state');
  if (provinceSelect?.firstElementChild) {
    provinceSelect.firstElementChild.textContent = regionPlaceholder;
  }
  setSelectOptions(provinceSelect, provinceOptions);

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
  if (inputs.firstName) inputs.firstName.placeholder = inputHints.firstName ?? '';
  if (inputs.lastName) inputs.lastName.placeholder = inputHints.lastName ?? '';
  if (inputs.address) inputs.address.placeholder = inputHints.address ?? '';
  if (inputs.addressLine2) inputs.addressLine2.placeholder = inputHints.addressLine2 ?? '';
  if (inputs.city) inputs.city.placeholder = inputHints.city ?? '';
  if (inputs.postalCode) inputs.postalCode.placeholder = inputHints.postalCode ?? '';
  if (inputs.phone) inputs.phone.placeholder = inputHints.phone ?? '';
  if (inputs.email) inputs.email.placeholder = inputHints.email ?? '';

  const purchasedOnInput = form.querySelector('#product-registration-purchased-on');
  if (purchasedOnInput && inputHints.date) purchasedOnInput.setAttribute('placeholder', inputHints.date);

  const marketingCheckboxText = form.querySelector('.product-registration-consent .checkbox-text');
  if (marketingCheckboxText) marketingCheckboxText.textContent = labels.sendNewsPromotionsOptional ?? 'Please send the latest Vitamix news and promotions to my email address. (optional)';
  const termsCheckboxText = form.querySelector('.terms-text');
  if (termsCheckboxText) termsCheckboxText.textContent = labels.iAcceptTermsPrivacy ?? "I accept the terms & conditions and Vitamix's privacy policy.";
  const emailConsentEl = form.querySelector('.email-consent-disclaimer');
  if (emailConsentEl) emailConsentEl.textContent = labels.emailConsentDisclaimer ?? '';
  form.querySelector('.click-here-prefix').textContent = labels.clickHereToConsult ?? 'Click here to consult our ';
  form.querySelector('.privacy-policy-link').textContent = labels.privacyPolicyLinkText ?? 'privacy policy';
  form.querySelector('.and-our').textContent = labels.andOur ?? ' and our ';
  form.querySelector('.terms-link').textContent = labels.termsOfUseLinkText ?? 'terms of use.';

  const submitBtn = form.querySelector('button[type="submit"]');
  const clearBtn = form.querySelector('.clear-form-btn');
  if (submitBtn) submitBtn.textContent = labels.register ?? 'Register';
  if (clearBtn) clearBtn.textContent = labels.clearForm ?? 'Clear form';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.formId = `${locale}/${language}/product-registration`;
    payload.pageUrl = window.location.href;

    const submitButton = form.querySelector('button[type="submit"]');
    const buttonLabel = submitButton?.textContent;
    [...form.elements].forEach((el) => { el.disabled = true; });
    if (submitButton) {
      submitButton.dataset.originalLabel = buttonLabel;
      submitButton.textContent = labels.sending ?? 'Sending...';
    }

    let didNavigate = false;
    try {
      const resp = await fetch(getFormSubmissionUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const { handleFormSubmitError } = await import('./util.js');
        await handleFormSubmitError(resp, form, labels.submissionFailed ?? 'Something went wrong. Please try again.');
        return;
      }
      didNavigate = true;
      const thankYouPath = `/${locale}/${language}/product-registration-thankyou`;
      window.location.href = thankYouPath;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Product registration form submission failed', err);
      const { toast } = await import('./util.js');
      toast(labels.networkError ?? 'Could not reach the server. Please try again.', 'error');
    } finally {
      if (!didNavigate) {
        [...form.elements].forEach((el) => { el.disabled = false; });
        if (submitButton) {
          submitButton.textContent = submitButton.dataset.originalLabel || buttonLabel;
        }
      }
    }
  });
}
