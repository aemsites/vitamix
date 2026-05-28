import { attachFieldValidation } from './checkout-validation.js';

const SUBMIT_LOCK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

function getContactFields(strings) {
  return [
    {
      name: 'email', type: 'email', label: strings.email, required: true, autocomplete: 'email',
    },
    { name: 'newsletter', type: 'checkbox', label: strings.newsletter },
  ];
}

function getAddressFields(strings, isCanada) {
  return [
    {
      name: 'firstname', type: 'text', label: strings.firstName, required: true, autocomplete: 'given-name', width: 'half', maxlength: 50,
    },
    {
      name: 'lastname', type: 'text', label: strings.lastName, required: true, autocomplete: 'family-name', width: 'half', maxlength: 50,
    },
    {
      name: 'street-0', type: 'text', label: strings.address, required: true, autocomplete: 'address-line1',
    },
    {
      name: 'street-1', type: 'text', label: strings.addressLine2, autocomplete: 'address-line2',
    },
    {
      name: 'city', type: 'text', label: strings.city, required: true, autocomplete: 'address-level2', width: 'third',
    },
    {
      name: 'state', type: 'select', label: isCanada ? strings.province : strings.state, required: true, autocomplete: 'address-level1', width: 'third',
    },
    {
      name: 'zip', type: 'text', label: isCanada ? strings.postalCode : strings.zip, required: true, autocomplete: 'postal-code', width: 'third', inputmode: isCanada ? undefined : 'numeric',
    },
    {
      name: 'telephone', type: 'tel', label: strings.phone, autocomplete: 'tel', format: 'phone', maxlength: 14,
    },
  ];
}

// North American Numbering Plan: (555) 123-4567
export function formatPhoneDisplay(raw) {
  let digits = raw.replace(/\D/g, '');
  // Strip the +1 country code if present — North America only, so leading digit is always 1
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function attachPhoneFormatter(input) {
  input.addEventListener('input', () => {
    const { selectionStart } = input;
    const digitsBefore = input.value.slice(0, selectionStart).replace(/\D/g, '').length;

    const formatted = formatPhoneDisplay(input.value);
    input.value = formatted;

    // Restore cursor to the same logical digit position
    let newPos = formatted.length;
    if (digitsBefore === 0) {
      newPos = 0;
    } else {
      let count = 0;
      for (let i = 0; i < formatted.length; i += 1) {
        if (/\d/.test(formatted[i])) count += 1;
        if (count === digitsBefore) { newPos = i + 1; break; }
      }
    }
    // Advance past any trailing punctuation so cursor lands on the next digit
    while (newPos < formatted.length && !/\d/.test(formatted[newPos])) newPos += 1;

    input.setSelectionRange(newPos, newPos);
  });

  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    input.value = formatPhoneDisplay(pasted);
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function buildBreakdownRow(label, cls) {
  const row = document.createElement('div');
  row.className = 'order-breakdown-row';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = cls;
  row.append(labelEl, valueEl);
  return row;
}

/**
 * Creates a floating-label field wrapper.
 * @param {Object} field
 * @param {string} namePrefix
 * @returns {HTMLElement}
 */
function buildField(field, namePrefix = '') {
  const fullName = `${namePrefix}${field.name}`;

  if (field.type === 'checkbox') {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-field form-field-checkbox';
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = fullName;
    input.id = fullName;
    const span = document.createElement('span');
    span.textContent = field.label;
    label.append(input, span);
    wrapper.appendChild(label);
    return wrapper;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'form-field floating-label-field';
  if (field.width) wrapper.classList.add(`field-${field.width}`);

  let input;
  if (field.type === 'select') {
    input = document.createElement('select');
    // select doesn't support :placeholder-shown — use has-value class toggle
    input.addEventListener('change', () => {
      input.classList.toggle('has-value', !!input.value);
    });
  } else {
    input = document.createElement('input');
    input.type = field.type;
    input.placeholder = ' ';
    if (field.autocomplete) input.autocomplete = field.autocomplete;
    if (field.inputmode) input.inputMode = field.inputmode;
    if (field.maxlength) input.maxLength = field.maxlength;
    if (field.format === 'phone') attachPhoneFormatter(input);
  }

  input.name = fullName;
  input.id = fullName;
  if (field.required) input.required = true;

  attachFieldValidation(input);

  const label = document.createElement('label');
  label.htmlFor = fullName;
  label.textContent = field.label;

  wrapper.append(input, label);
  return wrapper;
}

/**
 * Builds an address fieldset for the given prefix.
 * @param {string} prefix
 * @param {string} legend
 * @param {Object} strings
 * @param {boolean} isCanada
 * @returns {HTMLElement}
 */
function buildAddressSection(prefix, legend, strings, isCanada) {
  const section = document.createElement('div');
  section.className = `form-section ${prefix.replace('-', '')}-address-section`;

  const heading = document.createElement('h3');
  heading.textContent = legend;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'form-fields';
  getAddressFields(strings, isCanada).forEach((field) => {
    grid.appendChild(buildField(field, prefix));
  });
  section.appendChild(grid);
  return section;
}

/**
 * Builds and returns the checkout form element.
 * @param {HTMLElement} container
 * @param {Object} config
 * @param {Object} strings
 * @returns {HTMLFormElement}
 */
export default function buildForm(container, config, strings) {
  const isCanada = config.getLocale() === 'ca';
  const form = document.createElement('form');
  form.className = 'checkout-form';
  form.noValidate = true;
  form.dataset.locale = config.getLocale();
  form.dataset.lang = (config.getLanguage?.() || 'en').split('_')[0].toLowerCase();

  // Express checkout section (populated by checkout-payment.js)
  const expressSection = document.createElement('div');
  expressSection.className = 'form-section express-checkout-section';

  const expressHeader = document.createElement('div');
  expressHeader.className = 'express-checkout-header';
  const expressHeading = document.createElement('p');
  expressHeading.className = 'express-checkout-label';
  expressHeading.textContent = strings.expressCheckout;
  const expressTagline = document.createElement('p');
  expressTagline.className = 'express-checkout-tagline';
  expressTagline.textContent = strings.expressTagline;
  expressHeader.append(expressHeading, expressTagline);

  const expressButtons = document.createElement('div');
  expressButtons.className = 'express-checkout-buttons';

  const dividerText = document.createElement('p');
  dividerText.className = 'express-checkout-divider';
  dividerText.textContent = strings.expressOr;

  expressSection.append(expressHeader, expressButtons, dividerText);
  form.appendChild(expressSection);

  // Contact section
  const contactSection = document.createElement('div');
  contactSection.className = 'form-section contact-section';
  const contactHeading = document.createElement('h3');
  contactHeading.textContent = strings.contact;
  contactSection.appendChild(contactHeading);
  const contactFields = document.createElement('div');
  contactFields.className = 'form-fields';
  getContactFields(strings).forEach((field) => {
    contactFields.appendChild(buildField(field, ''));
  });
  contactSection.appendChild(contactFields);
  form.appendChild(contactSection);

  // Shipping address
  form.appendChild(buildAddressSection('shipping-', strings.shippingAddress, strings, isCanada));

  // Billing address section
  const billingSection = document.createElement('div');
  billingSection.className = 'form-section billing-section';

  const billingHeading = document.createElement('h3');
  billingHeading.textContent = strings.billingAddress;
  billingSection.appendChild(billingHeading);

  const billingSubtitle = document.createElement('p');
  billingSubtitle.className = 'billing-subtitle';
  billingSubtitle.textContent = strings.billingSubtitle;
  billingSection.appendChild(billingSubtitle);

  const billingOptions = document.createElement('div');
  billingOptions.className = 'billing-options';

  const sameCard = document.createElement('label');
  sameCard.className = 'billing-option-card';
  const sameRadio = document.createElement('input');
  sameRadio.type = 'radio';
  sameRadio.name = 'billing-choice';
  sameRadio.value = 'same';
  sameRadio.checked = true;
  const sameContent = document.createElement('div');
  sameContent.className = 'billing-option-content';
  const sameLabelSpan = document.createElement('span');
  sameLabelSpan.className = 'billing-option-label';
  sameLabelSpan.textContent = strings.billingSame;
  const sameDetail = document.createElement('span');
  sameDetail.className = 'billing-option-detail';
  sameContent.append(sameLabelSpan, sameDetail);
  sameCard.append(sameRadio, sameContent);

  const differentCard = document.createElement('label');
  differentCard.className = 'billing-option-card';
  const differentRadio = document.createElement('input');
  differentRadio.type = 'radio';
  differentRadio.name = 'billing-choice';
  differentRadio.value = 'different';
  const differentContent = document.createElement('div');
  differentContent.className = 'billing-option-content';
  const differentLabelSpan = document.createElement('span');
  differentLabelSpan.className = 'billing-option-label';
  differentLabelSpan.textContent = strings.billingDifferent;
  differentContent.appendChild(differentLabelSpan);
  differentCard.append(differentRadio, differentContent);

  billingOptions.append(sameCard, differentCard);
  billingSection.appendChild(billingOptions);

  const billingFieldsWrapper = document.createElement('div');
  billingFieldsWrapper.className = 'billing-fields-wrapper';
  billingFieldsWrapper.hidden = true;
  const billingGrid = document.createElement('div');
  billingGrid.className = 'form-fields';
  getAddressFields(strings, isCanada).forEach((field) => {
    billingGrid.appendChild(buildField(field, 'billing-'));
  });
  billingFieldsWrapper.appendChild(billingGrid);
  billingSection.appendChild(billingFieldsWrapper);

  form.appendChild(billingSection);

  // Shipping methods container (populated by checkout-shipping.js)
  const shippingMethodsContainer = document.createElement('fieldset');
  shippingMethodsContainer.className = 'form-section shipping-methods';
  const shippingLegend = document.createElement('legend');
  shippingLegend.textContent = strings.shipping;
  shippingMethodsContainer.appendChild(shippingLegend);
  form.appendChild(shippingMethodsContainer);

  // Gift message panel
  const giftSection = document.createElement('div');
  giftSection.className = 'form-section gift-message-section';

  const giftHeading = document.createElement('h3');
  giftHeading.textContent = strings.giftMessage;
  giftSection.appendChild(giftHeading);

  const giftCheckboxWrapper = document.createElement('div');
  giftCheckboxWrapper.className = 'form-field form-field-checkbox';
  const giftCheckboxLabel = document.createElement('label');
  const giftCheckbox = document.createElement('input');
  giftCheckbox.type = 'checkbox';
  giftCheckbox.name = 'is-gift';
  giftCheckbox.id = 'is-gift';
  const giftCheckboxSpan = document.createElement('span');
  giftCheckboxSpan.textContent = strings.isThisAGift;
  giftCheckboxLabel.append(giftCheckbox, giftCheckboxSpan);
  giftCheckboxWrapper.appendChild(giftCheckboxLabel);
  giftSection.appendChild(giftCheckboxWrapper);

  const giftMessageWrapper = document.createElement('div');
  giftMessageWrapper.className = 'gift-message-wrapper';
  giftMessageWrapper.hidden = true;

  const giftField = document.createElement('div');
  giftField.className = 'form-field floating-label-field';
  const giftTextarea = document.createElement('textarea');
  giftTextarea.name = 'gift-message';
  giftTextarea.id = 'gift-message';
  giftTextarea.maxLength = 250;
  giftTextarea.placeholder = ' ';
  giftTextarea.rows = 3;
  const giftLabel = document.createElement('label');
  giftLabel.htmlFor = 'gift-message';
  giftLabel.textContent = strings.giftMessagePlaceholder;
  const charCount = document.createElement('span');
  charCount.className = 'char-count';
  charCount.textContent = '0 / 250';
  giftTextarea.addEventListener('input', () => {
    charCount.textContent = `${giftTextarea.value.length} / 250`;
  });
  giftField.append(giftTextarea, giftLabel, charCount);
  giftMessageWrapper.appendChild(giftField);
  giftSection.appendChild(giftMessageWrapper);

  giftCheckbox.addEventListener('change', () => {
    giftMessageWrapper.hidden = !giftCheckbox.checked;
    if (giftCheckbox.checked) {
      giftTextarea.focus();
    } else {
      giftTextarea.value = '';
      charCount.textContent = '0 / 250';
    }
  });

  form.appendChild(giftSection);

  // Payment method section (populated by checkout-payment.js)
  const paymentSection = document.createElement('fieldset');
  paymentSection.className = 'form-section payment-method-section';
  const paymentLegend = document.createElement('legend');
  paymentLegend.textContent = strings.paymentMethod;
  paymentSection.appendChild(paymentLegend);
  form.appendChild(paymentSection);

  // Error container
  const errorContainer = document.createElement('div');
  errorContainer.className = 'checkout-error';
  errorContainer.hidden = true;
  form.appendChild(errorContainer);

  // Order total + submit panel
  const orderTotalSection = document.createElement('div');
  orderTotalSection.className = 'form-section order-total-section';

  const orderTotalLeft = document.createElement('div');
  orderTotalLeft.className = 'order-total-left';

  const orderTotalLabel = document.createElement('span');
  orderTotalLabel.className = 'order-total-label';
  orderTotalLabel.textContent = strings.orderTotal;

  const orderTotalAmount = document.createElement('span');
  orderTotalAmount.className = 'order-total-amount';
  orderTotalAmount.textContent = '--';

  const orderTotalTnc = document.createElement('p');
  orderTotalTnc.className = 'order-total-tnc';
  orderTotalTnc.textContent = strings.tnc;

  const breakdown = document.createElement('div');
  breakdown.className = 'order-total-breakdown';
  breakdown.append(
    buildBreakdownRow(strings.subtotal, 'order-breakdown-subtotal'),
    buildBreakdownRow(strings.shipping, 'order-breakdown-shipping'),
    buildBreakdownRow(strings.estimatedTaxes, 'order-breakdown-taxes'),
  );

  orderTotalLeft.append(orderTotalLabel, breakdown, orderTotalAmount, orderTotalTnc);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'button emphasis checkout-submit-btn';

  const lockIconSpan = document.createElement('span');
  lockIconSpan.className = 'submit-lock-icon';
  lockIconSpan.innerHTML = SUBMIT_LOCK_SVG;

  const submitText = document.createElement('span');
  submitText.className = 'submit-btn-text';
  submitText.textContent = strings.continueToPayment;

  submitBtn.append(lockIconSpan, submitText);
  orderTotalSection.append(orderTotalLeft, submitBtn);
  form.appendChild(orderTotalSection);

  container.appendChild(form);
  return form;
}

/**
 * Wires a form section to collapse into a compact summary bar after valid input.
 * @param {HTMLElement} section
 * @param {Object} opts
 * @param {function(): boolean} opts.getIsValid
 * @param {function(): string} opts.getSummary
 * @param {boolean} [opts.autoCollapse]
 * @param {Object} strings
 * @returns {{ collapse: function, expand: function }}
 */
export function initCollapse(section, opts = {}, strings = {}) {
  const { getIsValid, getSummary, autoCollapse = true } = opts;
  const title = section.querySelector('h3, legend')?.textContent || '';

  const bar = document.createElement('div');
  bar.className = 'section-collapsed-bar';
  bar.hidden = true;

  const checkIcon = document.createElement('span');
  checkIcon.className = 'section-check';
  checkIcon.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="11" r="11" fill="#111"/><path d="M6.5 11l3 3 6-6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const textBlock = document.createElement('div');
  textBlock.className = 'section-summary-text';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'section-summary-title';
  titleSpan.textContent = title;

  const detailSpan = document.createElement('span');
  detailSpan.className = 'section-summary-detail';

  textBlock.append(titleSpan, detailSpan);

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'section-edit-btn';
  editBtn.textContent = strings.edit || 'Edit';

  bar.append(checkIcon, textBlock, editBtn);
  section.prepend(bar);

  const collapse = () => {
    if (!getIsValid?.()) return;
    detailSpan.textContent = getSummary?.() || '';
    bar.hidden = false;
    section.classList.add('is-collapsed');
  };

  const expand = () => {
    bar.hidden = true;
    section.classList.remove('is-collapsed');
    // Re-sync floating label state: browsers may not re-evaluate :placeholder-shown
    // after an ancestor transitions from display:none
    section.querySelectorAll('input[placeholder], textarea[placeholder]').forEach((el) => {
      if (el.value) {
        const { value } = el;
        el.value = '';
        el.value = value;
      }
    });
    section.querySelectorAll('select').forEach((el) => {
      el.classList.toggle('has-value', !!el.value);
    });
    const firstInput = section.querySelector(
      'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), select, textarea',
    );
    firstInput?.focus();
  };

  editBtn.addEventListener('click', expand);

  if (autoCollapse) {
    section.addEventListener('focusout', (e) => {
      if (section.contains(e.relatedTarget)) return;
      collapse();
    });
  }

  return { collapse, expand };
}
