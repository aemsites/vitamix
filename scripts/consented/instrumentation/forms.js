import { debugLog, hasMarketingConsent } from './shared.js';
import {
  assignDigitalDataComponent,
  triggerLaunchEvent,
  whenSatelliteReady,
} from './adobe-runtime.js';

/**
 * Launch direct-call rule fired on every tracked form.block submission
 * (Adobe Analytics, Vitamix.com property — see Launch rule "form-submit").
 */
const FORM_SUBMIT_EVENT = 'form-submit';

/**
 * digitalData.component.form.formName by the identifying CSS class blocks/form/form.js's
 * enableSubmission() adds to the built <form> (see buildForm() →
 * enableFooterSignUp/enableNavSearch). Add an entry here whenever a new form.block
 * submission handler is wired up there.
 * @type {Record<string, string>}
 */
const FORM_NAME_BY_CLASS = {
  'footer-sign-up': 'footer-sign-up',
  'nav-search': 'nav-search',
};

/**
 * Resolve digitalData.component.form.formName for a submitted form.block <form>.
 * Falls back to a data-form-name override or the form id when no known class matches
 * (e.g. locator, or a future form type not yet added to FORM_NAME_BY_CLASS).
 * @param {HTMLFormElement} form
 * @returns {string}
 */
function resolveFormName(form) {
  const matchedClass = Object.keys(FORM_NAME_BY_CLASS)
    .find((className) => form.classList.contains(className));
  if (matchedClass) return FORM_NAME_BY_CLASS[matchedClass];
  return form.dataset.formName || form.id || 'form';
}

/**
 * Set digitalData.component.form.formName and fire the form-submit Launch direct-call rule.
 * @param {string} formName
 * @returns {void}
 */
export function fireFormSubmit(formName) {
  if (!hasMarketingConsent()) {
    return;
  }

  assignDigitalDataComponent({ form: { formName } });

  // triggerLaunchEvent() already logs the fired event + payload — no need to log again here.
  whenSatelliteReady(() => {
    triggerLaunchEvent(FORM_SUBMIT_EVENT, window.digitalData.component);
  }, FORM_SUBMIT_EVENT);
}

/**
 * Attach a submit-tracking listener to a form.block <form>, guarded against double-attach.
 * Runs alongside (not in place of) the block's own submit handler in blocks/form/form.js.
 * @param {HTMLFormElement} form
 */
function attachFormSubmitTracking(form) {
  if (form.dataset.formAnalyticsAttached) return;
  form.dataset.formAnalyticsAttached = 'true';

  form.addEventListener('submit', () => {
    fireFormSubmit(resolveFormName(form));
  });
}

/** Scan the page for loaded form.block forms and wire up any that aren't attached yet. */
function attachFormTargets() {
  document.querySelectorAll('.form-wrapper .form.block[data-form="loaded"] form')
    .forEach((form) => attachFormSubmitTracking(form));
}

let formEventsRegistered = false;

/** Reset form events registration state (for unit tests). */
export function resetFormEventsState() {
  formEventsRegistered = false;
}

/**
 * Register form-submit analytics on every form.block on the page (footer sign-up,
 * nav search, etc). form.block builds its <form> asynchronously (fetch + buildForm in
 * blocks/form/form.js) and flips data-form to "loaded" when done, so an initial scan is
 * followed by a MutationObserver watching for that flip — the same lazily-loaded-content
 * pattern trackSocialEvents() uses for the footer.
 * @returns {void}
 */
export function trackFormEvents() {
  if (formEventsRegistered) return;
  formEventsRegistered = true;

  attachFormTargets();

  const observer = new MutationObserver(() => attachFormTargets());
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-form'],
  });

  debugLog('Adobe Analytics form-submit tracking registered');
}
