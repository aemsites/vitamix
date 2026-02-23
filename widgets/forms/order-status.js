import { fetchPlaceholders } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/** Sheet logger endpoint for order status lookup */
const SHEET_LOGGER_URL = 'https://sheet-logger.david8603.workers.dev/vitamix.com/forms-testing/order-status';

/**
 * Decorates the order-status widget: applies placeholders and configures form.
 * Submits POST with JSON to sheet-logger and displays the response JSON below the form.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.order-status-form');
  const resultEl = widget.querySelector('.order-status-result');
  if (!form || !resultEl) return;

  const { locale, language } = getLocaleAndLanguage();
  const p = await fetchPlaceholders(`/${locale}/${language}`);
  const get = (key, fallback = '') => (p[key] != null && p[key] !== '' ? p[key] : fallback);

  // fetchPlaceholders stores by toCamelCase(Key), so we look up with camelCase keys
  const labels = {
    orderNumber: get('orderNumber', 'Order Number'),
    submit: get('searchOrder', 'Search Order'),
    sending: get('searching', 'Searching...'),
  };
  const placeholders = {
    orderNumber: get('orderNumberPlaceholder'),
  };

  form.querySelector('[for="order-status-order-number"] .label-text').textContent = labels.orderNumber;
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = labels.submit;

  const orderNumberInput = form.querySelector('#order-status-order-number');
  if (orderNumberInput && placeholders.orderNumber) {
    orderNumberInput.placeholder = placeholders.orderNumber;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.pageUrl = window.location.href;

    [...form.elements].forEach((el) => { el.disabled = true; });
    const originalSubmitText = submitBtn?.textContent;
    if (submitBtn) {
      submitBtn.dataset.originalLabel = originalSubmitText;
      submitBtn.textContent = labels.sending;
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
