import { debugLog, hasMarketingConsent } from './shared.js';
import {
  assignDigitalDataComponent,
  triggerLaunchEvent,
  whenSatelliteReady,
} from './adobe-runtime.js';

/**
 * Launch direct-call rule fired once a form.block submission is confirmed successful
 * (Adobe Analytics, Vitamix.com property — see Launch rule "form-submit"). Never fire
 * this on the raw DOM submit event — only after the backend has actually responded ok.
 */
const FORM_SUBMIT_EVENT = 'form-submit';

/** Launch direct-call rule fired when a form.block submission fails (non-2xx response
 *  or a thrown error), instead of form-submit. */
const FORM_ERROR_EVENT = 'formError';

/**
 * Set digitalData.component.form.formName and fire a form Launch direct-call rule.
 * @param {string} eventName Launch direct-call identifier (form-submit or formError)
 * @param {string} formName
 * @returns {void}
 */
function fireFormEvent(eventName, formName) {
  if (!hasMarketingConsent()) {
    return;
  }

  assignDigitalDataComponent({ form: { formName } });
  whenSatelliteReady(() => {
    triggerLaunchEvent(eventName, window.digitalData.component);
  }, eventName);
}

/**
 * Fire form-submit for a successful form.block submission.
 * @param {string} formName
 * @returns {void}
 */
export function fireFormSubmit(formName) {
  fireFormEvent(FORM_SUBMIT_EVENT, formName);
}

/**
 * Fire formError for a failed form.block submission.
 * @param {string} formName
 * @returns {void}
 */
export function fireFormError(formName) {
  fireFormEvent(FORM_ERROR_EVENT, formName);
}

let formEventsRegistered = false;

/** Reset form events registration state (for unit tests). */
export function resetFormEventsState() {
  formEventsRegistered = false;
}

/**
 * Listen for the form:submit-success / form:submit-error CustomEvents that
 * blocks/form/form.js dispatches once it knows the actual backend outcome (never on the
 * raw submit DOM event, which fires before that outcome is known), and fire the matching
 * Launch direct-call rule. Kept decoupled from block code — mirrors trackCartChange()'s
 * cart:change listener so blocks never import this instrumentation module directly.
 * @returns {void}
 */
export function trackFormEvents() {
  if (formEventsRegistered) return;
  formEventsRegistered = true;

  document.addEventListener('form:submit-success', (ev) => {
    fireFormSubmit(ev.detail?.formName || 'form');
  });
  document.addEventListener('form:submit-error', (ev) => {
    fireFormError(ev.detail?.formName || 'form');
  });

  debugLog('Adobe Analytics form-submit/formError tracking registered');
}
