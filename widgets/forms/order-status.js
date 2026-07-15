import { getLocaleAndLanguage } from '../../scripts/scripts.js';
import {
  loadOrderStatusCopy,
  performOrderStatusLookup,
  renderOrderStatusResult,
} from './order-status-lookup.js';

/**
 * Decorates the order-status widget: applies copy from JSON and configures form.
 * Submits POST with JSON to sheet-logger and displays the order result below the form.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const form = widget.querySelector('.order-status-form');
  const resultEl = widget.querySelector('.order-status-result');
  if (!form || !resultEl) return;

  const { language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  import('./util.js').then(({ setupFormValidation }) => setupFormValidation(form, lang));
  const copy = await loadOrderStatusCopy(lang);
  const labels = copy.labels || {};
  const inputHints = copy.inputPlaceholders || {};

  const submitBtn = form.querySelector('button[type="submit"]');

  form.querySelector('[for="order-status-order-number"] .label-text').textContent = labels.orderNumber ?? 'Order Number';
  if (submitBtn) submitBtn.textContent = labels.searchOrder ?? 'Search Order';

  const orderNumberInput = form.querySelector('#order-status-order-number');
  if (orderNumberInput) orderNumberInput.placeholder = inputHints.orderNumber ?? '';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const orderNumber = String(data.get('orderNumber') || '');

    [...form.elements].forEach((el) => { el.disabled = true; });
    const originalSubmitText = submitBtn?.textContent;
    if (submitBtn) {
      submitBtn.dataset.originalLabel = originalSubmitText;
      submitBtn.textContent = labels.searching ?? 'Searching...';
    }
    resultEl.hidden = true;
    resultEl.textContent = '';

    try {
      const result = await performOrderStatusLookup(orderNumber);
      renderOrderStatusResult(result, copy, resultEl, orderNumber);
      resultEl.hidden = false;
      resultEl.classList.add('order-status-result-visible');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Order status lookup failed', err);
      const { toast } = await import('./util.js');
      toast(labels.networkError ?? 'Could not reach the server. Please try again.', 'error');
    } finally {
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitBtn) submitBtn.textContent = submitBtn.dataset.originalLabel || originalSubmitText;
    }
  });
}
