import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/**
 * Loads form copy from the widget's local JSON (same name as the script).
 * @param {string} lang - Language key (en, fr, es)
 * @returns {Promise<Object>} Form copy for that language
 */
async function loadFormCopy(lang) {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const url = `${window.hlx?.codeBasePath || ''}${jsonPath}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const key = data[lang] ? lang : 'en';
  return data[key];
}

/**
 * Decorates the simple-search widget: loads copy from JSON and configures form to submit as GET.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.simple-search-form');
  const input = widget.querySelector('#simple-search-input');
  const submitBtn = widget.querySelector('button[type="submit"]');
  const label = widget.querySelector('label[for="simple-search-input"]');

  if (!form || !input) return;

  const { locale, language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadFormCopy(lang);
  const labels = copy.labels || {};

  const searchHint = labels.search ?? 'Search';
  const goLabel = labels.go ?? 'Go';

  input.placeholder = searchHint;
  input.setAttribute('aria-label', searchHint);
  if (submitBtn) submitBtn.textContent = goLabel;
  if (label) label.textContent = searchHint;

  form.action = `/${locale}/${language}/search-result`;
  form.method = 'get';
}
