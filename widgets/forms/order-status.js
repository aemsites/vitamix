import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/** Sheet logger endpoint for order status lookup */
const SHEET_LOGGER_URL = 'https://sheet-logger.david8603.workers.dev/vitamix.com/forms-testing/order-status';

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
 * Decorates the order-status widget: applies copy from JSON and configures form.
 * Submits POST with JSON to sheet-logger and displays the response JSON below the form.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.order-status-form');
  const resultEl = widget.querySelector('.order-status-result');
  if (!form || !resultEl) return;

  const { locale, language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadFormCopy(lang);
  const labels = copy.labels || {};
  const placeholders = copy.placeholders || {};

  const submitBtn = form.querySelector('button[type="submit"]');

  form.querySelector('[for="order-status-order-number"] .label-text').textContent = labels.orderNumber ?? 'Order Number';
  if (submitBtn) submitBtn.textContent = labels.searchOrder ?? 'Search Order';

  const orderNumberInput = form.querySelector('#order-status-order-number');
  if (orderNumberInput) orderNumberInput.placeholder = placeholders.orderNumber ?? '';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.pageUrl = window.location.href;

    [...form.elements].forEach((el) => { el.disabled = true; });
    const originalSubmitText = submitBtn?.textContent;
    if (submitBtn) {
      submitBtn.dataset.originalLabel = originalSubmitText;
      submitBtn.textContent = labels.searching ?? 'Searching...';
    }
    resultEl.hidden = true;
    resultEl.textContent = '';

    try {
      const resp = await fetch(SHEET_LOGGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await resp.text();
      let result;
      try {
        result = text ? JSON.parse(text) : { status: resp.status, ok: resp.ok };
      } catch {
        result = { status: resp.status, ok: resp.ok, body: text };
      }
      resultEl.hidden = false;
      resultEl.textContent = JSON.stringify(result, null, 2);
      resultEl.classList.add('order-status-result-visible');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Order status lookup failed', err);
      resultEl.hidden = false;
      resultEl.textContent = JSON.stringify({ error: err.message }, null, 2);
      resultEl.classList.add('order-status-result-visible');
    } finally {
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitBtn) submitBtn.textContent = submitBtn.dataset.originalLabel || originalSubmitText;
    }
  });
}
