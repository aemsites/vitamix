import { fetchProductsIndexForLocale } from '../pim.js';
import { easternDatetimeLocalToIso, isoToEasternDatetimeLocal } from '../commerce-eastern-time.js';
import { convertSkuTable, promotionTsv } from './sku-tables.js';

const countrySelect = document.querySelector('#sku-tables-country');
const startInput = document.querySelector('#sku-tables-start');
const endInput = document.querySelector('#sku-tables-end');
const input = document.querySelector('#sku-tables-input');
const convertButton = document.querySelector('#sku-tables-convert');
const copyButton = document.querySelector('#sku-tables-copy');
const status = document.querySelector('#sku-tables-status');
const copyStatus = document.querySelector('#sku-tables-copy-status');
const results = document.querySelector('.sku-tables-results');
const tbody = document.querySelector('#sku-tables-rows');
const catalogCache = new Map();
let latest = null;
let requestId = 0;

function localesForCountry(country) {
  return country === 'ca' ? ['ca/en_us', 'ca/fr_ca'] : ['us/en_us'];
}

async function loadCatalog(locale) {
  if (!catalogCache.has(locale)) {
    const request = fetchProductsIndexForLocale(locale).then((json) => {
      const rows = Array.isArray(json) ? json : json?.data;
      if (!Array.isArray(rows) || !rows.length) throw new Error(`${locale} catalog index is empty.`);
      return rows;
    });
    catalogCache.set(locale, request);
    request.catch(() => catalogCache.delete(locale));
  }
  return catalogCache.get(locale);
}

function dateWindow() {
  const start = easternDatetimeLocalToIso(startInput.value);
  const end = easternDatetimeLocalToIso(endInput.value);
  if (!start || !end) return { error: 'Enter both start and end dates in Eastern Time.' };
  if (isoToEasternDatetimeLocal(start) !== startInput.value
    || isoToEasternDatetimeLocal(end) !== endInput.value) {
    return { error: 'The selected time does not exist in Eastern Time.' };
  }
  if (Date.parse(end) <= Date.parse(start)) return { error: 'End must be after start.' };
  return { start, end };
}

function appendCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = value;
  row.append(cell);
  return cell;
}

function updateCopyState() {
  const windowDates = dateWindow();
  copyButton.disabled = !latest?.canCopy || Boolean(windowDates.error);
  copyStatus.textContent = latest?.rows.length ? (windowDates.error || (latest.canCopy
    ? '' : 'Resolve conversion errors before copying.')) : '';
}

function renderTable(conversion) {
  tbody.replaceChildren();
  conversion.rows.forEach((item) => {
    const row = document.createElement('tr');
    if (item.issues.length) row.classList.add('sku-tables-error');
    else if (item.warnings.length) row.classList.add('sku-tables-warning');
    appendCell(row, item.sku);
    appendCell(row, startInput.value.replace('T', ' '));
    appendCell(row, endInput.value.replace('T', ' '));
    appendCell(row, item.path);
    appendCell(row, item.regular);
    appendCell(row, item.sale);
    const issueCell = appendCell(row, [...new Set([...item.issues, ...item.warnings])].join(' '));
    if (item.issues.length) issueCell.setAttribute('aria-label', `Error: ${issueCell.textContent}`);
    tbody.append(row);
  });
  results.hidden = false;
  const errors = conversion.rows.filter((row) => row.issues.length).length;
  const warnings = conversion.rows.filter((row) => row.warnings.length).length;
  status.textContent = `${conversion.inputCount} SKU rows, ${conversion.rows.length} promotion rows. ${errors} errors, ${warnings} warnings.`;
  updateCopyState();
}

async function convert() {
  requestId += 1;
  const currentRequest = requestId;
  latest = null;
  copyButton.disabled = true;
  results.hidden = true;
  status.textContent = 'Loading catalog...';
  try {
    const locales = localesForCountry(countrySelect.value);
    const indexes = await Promise.all(locales.map(loadCatalog));
    if (currentRequest !== requestId) return;
    const conversions = locales.map((locale, index) => (
      convertSkuTable(input.value, indexes[index], locale)
    ));
    const rows = conversions.flatMap((conversion) => conversion.rows);
    latest = {
      rows,
      inputCount: conversions[0].inputCount,
      canCopy: rows.length > 0 && conversions.every((conversion) => conversion.canCopy),
    };
    renderTable(latest);
  } catch (error) {
    if (currentRequest === requestId) status.textContent = `Could not load catalog: ${error.message}`;
  }
}

convertButton.addEventListener('click', convert);
countrySelect.addEventListener('change', convert);
input.addEventListener('input', () => {
  requestId += 1;
  latest = null;
  copyButton.disabled = true;
  results.hidden = true;
  status.textContent = 'Convert table to refresh the preview.';
});
[startInput, endInput].forEach((field) => field.addEventListener('change', () => {
  if (latest) renderTable(latest);
}));
copyButton.addEventListener('click', async () => {
  const dates = dateWindow();
  if (!latest?.canCopy || dates.error) return;
  try {
    await navigator.clipboard.writeText(promotionTsv(latest.rows, dates.start, dates.end));
    copyStatus.textContent = 'Copied promotion table.';
  } catch {
    copyStatus.textContent = 'Clipboard unavailable. Check browser permissions and try again.';
  }
});
loadCatalog('us/en_us').then((rows) => {
  if (countrySelect.value === 'us' && !latest) status.textContent = `${rows.length} catalog rows loaded.`;
}).catch((error) => {
  if (countrySelect.value === 'us') status.textContent = `Could not load catalog: ${error.message}`;
});
