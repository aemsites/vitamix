import { getLocaleAndLanguage } from '../../scripts/scripts.js';

async function loadFormCopy(lang) {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const url = `${(window.hlx && window.hlx.codeBasePath) || ''}${jsonPath}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const key = data[lang] ? lang : 'en';
  return data[key];
}

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

  const emailLabel = form.querySelector('[for="giveaway-email"]');
  if (emailLabel) emailLabel.textContent = labels.email ?? 'Enter your Email';

  const emailInput = form.querySelector('#giveaway-email');
  if (emailInput) emailInput.placeholder = inputHints.email ?? '';

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.submit ?? 'Sign up';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.pageUrl = window.location.href;
    payload.lead_source = widget.dataset.leadsource || '';
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
      thankYou.className = 'giveaway-thank-you';
      thankYou.textContent = labels.thankYou ?? 'Thank you for entering.';
      form.replaceWith(thankYou);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Giveaway form submission failed', err);
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitBtn) {
        submitBtn.textContent = submitBtn.dataset.originalLabel || (labels.submit ?? 'Sign up');
      }
    }
  });
}
