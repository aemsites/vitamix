import { loadCSS } from '../../scripts/aem.js';

const TOAST_DURATION_MS = 5000;
const TOAST_EXIT_MS = 250;

let toastContainer = null;
let formStylesLoaded = false;

function ensureFormStyles() {
  if (formStylesLoaded) return;
  loadCSS(`${window.hlx?.codeBasePath || ''}/widgets/forms/toast.css`);
  formStylesLoaded = true;
}

function ensureToastContainer() {
  ensureFormStyles();
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.setAttribute('role', 'status');
    toastContainer.setAttribute('aria-live', 'polite');
    document.body.append(toastContainer);
  }
  return toastContainer;
}

/**
 * Shows a dismissible toast message.
 * @param {string} message - Text to display
 * @param {'info'|'success'|'error'} [level] - Visual level; defaults to 'info'
 */
export function toast(message, level = 'info') {
  if (!message) return;
  const root = ensureToastContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${level}`;
  el.textContent = message;
  root.append(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => {
    el.classList.remove('toast-visible');
    setTimeout(() => el.remove(), TOAST_EXIT_MS);
  }, TOAST_DURATION_MS);
}

/**
 * Extracts candidate error messages from a 400 response in priority order:
 *   1. body.details[].message
 *   2. body.error
 *   3. 'x-error' response header
 */
function extractErrorMessages(response, body) {
  if (Array.isArray(body?.details)) {
    const messages = body.details
      .map((d) => d?.message)
      .filter((m) => typeof m === 'string' && m.trim());
    if (messages.length) return messages;
  }
  if (typeof body?.error === 'string' && body.error.trim()) {
    return [body.error];
  }
  const headerMessage = response?.headers?.get?.('x-error');
  if (headerMessage) return [headerMessage];
  return [];
}

/**
 * Finds the first input whose `name` attribute appears (case-insensitively)
 * inside one of the given messages.
 */
/**
 * Human-readable rewrites of field names: e.g. 'emailAddress' -> 'email address'.
 */
function splitCamel(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
    .trim();
}

/**
 * Alternate phrases that may appear in error messages -> canonical input name.
 */
const FIELD_ALIASES = {
  'purchase date': 'purchasedOn',
  'date of purchase': 'purchasedOn',
  'date purchased': 'purchasedOn',
  'purchase location': 'purchasedFrom',
  retailer: 'purchasedFrom',
  store: 'purchasedFrom',
  serial: 'serialNumber',
  zip: 'zipCode',
  postcode: 'postalCode',
  surname: 'lastName',
  'family name': 'lastName',
  'given name': 'firstName',
  forename: 'firstName',
};

function findMatchingInput(form, messages) {
  const namedInputs = [...form.querySelectorAll('[name]')].filter((el) => el.name);
  const inputsByName = new Map(namedInputs.map((el) => [el.name, el]));
  const candidates = [];
  namedInputs.forEach((input) => {
    const lower = input.name.toLowerCase();
    candidates.push({ keyword: lower, input });
    const split = splitCamel(input.name);
    if (split && split !== lower) candidates.push({ keyword: split, input });
  });
  Object.entries(FIELD_ALIASES).forEach(([alias, fieldName]) => {
    const input = inputsByName.get(fieldName);
    if (input) candidates.push({ keyword: alias.toLowerCase(), input });
  });
  candidates.sort((a, b) => b.keyword.length - a.keyword.length);
  let match = null;
  messages.find((message) => {
    const lower = message.toLowerCase();
    const c = candidates.find((cand) => lower.includes(cand.keyword));
    if (c) match = { input: c.input, message };
    return !!c;
  });
  return match;
}

/**
 * Returns the input's "field row" — the closest ancestor whose parent is the
 * form or a fieldset. This is where we render an inline error message.
 */
function getFieldWrapper(input) {
  let el = input;
  while (
    el?.parentElement
    && el.parentElement.tagName !== 'FORM'
    && el.parentElement.tagName !== 'FIELDSET'
  ) {
    el = el.parentElement;
  }
  return el;
}

function getOrCreateErrorElement(input) {
  const wrapper = getFieldWrapper(input);
  if (!wrapper) return null;
  let errorEl = wrapper.querySelector(':scope > .form-field-error');
  if (!errorEl) {
    errorEl = document.createElement('p');
    errorEl.className = 'form-field-error';
    errorEl.setAttribute('aria-live', 'polite');
    errorEl.hidden = true;
    wrapper.appendChild(errorEl);
  }
  return errorEl;
}

function showInlineError(input, message) {
  const errorEl = getOrCreateErrorElement(input);
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.hidden = false;
  input.setAttribute('aria-invalid', 'true');
}

function clearInlineError(input) {
  const wrapper = getFieldWrapper(input);
  const errorEl = wrapper?.querySelector(':scope > .form-field-error');
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }
  input.removeAttribute('aria-invalid');
}

function applyInputError(input, message) {
  if (typeof input.setCustomValidity !== 'function') return;
  input.setCustomValidity(message);
  showInlineError(input, message);
  if (typeof input.scrollIntoView === 'function') {
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  if (typeof input.focus === 'function') input.focus();
  const clear = () => {
    input.setCustomValidity('');
    clearInlineError(input);
    input.removeEventListener('input', clear);
    input.removeEventListener('change', clear);
  };
  input.addEventListener('input', clear);
  input.addEventListener('change', clear);
}

/**
 * Localized native validation messages, keyed by ValidityState flag.
 * `default` is the fallback when none of the more specific keys apply.
 */
const VALIDATION_MESSAGES = {
  en: {
    valueMissing: 'This field is required.',
    default: 'Please enter a valid value.',
  },
  fr: {
    valueMissing: 'Ce champ est obligatoire.',
    default: 'Veuillez saisir une valeur valide.',
  },
  es: {
    valueMissing: 'Este campo es obligatorio.',
    default: 'Por favor, introduzca un valor válido.',
  },
};

function pickValidationMessage(validity, messages) {
  if (validity.customError) return null;
  if (validity.valueMissing) return messages.valueMissing;
  if (validity.valid) return null;
  return messages.default;
}

/**
 * Installs localized native-validation messages on every form control.
 * Listens for `invalid` events and replaces the browser's default message
 * via setCustomValidity. Custom errors set by other code are not overridden.
 * @param {HTMLFormElement} form
 * @param {string} [lang] - Language key (en, fr, es); defaults to 'en'
 */
export function setupFormValidation(form, lang = 'en') {
  ensureFormStyles();
  const messages = VALIDATION_MESSAGES[lang] || VALIDATION_MESSAGES.en;
  [...form.querySelectorAll('input, select, textarea')].forEach((input) => {
    input.addEventListener('invalid', (e) => {
      e.preventDefault();
      const message = pickValidationMessage(input.validity, messages);
      if (message) {
        input.setCustomValidity(message);
        showInlineError(input, message);
      }
    });
    const clear = () => {
      if (input.validity.customError) input.setCustomValidity('');
      clearInlineError(input);
    };
    input.addEventListener('input', clear);
    input.addEventListener('change', clear);
  });

  form.addEventListener('submit', (e) => {
    if (form.checkValidity()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const firstInvalid = form.querySelector(':invalid');
    if (firstInvalid) {
      firstInvalid.focus();
      firstInvalid.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, true);
}

/**
 * Handles a non-ok form submission response. For a 400, extracts the preferred
 * error message and applies it inline to a matching input or shows a toast.
 * For any other non-ok status, shows a toast with the fallback message.
 * @param {Response} response - The fetch Response
 * @param {HTMLFormElement} form - Form whose inputs may be matched by field name
 * @param {string} fallbackMessage - Shown when no structured error is found
 * @returns {Promise<void>}
 */
export async function handleFormSubmitError(response, form, fallbackMessage) {
  if (response?.status === 400) {
    let body = null;
    try {
      const text = await response.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const messages = extractErrorMessages(response, body);
    if (messages.length) {
      const match = findMatchingInput(form, messages);
      if (match) {
        applyInputError(match.input, match.message);
        return;
      }
      toast(messages[0], 'error');
      return;
    }
  }
  if (fallbackMessage) toast(fallbackMessage, 'error');
}
