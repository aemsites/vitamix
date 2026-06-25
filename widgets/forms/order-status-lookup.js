import { getLocaleAndLanguage, getFormSubmissionUrl } from '../../scripts/scripts.js';

/**
 * Loads localized order-status copy from the sibling `order-status.json`.
 *
 * @param {string} lang - Language key (en, fr, es)
 * @returns {Promise<Record<string, any>>} Copy object for the resolved language
 */
export async function loadOrderStatusCopy(lang) {
  const jsonPath = new URL('./order-status.json', import.meta.url).pathname;
  const url = `${window.hlx?.codeBasePath || ''}${jsonPath}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const key = data[lang] ? lang : 'en';
  return data[key];
}

/**
 * Derives a status key from the order-status API response.
 *
 * @param {Record<string, any>|null} result - Parsed API response
 * @returns {string} Status key matching a key in `result.statuses`
 */
export function deriveOrderStatusKey(result) {
  if (!result?.succeeded) return 'unavailable';
  if (result.outcome === 'Cancelled') return 'cancelled';
  const deliveries = result.order?.delivery ?? [];
  const shippedCount = deliveries.filter((d) => d.shipped).length;
  if (shippedCount === 0) return deliveries.length ? 'processed' : 'received';
  if (shippedCount < deliveries.length) return 'partiallyShipped';
  return 'shipped';
}

/**
 * Performs an order-status lookup against the forms endpoint.
 *
 * The order number is trimmed and lower-cased before submission so callers can pass merchant
 * order numbers verbatim.
 *
 * @param {string} orderNumber - Merchant order number to look up
 * @returns {Promise<Record<string, any>>} Parsed API response
 */
export async function performOrderStatusLookup(orderNumber) {
  const { locale, language } = getLocaleAndLanguage();
  const payload = {
    orderNumber: String(orderNumber ?? '').trim().toLowerCase(),
    formId: `${locale}/${language}/order-status`,
    pageUrl: window.location.href,
  };
  const resp = await fetch(getFormSubmissionUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  try {
    return text ? JSON.parse(text) : { status: resp.status, ok: resp.ok };
  } catch {
    return { status: resp.status, ok: resp.ok, body: text };
  }
}

/**
 * Renders the order-status result as a definition list into the given container.
 *
 * @param {Record<string, any>|null} result - Parsed API response
 * @param {Record<string, any>} copy - Localized order-status copy
 * @param {HTMLElement} container - Element to render into
 */
export function renderOrderStatusResult(result, copy, container) {
  const resultLabels = copy.result?.labels ?? {};
  const resultStatuses = copy.result?.statuses ?? {};

  const orderNumber = result?.order?.key ?? '—';
  const statusKey = deriveOrderStatusKey(result);
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
 * Renders the full list of order-status definitions (label + description) into the container.
 * Intended to be shown on demand (e.g. after a status check), not by default.
 *
 * @param {Record<string, any>} copy - Localized order-status copy
 * @param {HTMLElement} container - Element to render into
 */
export function renderOrderStatusDefinitions(copy, container) {
  const statuses = copy.result?.statuses ?? {};
  const descriptions = copy.result?.descriptions ?? {};
  const heading = copy.result?.definitionsTitle;

  container.replaceChildren();
  if (heading) {
    const h = document.createElement('p');
    h.className = 'order-status-definitions-title';
    h.textContent = heading;
    container.append(h);
  }

  const dl = document.createElement('dl');
  dl.className = 'order-status-definitions-list';
  Object.keys(statuses).forEach((key) => {
    const div = document.createElement('div');
    div.className = 'order-status-definitions-row';
    const dt = document.createElement('dt');
    dt.textContent = statuses[key];
    div.append(dt);
    if (descriptions[key]) {
      const dd = document.createElement('dd');
      dd.textContent = descriptions[key];
      div.append(dd);
    }
    dl.append(div);
  });
  container.append(dl);
}
