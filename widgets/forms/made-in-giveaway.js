import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/**
 * Loads form copy from the widget's local JSON (same name as the script).
 * @param {string} lang - Language key (en, fr, es)
 * @returns {Promise<Object>} Form copy for that language
 */
async function loadFormCopy(lang) {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const url = `${(window.hlx && window.hlx.codeBasePath) || ''}${jsonPath}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const key = data[lang] ? lang : 'en';
  return data[key];
}

/**
 * Decorates the made-in-giveaway widget: applies locale copy and handles form submission.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('form');
  if (!form) return;

  const { locale, language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadFormCopy(lang);
  const labels = copy.labels || {};
  const inputHints = copy.inputPlaceholders || {};

  const ownLegend = form.querySelector('.radio-group legend');
  if (ownLegend) ownLegend.textContent = labels.ownsVitamix ?? 'Do you own a Vitamix?';

  const [yesLabel, noLabel] = form.querySelectorAll('.radio-label');
  if (yesLabel) yesLabel.textContent = labels.yes ?? 'Yes';
  if (noLabel) noLabel.textContent = labels.no ?? 'No';

  const emailLabel = form.querySelector('[for="made-in-giveaway-email"]');
  if (emailLabel) emailLabel.textContent = labels.email ?? 'Enter your Email';

  const emailInput = form.querySelector('#made-in-giveaway-email');
  if (emailInput) emailInput.placeholder = inputHints.email ?? '';

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.submit ?? 'Sign up';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.pageUrl = window.location.href;
    payload.lead_source = submitBtn ? submitBtn.dataset.leadsource : 'madein';
    // actionUrl tells the backend which Magento endpoint to proxy the submission to
    payload.actionUrl = `/${locale}/${language}/rest/V1/partners`;

    [...form.elements].forEach((el) => { el.disabled = true; });
    if (submitBtn) {
      submitBtn.dataset.originalLabel = submitBtn.textContent;
      submitBtn.textContent = labels.sending ?? 'Sending...';
    }

    try {
      const params = new URLSearchParams(payload);
      const resp = await fetch(`https://www.vitamix.com/bin/vitamix/partnerform?${params.toString()}`);
      if (!resp.ok) throw new Error(`Form submission failed with ${resp.status}`);
      const thankYou = document.createElement('p');
      thankYou.className = 'made-in-giveaway-thank-you';
      thankYou.textContent = labels.thankYou ?? 'Thank you for entering.';
      form.replaceWith(thankYou);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Made in giveaway form submission failed', err);
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitBtn) {
        submitBtn.textContent = submitBtn.dataset.originalLabel || (labels.submit ?? 'Sign up');
      }
    }
  });
}
