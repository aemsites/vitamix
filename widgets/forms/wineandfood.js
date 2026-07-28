import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/**
 * Fetches form copy from the co-located JSON file.
 * @returns {Promise<Object>} Parsed JSON with labels, dinners, and input placeholders.
 */
async function loadFormCopy() {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const url = `${(window.hlx && window.hlx.codeBasePath) || ''}${jsonPath}`;
  const resp = await fetch(url);
  return resp.json();
}

/**
 * Decorates the Wine and Food giveaway form widget with copy and submission handling.
 * @param {HTMLElement} widget - Widget container element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('form');
  if (!form) return;

  const { locale, language } = getLocaleAndLanguage();
  const copy = await loadFormCopy();
  const labels = copy.labels || {};

  const attendLegend = form.querySelector('.radio-group legend');
  if (attendLegend) attendLegend.textContent = labels.attendance ?? 'Did you attend a Wine and Food Dinner?';

  const [yesLabel, noLabel] = form.querySelectorAll('.radio-label');
  if (yesLabel) yesLabel.textContent = labels.yes ?? 'Yes';
  if (noLabel) noLabel.textContent = labels.no ?? 'No';

  const dinnerLabel = form.querySelector('[for="wf-dinner"]');
  if (dinnerLabel) dinnerLabel.textContent = labels.whichDinner ?? 'Which one?';

  const dinnerSelect = form.querySelector('#wf-dinner');
  if (dinnerSelect) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = (copy.inputPlaceholders && copy.inputPlaceholders.dinner) || 'Select Event';
    placeholder.disabled = true;
    placeholder.selected = true;
    dinnerSelect.append(placeholder);

    if (Array.isArray(copy.dinners)) {
      copy.dinners.forEach((dinnerName) => {
        const option = document.createElement('option');
        option.value = dinnerName;
        option.textContent = dinnerName;
        dinnerSelect.append(option);
      });
    }
  }

  const openTextLabel = form.querySelector('[for="wf-open-text"]');
  if (openTextLabel) openTextLabel.textContent = labels.openText ?? 'What would you make in a Vitamix Blender?';

  const emailLabel = form.querySelector('[for="wf-email"]');
  if (emailLabel) emailLabel.textContent = labels.email ?? 'Enter your Email';

  const emailInput = form.querySelector('#wf-email');
  if (emailInput && copy.inputPlaceholders) emailInput.placeholder = copy.inputPlaceholders.email || '';

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.submit ?? 'Sign up';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const params = new URLSearchParams();

    [...data.entries()].forEach(([key, val]) => params.append(key, val));
    params.set('pageUrl', window.location.href);
    params.set('lead_source', 'foodandwine');
    params.set('actionUrl', `/${locale}/${language}/rest/V1/partners`);

    [...form.elements].forEach((el) => { el.disabled = true; });
    if (submitBtn) {
      submitBtn.dataset.originalLabel = submitBtn.textContent;
      submitBtn.textContent = labels.sending ?? 'Sending...';
    }

    try {
      const resp = await fetch(`https://www.vitamix.com/bin/vitamix/partnerform?${params.toString()}`);
      if (!resp.ok) throw new Error(`Form submission failed with ${resp.status}`);
      const thankYou = document.createElement('p');
      thankYou.className = 'wf-thank-you';
      thankYou.textContent = labels.thankYou ?? 'Thank you for entering.';
      form.replaceWith(thankYou);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Wine and Food form submission failed', err);
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitBtn) {
        submitBtn.textContent = submitBtn.dataset.originalLabel || (labels.submit ?? 'Sign up');
      }
    }
  });
}
