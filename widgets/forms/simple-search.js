import { fetchPlaceholders } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/**
 * Decorates the simple-search widget: loads placeholders and configures form to submit as GET.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.simple-search-form');
  const input = widget.querySelector('#simple-search-input');
  const submitBtn = widget.querySelector('button[type="submit"]');
  const label = widget.querySelector('label[for="simple-search-input"]');

  if (!form || !input) return;

  const { locale, language } = getLocaleAndLanguage();
  const placeholders = await fetchPlaceholders(`/${locale}/${language}`);

  const searchPlaceholder = placeholders.search || 'Search';
  const goLabel = placeholders.go || 'Go';

  input.placeholder = searchPlaceholder;
  input.setAttribute('aria-label', searchPlaceholder);
  if (submitBtn) submitBtn.textContent = goLabel;
  if (label) label.textContent = searchPlaceholder;

  form.action = `/${locale}/${language}/search-result`;
  form.method = 'get';
  // name="search" on input yields ?search=... in query string
}
