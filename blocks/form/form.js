import { toCamelCase, toClassName } from '../../scripts/aem.js';

/**
 * Creates an HTML element with an optional class name
 * @param {string} tag - HTML tag name
 * @param {string} [className] - Optional CSS class name
 * @returns {HTMLElement} Created element
 */
function createElement(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

/**
 * Generates a camelCase ID from a name and optional option
 * @param {string} name - Base name for the ID
 * @param {string} [option] - Optional value to append to the ID
 * @returns {string} Generated camelCase ID
 */
function generateId(name, option = null) {
  const id = toCamelCase(name);
  return option ? `${id}-${toCamelCase(option)}` : id;
}

/**
 * Creates a help text paragraph with a unique ID
 * @param {string} text - Help text content
 * @param {string} inputId - ID of the associated input field
 * @returns {HTMLParagraphElement} Help text element
 */
function writeHelpText(text, inputId) {
  const help = createElement('p', 'field-help-text');
  help.textContent = text;
  help.id = `${inputId}-help`;
  return help;
}

/**
 * Creates a label or legend element
 * @param {string} text - Label text content
 * @param {string} [type='label'] - Either 'label' or 'legend'
 * @param {string} [id] - ID of the associated input (for 'label' type only)
 * @returns {HTMLElement} Label or legend element
 */
function buildLabel(text, type = 'label', id = null) {
  const label = createElement(type);
  label.textContent = text;
  if (id && type === 'label') label.setAttribute('for', id);
  return label;
}

/**
 * Creates an input element with specified attributes
 * @param {Object} field - Field configuration object
 * @returns {HTMLInputElement} Input element
 */
function buildInput(field) {
  const {
    type, field: fieldName, required, default: defaultValue, placeholder,
  } = field;

  const input = createElement('input');
  input.type = type || 'text';
  input.id = generateId(fieldName);
  input.name = input.id;
  input.required = required === 'true';
  if (defaultValue) input.value = defaultValue;
  if (placeholder) input.placeholder = placeholder;
  return input;
}

/**
 * Creates a textarea element
 * @param {Object} field - Field configuration object
 * @returns {HTMLTextAreaElement} Textarea element
 */
function buildTextArea(field) {
  const {
    field: fieldName, required, default: defaultValue, placeholder,
  } = field;

  const textarea = createElement('textarea');
  textarea.id = generateId(fieldName);
  textarea.name = textarea.id;
  textarea.required = required === 'true';
  textarea.rows = 5;
  if (defaultValue) textarea.value = defaultValue;
  if (placeholder) textarea.placeholder = placeholder;
  return textarea;
}

/**
 * Creates a radio/checkbox input for an option
 * @param {Object} field - Field configuration object
 * @param {string} option - Option value
 * @returns {HTMLInputElement} Radio/checkbox input
 */
function buildOptionInput(field, option) {
  const {
    type, field: fieldName, default: defaultValue, required,
  } = field;
  const id = generateId(fieldName, option);

  const input = createElement('input');
  input.type = type;
  input.id = id;
  input.name = generateId(fieldName);
  input.value = option;
  input.checked = option === defaultValue;
  input.required = required === 'true';

  return input;
}

/**
 * Creates a fieldset containing radio/checkbox options
 * @param {Object} field - Field configuration object
 * @param {string} controlled - Controlled field name
 * @returns {HTMLFieldSetElement} Fieldset containing options
 */
function buildOptions(field, controlled) {
  const { type, options, label } = field;
  if (!options) return null;

  const fieldset = createElement('fieldset', `form-field ${type}-field`);
  if (controlled) {
    const controller = controlled.split('-')[0];
    fieldset.dataset.controller = controller;
    fieldset.dataset.condition = controlled;
  }
  fieldset.append(buildLabel(label, 'legend'));

  options.split(';').forEach((o) => {
    const option = o.trim();
    const input = buildOptionInput(field, option);
    const span = createElement('span');
    const labelEl = buildLabel(option, 'label', input.id);
    labelEl.prepend(input, span);
    fieldset.append(labelEl);
  });

  return fieldset;
}

/**
 * Creates a button element
 * @param {Object} field - Field configuration object
 * @returns {HTMLButtonElement} Button element
 */
function buildButton(field) {
  const { type, label } = field;
  const button = createElement('button');
  button.className = 'button';
  button.type = type;
  button.textContent = label;
  if (type === 'reset') button.classList.add('outline');
  if (type === 'submit') button.dataset.thankYou = field.options;
  return button;
}

/**
 * Toggles visibility of conditional fields based on the selected input
 * @param {Event} e - Change event
 * @param {Map} controllerConfig - Map of controller names to controlled fields
 */
function toggleConditional(e, controllerConfig) {
  const { target } = e;
  const controller = target.name;
  // check if this is a controlling input
  if (controllerConfig.has(controller)) {
    const inputs = [...controllerConfig.get(controller)];
    inputs.forEach((i) => {
      const field = i.closest('.form-field');
      const { condition } = field.dataset;
      const conditionMet = condition.includes(toClassName(target.value));
      field.setAttribute('aria-hidden', !conditionMet);

      // toggle required attribute based on visibility
      if (i.hasAttribute('required')) {
        if (conditionMet) i.setAttribute('required', '');
        else i.removeAttribute('required');
      }
    });
  }
}

/**
 * Sets initial visibility of conditional fields based on default values.
 * @param {HTMLFormElement} form - Form element
 * @param {Map} controllerConfig - Map of controller names to controlled fields.
 */
function initConditionals(form, controllerConfig) {
  // for each controller, find its current value and apply conditions
  controllerConfig.forEach((controlledInputs, controller) => {
    // find the checked input in the controller group
    const checked = form.querySelector(`[name="${controller}"]:checked`);

    if (checked) {
      // set correct visibility for each controlled field
      controlledInputs.forEach((input) => {
        const field = input.closest('.form-field');
        const { condition } = field.dataset;
        const conditionMet = condition.includes(toClassName(checked.value));
        field.setAttribute('aria-hidden', !conditionMet);

        // store original required state and toggle based on visibility
        if (input.hasAttribute('required')) {
          // store original required state if not already stored
          if (!input.dataset.originalRequired) {
            input.dataset.originalRequired = 'true';
          }

          if (!conditionMet) {
            input.removeAttribute('required');
          }
        }
      });
    } else {
      // if no input is checked, hide all controlled fields
      controlledInputs.forEach((input) => {
        const field = input.closest('.form-field');
        field.setAttribute('aria-hidden', true);

        // remove required attribute when hidden
        if (input.hasAttribute('required')) {
          // store original required state if not already stored
          if (!input.dataset.originalRequired) {
            input.dataset.originalRequired = 'true';
          }
          input.removeAttribute('required');
        }
      });
    }
  });
}

/**
 * Sets up conditional field visibility and ARIA relationships
 * @param {HTMLFormElement} form - Form element
 */
function enableConditionals(form) {
  // find controlled fields
  const controlled = [...form.querySelectorAll('[data-controller]')];

  // create a map of controller names to controlled fields
  const controllerConfig = new Map();

  controlled.forEach((c) => {
    const input = c.querySelector('input, textarea');
    const { controller } = c.dataset;

    // add to controller map
    if (!controllerConfig.has(controller)) controllerConfig.set(controller, []);
    controllerConfig.get(controller).push(input);

    // set up aria relationships
    if (input && input.id) {
      // find the controlling input(s)
      const controllerInputs = form.querySelectorAll(`[name="${controller}"]`);

      // set aria-controls on controlling inputs
      controllerInputs.forEach((controllerInput) => {
        // get existing aria-controls or initialize empty
        const existingControls = controllerInput.getAttribute('aria-controls') || '';
        const controlsArray = existingControls.split(' ').filter((ec) => ec);

        // add this input's id if not already present
        if (!controlsArray.includes(input.id)) {
          controlsArray.push(input.id);
        }

        // update aria-controls attribute
        controllerInput.setAttribute('aria-controls', controlsArray.join(' '));

        // set aria-controlledby on the controlled input
        input.setAttribute('aria-controlledby', controllerInput.id);
      });
    }
  });

  // initialize conditional visibility
  initConditionals(form, controllerConfig);

  // add single event listener for ALL controlling inputs
  form.addEventListener('change', (e) => {
    toggleConditional(e, controllerConfig);
  });
}

/**
 * Displays loading spinner in button.
 * @param {HTMLButtonElement} button - Button element.
 */
function showLoadingButton(button) {
  // preserves original size of the button
  const { width, height } = button.getBoundingClientRect();
  button.style.minWidth = `${width}px`;
  button.style.minHeight = `${height}px`;
  // stores original button text content
  button.dataset.label = button.textContent;
  button.innerHTML = '<i class="symbol symbol-loading"></i>';
}

/**
 * Resets button from loading state back to original appearance and content.
 * @param {HTMLButtonElement} button - Button element.
 */
function resetLoadingButton(button) {
  button.textContent = button.dataset.label;
  button.removeAttribute('style');
}

function toggleForm(form, disabled = true) {
  [...form.elements].forEach((el) => {
    el.disabled = disabled;
    if (el.type === 'submit') {
      if (disabled) showLoadingButton(el);
      else resetLoadingButton(el);
    }
  });
}

/**
 * Configures footer sign-up form with submission handling.
 * @param {HTMLFormElement} form - Footer sign-up form
 */
function enableFooterSignUp(form) {
  form.classList.add('footer-sign-up');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    // disable form and show loading button
    toggleForm(form);
    const entries = Object.fromEntries(data.entries());
    const { email, mobile, optIn } = entries;
    const country = window.location.pathname.split('/')[1];
    let leadSource = `sub-em-footer-${country}`;
    if (form.closest('dialog')) {
      leadSource = `sub-em-modal-${country}`;
    }
    const payload = {
      email,
      mobile,
      sms_optin: optIn ? '1' : '0',
      lead_source: leadSource,
      pageUrl: window.location.href,
      actionUrl: '/us/en_us/rest/V1/vitamix-api/newslettersubscribe',
    };
    const params = new URLSearchParams(payload);
    try {
      const resp = await fetch(`https://www.vitamix.com/bin/vitamix/newslettersubscription?${params.toString()}`);
      if (!resp.ok) {
        // eslint-disable-next-line no-console
        console.error('Failed to submit newsletter subscription', resp);
      }
      const { data: { message } } = await resp.json();
      // eslint-disable-next-line no-console
      console.log(message);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to submit newsletter subscription', error);
    }
    const thankYou = document.createElement('div');
    thankYou.className = 'form-thank-you';
    thankYou.innerHTML = `<p>${e.submitter.dataset.thankYou}</p>`;
    form.replaceWith(thankYou);
  });
}

/**
 * Configures nav search form with submission handling.
 * @param {HTMLFormElement} form - Nav search form
 */
function enableNavSearch(form) {
  form.classList.add('nav-search');
  const button = form.querySelector('button');
  button.classList.add('emphasis');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const { search } = Object.fromEntries(data.entries()) || '';
    window.location.href = `https://www.vitamix.com/us/en_us/search-result?search=${search}`;
  });
}

/**
 * Enables form submission handling based on form path.
 * @param {HTMLFormElement} form - Form element
 * @param {string} path -Path associated with the form
 */
function enableSubmission(form, path) {
  if (path.includes('/footer-sign-up.json')) {
    enableFooterSignUp(form);
  } else if (path.includes('/nav-search.json')) {
    enableNavSearch(form);
  }
}

/**
 * Creates a form field based on field configuration
 * @param {Object} field - Field configuration object
 * @returns {HTMLElement} Form field element (fieldset, div, or button)
 */
function buildField(field) {
  const {
    type, label, help, field: fieldName, conditional,
  } = field;
  const controlled = conditional || null;

  // submit/reset buttons stand alone
  if (type === 'submit' || type === 'reset') {
    return buildButton(field);
  }

  // radio/checkbox groups get a fieldset
  if (type === 'radio' || type === 'checkbox') {
    const fieldset = buildOptions(field, controlled);
    if (help) {
      const helpText = writeHelpText(help, generateId(fieldName));
      fieldset.append(helpText);
    }
    return fieldset;
  }

  // inputs and textareas get a wrapper div
  const wrapper = createElement('div', `form-field ${type}-field`);
  if (controlled) {
    const controller = controlled.split('-')[0];
    wrapper.dataset.controller = controller;
    wrapper.dataset.condition = controlled;
  }
  const inputId = generateId(fieldName);
  wrapper.append(buildLabel(label, 'label', inputId));

  // create help text first to get id
  let helpText;
  if (help) {
    helpText = writeHelpText(help, inputId);
    wrapper.append(helpText);
  }

  const input = type === 'textarea' ? buildTextArea(field) : buildInput(field);

  if (type === 'textarea') {
    wrapper.append(input);
  } else {
    wrapper.insertBefore(input, wrapper.firstChild.nextSibling);
  }

  if (help) input.setAttribute('aria-describedby', helpText.id);

  return wrapper;
}

/**
 * Creates a complete form from field configurations
 * @param {Array<Object>} fields - Array of field configurations
 * @returns {HTMLFormElement} Complete form element
 */
function buildForm(fields, path) {
  const form = createElement('form');

  // group buttons at the end
  const buttons = [];

  fields.forEach((field) => {
    if (field.type === 'submit' || field.type === 'reset') {
      buttons.push(field);
    } else {
      form.append(buildField(field));
    }
  });

  // add buttons in a wrapper (if any)
  if (buttons.length) {
    const buttonWrapper = createElement('div', 'button-wrapper');
    buttons.forEach((button) => buttonWrapper.append(buildField(button)));
    form.append(buttonWrapper);
  }

  enableConditionals(form);

  const named = form.querySelectorAll('[name]');
  named.forEach((n) => {
    const field = n.closest('.form-field');
    field.dataset.name = n.name;
  });

  enableSubmission(form, path);

  return form;
}

/**
 * Initializes form block with data from JSON endpoint
 * @param {HTMLElement} block - Form block element
 */
export default async function decorate(block) {
  block.style.visibility = 'hidden';
  block.dataset.form = 'unloaded';
  const path = new URL(block.querySelector('a').href).pathname;
  try {
    block.dataset.form = 'loading';
    const resp = await fetch(new URL(path, window.location.origin));
    if (!resp.ok) throw new Error(`${resp.status}: ${resp.statusText}`);
    const { data } = await resp.json();
    if (!data) throw new Error(`No form fields at ${path}`);
    const form = buildForm(data, path);
    block.replaceChildren(form);
    block.removeAttribute('style');
    block.dataset.form = 'loaded';
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Could not build form from', path, error);
    block.parentElement.remove();
  }
}
