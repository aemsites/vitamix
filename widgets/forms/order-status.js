import { getLocaleAndLanguage, getFormSubmissionUrl } from '../../scripts/scripts.js';

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
 * Derives a status key from the API response.
 * @param {Object|null} result - Parsed API response
 * @returns {string} Status key matching a key in result.statuses
 */
function deriveStatus(result) {
  if (!result?.succeeded) return 'unavailable';
  if (result.outcome === 'Cancelled') return 'cancelled';
  const deliveries = result.order?.delivery ?? [];
  const shippedCount = deliveries.filter((d) => d.shipped).length;
  if (shippedCount === 0) return deliveries.length ? 'processed' : 'received';
  if (shippedCount < deliveries.length) return 'partiallyShipped';
  return 'shipped';
}

/**
 * Renders the order result as a formatted definition list into the given container.
 * @param {Object|null} result - Parsed API response
 * @param {Object} copy - Localised copy for the current language
 * @param {HTMLElement} container - Element to render into
 */
function renderResult(result, copy, container) {
  const resultLabels = copy.result?.labels ?? {};
  const resultStatuses = copy.result?.statuses ?? {};

  const orderNumber = result?.order?.key ?? '—';
  const statusKey = deriveStatus(result);
  const orderStatus = resultStatuses[statusKey] ?? statusKey;

  const rows = [
    [resultLabels.orderNumber ?? 'Order Number', orderNumber],
    [resultLabels.orderStatus ?? 'Order Status', orderStatus],
  ];

  const dl = document.createElement('dl');
  dl.className = 'order-status-result-list';
  rows.forEach(([label, value]) => {
    const div = document.createElement('div');
    div.className = 'order-status-result-row';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    div.append(dt, dd);
    dl.append(div);
  });

  container.replaceChildren(dl);
}

/**
 * Decorates the order-status widget: applies copy from JSON and configures form.
 * Submits POST with JSON to sheet-logger and displays the order result below the form.
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
  const inputHints = copy.inputPlaceholders || {};

  const submitBtn = form.querySelector('button[type="submit"]');

  form.querySelector('[for="order-status-order-number"] .label-text').textContent = labels.orderNumber ?? 'Order Number';
  if (submitBtn) submitBtn.textContent = labels.searchOrder ?? 'Search Order';

  const orderNumberInput = form.querySelector('#order-status-order-number');
  if (orderNumberInput) orderNumberInput.placeholder = inputHints.orderNumber ?? '';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.formId = `${locale}/${language}/order-status`;
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
      const resp = await fetch(getFormSubmissionUrl(), {
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
      renderResult(result, copy, resultEl);
      resultEl.hidden = false;
      resultEl.classList.add('order-status-result-visible');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Order status lookup failed', err);
      renderResult(null, copy, resultEl);
      resultEl.hidden = false;
      resultEl.classList.add('order-status-result-visible');
    } finally {
      [...form.elements].forEach((el) => { el.disabled = false; });
      if (submitBtn) submitBtn.textContent = submitBtn.dataset.originalLabel || originalSubmitText;
    }
  });
}
