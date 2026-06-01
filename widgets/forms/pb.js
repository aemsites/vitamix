import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/**
 * Fetches form copy from the co-located JSON file.
 * @returns {Promise<Object>} Parsed JSON with labels, dinners, and terms.
 */
async function loadFormCopy() {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const url = `${(window.hlx && window.hlx.codeBasePath) || ''}${jsonPath}`;
  const resp = await fetch(url);
  return resp.json();
}

/**
 * Decorates the Pebble Beach giveaway form widget with copy and submission handling.
 * @param {HTMLElement} widget - Widget container element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('form');
  if (!form) return;

  const { locale, language } = getLocaleAndLanguage();
  const copy = await loadFormCopy();
  const labels = copy.labels || {};

  const attendLegend = form.querySelector('.radio-group legend');
  if (attendLegend) attendLegend.textContent = labels.attendance ?? 'Did you attend a Vitamix Series Dining Event during the festival?';

  const [yesLabel, noLabel] = form.querySelectorAll('.radio-label');
  if (yesLabel) yesLabel.textContent = labels.yes ?? 'Yes';
  if (noLabel) noLabel.textContent = labels.no ?? 'No';

  const checkboxLegend = form.querySelector('.checkbox-group legend');
  if (checkboxLegend) checkboxLegend.textContent = labels.whichDinner ?? 'Which one?';

  const checkboxOptions = form.querySelector('.checkbox-options');
  if (checkboxOptions && Array.isArray(copy.dinners)) {
    copy.dinners.forEach((dinnerName) => {
      const label = document.createElement('label');
      label.className = 'checkbox-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'name_of_dinner';
      input.value = dinnerName;
      const span = document.createElement('span');
      span.className = 'checkbox-label';
      span.textContent = dinnerName;
      label.append(input, span);
      checkboxOptions.append(label);
    });
  }

  const openTextLabel = form.querySelector('[for="pb-open-text"]');
  if (openTextLabel) openTextLabel.textContent = labels.openText ?? 'Did you learn anything new about Vitamix Blenders?';

  const emailLabel = form.querySelector('[for="pb-email"]');
  if (emailLabel) emailLabel.textContent = labels.email ?? 'Enter your Email';

  const emailInput = form.querySelector('#pb-email');
  if (emailInput && copy.inputPlaceholders) emailInput.placeholder = copy.inputPlaceholders.email || '';

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.submit ?? 'Sign up';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const params = new URLSearchParams();

    [...data.entries()].forEach(([key, val]) => {
      if (key !== 'name_of_dinner') params.append(key, val);
    });
    data.getAll('name_of_dinner').forEach((val) => params.append('name_of_dinner', val));
    params.set('pageUrl', window.location.href);
    params.set('lead_source', 'PebbleBeach');
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
      thankYou.className = 'pb-thank-you';
      thankYou.textContent = labels.thankYou ?? 'Thank you for entering.';
      form.replaceWith(thankYou);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Pebble Beach form submission failed', err);
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitBtn) {
        submitBtn.textContent = submitBtn.dataset.originalLabel || (labels.submit ?? 'Sign up');
      }
    }
  });
}
