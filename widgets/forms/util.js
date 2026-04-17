import { loadCSS } from '../../scripts/aem.js';

const TOAST_DURATION_MS = 5000;
const TOAST_EXIT_MS = 250;

let toastContainer = null;
let toastCssLoaded = false;

function ensureToastContainer() {
  if (!toastCssLoaded) {
    loadCSS(`${window.hlx?.codeBasePath || ''}/widgets/forms/toast.css`);
    toastCssLoaded = true;
  }
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
function findMatchingInput(form, messages) {
  const namedInputs = [...form.querySelectorAll('[name]')]
    .filter((el) => el.name)
    .sort((a, b) => b.name.length - a.name.length);
  let match = null;
  messages.find((message) => {
    const lower = message.toLowerCase();
    const input = namedInputs.find((el) => lower.includes(el.name.toLowerCase()));
    if (input) match = { input, message };
    return !!input;
  });
  return match;
}

function applyInputError(input, message) {
  if (typeof input.setCustomValidity !== 'function') return;
  input.setCustomValidity(message);
  if (typeof input.reportValidity === 'function') input.reportValidity();
  const clear = () => {
    input.setCustomValidity('');
    input.removeEventListener('input', clear);
    input.removeEventListener('change', clear);
  };
  input.addEventListener('input', clear);
  input.addEventListener('change', clear);
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
